import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import {
  emailDomainStatus,
  formatSender,
  renderEmailHtml,
  renderEmailText,
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
 * ‎**קודי ה-4xx שאומרים „לא עכשיו” ולא „לא”.**
 *
 * ‎429 — הספק מבקש להאט. 408 — הבקשה לא הושלמה בזמן אצלו. בשניהם
 * ההודעה לא יצאה ובשניהם אותה בקשה בדיוק תצליח מאוחר יותר; כל שאר
 * ה-4xx נפסלו על סמך תוכן שלא ישתנה מעצמו.
 */
const RETRYABLE_REJECTIONS = new Set([408, 429]);

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

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
    } = {},
  ): Promise<void> {
    const body: EmailContent =
      typeof content === "string" ? { paragraphs: [content] } : content;
    const creds = await this.credentials();
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
      );
      if (res.ok) return;
      const detail = await res.text().catch(() => "");
      this.logger.error(
        `Postmark דחה שולח של משרד (${res.status}): ${detail.slice(0, 300)}${options.tenantOnly === true ? "" : " — נשלח שוב מכתובת הפלטפורמה"}`,
      );
      if (res.status >= 500) {
        throw new ServiceUnavailableException("שליחת האימייל נכשלה — נסו שוב");
      }
      if (options.tenantOnly === true) {
        // חריגה מקצב אינה „הדומיין פסול” — אותה בדיקה תעבור בעוד רגע
        throw new EmailRejectedError(
          RETRYABLE_REJECTIONS.has(res.status)
            ? "ספק האימייל מגביל כרגע את קצב השליחה — נסו שוב בעוד רגע"
            : "ספק האימייל דחה את הכתובת של המשרד — בדקו את האימות במסך ההגדרות",
          RETRYABLE_REJECTIONS.has(res.status),
        );
      }
    }

    const res = await this.postmarkSend(
      creds.token,
      creds.from,
      to,
      subject,
      body,
      options.replyTo,
      options.attachments,
    );
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
        throw new EmailRejectedError(
          "שליחת האימייל נכשלה — נסו שוב",
          RETRYABLE_REJECTIONS.has(res.status),
        );
      }
      throw new ServiceUnavailableException("שליחת האימייל נכשלה — נסו שוב");
    }
  }

  /** הקריאה עצמה — כשל רשת מתורגם כאן, קוד התשובה מוכרע אצל הקורא. */
  private async postmarkSend(
    token: string,
    from: string,
    to: string,
    subject: string,
    body: EmailContent,
    replyTo?: string,
    attachments?: readonly { name: string; contentType: string; content: Buffer }[],
  ): Promise<Response> {
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
          Subject: subject,
          HtmlBody: renderEmailHtml(body),
          TextBody: renderEmailText(body),
          MessageStream: "outbound",
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.error(`שליחת אימייל נכשלה (רשת): ${String(error)}`);
      throw new ServiceUnavailableException("שליחת האימייל נכשלה — נסו שוב");
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
      { required: true, tenantId, tenantOnly: true },
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
      { required: true },
    );
  }
}
