import { Body, Controller, HttpCode, Logger, Post } from "@nestjs/common";
import { Public } from "../../common/auth.decorators";
import { BillingService } from "./billing.service";

/**
 * הוובהוק של קארדקום.
 *
 * **גוף ההודעה אינו מקור אמת.** קארדקום אינו חותם אותה, ולכן כל מי
 * שיודע את הכתובת יכול לשלוח "שולם, סכום 1 ₪, משרד כלשהו". מה
 * שנלקח מכאן הוא **שדה אחד בלבד** — מזהה דף התשלום — וגם הוא רק כדי
 * לשאול את קארדקום מה באמת קרה (`BillingService.apply`). כל השאר
 * בגוף ההודעה נזרק.
 *
 * התשובה היא תמיד 200. קארדקום חוזר על הודעה שלא נענתה, וניסיון
 * חוזר על עסקה שכבר טופלה הוא רעש; האידמפוטנטיות ב-`apply` היא מה
 * שמגן, לא קוד התשובה.
 */
@Controller("webhooks/cardcom")
export class CardcomWebhookController {
  private readonly logger = new Logger(CardcomWebhookController.name);

  constructor(private readonly billing: BillingService) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown): Promise<{ ok: true }> {
    const lowProfileId = readLowProfileId(body);
    if (lowProfileId === null) {
      this.logger.warn("וובהוק קארדקום הגיע בלי מזהה דף תשלום — נזרק");
      return { ok: true };
    }

    try {
      const result = await this.billing.apply(lowProfileId);
      this.logger.log(`וובהוק קארדקום ${lowProfileId}: ${result.status}`);
    } catch (error) {
      // כישלון כאן לא מוחזר לקארדקום כשגיאה: הוא ינסה שוב, ובינתיים
      // דף החזרה של המשרד מבצע את אותו אימות בעצמו
      this.logger.error(`טיפול בוובהוק קארדקום נכשל: ${String(error)}`);
    }
    return { ok: true };
  }
}

/**
 * מזהה דף התשלום מתוך גוף ההודעה.
 *
 * שני האיותים נבדקים כי קארדקום שולח `LowProfileId` בגרסה החדשה
 * ו-`lowprofilecode` בגרסאות ישנות — טרמינל שהוגדר פעם אחת ממשיך
 * לשלוח בצורה שבה הוגדר.
 */
function readLowProfileId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  for (const key of ["LowProfileId", "lowprofilecode", "LowProfileCode", "lowProfileId"]) {
    const value = record[key];
    // אורך מוגבל: הערך נכנס לקריאת HTTP יוצאת, ומחרוזת ענק היא ניסיון
    // להעמיס ולא מזהה
    if (typeof value === "string" && value.length > 0 && value.length <= 64) return value;
  }
  return null;
}
