import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { loadEnv } from "../config/env";

/**
 * שליחת אימייל — שכבת הפשטה (docs/05 §0): הליבה לא מכירה ספק.
 * הספק המחובר: Postmark (POSTMARK_SERVER_TOKEN + EMAIL_FROM).
 * בלי הגדרות — Fallback ללוג בלבד; פיצ'רים שדורשים אימייל בפועל
 * (אימות כניסה, איפוס סיסמה) בודקים את providerConfigured.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly token?: string;
  private readonly from?: string;

  constructor() {
    const env = loadEnv();
    this.token = env.POSTMARK_SERVER_TOKEN;
    this.from = env.EMAIL_FROM;
  }

  /** האם מחובר ספק אמיתי — פיצ'רים שדורשים אימייל בפועל בודקים כאן. */
  get providerConfigured(): boolean {
    return this.token !== undefined && this.from !== undefined;
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.token || !this.from) {
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
          "X-Postmark-Server-Token": this.token,
        },
        body: JSON.stringify({
          From: this.from,
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
}
