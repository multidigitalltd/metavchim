import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  digestDedupeKey,
  digestManagerDedupeKey,
  digestManagerSummary,
  digestManagerTitle,
  digestMonthAnchor,
  digestMonthKey,
  digestSkipReason,
  digestWhatsappSkip,
  effectiveCapabilities,
  officeDigestTemplateValues,
  officeDigestText,
  officeDigestTitle,
  whatsappTemplateParams,
  OFFICE_DIGEST_NOTIFICATION_TYPE,
  type BoardCounts,
  type DigestSkip,
} from "@metavchim/shared";
import { notifyOnce } from "../../common/notify-once";
import { TenantContext } from "../../common/tenant-context";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
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
    private readonly platformSettings: PlatformSettingsService,
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
    /*
     * ‎**העוגן נגזר מהמפתח ולא מ-`now`** (ביקורת Codex, P1).
     *
     * ‏שני חישובים נפרדים מאותו רגע נפרדו בפועל: המפתח לפי
     * ‏שעון ירושלים והעוגן לפי UTC. עכשיו הכותרת, מפתח הדדופ
     * ‏והנתונים יוצאים ממחרוזת אחת, ולכן אינם יכולים לחלוק.
     */
    const board = await TenantContext.run(
      { tenantId, userId: "", capabilities: new Set(), billingOnly: false },
      () => this.analytics.board("month", digestMonthAnchor(monthKey)),
    );
    if (board.rows.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        whatsappAccess: true,
        officeDigestOptedOutAt: true,
      },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    /*
     * ‎**קישור חי בלבד** — `revokedAt` הוא „היה ונותק”, ולא „יש”.
     *
     * ‏המספר עצמו מגיע מהקישור ולא מהפרופיל: הקישור הוא
     * ‏המספר שהסוכן הוכיח שהוא שלו בוואטסאפ, והוא גם המספר שהבוט
     * ‏מכיר — בעוד `users.phone` יכול להיות קו נייח במשרד.
     */
    const links = await this.prisma.whatsAppLink.findMany({
      where: { tenantId, revokedAt: null },
      select: { userId: true, waIdEncrypted: true },
    });
    const waById = new Map(links.map((l) => [l.userId, l.waIdEncrypted]));

    let sent = 0;
    const skipped: Skipped[] = [];

    for (const row of board.rows) {
      /*
       * ‎**שתי שאלות נפרדות, ולא אחת** (ביקורת Codex).
       *
       * ‏„האם יש מה לסכם” חוסם הכול; „האם לדחוף לטלפון”
       * ‏חוסם רק את הוואטסאפ. קודם הן היו פונקציה אחת שבדקה
       * ‏וויתור ראשון, ולכן סוכן שביקש לא לקבל בוואטסאפ איבד גם
       * ‏את ההתראה — בניגוד למה שהמסך מבטיח לו ולמה שכתוב
       * ‏בתיעוד העמודה עצמה.
       */
      if (digestSkipReason({ counts: row.counts }) !== null) continue;

      const user = byId.get(row.userId);
      if (user === undefined) continue;

      const text = officeDigestText({
        name: row.name,
        monthKey,
        counts: row.counts,
        rank: row.rank,
        total: board.agents,
        ...(row.goal === null ? {} : { goal: row.goal }),
      });

      /*
       * ‎**נרשם קודם, נשלח אחר כך.** `notifyOnce` הוא גם ההתראה
       * ‏בפעמון וגם מנעול הפעם-אחת; `false` = החודש הזה כבר יצא.
       *
       * ‎**והגוף הוא הסיכום עצמו** (ביקורת Codex): עמוד ההתראות
       * ‏מציג פרטים מ-`body` בלבד, ואין להתראה הזו עוגן לנווט
       * ‏אליו — כלומר `null` היה „סיכום” שאין בו שום סיכום. עכשיו
       * ‏הפעמון הוא המסירה העמידה, והוואטסאפ הוא הדחיפה שמעליה.
       */
      const written = await this.notify({
        tenantId,
        dedupeKey: digestDedupeKey(monthKey, row.userId),
        userId: row.userId,
        title: officeDigestTitle(monthKey),
        body: text,
      });
      if (!written) continue;

      /*
       * ‎**וואטסאפ הוא שכבה שנייה.** `whatsappAccess` הוא מקום
       * ‏מוקצה שהמשרד מחליט עליו, וסוכן בלעדיו אינו נמצא על
       * ‏הקו בכלל — בדיוק כמו סוכן בלי קישור.
       */
      const skip = digestWhatsappSkip({
        hasWhatsapp: user.whatsappAccess && waById.has(row.userId),
        optedOut: user.officeDigestOptedOutAt !== null,
      });
      if (skip !== null) {
        skipped.push({ name: row.name, reason: skip });
        continue;
      }

      const to = this.crypto.decrypt(waById.get(row.userId) ?? "");
      if (await this.push(to, text, { name: row.name, monthKey, rank: row.rank, total: board.agents, counts: row.counts })) {
        sent += 1;
      } else {
        /*
         * ‎**כישלון שליחה אינו נבלע** — אבל גם אינו מוחק את
         * ‏ההתראה: הסיכום נכון, הוא בפעמון על כל פרטיו,
         * ‏והסוכן יראה אותו. מה שנכשל הוא הערוץ.
         */
        this.logger.warn(
          `סיכום ${monthKey} לא נשלח בוואטסאפ ל-${row.userId} במשרד ${tenantId}`,
        );
      }
    }

    if (sent > 0 || skipped.length > 0) {
      await this.reportToManagers(tenantId, monthKey, digestManagerSummary(sent, skipped));
    }
  }

  /** ‏כתיבת התראה בהקשר הדייר — שלושה קוראים, ניסוח אחד. */
  private async notify(input: {
    tenantId: string;
    dedupeKey: string;
    userId: string;
    title: string;
    body: string;
  }): Promise<boolean> {
    return TenantContext.run(
      { tenantId: input.tenantId, userId: "", capabilities: new Set(), billingOnly: false },
      () =>
        this.prisma.withTenant((tx) =>
          notifyOnce(tx, {
            tenantId: input.tenantId,
            dedupeKey: input.dedupeKey,
            userId: input.userId,
            type: OFFICE_DIGEST_NOTIFICATION_TYPE,
            title: input.title,
            body: input.body,
            /* ‏הסיכום אינו על ישות אחת, ולכן אין לו עוגן */
            entityType: null,
            entityId: null,
          }),
        ),
    );
  }

  /**
   * ‎**הדחיפה לטלפון — על הקו שהסוכן באמת מדבר איתו.**
   *
   * ## מה היה קודם, ולמה הוא לא היה מגיע
   *
   * ‏השליחה רצה ב-`sendAsTenant`, כלומר על **חיבור הוואטסאפ
   * ‏של המשרד** — מספר אחר לגמרי מזה שהסוכן מכיר. העוזר
   * ‏האישי בוואטסאפ עונה דרך `sendText`, כלומר על קו
   * ‏**הפלטפורמה**, ושם גם נוצר הקישור. סוכן שמעולם לא כתב
   * ‏לקו המשרדי אינו בתוך חלון 24 השעות שלו, והרוב המכריע
   * ‏של המשרדים אפילו אינם מחוברים (`no_connection`).
   *
   * ## ולמה גם תבנית
   *
   * ‏גם על הקו הנכון, טקסט חופשי עובד רק בתוך חלון 24
   * ‏השעות, וסיכום חודשי הוא פנייה יזומה מובהקת — הסבב רץ
   * ‏בתחילת החודש, ולא בתגובה לכלום. אותו סדר בדיוק של
   * ‏התראת „לקוח ענה במייל”: חופשי קודם (עובד בתוך החלון
   * ‏ונושא את הפירוט המלא), ותבנית מאושרת כשהוא נדחה.
   *
   * ‏בלי תבנית מוגדרת זו אינה תקלה: הסיכום כבר נמסר בפעמון.
   */
  private async push(
    to: string,
    text: string,
    vars: { name: string; monthKey: string; rank: number; total: number; counts: BoardCounts },
  ): Promise<boolean> {
    if (await this.whatsapp.sendText(to, text)) return true;

    const template = await this.platformSettings.get("whatsappOfficeDigestTemplate");
    if (template === undefined || template === "") return false;
    const lang = (await this.platformSettings.get("whatsappOfficeDigestTemplateLang")) ?? "he";
    return this.whatsapp.sendTemplate(
      to,
      template,
      lang,
      whatsappTemplateParams("officeDigest", officeDigestTemplateValues(vars)),
    );
  }

  /**
   * ‎**הדיווח מגיע למנהל, ולא ללוג** (ביקורת Codex).
   *
   * ‏„מי לא קיבל ולמה” נכתב ללוג השרת בלבד, ולמנהל משרד
   * ‏אין גישה אליו — כלומר ההסבר שתועד כמנהלי לא הגיע
   * ‏לאיש. הלוג נשאר לתפעול, וההתראה היא למי שיכול לפעול.
   *
   * ‎**למנהלים בלבד, ולא לכל המשרד.** הדיווח נוקב בשמות
   * ‏סוכנים ובסיבה — „ביקש לא לקבל” הוא נתון על עמית,
   * ‏והתראה לכל המשרד היתה חושפת אותו לכולם.
   */
  private async reportToManagers(
    tenantId: string,
    monthKey: string,
    summary: string,
  ): Promise<void> {
    const [tenant, staff] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { blockedModules: true },
      }),
      this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, role: true },
      }),
    ]);
    /*
     * ‏`user_capabilities` יושבת תחת RLS, וקריאה בלי הקשר דייר
     * ‏מחזירה אפס שורות **בשקט** — כלומר כל החריגים היו
     * ‏נעלמים, ומנהל שהיכולת שלו הוענקה בחריג לא היה מקבל
     * ‏את הדיווח. שער `rls-access` תופס בדיוק את זה.
     */
    const overrides = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.userCapability.findMany({
        where: { tenantId },
        select: { userId: true, capability: true, effect: true, expiresAt: true },
      }),
    );
    const byUser = new Map<string, typeof overrides>();
    for (const row of overrides) {
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    }
    const now = new Date();
    for (const member of staff) {
      const capabilities = effectiveCapabilities(
        {
          role: member.role,
          overrides: byUser.get(member.id) ?? [],
          blockedModules: tenant?.blockedModules ?? [],
        },
        now,
      );
      if (!capabilities.has("users.manage")) continue;
      await this.notify({
        tenantId,
        dedupeKey: digestManagerDedupeKey(monthKey, member.id),
        userId: member.id,
        title: digestManagerTitle(monthKey),
        body: summary,
      });
    }
  }

}
