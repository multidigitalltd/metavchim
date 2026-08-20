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
   * הכשל האחרון וההצלחה האחרונה — בזיכרון, לאבחון.
   *
   * "זיהוי בסיסי" בכל פקודה עם מפתח מוגדר הוא כשל שקט לחלוטין:
   * הסיבה נרשמה רק ביומן השרת, ומי שמול המסך לא רואה דבר (דיווח
   * המשתמש). הרישום כאן הוא מה שהופך את זה לניתן לאבחון בלחיצה.
   */
  private lastFailure: { at: string; detail: string } | null = null;
  private lastSuccessAt: string | null = null;

  /**
   * בדיקת חיבור חיה — מחזירה את **הסיבה**, לא רק הצלחה/כשל.
   *
   * הקריאה זהה במבנה לקריאה אמיתית (אותו נתיב, אותם כותרים), כי
   * בדיקת "המפתח קיים" אינה מוכיחה דבר: מפתח תקין עם שם מודל שגוי,
   * או שרת שחסום ליציאה ל-Google, נכשלים באותה צורה שקטה.
   */
  async probe(
    prompt: string,
    responseSchema?: Record<string, unknown>,
  ): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    const result = await this.callDetailed(prompt, {
      ...(responseSchema === undefined ? {} : { responseSchema }),
      maxOutputTokens: 4_096,
      timeoutMs: 15_000,
    });
    return {
      ok: result.value !== null,
      latencyMs: Date.now() - started,
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  }

  status(): { lastFailure: { at: string; detail: string } | null; lastSuccessAt: string | null } {
    return { lastFailure: this.lastFailure, lastSuccessAt: this.lastSuccessAt };
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
    return (await this.callDetailed(prompt, options)).value;
  }

  /**
   * הקריאה עצמה, עם **הסיבה** לכשל ולא רק null.
   *
   * גוף התשובה של Google נקרא גם על שגיאה: `error.message` שלו אומר
   * בדיוק מה לא בסדר — "model not found", "API key not valid",
   * "Invalid JSON payload" — וזה ההבדל בין אבחון של עשר שניות לבין
   * "זה פשוט לא עובד" (דיווח המשתמש: זיהוי בסיסי בכל פקודה).
   */
  private async callDetailed(
    prompt: string,
    options: {
      responseSchema?: Record<string, unknown>;
      maxOutputTokens?: number;
      timeoutMs?: number;
    },
  ): Promise<{ value: unknown | null; error?: string }> {
    const key = await this.apiKey();
    if (key === "") return { value: null, error: "לא מוגדר מפתח Gemini" };
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
        const detail = `HTTP ${res.status} (מודל ${model}): ${await googleErrorMessage(res)}`;
        return { value: null, error: this.recordFailure(detail) };
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
        return {
          value: null,
          error: this.recordFailure("התשובה נחתכה בגלל מגבלת אסימונים (MAX_TOKENS)"),
        };
      }
      const text = candidate?.content?.parts?.[0]?.text ?? "";
      if (text === "") {
        return {
          value: null,
          error: this.recordFailure(
            `תשובה ריקה (finishReason: ${candidate?.finishReason ?? "אין"})`,
          ),
        };
      }
      const value = JSON.parse(text) as unknown;
      this.lastSuccessAt = new Date().toISOString();
      return { value };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const detail =
        name === "TimeoutError" || name === "AbortError"
          ? `פסק זמן אחרי ${options.timeoutMs ?? 5_000}ms — ייתכן שהשרת חסום ליציאה אל Google`
          : `כשל רשת: ${String(error)}`;
      return { value: null, error: this.recordFailure(detail) };
    }
  }

  private recordFailure(detail: string): string {
    this.lastFailure = { at: new Date().toISOString(), detail };
    this.logger.warn(`קריאת Gemini נכשלה — נופלים לחוקים: ${detail}`);
    return detail;
  }
}

/** ‎error.message‎ מגוף התשובה של Google — הסיבה האמיתית, לא רק הקוד. */
async function googleErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } };
    const message = body.error?.message ?? "";
    const status = body.error?.status ?? "";
    return [status, message].filter(Boolean).join(" — ").slice(0, 500) || "ללא פירוט";
  } catch {
    return "ללא פירוט";
  }
}
