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
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  private async apiKey(): Promise<string> {
    return (await this.settings.get("geminiApiKey")) ?? loadEnv().GEMINI_API_KEY ?? "";
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
    const key = await this.apiKey();
    if (key === "") return null;
    const model =
      (await this.settings.get("geminiModel")) ??
      loadEnv().GEMINI_MODEL ??
      "gemini-2.5-flash-lite";
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
              // דטרמיניזם עדיף על יצירתיות — זה חילוץ, לא כתיבה
              temperature: 0,
              maxOutputTokens: 1024,
            },
          }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Gemini השיב ${res.status} — נופלים לחוקים`);
        return null;
      }
      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (text === "") return null;
      return JSON.parse(text) as unknown;
    } catch (error) {
      // כשל רשת/timeout/JSON פגום — כולם אותו דבר מבחינת הקורא
      this.logger.warn(`קריאת Gemini נכשלה — נופלים לחוקים: ${String(error)}`);
      return null;
    }
  }
}
