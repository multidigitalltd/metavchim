import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { loadEnv } from "../../config/env";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { Sweep } from "../../core/sweeps";
import { PrismaService } from "../../core/prisma.service";
import { MarketIngest } from "./market-ingest";
import { MarketPropertyService } from "./market-property.service";
import {
  DEFAULT_MARKET_SOURCE_URL,
  MarketSourceFormatError,
  MarketSourceRateLimitError,
  OverOrgIlSource,
} from "./market-source";

/** סבב כל חצי שעה. כל סבב עובד עד 25 דקות ועוצר בעמוד שלם. */
const TICK_MS = 30 * 60 * 1000;
const RUN_BUDGET_MS = 25 * 60 * 1000;

/**
 * שלוש דקות אחרי העלייה — אחרי המיגרציות ואחרי סבב ההתאמות, שניהם
 * רצים בעלייה ומתחרים על אותם חיבורים.
 */
const FIRST_TICK_DELAY_MS = 3 * 60 * 1000;

/** סבב שמסומן „רץ” זמן רב מזה — נקטע (פריסה, קריסה) ולא רץ באמת. */
const STALE_RUN_MS = 2 * 60 * 60 * 1000;

/** רענון רשימת היישובים — פעם ביום. היא משתנה לאט. */
const CATALOG_EVERY_MS = 24 * 60 * 60 * 1000;

/** יישוב שהושלם נבדק שוב אחרי שבוע — המקור מתעדכן שבועית. */
const RESYNC_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * יישוב שנכשל מנוסה שוב רק אחרי שש שעות.
 *
 * תקלה זמנית נפתרת עד אז; תקלה קבועה (למשל יותר עסקאות ביום אחד ממה
 * שהמקור מחזיר בחיפוש) הייתה שורפת עשרות בקשות מהתקציב המנומס בכל
 * חצי שעה, לנצח, ודוחקת יישובים תקינים מהסבב.
 */
const ERROR_RETRY_MS = 6 * 60 * 60 * 1000;

/** חלקות להעשרה בסבב אחד, כשנשאר זמן אחרי העסקאות. */
const PARCELS_PER_RUN = 600;

const DEFAULT_INTERVAL_MS = 1_500;

export interface MarketRunResult {
  started: boolean;
  /** למה לא התחיל — כבר רץ, או כבוי. */
  reason?: "running" | "disabled";
}

/**
 * ‎**סבב סנכרון נתוני השוק — כל הארץ, ובלי למחוק דבר** (docs/18).
 *
 * הסבב רץ ב-API ולא ב-Workers מאותה סיבה כמו רענון ההתאמות: אחרי
 * הקליטה הוא מחשב מחדש את מיקום המחיר של נכסי המשרדים, וזה הקוד של
 * ‎`MarketPropertyService` — עותק שני שלו בתהליך אחר היה נפרד ממנו
 * תוך חודשיים. העבודה עצמה היא בעיקר המתנה לרשת בקצב מנומס, לא חישוב.
 *
 * ## חכירה ולא נעילה
 *
 * סבב נמשך עשרים דקות, ונעילת ייעוץ של Postgres חיה בחיבור — ו-Prisma
 * מחזיק מאגר חיבורים. לכן החכירה היא שורה ב-`market_sync_runs` במצב
 * ‎`running`, שנכתבת תחת נעילת טרנזקציה: שני מופעי API שעולים יחד לא
 * יתחילו שני סבבים. שורה שנשארה `running` אחרי קריסה פגה אחרי שעתיים.
 */
@Injectable()
export class MarketSyncService {
  private readonly logger = new Logger(MarketSyncService.name);
  private running = false;
  private lastCatalogAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly properties: MarketPropertyService,
  ) {}

  /**
   * ‏הסבב האוטומטי — `@Sweep` דואג שרק מופע אחד מריץ אותו; החכירה ב-
   * ‏`market_sync_runs` נשארת, כי גם „סנכרן עכשיו” מתחיל סבב.
   */
  @Sweep({ name: "market-sync", everyMs: TICK_MS, firstDelayMs: FIRST_TICK_DELAY_MS })
  private async autoTick(): Promise<void> {
    await this.tick("auto");
  }

  /** האם הסנכרון פועל — הגדרה מפורשת גוברת; בלעדיה, רק בייצור. */
  async enabled(): Promise<boolean> {
    const value = await this.settings.get("marketSyncEnabled");
    if (value === "true") return true;
    if (value === "false") return false;
    return loadEnv().NODE_ENV === "production";
  }

  async intervalMs(): Promise<number> {
    const value = Number(await this.settings.get("marketRequestIntervalMs"));
    return Number.isInteger(value) && value >= 500 && value <= 60_000 ? value : DEFAULT_INTERVAL_MS;
  }

  /** כפתור „סנכרן עכשיו” — מתחיל ברקע ומחזיר מיד. */
  async runNow(): Promise<MarketRunResult> {
    if (this.running) return { started: false, reason: "running" };
    if (!(await this.enabled())) return { started: false, reason: "disabled" };
    void this.tick("manual");
    return { started: true };
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async tick(kind: "auto" | "manual"): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.enabled())) return;
      const runId = await this.acquire(kind);
      if (runId === null) return;
      await this.run(runId);
    } catch (error: unknown) {
      this.logger.error(`market sync failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** חכירת הסבב — `null` כשסבב אחר כבר רץ. */
  private async acquire(kind: "auto" | "manual"): Promise<string | null> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('market-sync', 0))`;
      const live = await tx.marketSyncRun.findFirst({
        where: { status: "running", startedAt: { gt: new Date(now.getTime() - STALE_RUN_MS) } },
        select: { id: true },
      });
      if (live) return null;
      await tx.marketSyncRun.updateMany({
        where: { status: "running" },
        data: { status: "error", finishedAt: now, message: "הסבב נקטע באמצע (הפעלה מחדש של השרת)" },
      });
      const id = ulid();
      await tx.marketSyncRun.create({ data: { id, kind, startedAt: now, status: "running" } });
      return id;
    });
  }

  private async run(runId: string): Promise<void> {
    const started = Date.now();
    const source = new OverOrgIlSource(DEFAULT_MARKET_SOURCE_URL);
    const ingest = new MarketIngest(this.prisma, source, {
      intervalMs: await this.intervalMs(),
      deadline: new Date(started + RUN_BUDGET_MS),
    });

    let status: "ok" | "partial" | "error" = "ok";
    let stopReason: string | null = null;
    // יישובים שנכנסו בהם עסקאות חדשות — גם כאלה שנעצרו באמצע. יישוב
    // שהסנכרון שלו לא הביא דבר אינו מצדיק בנייה מחדש של כל הארץ
    const touched = ingest.touched;
    let parcels = 0;
    let linked = 0;

    try {
      if (this.catalogDue()) {
        await ingest.refreshCatalog();
        this.lastCatalogAt = Date.now();
      }

      for (const settlementId of await this.dueSettlements()) {
        if (!ingest.hasTime()) {
          status = "partial";
          break;
        }
        try {
          const outcome = await ingest.syncSettlement(settlementId);
          if (!outcome.complete) status = "partial";
        } catch (error: unknown) {
          if (error instanceof MarketSourceRateLimitError || error instanceof MarketSourceFormatError) throw error;
          // יישוב אחד שנכשל אינו עוצר את השאר — הוא יחזור אחרי ERROR_RETRY_MS
          status = "partial";
          await this.prisma.marketSettlement.update({
            where: { id: settlementId },
            data: { status: "error", lastError: String(error).slice(0, 300), syncedAt: new Date() },
          });
        }
      }

      if (ingest.hasTime()) parcels = await ingest.enrichParcels(PARCELS_PER_RUN);
      // קישור נכסי המשרדים לחלקות — מאותו מקור ובאותו קצב
      if (ingest.hasTime()) linked = await this.properties.linkParcels(ingest, 200);
    } catch (error: unknown) {
      status = "error";
      stopReason =
        error instanceof MarketSourceRateLimitError
          ? `${error.message} — הסבב נעצר ויחזור בעוד חצי שעה. אם זה חוזר, הגדילו את המרווח בין בקשות.`
          : String(error instanceof Error ? error.message : error);
      this.logger.warn(`market sync stopped: ${stopReason}`);
    }

    /*
     * הסטטיסטיקה נבנית גם כשהסבב נעצר באמצע: מה שנקלט עד העצירה
     * אמיתי, וחציון של אתמול על עסקאות של היום הוא מספר שקרי.
     */
    try {
      for (const settlementId of touched) await ingest.rebuildStats(settlementId);
      if (touched.size > 0) await ingest.rebuildStats(0);
      if (touched.size > 0) await this.properties.refreshSnapshots();
    } catch (error: unknown) {
      status = "error";
      stopReason = `בניית הסטטיסטיקה נכשלה: ${String(error)}`;
    }

    const summary = [
      `${touched.size} יישובים`,
      `${ingest.rows} עסקאות חדשות`,
      parcels > 0 ? `${parcels} חלקות` : null,
      linked > 0 ? `${linked} נכסים קושרו לחלקה` : null,
      stopReason,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");

    await this.prisma.marketSyncRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        requests: ingest.requests,
        rows: ingest.rows,
        message: summary.slice(0, 500),
      },
    });
  }

  /**
   * רענון הקטלוג פעם ביום, לפי זיכרון התהליך.
   *
   * עלייה מחדש מרעננת שוב — שתי בקשות, וזה המחיר של לא להחזיק עוד
   * חותמת במסד רק בשבילן.
   */
  private catalogDue(): boolean {
    return this.lastCatalogAt === 0 || Date.now() - this.lastCatalogAt > CATALOG_EVERY_MS;
  }

  /**
   * סדר העבודה: מה שכבר באמצע, אחר כך יישובים שלא התחילו — הגדולים
   * קודם, כי שם רוב המשרדים — ובסוף יישובים שהושלמו והגיע זמנם לרענון.
   */
  private async dueSettlements(): Promise<number[]> {
    const staleBefore = new Date(Date.now() - RESYNC_AFTER_MS);
    const rows = await this.prisma.marketSettlement.findMany({
      where: {
        OR: [
          { status: { in: ["backfill", "pending"] } },
          { status: "error", OR: [{ syncedAt: null }, { syncedAt: { lt: new Date(Date.now() - ERROR_RETRY_MS) } }] },
          { status: "ok", syncedAt: { lt: staleBefore } },
        ],
      },
      select: { id: true, status: true, sourceDeals: true, syncedAt: true },
    });
    const rank = (status: string): number =>
      status === "backfill" ? 0 : status === "pending" ? 1 : status === "error" ? 2 : 3;
    return rows
      .sort(
        (a, b) =>
          rank(a.status) - rank(b.status) ||
          b.sourceDeals - a.sourceDeals ||
          (a.syncedAt?.getTime() ?? 0) - (b.syncedAt?.getTime() ?? 0),
      )
      .map((row) => row.id);
  }
}
