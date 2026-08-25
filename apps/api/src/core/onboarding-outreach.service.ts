import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { EmailService } from "./email.service";
import { PrismaService } from "./prisma.service";

/** פעם בשעה — החלון נמדד בימים, ודיוק של שעה הוא די והותר. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** שתי דקות אחרי העלייה — לא מתחרים במיגרציות על החיבורים. */
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;

/** מגיל חמישה ימים ההודעה נשלחת (בקשת המשתמש: 5–6 ימים). */
const MIN_AGE_DAYS = 5;

/**
 * תקרת גיל: משרד ותיק מזה לא יקבל את ההודעה לעולם.
 *
 * בלעדיה, ביום הפריסה הראשון כל המשרדים הקיימים — גם בני שנה —
 * היו מקבלים "ברוכים הבאים, רוצים שיחת היכרות?". החלון תופס רק
 * את מי שנרשם ממש לאחרונה, וגם מכסה שבת שדחתה את השליחה ביום-יומיים.
 */
const MAX_AGE_DAYS = 12;

/**
 * שיחת ההיכרות — אימייל אחד לכל משרד חדש, כמה ימים אחרי ההרשמה.
 *
 * ## מה זה (בקשת המשתמש)
 *
 * אוטומציה של מנהל הפלטפורמה: כל חשבון שנוצר מקבל אחרי 5–6 ימים
 * (לא בשבת) אימייל עם היתרונות המרכזיים והצעה לתאם שיחת הדרכה של
 * 20 דקות עם נציג. חמישה ימים ולא מיד: ביום הראשון נשלחות הודעות
 * ההקמה, וההצעה נופלת על אוזניים שעוד לא ניסו כלום; אחרי כמה ימי
 * שימוש יש כבר שאלות אמיתיות לשאול בשיחה.
 *
 * ## למה ב-API ולא ב-Workers
 *
 * כמו תפוגת הקרדיטים שמעליו: השליחה דורשת את EmailService, שקורא
 * סודות מוצפנים דרך PlatformSettingsService. הסריקה זולה — שאילתה
 * אחת לשעה.
 *
 * ## אחת ולתמיד — בכל מספר עותקים
 *
 * הסימון נתפס **לפני** השליחה בעדכון jsonb אטומי מותנה: עותק שני
 * שרץ במקביל מקבל 0 שורות ולא שולח. שליחה שנכשלה משחררת את הסימון
 * כדי שהסבב הבא ינסה שוב — עדיף סיכון קטן לכפילות ברשת רועשת מאשר
 * משרד שלא יקבל את ההצעה לעולם בגלל תקלה רגעית.
 */
@Injectable()
export class OnboardingOutreachService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnboardingOutreachService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    }, FIRST_SWEEP_DELAY_MS);
    this.kickoff.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } catch (error: unknown) {
      this.logger.error(`onboarding outreach sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** סבב אחד. ציבורי — לבדיקה מול מסד אמיתי בלי לחכות שעה. */
  async sweep(now: Date): Promise<{ sent: number }> {
    /*
     * לא בשבת (בקשת המשתמש), ובשעות אנושיות בלבד: אימייל שיווקי
     * שנוחת בשלוש לפנות בוקר נקרא כספאם גם כשהתוכן מצוין. השעה
     * בשעון ירושלים — השרת יכול לרוץ בכל אזור זמן.
     */
    const jerusalem = jerusalemParts(now);
    if (jerusalem.weekday === "Saturday") return { sent: 0 };
    if (jerusalem.hour < 9 || jerusalem.hour >= 18) return { sent: 0 };

    const minCreatedAt = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const maxCreatedAt = new Date(now.getTime() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.tenant.findMany({
      where: { createdAt: { gte: minCreatedAt, lte: maxCreatedAt } },
      select: { id: true, name: true },
    });

    let sent = 0;
    for (const tenant of candidates) {
      try {
        if (await this.sendToTenant(tenant.id, tenant.name, now)) sent += 1;
      } catch (error: unknown) {
        // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
        this.logger.warn(`onboarding outreach failed for ${tenant.id}: ${String(error)}`);
      }
    }
    if (sent > 0) this.logger.log(`שיחת היכרות: נשלחו ${sent} הזמנות למשרדים חדשים`);
    return { sent };
  }

  private async sendToTenant(tenantId: string, tenantName: string, now: Date): Promise<boolean> {
    /*
     * תפיסת הסימון — אטומית ומותנית, לפני השליחה. שני עותקים שרצים
     * במקביל: אחד מעדכן שורה אחת, השני אפס — ורק הראשון שולח.
     */
    const claimed = await this.prisma.$executeRaw`
      UPDATE tenants
      SET settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{onboardingCallEmailAt}',
        to_jsonb(${now.toISOString()}::text)
      )
      WHERE id = ${tenantId}
        AND NOT (COALESCE(settings, '{}'::jsonb) ? 'onboardingCallEmailAt')
    `;
    if (claimed === 0) return false;

    const owners = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.user.findMany({
        where: { tenantId, role: "owner", isActive: true },
        orderBy: { createdAt: "asc" },
        select: { name: true, email: true },
      }),
    );
    if (owners.length === 0) {
      // אין למי לשלוח כרגע — משחררים כדי שבעלים שיופעל בתוך החלון עוד יקבל
      await this.releaseClaim(tenantId);
      return false;
    }

    /*
     * כמה נשלחו בפועל — ולא רק „הצליח / נכשל”.
     *
     * הסימון הוא **ברמת המשרד**, והלולאה שולחת לכל בעלים בנפרד.
     * שחרור הסימון אחרי שהראשון כבר קיבל היה מחזיר את המשרד לתור,
     * והסבב הבא היה שולח לו שוב — ושוב בכל שעה עד סוף החלון, כל עוד
     * הבעלים השני אינו ניתן לשליחה (ביקורת Codex). לכן השחרור מותנה
     * בכך ש**איש** לא קיבל: אז אין כפילות אפשרית, ויש טעם לנסות שוב.
     */
    let delivered = 0;

    try {
      for (const owner of owners) {
        await this.email.send(
          owner.email,
          "כמה דקות שיחסכו לכם שעות — שיחת היכרות עם מתווכים",
          {
            heading: "כבר בפנים? עכשיו נראה לכם כמה רחוק אפשר להגיע",
            greeting: `שלום ${owner.name},`,
            paragraphs: [
              `לפני כמה ימים הצטרפתם עם ${tenantName} למתווכים — ורצינו לוודא שאתם מפיקים מהמערכת את המקסימום.`,
              "כמה מהדברים שמשרדים מגלים רק בשיחה קצרה: הסוכן החכם שקולט קונה או נכס במשפט אחד מדובר, התאמות אוטומטיות בין קונים לנכסים שרצות ברקע, רשת שיתופי הפעולה שמביאה עסקאות ממשרדים אחרים בלי לחשוף את הלקוח שלכם, ותמלול וסיכום אוטומטי של שיחות טלפון ישירות לכרטיס הלקוח.",
              "נשמח להראות לכם את כל זה על המשרד שלכם עצמו: שיחת הדרכה אישית של 20 דקות עם נציג, בזמן שנוח לכם. בלי מצגות — פותחים את המערכת שלכם ועוברים על מה שיחסוך לכם הכי הרבה זמן.",
              "כדי לתאם — פשוט השיבו למייל הזה עם יום ושעה שנוחים לכם, ונציג יחזור אליכם.",
            ],
            footnote: "קיבלתם את ההודעה כי נרשמתם למתווכים. אם אין צורך — אפשר פשוט להתעלם.",
          },
          /*
           * הסימון `onboardingCallEmailAt` נתפס **לפני** השליחה והוא
           * חד-פעמי לכל משרד. בלי `required` היעדר ספק היה חוזר
           * בשקט, הסימון היה נשאר, והמשרד לא היה מקבל את ההזמנה
           * לעולם. עם `required` נזרקת שגיאה, וכשאיש עוד לא קיבל —
           * ה-`catch` למטה משחרר את הסימון (ביקורת Codex).
           */
          { required: true },
        );
        delivered += 1;
      }
      return true;
    } catch (error: unknown) {
      if (delivered > 0) {
        /*
         * חלק מהבעלים כבר קיבלו. שחרור הסימון כאן היה גורם להם לקבל
         * את אותה הזמנה בכל סבב מחדש — נזק ודאי וחוזר, לעומת בעלים
         * אחד שלא קיבל הזמנה שיווקית. הסימון נשאר, והפער נרשם.
         */
        this.logger.warn(
          `שיחת היכרות ל-${tenantId}: ${delivered} מתוך ${owners.length} נשלחו; הסימון נשמר כדי לא לשלוח שוב למי שכבר קיבל`,
        );
        return true;
      }
      /*
       * איש לא קיבל — משחררים, אחרת המשרד לא יקבל את ההצעה לעולם
       * בגלל תקלת רשת רגעית.
       */
      await this.releaseClaim(tenantId);
      throw error;
    }
  }

  /** ביטול הסימון — רק כשבטוח שאיש לא קיבל את ההזמנה. */
  private async releaseClaim(tenantId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE tenants
      SET settings = COALESCE(settings, '{}'::jsonb) - 'onboardingCallEmailAt'
      WHERE id = ${tenantId}
    `;
  }
}

/** היום והשעה בשעון ירושלים — השרת יכול לרוץ בכל אזור זמן. */
function jerusalemParts(now: Date): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  return {
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? "0"),
  };
}
