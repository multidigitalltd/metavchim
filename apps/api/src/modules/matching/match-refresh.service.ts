import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ulid } from "ulid";
import {
  MATCH_ENGINE_VERSION,
  matchRefreshDue,
  matchRefreshNotice,
  summarizeMatchRefresh,
  type MatchRefreshReason,
  type MatchRefreshState,
  type MatchRefreshSummary,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";
import { MATCHABLE_PROPERTY_STATUSES, MatchingService } from "./matching.service";

/** כל שעה — הסבב עצמו רץ רק למי שהגיע תורו, ראו `matchRefreshDue`. */
const TICK_MS = 60 * 60 * 1000;

/**
 * שתי דקות אחרי העלייה. לא מיד: בעליית השרת רצות מיגרציות ונטענות
 * הגדרות, ופריסה שמשנה את גרסת המנוע תגרור סבב לכל המשרדים — בדיוק
 * הרגע שבו הכי חשוב לא להתחרות על החיבורים.
 */
const FIRST_TICK_DELAY_MS = 2 * 60 * 1000;

/**
 * תקרת נכסים לסבב אחד למשרד.
 *
 * זו אינה אופטימיזציה אלא **הגנה**: משרד עם עשרת אלפים נכסים היה
 * מחזיק את מאגר הנתונים שעה. סבב שנקטע בתקרה נרשם כ-`ok: false`,
 * ולכן הסבב הבא יתפוס אותו מיד — הקיצוץ מדווח, לא נבלע.
 */
const MAX_PROPERTIES_PER_SWEEP = 2000;

/** כמה נכסים בכל שליפה מהמסד. */
const PAGE = 200;

/** תקרת סבבים רצופים שנגררים מבקשות שהצטברו — ראו `refreshTenant`. */
const MAX_CHAINED_RERUNS = 3;

interface RefreshOutcome extends MatchRefreshState {
  /** מספר המשרד — לשורת הלוג בלבד. */
  tenantId: string;
}

/**
 * רענון ההתאמות — **הסבב שסוגר את הפער בין הגדרה לתוצאה.**
 *
 * המנוע מחשב מחדש בכל יצירה ובכל עריכה של נכס או קונה, ובשני
 * הכיוונים. מה שנשאר בחוץ הוא כל מה שאינו רשומה בודדת: משקלים
 * שהמשרד שינה, מנוע שהשתדרג, וזמן שעבר (התאמת מועד הכניסה נמדדת
 * מול `now`). הכלל עצמו יושב ב-`match-refresh.ts` — כאן רק ההרצה.
 *
 * ## למה ב-API ולא ב-Workers
 *
 * הסבב מריץ את `MatchingService` עצמו. חלופה בתהליך ה-Workers הייתה
 * מחייבת עותק שני של מנוע ההתאמות — הסינון הגס, הניקוד, כללי
 * הדריסה של סטטוס ידני — ושני עותקים של מנוע נפרדים במרחק חודשיים.
 * **התאמה שמחושבת בלילה חייבת להיות בדיוק ההתאמה שנשמרת בעריכה**,
 * אחרת המספר במסך משתנה לפי מי חישב אותו.
 *
 * ## התראה אחת לסבב
 *
 * הרענון קורא ל-`recomputeForProperty` עם `silent`, ומסכם את עצמו
 * בהתראה אחת לבעלים. בלי זה, לילה אחד היה מייצר עשרות התראות
 * "נמצאו קונים חדשים לנכס" — הדרך הבטוחה ביותר להרגיל משרד לכבות
 * התראות, וגם להחמיץ את האמיתית שתגיע מחר.
 */
@Injectable()
export class MatchRefreshService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchRefreshService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  private ticking = false;
  /**
   * משרדים שסבב שלהם רץ ברגע זה.
   *
   * שומר על שני מסלולים שנפגשים: הסורק השעתי והכפתור הידני. סבב
   * כפול על אותו משרד אינו הורס נתונים (החישוב אידמפוטנטי), אבל
   * הוא מכפיל עומס ומייצר שתי כתיבות מצב מתחרות שאחת מהן משקרת.
   */
  private readonly running = new Set<string>();
  /**
   * בקשות שהגיעו בזמן שסבב כבר רץ — יבוצעו מיד בסיומו.
   *
   * הסיבה נשמרת ולא רק "כן": ההתראה והמסך מציגים אותה, ובקשה
   * שהתחילה כ"שינוי משקלים" לא צריכה להופיע כ"סבב יומי".
   */
  private readonly pending = new Map<string, MatchRefreshReason>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_MS);
    }, FIRST_TICK_DELAY_MS);
    // אחרת התהליך לא יוצא בבדיקות ובסקריפטים קצרים
    this.kickoff.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.sweepAll(new Date());
    } catch (error: unknown) {
      this.logger.error(`match refresh sweep failed: ${String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * סבב על כל המשרדים שהגיע תורם.
   *
   * ציבורי כדי שאפשר יהיה להריץ אותו בבדיקה מול מסד אמיתי במקום
   * לחכות שעה ולקוות — אותה סיבה בדיוק כמו בסריקת תפוגת הקרדיטים.
   */
  async sweepAll(now: Date): Promise<RefreshOutcome[]> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true, settings: true } });
    const done: RefreshOutcome[] = [];

    for (const tenant of tenants) {
      const settings = (tenant.settings ?? {}) as Record<string, unknown>;
      const reason = matchRefreshDue(readState(settings), now, {
        engineVersion: MATCH_ENGINE_VERSION,
        weightsChangedAt: readWeightsChangedAt(settings),
      });
      if (reason === null) continue;

      try {
        const outcome = await this.refreshTenant(tenant.id, reason);
        if (outcome) done.push(outcome);
      } catch (error: unknown) {
        // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
        this.logger.warn(`match refresh failed for tenant ${tenant.id}: ${String(error)}`);
      }
    }
    return done;
  }

  /**
   * רענון המשרד — כולל חזרה על הסבב אם משהו השתנה בזמן שהוא רץ.
   *
   * **למה זה לא סתם "כבר רץ, נחזור אחר כך":** מנהל שגורר מחוונים
   * שומר לרוב יותר מפעם אחת, והשמירה השנייה נופלת בדיוק בזמן הסבב
   * של הראשונה. בקשה שנזרקת שם משאירה את הנכסים שכבר נסרקו עם
   * המשקלים הקודמים, והמסך מציג ✓ — כלומר בדיוק הכשל שה-PR הזה בא
   * לסגור, רק צר יותר (ביקורת Codex).
   *
   * שתי ההגנות משלימות זו את זו: הבקשה נרשמת ומתבצעת מיד בסיום,
   * ואם התהליך נפל בין השתיים — `matchRefreshDue` משווה מול זמן
   * ההתחלה ולכן הסורק יתפוס אותה בכל מקרה.
   *
   * `null` = הבקשה נרשמה להרצה מיד בתום הסבב שרץ עכשיו.
   */
  async refreshTenant(tenantId: string, reason: MatchRefreshReason): Promise<RefreshOutcome | null> {
    if (this.running.has(tenantId)) {
      this.pending.set(tenantId, reason);
      return null;
    }
    this.running.add(tenantId);
    try {
      let outcome = await this.sweepOnce(tenantId, reason);
      /*
       * חסום במפורש. כל סיבוב דורש שמירה **חדשה** שנחתה בזמן הקודם,
       * ולכן בפועל זה מתכנס — אבל לולאה בלי גבול בשירות שרץ ברקע
       * היא בדיוק סוג התקלה שמתגלה בפרודקשן. מה שנשאר מעבר לתקרה
       * נתפס בסורק, כי החותמת מאוחרת מזמן ההתחלה.
       */
      for (let round = 0; round < MAX_CHAINED_RERUNS; round += 1) {
        const next = this.pending.get(tenantId);
        if (next === undefined) return outcome;
        this.pending.delete(tenantId);
        outcome = await this.sweepOnce(tenantId, next);
      }
      if (this.pending.has(tenantId)) {
        this.logger.warn(
          `match refresh for tenant ${tenantId} still had pending work after ${MAX_CHAINED_RERUNS} reruns`,
        );
      }
      return outcome;
    } finally {
      this.running.delete(tenantId);
    }
  }

  /**
   * סבב אחד למשרד אחד.
   *
   * **עובר על הנכסים בלבד, לא על שני הצדדים.** `recomputeForProperty`
   * סורק כל נכס מול *כל* הקונים במשרד, ולכן מעבר על הנכסים מכסה כל
   * צמד (נכס, קונה) פעם אחת. הוספת מעבר על הקונים הייתה מכפילה את
   * זמן הסבב ומחשבת שוב בדיוק את אותם צמדים.
   */
  private async sweepOnce(tenantId: string, reason: MatchRefreshReason): Promise<RefreshOutcome> {
    const startedAt = Date.now();

    let properties = 0;
    let matches = 0;
    let opened = 0;
    let removed = 0;
    let ok = true;

    try {
      removed = await this.dropOrphanMatches(tenantId);
      /*
       * דפדוף לפי מזהה ולא `skip`: הסבב אורך דקות, ונכס שנקלט
       * באמצעו היה מזיז את החלון ומדלג על נכס קיים. ULID עולה
       * מונוטונית, ולכן "אחרי המזהה האחרון" יציב.
       */
      let cursor: string | null = null;
      let hitCap = false;

      while (!hitCap) {
        const page: { id: string }[] = await this.prisma.withExplicitTenant(tenantId, (tx) =>
          tx.property.findMany({
            where: {
              tenantId,
              deletedAt: null,
              status: { in: [...MATCHABLE_PROPERTY_STATUSES] },
              ...(cursor === null ? {} : { id: { gt: cursor } }),
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: PAGE,
          }),
        );
        if (page.length === 0) break;
        cursor = page[page.length - 1]!.id;

        for (const row of page) {
          if (properties >= MAX_PROPERTIES_PER_SWEEP) {
            hitCap = true;
            ok = false;
            this.logger.warn(
              `match refresh for tenant ${tenantId} stopped at ${MAX_PROPERTIES_PER_SWEEP} properties`,
            );
            break;
          }
          /*
           * `TenantContext.run` ולא פרמטר: המנוע קורא את המשרד
           * מההקשר, וזה גם מה שמזין את `SET app.tenant_id` לכל
           * טרנזקציה. סבב שהיה עוקף את ההקשר היה עוקף גם את RLS.
           *
           * יכולות ריקות בכוונה — הרענון אינו פועל בשם משתמש, ואין
           * בו שום נתיב שדורש הרשאה.
           */
          const result = await TenantContext.run(
            { tenantId, userId: "", capabilities: new Set(), billingOnly: false },
            () => this.matching.recomputeForProperty(row.id, { silent: true }),
          );
          properties += 1;
          matches += result.matches;
          opened += result.opened;
        }
      }
    } catch (error: unknown) {
      /*
       * סבב שנפל באמצע נרשם כ-`ok: false` **ונשמר** — ולא נזרק
       * החוצה בלי עקבות. חלק מהמאגר בניקוד חדש וחלק בישן הוא בדיוק
       * המצב שצריך להיראות במסך, ולגרום לסבב הבא לרוץ מיד.
       */
      ok = false;
      this.logger.error(`match refresh for tenant ${tenantId} aborted: ${String(error)}`);
    }

    const state: MatchRefreshState = {
      at: new Date().toISOString(),
      startedAt: new Date(startedAt).toISOString(),
      reason,
      engineVersion: MATCH_ENGINE_VERSION,
      properties,
      matches,
      opened,
      durationMs: Date.now() - startedAt,
      ok,
    };
    await this.writeState(tenantId, state);
    await this.notify(tenantId, state);
    this.logger.log(
      `רענון התאמות (${reason}) למשרד ${tenantId}: ${properties} נכסים, ${matches} התאמות, ${opened} חדשות, ${removed} יתומות נמחקו, ${state.durationMs}ms`,
    );
    return { ...state, tenantId };
  }

  /**
   * התאמות שנשארו לנכס שאינו משווק עוד — **מה שאף מסלול אחר לא מנקה.**
   *
   * `recomputeForProperty` מנקה נכס שהוא נוגע בו, והסבב עובר רק על
   * נכסים משווקים — כלומר נכס שיצא מהשיווק אינו נסרק בשום מקום,
   * וההתאמות שלו נשארות לנצח. עד היום זה הוסתר במסך: `listAll`
   * מסנן אותן בזיכרון, מושך שורות עודפות כדי לפצות, והמונה בכרטיס
   * הנכס עדיין סופר אותן.
   *
   * שאילתה אחת ולא שליפת מזהים: לרשומת ההתאמה אין קשר מוצהר לנכס
   * בסכמה, ומשרד עם אלפי נכסים שנמכרו היה מייצר `IN (...)` ענק.
   * RLS חלה — `withExplicitTenant` מציב את `app.tenant_id`.
   *
   * **`status = 'suggested'` בלבד**: התאמה שהמתווך הציע או דחה היא
   * החלטה שלו ותיעוד של מה שקרה, ולא הצעה פתוחה שהמנוע רשאי למחוק.
   */
  private async dropOrphanMatches(tenantId: string): Promise<number> {
    return this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.$executeRaw`
        DELETE FROM matches m
        WHERE m.tenant_id = ${tenantId}
          AND m.status = 'suggested'
          AND NOT EXISTS (
            SELECT 1 FROM properties p
            WHERE p.id = m.property_id
              AND p.tenant_id = m.tenant_id
              AND p.deleted_at IS NULL
              AND p.status IN ('draft', 'active')
          )
      `,
    );
  }

  /** המצב האחרון + חיווי למסך ההגדרות. */
  async statusFor(tenantId: string, now: Date): Promise<{
    state: MatchRefreshState | null;
    summary: MatchRefreshSummary;
    engineVersion: string;
    running: boolean;
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const state = readState((tenant?.settings ?? {}) as Record<string, unknown>);
    return {
      state,
      summary: summarizeMatchRefresh(state, now),
      engineVersion: MATCH_ENGINE_VERSION,
      running: this.running.has(tenantId),
    };
  }

  /**
   * `jsonb_set` ולא קריאה-שינוי-כתיבה של כל העמודה — אותו נימוק
   * בדיוק כמו בשמירת המשקלים: שמירה מקבילה של פרטי המשרד הייתה
   * מוחקת בשקט את מה שנכתב כאן.
   */
  private async writeState(tenantId: string, state: MatchRefreshState): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE tenants
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{matchRefresh}', ${JSON.stringify(state)}::jsonb, true)
      WHERE id = ${tenantId}
    `;
  }

  /**
   * התראה אחת לסבב, ורק כשנפתח משהו.
   *
   * לבעלים ולא לכל הסוכנים: הסבב הוא אירוע ברמת המשרד, והסוכן שאליו
   * שייך קונה מסוים יראה את ההתאמה בכרטיס שלו ממילא.
   */
  private async notify(tenantId: string, state: MatchRefreshState): Promise<void> {
    const notice = matchRefreshNotice(state);
    if (notice === null) return;
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const owners = await tx.user.findMany({
        where: { tenantId, role: "owner", isActive: true },
        select: { id: true },
      });
      for (const owner of owners) {
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId,
            userId: owner.id,
            type: "matches_refreshed",
            title: notice.title,
            body: notice.body,
          },
        });
      }
    });
  }
}

/**
 * קריאת המצב מה-JSON של המשרד.
 *
 * מאמת את השדות שהחלטות נשענות עליהם ומחזיר `null` על כל דבר אחר:
 * מצב פגום שנקרא כאילו הוא תקין היה מונע סבב לנצח, וזה בדיוק הכשל
 * השקט שהמנגנון נועד למנוע.
 */
function readState(settings: Record<string, unknown>): MatchRefreshState | null {
  const raw = settings["matchRefresh"];
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Partial<MatchRefreshState>;
  if (typeof value.at !== "string" || typeof value.engineVersion !== "string") return null;
  if (Number.isNaN(new Date(value.at).getTime())) return null;
  /*
   * מצב שנכתב לפני שהשדה נוסף נופל חזרה לזמן הסיום. זו ההתנהגות
   * הישנה, והיא נכונה **פעם אחת בלבד**: הסבב הבא כותב זמן התחלה
   * אמיתי, ומשם והלאה ההשוואה מדויקת.
   */
  const startedAt =
    typeof value.startedAt === "string" && !Number.isNaN(new Date(value.startedAt).getTime())
      ? value.startedAt
      : value.at;
  return {
    at: value.at,
    startedAt,
    reason: value.reason ?? "schedule",
    engineVersion: value.engineVersion,
    properties: value.properties ?? 0,
    matches: value.matches ?? 0,
    opened: value.opened ?? 0,
    durationMs: value.durationMs ?? 0,
    ok: value.ok !== false,
  };
}

function readWeightsChangedAt(settings: Record<string, unknown>): string | null {
  const value = settings["matchWeightsChangedAt"];
  return typeof value === "string" ? value : null;
}
