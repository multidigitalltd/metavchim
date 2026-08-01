import { Injectable, Logger } from "@nestjs/common";

/**
 * שליחת אימייל — שכבת הפשטה (docs/05 §0): הליבה לא מכירה ספק.
 * כרגע אין ספק אימייל מחובר, ולכן ברירת המחדל היא Fallback ללוג —
 * מספיק לפיתוח ולבדיקות. חיבור ספק אמיתי (SMTP/API) יחליף את המימוש
 * כאן בלבד, בלי לגעת בקוד שקורא לו.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /** האם מחובר ספק אמיתי — פיצ'רים שדורשים אימייל בפועל בודקים כאן. */
  get providerConfigured(): boolean {
    return false; // יתעדכן עם חיבור ספק (SMTP_URL וכד')
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    // Fallback: אין ספק — נרשם ללוג השרת בלבד (לא נשלח לאף אחד)
    this.logger.warn(`[אימייל לא נשלח — אין ספק מחובר] אל: ${to} | ${subject} | ${body}`);
  }
}
