import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import {
  EMAIL_IDEMPOTENCY_METADATA_KEY,
  emailAttemptDecision,
  emailDomainStatus,
  formatSender,
  isValidEmailIdempotencyKey,
  renderEmailHtml,
  renderEmailText,
  type EmailAttemptStatus,
  type EmailContent,
} from "@metavchim/shared";
import { loadEnv } from "../config/env";
import { PlatformSettingsService } from "./platform-settings.service";
import { PrismaService } from "./prisma.service";

/**
 * שליחת אימייל — שכבת הפשטה (docs/05 §0): הליבה לא מכירה ספק.
 * הספק המחובר: Postmark. ההגדרות נקראות קודם מהגדרות הפלטפורמה
 * (מסך /platform, מוצפן ב-DB) ואם אינן שם — ממשתני הסביבה.
 * בלי הגדרות כלל — Fallback ללוג. פיצ'ר שההמשך שלו תלוי בשליחה
 * מבקש `required` ומקבל דחייה ודאית במקום שקט; `isConfigured()`
 * נותרה לשער מוקדם וידידותי, ולא כערובה.
 *
 * כל הודעה נשלחת בשתי גרסאות: HTML מעוצב מימין לשמאל, וטקסט.
 * שתיהן נגזרות מאותו `EmailContent` (packages/shared) ולא נכתבות
 * בנפרד — גרסת הטקסט היא זו שאיש לא רואה בבדיקה, כי היא מוצגת רק
 * ללקוחות שחוסמים HTML, ולכן היא בדיוק זו שהייתה מתיישנת.
 *
 * שליחת שתיהן אינה קישוט: הודעה עם HTML בלבד נענשת במסננים, ולקוחות
 * טקסט-בלבד היו מקבלים תגיות גולמיות.
 */
/**
 * הספק **ענה, ודחה** — ההודעה בוודאות לא יצאה.
 *
 * ההבחנה הזו אינה סגנונית. כישלון רשת או פסק זמן הוא תוצאה
 * **עמומה**: ייתכן ש-Postmark קיבל את ההודעה ושלח אותה, ורק התשובה
 * אבדה. קורא שמתייחס לשני המקרים כאל „לא נשלח” ומחזיר מכסה הופך
 * את התקרה לחסרת משמעות — מי שמסוגל לגרום לפסק זמן חוזר שולח בלי
 * הגבלה, וזו בדיוק ההצפה שהתקרה נועדה למנוע (ביקורת Codex).
 *
 * **‏4xx בלבד.** הגבול אינו „הספק ענה” אלא „הבקשה נפסלה על סמך
 * תוכנה”: טוקן שגוי, כתובת From שאינה מאומתת, נמען פסול, חריגה
 * מקצב. ‎5xx הוא תקלה **אצל הספק**, שיכולה לקרות אחרי שההודעה כבר
 * נקלטה — ולכן הוא שייך לאותה משפחה עמומה של פסק זמן ואינו נושא את
 * הסוג הזה. ‎`send` אוכפת בדיוק את הגבול הזה.
 *
 * היורש מ-`ServiceUnavailableException` ולא מחליף אותו: מי שאינו
 * מבחין ממשיך לקבל בדיוק את אותה תשובה.
 *
 * ## ‎**`retryable` — הציר השני, ולמה הוא נפרד**
 *
 * לסוג הזה היו **שני קוראים ששאלו אותו שתי שאלות שונות**. נתיב
 * ההרשמה שואל „האם ידוע שלא יצאה?”, כדי להחזיר מכסה ולבטל קוד.
 * נתיב ההצעות שואל „האם יש טעם לנסות שוב?”, כדי לסמן `email_failed`
 * ולהוציא את ההצעה מהמחזור. לרוב התשובות זהות — טוקן שגוי ונמען
 * פסול ייכשלו זהה לנצח.
 *
 * ‎**חריגה מקצב היא המקום שבו הן נפרדות.** ההודעה בוודאות לא יצאה,
 * ולכן המכסה חוזרת — אבל היא לא יצאה **מפני שהספק ביקש להאט**, וזו
 * ההגדרה של „נסו בעוד רגע”. סימון `email_failed` שם מוציא לתמיד
 * הצעה שדבר לא היה פסול בה (ביקורת Codex). לכן זה שדה ולא סוג נפרד:
 * הקביעה „לא יצאה” נכונה בשני המקרים, ורק ההמלצה שונה.
 */
export class EmailRejectedError extends ServiceUnavailableException {
  constructor(
    message: string,
    /** ‎`true` = נדחתה עכשיו ובלבד. ברירת המחדל היא הכישלון הקבוע. */
    readonly retryable: boolean = false,
  ) {
    super(message);
  }
}

/**
 * ‎**„איננו יודעים” — והפעם זה נאמר, ולא משתמע.**
 *
 * ‏פסק זמן, נפילת רשת או ‎5xx אינם „נכשל”: ייתכן שהספק קיבל את
 * ההודעה ושלח אותה, ורק התשובה אבדה בדרך חזרה. עד כה הם יצאו
 * כ-`ServiceUnavailableException` סתם — כלומר בדיוק אותו דבר שכל
 * תקלה אחרת מחזירה — והקורא נאלץ להסיק את ההבחנה מהיעדר הסוג
 * השני. „לא `EmailRejectedError`” אינו ידיעה חיובית: גם באג
 * בקוד נראה כך.
 *
 * ‎`idempotencyKey` נישא על השגיאה בכוונה: הוא מה שמאפשר לקורא
 * לומר למשתמש „נסו שוב, לא יישלח פעמיים” ולהתכוון לזה — הניסיון
 * החוזר עם אותו מפתח יפגוש את הזיכרון ולא את הספק.
 *
 * יורש מ-`ServiceUnavailableException` ולא מחליף אותו: מי שאינו
 * מבחין ממשיך לקבל בדיוק את אותה תשובה כמו קודם.
 */
export class EmailAmbiguousError extends ServiceUnavailableException {
  constructor(
    message: string,
    /** ‎`null` = לשליחה הזו לא הוגדר מפתח, ולכן אין הגנה מפני כפילות. */
    readonly idempotencyKey: string | null = null,
  ) {
    super(message);
  }
}

/**
 * ‎**מה נרשם על שורת הודעה ששליחתה נכשלה — ולמה לא `instanceof` בכל אתר.**
 *
 * ‏ארבעה נתיבי שליחה כתבו את הכלל הזה בעצמם, וכולם באותו ניסוח:
 * ‎`error instanceof EmailRejectedError ? "failed" : "unknown"`. הכלל
 * ‏נכון בכוונתו — „נכשלה” רק כשידוע שלא יצאה — אבל **הוא נשען על
 * ‏שלילה**, ובדיוק זה מה שההערה על `EmailAmbiguousError` כאן למעלה
 * ‏מזהירה מפניו: „לא `EmailRejectedError`” אינו ידיעה חיובית.
 *
 * ‎**מה זה עשה בפועל.** באג בקוד שלנו — `TypeError` לפני שהבקשה
 * ‏בכלל יצאה, נפילה בשליפת ההגדרות, כשל כתיבה בתפיסת המפתח — אינו
 * ‏`EmailRejectedError`, ולכן נרשם „ייתכן שנשלחה”. הלקוח לא קיבל
 * ‏דבר, המסך אומר לסוכן שאולי כן, והסוכן אינו שולח שוב. זו בדיוק
 * ‏ההיעלמות השקטה שכל הנתיבים האלה נבנו כדי למנוע — רק מהכיוון
 * ‏ההפוך מזה שנשמר מפניו.
 *
 * ‎**הידיעה החיובית קיימת.** `EmailService.send` ממצה את גבול הספק:
 * ‏‎4xx ⇐ `EmailRejectedError`, וכשל רשת / פסק זמן / 5xx ⇐
 * ‏`EmailAmbiguousError`. כלומר **רק** `EmailAmbiguousError` אומר
 * ‏„ייתכן שההודעה יצאה”. כל השאר — דחייה ודאית או תקלה אצלנו —
 * ‏פירושו ששום דבר לא יצא, וניסיון חוזר בטוח (המפתח מונע כפילות).
 *
 * ‏התשובה אחת ומשמשת גם להכרעת הזרימה: `"failed"` ⇐ אין מה לשמור
 * ‏ואפשר לזרוק, `"unknown"` ⇐ ייתכן שהגיע, ולכן העותקים נשמרים
 * ‏והמצב מוצג לסוכן במקום להיזרק.
 */
export function emailSendOutcome(error: unknown): "failed" | "unknown" {
  return error instanceof EmailAmbiguousError ? "unknown" : "failed";
}

/**
 * ‎**זהות עסקית של שליחה — ולמה היא חובה ולא רשות.**
 *
 * ‏שדה רשות היה נשכח, וכל אתר שליחה שנוסף בלי לחשוב על כך היה
 * חוזר לדפוס הישן בשקט. השדה חובה, ולכן המהדר מכריח כל קורא —
 * הקיימים והבאים — להחליט: מפתח, או `null` מנומק.
 *
 * ‎`null` פירושו „חזרה כאן היא הודעה חדשה ולא כפילות” — תזכורת
 * חודשית, קוד התחברות, מייל בדיקה. אלה אינם חוסר-הגנה בהיסח
 * הדעת; זו התשובה הנכונה עבורם.
 */
export interface EmailIdempotency {
  /**
   * ‏מזהה עסקי יציב, לא טביעת אצבע של התוכן: „ההסכם הזה ללקוח
   * הזה” הוא אותה שליחה גם אחרי שהנוסח עודכן.
   */
  key: string;
  /** ‏למה נשלח — לאבחון בלבד (`agreement`, `offer`, `intake`…). */
  purpose: string;
}

/**
 * ‎**כמה זמן זוכרים.** הזיכרון קיים בשביל הניסיון החוזר, וזה קורה
 * בדקות עד ימים. חודש הוא נדיב, וזול.
 */
const ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** ‏ניקוי אחת לכמה כתיבות — כמו ביומן קליטת הוובהוק, ובלי סורק. */
const ATTEMPT_PRUNE_EVERY = 200;

/**
 * ‎**קודי ה-4xx שאומרים „לא עכשיו” ולא „לא”.**
 *
 * ‎429 — הספק מבקש להאט. 408 — הבקשה לא הושלמה בזמן אצלו. בשניהם
 * ההודעה לא יצאה ובשניהם אותה בקשה בדיוק תצליח מאוחר יותר; כל שאר
 * ה-4xx נפסלו על סמך תוכן שלא ישתנה מעצמו.
 */
const RETRYABLE_REJECTIONS = new Set([408, 429]);

/**
 * ‎**הכותרת ששוברת לולאות דואר** — RFC 3834.
 *
 * מיוצאת ולא כתובה בשורה, כדי שהבדיקה תוכל להאכיל בה את
 * ‎`autoReplyReason` ולהוכיח שהצד הנכנס באמת מפיל אותה. שני קצוות
 * שנכתבים בנפרד הם שני קצוות שיכולים להיפרד, וכאן המחיר של פרידה
 * כזו הוא מאות מיילים ללקוח.
 */
export const AUTO_SUBMITTED_HEADER = { Name: "Auto-Submitted", Value: "auto-generated" } as const;

/**
 * ‏מזהה ההודעה אצל הספק — לאבחון. גוף שאינו JSON אינו הופך שליחה
 * ‏מוצלחת לכישלון, ולכן `null` ולא חריגה.
 */
async function providerMessageId(res: Response): Promise<string | null> {
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === "object" && parsed !== null && "MessageID" in parsed) {
      const id = (parsed as { MessageID: unknown }).MessageID;
      return typeof id === "string" ? id.slice(0, 120) : null;
    }
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  /** ‏מונה כתיבות — הניקוי נתלה עליו, כמו ביומן קליטת הוובהוק. */
  private attemptWrites = 0;

  constructor(
    private readonly platformSettings: PlatformSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  private async credentials(): Promise<{ token: string; from: string } | null> {
    const env = loadEnv();
    const token = (await this.platformSettings.get("postmarkServerToken")) ?? env.POSTMARK_SERVER_TOKEN;
    const from = (await this.platformSettings.get("emailFrom")) ?? env.EMAIL_FROM;
    return token && from ? { token, from } : null;
  }

  /**
   * כתובת השולח של **המשרד** — כשחיבר דומיין ואימת אותו.
   *
   * ‏`withExplicitTenant` ולא `withTenant`: שליחה קורית גם מסורקים
   * (חידושים, תזכורות) שרצים בלי הקשר בקשה, והמזהה מגיע תמיד
   * מהשורה שבגינה נשלח המייל — לעולם לא מקלט משתמש.
   *
   * דומיין שאינו מאומת במלואו מוחזר כ-`null` בכוונה: שליחה ממנו
   * הייתה יוצאת לא חתומה או נדחית אצל הספק, ושתי התוצאות גרועות
   * מהחלופה — כתובת הפלטפורמה המאומתת.
   */
  private async tenantSender(tenantId: string): Promise<string | null> {
    const row = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.emailDomain.findUnique({
        where: { tenantId },
        select: {
          dkimVerified: true,
          returnPathVerified: true,
          fromEmail: true,
          fromName: true,
        },
      }),
    );
    if (row === null || emailDomainStatus(row) !== "verified") return null;
    return formatSender(row.fromName, row.fromEmail);
  }

  /** האם מחובר ספק אמיתי — פיצ'רים שדורשים אימייל בפועל בודקים כאן. */
  async isConfigured(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  /**
   * שליחה.
   *
   * `content` מקבל גם מחרוזת, כדי שקריאה פשוטה לא תחייב אובייקט —
   * היא נקראת כפסקה יחידה ועוברת באותה תבנית בדיוק.
   *
   * ‎`required` — **שליחה שהמשך התהליך תלוי בה.** בלי ספק מחובר
   * ההודעה נרשמת ליומן והקריאה חוזרת בשקט, וזה הנכון להתראה: אין
   * סיבה להפיל פעולה במערכת משום שאין ספק דואר. אבל קורא שמסיק
   * מכך שההודעה יצאה מקבל תשובה שגויה — ובנתיב ההרשמה זה אומר
   * שהקוד הקודם נפסל, קוד חדש „נשלח”, ואיש לא קיבל דבר (ביקורת
   * Codex). מי שתלוי בשליחה מבקש `required`, ומקבל דחייה ודאית.
   *
   * הבדיקה כאן ולא ב-`isConfigured` נפרד: ההגדרות יכולות להשתנות
   * בין שתי קריאות, ורק קריאה **אחת** של האישורים מכריעה גם אם יש
   * ספק וגם אם השליחה יצאה.
   */
  async send(
    to: string,
    subject: string,
    content: EmailContent | string,
    options: {
      /**
       * ‎**חובה, וזו כל הנקודה** — ראו `EmailIdempotency`.
       *
       * ‏מפתח = „חזרה עם אותו מפתח היא אותה שליחה”, והזיכרון מונע
       * ‏מייל כפול ללקוח אחרי כישלון עמום. ‎`null` = „חזרה כאן היא
       * ‏הודעה חדשה”, וזו החלטה מנומקת ולא השמטה.
       */
      idempotency: EmailIdempotency | null;
      required?: boolean;
      tenantId?: string;
      tenantOnly?: boolean;
      /**
       * כתובת Reply-To — תיבת הדואר הפנימית: מיילים ללקוח נושאים
       * כתובת ייחודית שמחזירה את תשובתו אל תוך המערכת. לא נשלח
       * כ-From: הדומיין החתום נשאר השולח, וזו רק כתובת התשובה.
       */
      replyTo?: string;
      /**
       * קבצים מצורפים — תשובת סוכן מהתיבה. האכיפה (סוגים, גדלים)
       * אצל הקורא; כאן רק הקידוד לפורמט הספק.
       */
      attachments?: readonly { name: string; contentType: string; content: Buffer }[];
      /**
       * ‎**שולח משלו — לתיבה שהיא שרת נפרד אצל הספק.**
       *
       * תיבת התמיכה אינה עוד מייל שיוצא מהמערכת: היא כתובת שמקבלת,
       * ולכן היא חייבת גם לשלוח מעצמה — תשובה שיוצאת מ-`no-reply`
       * מזמינה את הפונה להשיב לכתובת שאיש אינו קורא (ביקורת Codex).
       *
       * ‎`token` נפרד כשהתיבה יושבת על שרת נפרד אצל הספק: כך תקלה
       * או חסימה בזרם אחד אינה נוגעת בשני, וגם הסטטיסטיקה נפרדת.
       * בלעדיו נשלח בטוקן הכללי — שרת אחד הוא הגדרה חסרה, לא סיבה
       * לא לענות לפונה.
       */
      sender?: { from: string; token?: string | undefined };
      /**
       * ‎**הודעה שמכונה יצרה — ולא פנייה של אדם.**
       *
       * מוסיף `Auto-Submitted: auto-generated` (RFC 3834), וזו אינה
       * נימוס: `autoReplyReason` בצד הנכנס מפיל כל הודעה שנושאת את
       * הכותרת הזאת, ולכן היא **שוברת לולאות דואר**.
       *
       * התקלה שהיא נולדה ממנה: התראת „פנייה חדשה” נשלחה לכתובת
       * התמיכה, כתובת התמיכה מנותבת לוובהוק הנכנס, ההתראה נקלטה
       * כהודעה חדשה על אותה פנייה — והפעילה התראה נוספת. מאות
       * הודעות על פנייה אחת, בייצור.
       *
       * ‎**לא לכל מייל.** הודעה ללקוח היא שיחה, והוא אמור להשיב
       * עליה; סימונה כאוטומטית פוגע במסירה ובשרשור. זה נועד למה
       * שבאמת נכתב בידי מכונה אל תיבה תפעולית.
       */
      autoGenerated?: boolean;
    },
  ): Promise<void> {
    const body: EmailContent =
      typeof content === "string" ? { paragraphs: [content] } : content;
    const global = await this.credentials();
    const creds =
      options.sender === undefined
        ? global
        : ((): { token: string; from: string } | null => {
            const token = options.sender.token ?? global?.token ?? "";
            return token === "" || options.sender.from === ""
              ? null
              : { token, from: options.sender.from };
          })();
    if (!creds) {
      if (options.required === true) {
        this.logger.error(`[אימייל נדרש ולא נשלח — אין ספק מחובר] ${subject}`);
        throw new EmailRejectedError("שליחת האימייל נכשלה — נסו שוב");
      }
      // אין ספק — נרשם ללוג השרת בלבד (לא נשלח לאף אחד)
      this.logger.warn(`[אימייל לא נשלח — אין ספק מחובר] אל: ${to} | ${subject}`);
      return;
    }

    /*
     * ‎**התביעה אחרי בדיקת האישורים, ולא לפניה.**
     *
     * ‏בלי ספק מחובר לא נשלחת הודעה ולא נעשית קריאה חיצונית, ולכן
     * ‏אין מה לזכור. שורת `sending` שהייתה נכתבת שם הייתה נשארת
     * ‏תלויה, והשליחה **האמיתית** — אחרי שיחברו ספק — הייתה נחסמת
     * ‏עד שתתיישן.
     */
    if (await this.claim(options.idempotency, options.tenantId, creds.token)) return;

    /*
     * ‏`tenantId` — המייל יוצא בשם **המשרד** ולא בשם הפלטפורמה,
     * כשהמשרד חיבר דומיין ואימת אותו. זה המייל שהמשרד שולח ללקוח
     * שלו (הסכם לחתימה), והלקוח מכיר את המשרד — לא אותנו.
     *
     * דחיית 4xx על שולח של משרד מקבלת ניסיון שני מכתובת הפלטפורמה:
     * הדומיין יכול להישבר אצל הספק אחרי שאומת (רשומה שנמחקה אצל רשם
     * הדומיינים), והלקוח שמחכה להסכם חשוב מהמיתוג. הכישלון נרשם
     * ברעש כדי שהתקלה לא תוסתר — המשרד יראה גם סטטוס שבור במסך.
     *
     * ‏`tenantOnly` הופך את הנפילה הרכה לכישלון מפורש — בשביל מייל
     * **הבדיקה** של החיבור, שכל תכליתו לוודא שהשליחה מכתובת המשרד
     * עובדת. בדיקה שנופלת בשקט לכתובת הפלטפורמה ומדווחת "נשלח"
     * מאשרת בדיוק את החיבור השבור שהיא נועדה לחשוף (ביקורת Codex).
     */
    const tenantFrom =
      options.tenantId === undefined ? null : await this.tenantSender(options.tenantId);
    if (options.tenantOnly === true && tenantFrom === null) {
      await this.settle(options.idempotency, "rejected", null);
      throw new EmailRejectedError(
        "הדומיין של המשרד אינו מאומת — בדקו את החיבור במסך ההגדרות",
      );
    }
    if (tenantFrom !== null) {
      const res = await this.postmarkSend(
        creds.token,
        tenantFrom,
        to,
        subject,
        body,
        options.replyTo,
        options.attachments,
        options.autoGenerated,
        options.idempotency,
      );
      if (res === null) throw await this.ambiguous(options.idempotency);
      if (res.ok) {
        await this.settle(options.idempotency, "sent", await providerMessageId(res));
        return;
      }
      const detail = await res.text().catch(() => "");
      this.logger.error(
        `Postmark דחה שולח של משרד (${res.status}): ${detail.slice(0, 300)}${options.tenantOnly === true ? "" : " — נשלח שוב מכתובת הפלטפורמה"}`,
      );
      if (res.status >= 500) throw await this.ambiguous(options.idempotency);
      if (options.tenantOnly === true) {
        await this.settle(options.idempotency, "rejected", null);
        // חריגה מקצב אינה „הדומיין פסול” — אותה בדיקה תעבור בעוד רגע
        throw new EmailRejectedError(
          RETRYABLE_REJECTIONS.has(res.status)
            ? "ספק האימייל מגביל כרגע את קצב השליחה — נסו שוב בעוד רגע"
            : "ספק האימייל דחה את הכתובת של המשרד — בדקו את האימות במסך ההגדרות",
          RETRYABLE_REJECTIONS.has(res.status),
        );
      }
      /*
       * ‏נפילה רכה לכתובת הפלטפורמה — **ובלי לסמן דבר**. השליחה
       * ‏הזו עדיין באוויר, ומצבה ייקבע מהניסיון השני. סימון „נדחה”
       * ‏כאן היה מתאר את השולח שנפסל ולא את המייל שעדיין בדרך.
       */
    }

    const res = await this.postmarkSend(
      creds.token,
      creds.from,
      to,
      subject,
      body,
      options.replyTo,
      options.attachments,
      options.autoGenerated,
      options.idempotency,
    );
    if (res === null) throw await this.ambiguous(options.idempotency);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 422 של Postmark כולל סיבה (כתובת From לא מאומתת וכו') — ללוג בלבד
      this.logger.error(`Postmark החזיר ${res.status}: ${detail.slice(0, 300)}`);
      /*
       * **רק 4xx הוא דחייה ודאית.**
       *
       * 4xx אומר שהבקשה נפסלה על סמך תוכנה — טוקן שגוי, כתובת From
       * שאינה מאומתת, נמען פסול, חריגה מקצב — ולכן בוודאות לא יצאה
       * הודעה. 5xx הוא תקלה **אצל הספק**, שיכולה לקרות אחרי שההודעה
       * כבר נקלטה ולפני שהתשובה הושלמה; הוא שייך לאותה משפחה של פסק
       * זמן, כלומר „איננו יודעים” (ביקורת Codex).
       *
       * ‎**וגם בתוך 4xx יש הבחנה.** „לא יצאה” אינו „לא תצא לעולם”:
       * חריגה מקצב היא בקשה להאט, ומי שקורא אותה ככישלון קבוע קובר
       * הצעה תקינה. `retryable` נושא את ההבחנה הזו הלאה.
       */
      if (res.status < 500) {
        await this.settle(options.idempotency, "rejected", null);
        throw new EmailRejectedError(
          "שליחת האימייל נכשלה — נסו שוב",
          RETRYABLE_REJECTIONS.has(res.status),
        );
      }
      throw await this.ambiguous(options.idempotency);
    }
    await this.settle(options.idempotency, "sent", await providerMessageId(res));
  }

  /**
   * ‎**תפיסת השליחה — והתשובה היחידה שהקורא צריך: „כבר יצא?”**
   *
   * ‏‎`true` = יש כבר שליחה מוצלחת עם המפתח הזה, ואין מה לעשות.
   * ‏‎`false` = שולחים. ‎`inFlight` ו„עמום שהספק מאשר” מוכרעים כאן
   * ‏ולא אצל הקורא — אחרת כל אתר שליחה היה מפרש את המצבים בעצמו,
   * ‏וזו בדיוק הכפילות שהמנגנון בא לבטל.
   */
  private async claim(
    idempotency: EmailIdempotency | null,
    tenantId: string | undefined,
    token: string,
  ): Promise<boolean> {
    if (idempotency === null) return false;
    if (!isValidEmailIdempotencyKey(idempotency.key)) {
      /*
       * ‏מפתח פסול הוא באג של הקורא, לא מצב מסירה. שקט כאן היה
       * ‏מוריד את ההגנה בלי שאיש ידע — והמפתח שנשלח קטוע לספק
       * ‏הופך את החיפוש בדיעבד לחסר תועלת בדיוק כשנזקקים לו.
       */
      throw new Error(`מפתח אידמפוטנטיות פסול: ${idempotency.key.slice(0, 100)}`);
    }
    const now = new Date();
    /*
     * ‎`createMany` עם `skipDuplicates` — כלומר `ON CONFLICT DO
     * ‏NOTHING`. שני תהליכים שמתחילים יחד: אחד כותב, השני מקבל
     * ‏‎`count === 0` וקורא את השורה. אין שגיאה, אין טרנזקציה
     * ‏מבוטלת, ואין `catch` שבולע גם תקלה אמיתית.
     */
    const written = await this.prisma.emailSendAttempt.createMany({
      data: [
        {
          key: idempotency.key,
          tenantId: tenantId ?? null,
          purpose: idempotency.purpose.slice(0, 40),
          status: "sending",
          updatedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    if (written.count > 0) {
      await this.pruneAttempts();
      return false;
    }

    const previous = await this.prisma.emailSendAttempt.findUnique({
      where: { key: idempotency.key },
      select: { status: true, updatedAt: true },
    });
    const decision = emailAttemptDecision(
      previous === null ? null : { status: previous.status as EmailAttemptStatus, updatedAt: previous.updatedAt },
      now,
    );
    if (decision === "resolved") {
      this.logger.log(`מייל עם אותו מפתח כבר יצא — לא נשלח שוב (${idempotency.key})`);
      return true;
    }
    if (decision === "inFlight") {
      throw new EmailAmbiguousError(
        "שליחה זהה כבר בתהליך — המתינו רגע ובדקו שוב",
        idempotency.key,
      );
    }
    if (decision === "probe" && (await this.providerHasMessage(token, idempotency.key))) {
      await this.settle(idempotency, "sent", null);
      this.logger.log(`הספק מאשר שההודעה יצאה — לא נשלחת שוב (${idempotency.key})`);
      return true;
    }
    /*
     * ‎**התפיסה השנייה חייבת להיות מותנית, בדיוק כמו הראשונה**
     * ‏(ביקורת Codex, P1).
     *
     * ‏‎`createMany` עם `skipDuplicates` מסדר את הכניסה **הראשונה**
     * ‏בלבד. בניסיון החוזר — שורה `rejected`, או `sending` שהתיישנה
     * ‏שהספק אינו מכיר — שני עובדים קוראים את אותה שורה, שניהם
     * ‏מגיעים לכאן, ועדכון בלתי-מותנה מצליח אצל שניהם. שניהם
     * ‏מחזירים „שלח”, והלקוח מקבל את המייל פעמיים: בדיוק מה
     * ‏שהמנגנון קיים כדי למנוע.
     *
     * ‏התנאי הוא **המצב שקראנו ועוד החותמת שלו**, ולא אחד מהם:
     * ‏מעבר `rejected → sending` נחסם על ידי המצב לבדו, אבל
     * ‏‎`sending → sending` (שורה שהתיישנה) אינו משנה את המצב, ורק
     * ‏החותמת מבדילה. שורה שהתיישנה ישנה בהכרח מ-`now` בעשרות
     * ‏שניות, ולכן אין כאן התנגשות של אותה מילישנייה.
     *
     * ‏מי שהפסיד אינו „נכשל”: יש שליחה זהה בדרך ממש עכשיו, וזו
     * ‏אותה תשובה בדיוק שניתנת ל-`inFlight` שמעל.
     */
    const taken = await this.prisma.emailSendAttempt.updateMany({
      where: {
        key: idempotency.key,
        status: previous?.status ?? "sending",
        updatedAt: previous?.updatedAt ?? now,
      },
      data: { status: "sending", providerMessageId: null, updatedAt: now },
    });
    if (taken.count === 0) {
      throw new EmailAmbiguousError(
        "שליחה זהה כבר בתהליך — המתינו רגע ובדקו שוב",
        idempotency.key,
      );
    }
    return false;
  }

  /** ‏רישום התוצאה. בלי מפתח אין מה לרשום, וזה לא מצב שגיאה. */
  private async settle(
    idempotency: EmailIdempotency | null,
    status: EmailAttemptStatus,
    messageId: string | null,
  ): Promise<void> {
    if (idempotency === null) return;
    try {
      await this.prisma.emailSendAttempt.update({
        where: { key: idempotency.key },
        data: { status, providerMessageId: messageId, updatedAt: new Date() },
      });
    } catch (error: unknown) {
      /*
       * ‎**כתיבה שנכשלת אינה מבטלת מייל שכבר יצא.** התוצאה של
       * ‏השליחה נקבעה מול הספק; אי-סימונה משאיר את השורה `sending`,
       * ‏והיא תתיישן ותוכרע בבדיקה מול הספק. חריגה כאן הייתה הופכת
       * ‏שליחה מוצלחת לכישלון מדווח.
       */
      this.logger.error(`סימון ניסיון השליחה נכשל (${idempotency.key}): ${String(error)}`);
    }
  }

  /** ‏„איננו יודעים” — נרשם ככזה, ומוחזר ככזה. */
  private async ambiguous(idempotency: EmailIdempotency | null): Promise<EmailAmbiguousError> {
    await this.settle(idempotency, "unknown", null);
    return new EmailAmbiguousError(
      "שליחת האימייל נכשלה — נסו שוב",
      idempotency?.key ?? null,
    );
  }

  /**
   * ‎**„האם ההודעה הזו קיימת אצלך?” — במקום לנחש.**
   *
   * ‏חיפוש ההודעות היוצאות של Postmark מסנן לפי `metadata_<key>`,
   * ‏ולכן המפתח שנשלח על ההודעה עצמה הוא מה שהופך כישלון עמום
   * ‏לניתן להכרעה בדיעבד.
   *
   * ‏כישלון של החיפוש עצמו מוחזר כ-`false` — כלומר „לא ידוע
   * ‏שיצאה”. הבחירה כאן היא בין מייל כפול לבין מייל שלא הגיע,
   * ‏ובנתיבים האלה (הסכם, קוד, הצעה) אי-הגעה היא הנזק הגדול.
   */
  private async providerHasMessage(token: string, key: string): Promise<boolean> {
    try {
      const url = `https://api.postmarkapp.com/messages/outbound?count=1&offset=0&metadata_${EMAIL_IDEMPOTENCY_METADATA_KEY}=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "X-Postmark-Server-Token": token },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.error(`חיפוש הודעה אצל הספק החזיר ${res.status}`);
        return false;
      }
      const parsed: unknown = await res.json();
      const total =
        typeof parsed === "object" && parsed !== null && "TotalCount" in parsed
          ? (parsed as { TotalCount: unknown }).TotalCount
          : 0;
      return typeof total === "number" && total > 0;
    } catch (error: unknown) {
      this.logger.error(`חיפוש הודעה אצל הספק נכשל: ${String(error)}`);
      return false;
    }
  }

  /**
   * ‏ניקוי הזיכרון הישן — אחת לכמה כתיבות, בלי סורק ייעודי (הדפוס
   * ‏של `WebhookLogService`). כישלון אינו מפיל שליחה.
   */
  private async pruneAttempts(): Promise<void> {
    this.attemptWrites += 1;
    if (this.attemptWrites % ATTEMPT_PRUNE_EVERY !== 0) return;
    try {
      await this.prisma.emailSendAttempt.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - ATTEMPT_RETENTION_MS) } },
      });
    } catch (error: unknown) {
      this.logger.error(`ניקוי זיכרון השליחות נכשל: ${String(error)}`);
    }
  }

  /** ‏הקריאה עצמה. `null` = כשל רשת — כלומר עמום, ולא „נכשל”. */
  private async postmarkSend(
    token: string,
    from: string,
    to: string,
    subject: string,
    body: EmailContent,
    replyTo?: string,
    attachments?: readonly { name: string; contentType: string; content: Buffer }[],
    autoGenerated?: boolean,
    idempotency?: EmailIdempotency | null,
  ): Promise<Response | null> {
    try {
      return await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Server-Token": token,
        },
        body: JSON.stringify({
          From: from,
          To: to,
          ...(replyTo === undefined ? {} : { ReplyTo: replyTo }),
          ...(attachments === undefined || attachments.length === 0
            ? {}
            : {
                Attachments: attachments.map((a) => ({
                  Name: a.name,
                  Content: a.content.toString("base64"),
                  ContentType: a.contentType,
                })),
              }),
          /*
           * ‎`Auto-Submitted: auto-generated` (RFC 3834) — מה ששובר
           * לולאות דואר. `autoReplyReason` בצד הנכנס מפיל כל הודעה
           * שנושאת אותה, ולכן התראה שחוזרת לתיבה שלנו נעצרת בצעד
           * הראשון במקום לייצר עוד אחת.
           */
          ...(autoGenerated === true ? { Headers: [AUTO_SUBMITTED_HEADER] } : {}),
          /*
           * ‎**המפתח נוסע עם ההודעה** — וזה מה שמאפשר לשאול את
           * ‏הספק בדיעבד „האם היא יצאה”, במקום להמר בין מייל כפול
           * ‏למייל שלא הגיע. בלעדיו הזיכרון שלנו יודע שניסינו,
           * ‏ולעולם לא ידע אם הצלחנו.
           */
          ...(idempotency === undefined || idempotency === null
            ? {}
            : { Metadata: { [EMAIL_IDEMPOTENCY_METADATA_KEY]: idempotency.key } }),
          Subject: subject,
          HtmlBody: renderEmailHtml(body),
          TextBody: renderEmailText(body),
          MessageStream: "outbound",
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      /*
       * ‎**כשל רשת אינו „לא נשלח”.** הבקשה יצאה; מה שאבד הוא
       * ‏התשובה. `null` נושא בדיוק את זה אל הקורא, שמסמן „עמום”
       * ‏ומחזיר `EmailAmbiguousError` — ולא חריגה כללית שנראית
       * ‏כמו כל תקלה אחרת.
       */
      this.logger.error(`שליחת אימייל נכשלה (רשת): ${String(error)}`);
      return null;
    }
  }

  /**
   * שליחת מייל בדיקה ממסך ההגדרות — שגיאה מוחזרת לקורא בכוונה.
   *
   * ‎`required` כאן הוא **כל תכליתה** של הפעולה: מסך שאומר „נשלח אל
   * X” אחרי שלא נשלח דבר הוא בדיוק ההפך מבדיקת חיבור. הבדיקה
   * המוקדמת ב-`platform.controller` נשארת להודעה ידידותית, ואינה
   * ערובה — ההגדרות יכולות להשתנות בין שתי הקריאות (ביקורת Codex).
   */
  /**
   * מייל בדיקה **מהכתובת של המשרד** — ממסך חיבור הדומיין.
   *
   * אותו היגיון כמו `sendTest`: `required`, כי "נשלח" אחרי שלא נשלח
   * הוא ההפך מבדיקה. ו-`tenantOnly`, כי הנפילה הרכה לכתובת
   * הפלטפורמה — נכונה להסכם שחייב להגיע — הייתה הופכת כאן את
   * הבדיקה לשקר: מייל שמדווח "השליחה מהדומיין שלכם עובדת" אחרי
   * שיצא מכתובת הפלטפורמה מאשר בדיוק את החיבור השבור שהבדיקה
   * נועדה לחשוף (ביקורת Codex). דומיין שאיבד אימות מקבל כאן
   * שגיאה מפורשת, לא הצלחה מזויפת.
   */
  async sendTenantTest(tenantId: string, to: string): Promise<void> {
    await this.send(
      to,
      "בדיקת שליחה מהדומיין של המשרד — מתווכים",
      {
        heading: "השליחה מהדומיין שלכם עובדת",
        paragraphs: [
          "אם קיבלתם את ההודעה הזו, אימיילים ללקוחות המשרד נשלחים מהכתובת שחיברתם.",
          "בדקו את שורת 'מאת' — היא אמורה להציג את שם המשרד ואת הכתובת שהגדרתם.",
        ],
        footnote: "הודעת בדיקה שנשלחה ממסך הגדרות המשרד. אין צורך להשיב.",
      },
      // ‏מייל בדיקה — כל תכליתו לרוץ שוב ולראות אם החיבור עובד
      { idempotency: null, required: true, tenantId, tenantOnly: true },
    );
  }

  async sendTest(to: string): Promise<void> {
    await this.send(
      to,
      "בדיקת חיבור — מתווכים",
      {
        heading: "חיבור האימייל עובד",
        paragraphs: ["אם קיבלתם את ההודעה הזו, שליחת האימייל מהמערכת מוגדרת כראוי."],
        footnote: "הודעת בדיקה שנשלחה ממסך ניהול הפלטפורמה. אין צורך להשיב.",
      },
      // ‏אותו דבר: „שלחו שוב לבדיקה” הוא בדיוק מה שמבקשים כאן
      { idempotency: null, required: true },
    );
  }
}
