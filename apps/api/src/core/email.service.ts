import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * שליחת אימייל — שכבת הפשטה (docs/05 §0): הליבה לא מכירה ספק.
 * הספק המחובר: Postmark. ההגדרות נקראות קודם מהגדרות הפלטפורמה
 * (מסך /platform, מוצפן ב-DB) ואם אינן שם — ממשתני הסביבה.
 * בלי הגדרות כלל — Fallback ללוג; פיצ'רים שדורשים אימייל בפועל
 * (אימות כניסה) בודקים את isConfigured().
 */
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

  async send(to: string, subject: string, body: string): Promise<void> {
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
          TextBody: body,
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
      throw new ServiceUnavailableException("שליחת האימייל נכשלה — נסו שוב");
    }
  }

  /** שליחת מייל בדיקה ממסך ההגדרות — שגיאה מוחזרת לקורא בכוונה. */
  async sendTest(to: string): Promise<void> {
    await this.send(
      to,
      "בדיקת חיבור — מתווכים",
      "אם קיבלת את ההודעה הזו, חיבור האימייל של המערכת עובד. אין צורך להשיב.",
    );
  }
}
