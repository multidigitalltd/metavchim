import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  digestDedupeKey,
  digestManagerSummary,
  digestMonthKey,
  digestSkipReason,
  officeDigestText,
  officeDigestTitle,
  OFFICE_DIGEST_NOTIFICATION_TYPE,
  type DigestSkip,
} from "@metavchim/shared";
import { notifyOnce } from "../../common/notify-once";
import { TenantContext } from "../../common/tenant-context";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";
import { AnalyticsService } from "./analytics.service";

/**
 * ‎**הסיכום החודשי לסוכן — מה הוא עשה, ואיפה הוא עומד.**
 *
 * ## ‏למה סבב ולא משימה מתוזמנת
 *
 * ‏אותו נימוק בדיוק כמו בתזכורת הסיור שלצידו: משימה שנקבעת מראש
 * ‏קופאת על הנתונים של רגע הקביעה, וסבב ששואל „מי עוד לא קיבל
 * ‏על החודש שנגמר” קורא תמיד את המצב הנוכחי — כולל סוכן שהצטרף
 * ‏אתמול, סוכן שכיבה, וסוכן שקישר וואטסאפ אחרי שהסבב כבר רץ.
 *
 * ## ‎**ההתראה היא גם מנגנון הפעם-אחת**
 *
 * ‏אין טבלה חדשה. `notifyOnce` כותב שורת התראה עם מפתח דדופ
 * ‏‎`office_digest:<חודש>:<סוכן>`, וה-`ON CONFLICT` הוא מה שמבטיח
 * ‏שהודעה אחת תצא לכל סוכן לכל חודש — **גם אם הסבב ירוץ עשר
 * ‏פעמים ביום**. השליחה בוואטסאפ קורית רק כשהכתיבה הצליחה, כלומר
 * ‏„נרשם” תמיד קודם ל„נשלח”.
 *
 * ## ‏מה כל סוכן מקבל
 *
 * ‏השורה שלו והמיקום שלו („3 מתוך 7”) — **בלי המספרים של האחרים**
 * ‏(הכרעת בעל המוצר). זה נותן את התחושה התחרותית בלי לחשוף כמה כל
 * ‏אחד מכר, וזה גם מה שמתיישב עם הכלל שסוכן אינו רואה נתונים של
 * ‏סוכן אחר.
 */

/** ‏פעם בשעה: ההודעה חודשית, והדיוק הנדרש הוא „ביום הראשון”. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** ‏שתי דקות אחרי העלייה — אחרי המיגרציות, לפני השעה העגולה הבאה. */
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;

interface Skipped {
  name: string;
  reason: DigestSkip;
}

@Injectable()
export class OfficeDigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfficeDigestService.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly whatsapp: WhatsAppSendService,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit(): void {
    this.first = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    }, FIRST_SWEEP_DELAY_MS);
    /* ‏אחרת התהליך לא יוצא בבדיקות ובסקריפטים קצרים */
    this.first.unref?.();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * ‎**הסבב אינו בודק „האם היום הראשון בחודש”.**
   *
   * ‏הדדופ הוא התנאי היחיד, וזה עדיף על תנאי תאריך: שרת שהיה למטה
   * ‏בראשון בחודש היה מפספס את החודש כולו, ובדיקת „היום ראשון”
   * ‏הייתה הופכת תקלת תשתית לחודש בלי סיכום. כאן הסבב הראשון
   * ‏שרץ אחרי תחילת החודש שולח, וכל השאר לא עושים דבר.
   */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: { in: ["active", "trial"] } },
        select: { id: true },
      });
      for (const tenant of tenants) {
        await this.sweepTenant(tenant.id).catch((err: unknown) => {
          /* ‏משרד שנכשל אינו מפיל את השאר — אבל גם אינו נבלע */
          this.logger.error(`סיכום חודשי נכשל למשרד ${tenant.id}: ${String(err)}`);
        });
      }
    } finally {
      this.running = false;
    }
  }

  async sweepTenant(tenantId: string, now = new Date()): Promise<void> {
    const monthKey = digestMonthKey(now);
    const board = await TenantContext.run(
      { tenantId, userId: "", capabilities: new Set(), billingOnly: false },
      () => this.analytics.board("month", this.lastDayOfPreviousMonth(now)),
    );
    if (board.rows.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, officeDigestOptedOutAt: true },
    });
    const optedOut = new Map(users.map((u) => [u.id, u.officeDigestOptedOutAt !== null]));

    /* ‏קישור חי בלבד — `revokedAt` הוא „היה ונותק”, ולא „יש” */
    const links = await this.prisma.whatsAppLink.findMany({
      where: { tenantId, revokedAt: null },
      select: { userId: true, waIdEncrypted: true },
    });
    const waById = new Map(links.map((l) => [l.userId, l.waIdEncrypted]));

    let sent = 0;
    const skipped: Skipped[] = [];

    for (const row of board.rows) {
      const skip = digestSkipReason({
        hasWhatsapp: waById.has(row.userId),
        optedOut: optedOut.get(row.userId) === true,
        counts: row.counts,
      });
      if (skip !== null) {
        /*
         * ‎`nothing_to_report` אינו פער שהמנהל צריך לסגור — הוא
         * ‏סוכן שלא עבד החודש, וזה כבר כתוב בטבלה מולו.
         */
        if (skip !== "nothing_to_report") skipped.push({ name: row.name, reason: skip });
        continue;
      }

      /*
       * ‎**נרשם קודם, נשלח אחר כך.** `notifyOnce` הוא גם ההתראה
       * ‏בפעמון וגם מנעול הפעם-אחת; `false` = החודש הזה כבר יצא.
       */
      const written = await TenantContext.run(
        { tenantId, userId: "", capabilities: new Set(), billingOnly: false },
        () =>
          this.prisma.withTenant((tx) =>
            notifyOnce(tx, {
              tenantId,
              dedupeKey: digestDedupeKey(monthKey, row.userId),
              userId: row.userId,
              type: OFFICE_DIGEST_NOTIFICATION_TYPE,
              title: officeDigestTitle(monthKey),
              body: null,
              /* ‏הסיכום אינו על ישות אחת, ולכן אין לו עוגן */
              entityType: null,
              entityId: null,
            }),
          ),
      );
      if (!written) continue;

      const to = this.crypto.decrypt(waById.get(row.userId) ?? "");
      const text = officeDigestText({
        name: row.name,
        monthKey,
        counts: row.counts,
        rank: row.rank,
        total: board.agents,
        ...(row.goal === null ? {} : { goal: row.goal }),
      });
      const result = await this.whatsapp.sendAsTenant(tenantId, to, text);
      if (result === "sent") sent += 1;
      else {
        /*
         * ‎**כישלון שליחה אינו נבלע** — אבל גם אינו מוחק את
         * ‏ההתראה: היא נכונה, היא בפעמון, והסוכן יראה אותה. מה
         * ‏שנכשל הוא הערוץ, וזה מה שנרשם.
         */
        this.logger.warn(
          `סיכום ${monthKey} לא נשלח בוואטסאפ ל-${row.userId} במשרד ${tenantId}: ${result}`,
        );
      }
    }

    if (sent > 0 || skipped.length > 0) {
      this.logger.log(`${tenantId}: ${digestManagerSummary(sent, skipped)}`);
    }
  }

  /**
   * ‏נקודת זמן בתוך החודש שהסתיים — הלוח מחשב „חודש” סביב התאריך
   * ‏שהוא מקבל, ולכן זו הדרך לבקש ממנו את הקודם בלי להוסיף פרמטר.
   */
  private lastDayOfPreviousMonth(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 12, 0, 0));
  }
}
