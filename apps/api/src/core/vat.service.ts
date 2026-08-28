import { Injectable } from "@nestjs/common";
import { DEFAULT_VAT_PERCENT, grossFromNet, vatSplitFromNet, type VatSplit } from "@metavchim/shared";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * שיעור המע"מ — **נקרא במקום אחד, ומשמש בכל אתר גבייה.**
 *
 * ## למה שירות ולא קבוע
 *
 * המחירון של הפלטפורמה נקוב **לפני מע"מ**, ולכן כל אתר שגובה כסף
 * צריך להמיר מחיר מחירון לסכום חיוב: מנוי, קרדיטים, השכרת מספר,
 * וחידוש של כל אחד מהם. חמישה אתרים, ואצל כולם אותה שאלה — כמה
 * מע"מ.
 *
 * השיעור אינו קבוע בקוד: הוא הגדרת פלטפורמה (`vatPercent`), כי הוא
 * משתנה בחקיקה ואי אפשר לחכות לפריסה. אבל **הגדרה שנקראת בחמישה
 * מקומות היא חמש נפילות אפשריות לברירת מחדל שונה**, ובכסף זה אומר
 * חיוב באחוז אחד ומסמך באחוז אחר. `InvoiceService` כבר החזיק עותק
 * פרטי של הקריאה הזאת; זה השני, וזה הרגע להוציא אותה החוצה.
 *
 * ## למה ברירת מחדל ולא שגיאה
 *
 * הגדרה חסרה או פגומה נופלת ל-18% ולא זורקת. גבייה שנעצרת כי מישהו
 * הקליד אות בשדה השיעור היא נזק גדול בהרבה מגבייה בשיעור ברירת
 * המחדל — שהוא ממילא השיעור הנכון בישראל היום, ובדיוק זה שהמסמך
 * ייבנה לפיו.
 */
@Injectable()
export class VatService {
  constructor(private readonly settings: PlatformSettingsService) {}

  /** השיעור התקף כרגע, באחוזים. */
  async percent(): Promise<number> {
    const raw = await this.settings.get("vatPercent");
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
      ? parsed
      : DEFAULT_VAT_PERCENT;
  }

  /**
   * מחיר מחירון (נטו) ⟵ הסכום שייגבה בפועל.
   *
   * זו הפונקציה שכל אתר גבייה קורא לה בדיוק פעם אחת, על הסכום
   * **אחרי** הנחות: המע"מ מחושב על מה שמשלמים, לא על מה שהיה כתוב
   * לפני הקופון.
   */
  async gross(netAgorot: number): Promise<number> {
    return grossFromNet(netAgorot, await this.percent());
  }

  /** הפירוק המלא, למקום שצריך להציג גם את רכיב המע"מ. */
  async split(netAgorot: number): Promise<VatSplit> {
    return vatSplitFromNet(netAgorot, await this.percent());
  }

  /**
   * הסכום לחיוב **יחד עם השיעור שלפיו הוא נבנה** — מה שנכתב על
   * שורת התשלום.
   *
   * ‎**השיעור נצרב, ולא נקרא מחדש בהפקת המסמך.** המסמך נבנה מהברוטו
   * שנגבה (הוא חייב להסתכם בדיוק בשקל שנגבה), ולכן הוא מפרק אותו
   * בחזרה — ופירוק בשיעור אחר מזה שבו הורכב מחזיר נטו אחר. שינוי
   * חקיקה באמצע היה מוציא שורת חשבונית שאינה המחיר שהובטח, על כל
   * התשלומים שהיו באוויר: 100 ₪ נטו שנגבו כ-118 ומפורקים ב-19%
   * נרשמים כ-99.16 (ביקורת Codex).
   *
   * החלון אינו תיאורטי — דף תשלום שנשאר פתוח, סבב חידושים, וסורק
   * החשבוניות שרץ כל חמש דקות.
   *
   * שני השדות חוזרים יחד ומיועדים לפריסה אחת לתוך `payment.create`,
   * כדי שלא ייתכן אתר שכותב את הסכום ושוכח את השיעור.
   */
  async charge(netAgorot: number): Promise<{ amountAgorot: number; vatPercent: number }> {
    const vatPercent = await this.percent();
    return { amountAgorot: grossFromNet(netAgorot, vatPercent), vatPercent };
  }
}
