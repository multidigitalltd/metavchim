import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { renderEmailHtml, renderEmailText, type EmailContent } from "@metavchim/shared";
import { loadEnv } from "../config/env";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * שליחת אימייל — שכבת הפשטה (docs/05 §0): הליבה לא מכירה ספק.
 * הספק המחובר: Postmark. ההגדרות נקראות קודם מהגדרות הפלטפורמה
 * (מסך /platform, מוצפן ב-DB) ואם אינן שם — ממשתני הסביבה.
 * בלי הגדרות כלל — Fallback ללוג; פיצ'רים שדורשים אימייל בפועל
 * (אימות כניסה) בודקים את isConfigured().
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
 */
export class EmailRejectedError extends ServiceUnavailableException {}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly platformSettings: PlatformSettingsService) {}

  private async credentials(): Promise<{ token: string; from: string } | null> {
    const env = loadEnv();
    const token = (await this.platformSettings.get("postmarkServerToken")) ?? env.POSTMARK_SERVER_TOKEN;
    const from = (await this.platformSettings.get("emailFrom")) ?? env.EMAIL_FROM;
    return token && from ? { token, from } : null;
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
   */
  async send(to: string, subject: string, content: EmailContent | string): Promise<void> {
    const body: EmailContent =
      typeof content === "string" ? { paragraphs: [content] } : content;
    const creds = await this.credentials();
    if (!creds) {
      // אין ספק — נרשם ללוג השרת בלבד (לא נשלח לאף אחד)
      this.logger.warn(`[אימייל לא נשלח — אין ספק מחובר] אל: ${to} | ${subject}`);
      return;
    }

    let res: Response;
    try {
      res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Server-Token": creds.token,
        },
        body: JSON.stringify({
          From: creds.from,
          To: to,
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
       */
      if (res.status < 500) {
        throw new EmailRejectedError("שליחת האימייל נכשלה — נסו שוב");
      }
      throw new ServiceUnavailableException("שליחת האימייל נכשלה — נסו שוב");
    }
  }

  /** שליחת מייל בדיקה ממסך ההגדרות — שגיאה מוחזרת לקורא בכוונה. */
  async sendTest(to: string): Promise<void> {
    await this.send(to, "בדיקת חיבור — מתווכים", {
      heading: "חיבור האימייל עובד",
      paragraphs: ["אם קיבלתם את ההודעה הזו, שליחת האימייל מהמערכת מוגדרת כראוי."],
      footnote: "הודעת בדיקה שנשלחה ממסך ניהול הפלטפורמה. אין צורך להשיב.",
    });
  }
}
