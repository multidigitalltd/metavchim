import { Injectable, Logger } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * Gemini Flash — מנוע הבנת השפה של הפקודות הקוליות.
 *
 * המודל הזול ביותר של Google (‏Flash-Lite‏), כי הפרומפטים כאן קצרים
 * והמשימה צרה: משפט אחד בעברית ⟵ JSON מובנה. איכות "מספיק טובה"
 * במחיר של שברירי אגורה לפקודה.
 *
 * **העיקרון: ה-LLM מציע, הקוד מכריע.** התשובה שלו לעולם אינה מבוצעת
 * ישירות — היא עוברת את אותה ולידציה דטרמיניסטית (נרמול טלפון,
 * סכימות zod), והכול נשאר טיוטה שהמתווך מאשר. וכשאין מפתח, או
 * שהקריאה נכשלת או מתמהמהת — נופלים לחוקים הקיימים, שעובדים היום.
 * המערכת לעולם אינה תלויה בזמינות של Google.
 */
/**
 * המודל כשלא נבחר אחר — **קבוע אחד, לא שני העתקים.**
 *
 * הוא נקרא גם כאן וגם במסך הפלטפורמה שמציג „באיזה מודל אנחנו
 * עובדים”. עד עכשיו הוא היה מוקלד בשני המקומות, וזה בדיוק הדפוס
 * שגרם לעמלת ההפניה להיות מוצגת 15% ונגבית 10%: הגדרה אחת עם שתי
 * ברירות מחדל היא מסך שמשקר בשקט ברגע שאחת מהן מתעדכנת.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  private async apiKey(): Promise<string> {
    return (await this.settings.get("geminiApiKey")) ?? loadEnv().GEMINI_API_KEY ?? "";
  }

  /** המודל בתוקף — מההגדרה, מהסביבה, או ברירת המחדל. */
  async activeModel(): Promise<string> {
    return (
      (await this.settings.get("geminiModel")) ??
      loadEnv().GEMINI_MODEL ??
      DEFAULT_GEMINI_MODEL
    );
  }

  async isConfigured(): Promise<boolean> {
    return (await this.apiKey()) !== "";
  }

  /**
   * פרומפט ⟵ JSON. מחזיר null על כל כשל — הקורא נופל-לאחור לחוקים.
   *
   * ‎responseMimeType: application/json‎ גורם למודל להחזיר JSON נקי
   * בלי גדרות markdown; הפענוח כאן הוא ההגנה האחרונה, לא היחידה.
   * חמש שניות timeout: פקודה קולית היא אינטראקציה חיה, ומתווך שמחכה
   * שבע שניות כבר הקליד את זה ידנית.
   */
  async generateJson(prompt: string): Promise<unknown | null> {
    return this.call(prompt, {});
  }

  /**
   * פרומפט ⟵ JSON **בצורה שהוגדרה מראש.**
   *
   * ## למה סכימה ולא בקשה בפרוזה
   *
   * `generateJson` מבקש מהמודל להחזיר שדות מסוימים וסומך עליו. זה
   * עובד סביר לבחירה מתוך תשע אפשרויות ונשבר כשצריך למלא עשרים
   * וחמישה שדות מודפסים: המודל ממציא מפתחות, מחזיר מחרוזת במקום
   * מספר, וממציא ערך ל-enum שאינו קיים. `responseSchema` הופך את
   * זה מבקשה למגבלה — ה-API אוכף את המבנה, והמודל אינו יכול לחרוג.
   *
   * הוולידציה אצלנו נשארת ואינה מיותרת: הסכימה של Gemini היא
   * תת-קבוצה של OpenAPI ואינה יודעת לבטא כפולות של חצי, אורך
   * מחרוזת או יחסי טווח. **הסכימה מצמצמת, ה-zod מכריע.**
   *
   * ## למה timeout ארוך יותר
   *
   * חילוץ עשרים וחמישה שדות אורך יותר מבחירת מזהה אחד, ומודל
   * גדול יותר אורך יותר ממודל קטן. שתים-עשרה שניות הן הגבול שבו
   * מתווך עוד ממתין; מעליו הנפילה-לאחור לחוקים עדיפה על המתנה.
   */
  async generateStructured(
    prompt: string,
    responseSchema: Record<string, unknown>,
    options: { maxOutputTokens?: number; timeoutMs?: number } = {},
  ): Promise<unknown | null> {
    return this.call(prompt, {
      responseSchema,
      maxOutputTokens: options.maxOutputTokens ?? 4_096,
      timeoutMs: options.timeoutMs ?? 12_000,
    });
  }

  private async call(
    prompt: string,
    options: {
      responseSchema?: Record<string, unknown>;
      maxOutputTokens?: number;
      timeoutMs?: number;
    },
  ): Promise<unknown | null> {
    const key = await this.apiKey();
    if (key === "") return null;
    const model = await this.activeModel();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              ...(options.responseSchema === undefined
                ? {}
                : { responseSchema: options.responseSchema }),
              // דטרמיניזם עדיף על יצירתיות — זה חילוץ, לא כתיבה
              temperature: 0,
              maxOutputTokens: options.maxOutputTokens ?? 1_024,
            },
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Gemini השיב ${res.status} — נופלים לחוקים`);
        return null;
      }
      const body = (await res.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
        }[];
      };
      const candidate = body.candidates?.[0];
      /*
       * תשובה שנחתכה באמצע היא JSON פגום, ופענוח שלה נכשל בכל מקרה
       * — אבל השגיאה שתתקבל תתאר תו לא צפוי במקום את הסיבה. אמירה
       * מפורשת ביומן חוסכת חקירה של תקלה שהפתרון לה הוא מספר אחר
       * ב-`maxOutputTokens`.
       */
      if (candidate?.finishReason === "MAX_TOKENS") {
        this.logger.warn("תשובת Gemini נחתכה בגלל מגבלת אסימונים — נופלים לחוקים");
        return null;
      }
      const text = candidate?.content?.parts?.[0]?.text ?? "";
      if (text === "") return null;
      return JSON.parse(text) as unknown;
    } catch (error) {
      // כשל רשת/timeout/JSON פגום — כולם אותו דבר מבחינת הקורא
      this.logger.warn(`קריאת Gemini נכשלה — נופלים לחוקים: ${String(error)}`);
      return null;
    }
  }
}
