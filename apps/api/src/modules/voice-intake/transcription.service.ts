import { HttpException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { SEGMENT_DEFAULT_SECONDS, recommendSegmentSeconds } from "@metavchim/shared";
import { loadEnv } from "../../config/env";

/**
 * תמלול אודיו — שכבת הפשטה (docs/05 §0). המימוש הפעיל הוא שירות
 * מקומי בשרת (faster-whisper): ההקלטות של לקוחות המשרד לא יוצאות
 * מהמכונה, לא נשמרות בדיסק, ולא נשלחות לשום ספק חיצוני.
 *
 * לא מוגדר ⇒ הפיצ'ר פשוט לא מוצע בממשק, והדפדפן ממשיך לתמלל
 * מקומית (Web Speech API) כמו קודם — אין רגרסיה.
 */
/** מטמון קצר לבדיקת המוכנות — כל טעינת מסך קול שואלת. */
const READINESS_CACHE_MS = 15_000;
const HEALTH_TIMEOUT_MS = 3_000;

/**
 * רמז אוצר המילים למודל התמלול.
 *
 * המונחים שמתווך אומר בכל משפט שני — „ממ״ד”, „בלעדיות”, „טאבו”,
 * „מ״ר” — הם מילים נדירות בעברית הכללית שהמודל אומן עליה, ולכן הוא
 * מחליף אותן במילה שכיחה שנשמעת דומה („ממד”, „בלעדיות” ⇐ „בעלות”).
 * הרמז אינו מאלץ דבר: הוא רק מטה את ההסתברות לטובת הניסוח שנכון
 * לתחום הזה, וזה הכלי שהמודל עצמו מציע לכך (initial_prompt).
 *
 * ניסוח כטקסט זורם ולא כרשימה — כך זה עובד: המודל מתייחס אליו
 * כאל ההקשר שקדם להקלטה, לא כאל הוראה.
 */
const DOMAIN_HINT =
  'שיחה של מתווך נדל"ן בישראל על נכסים ולקוחות: דירה, דירת גן, פנטהאוז, דופלקס, ' +
  'מגרש, חנות, משרד, חדרים, מ"ר, קומה, מרפסת, ממ"ד, מעלית, חניה, מחסן, ריהוט, ' +
  'משופצת, כניסה מיידית, בלעדיות, טאבו, ארנונה, ועד בית, משכנתא, שכירות, מכירה, ' +
  'קונה, מוכר, ליד, סיור, פגישה, הצעה, עמלה, שיתוף פעולה, מיליון, אלף שקל.';

export interface TranscriptionStatus {
  available: boolean;
  /** אורך הקטע המומלץ בהקלטה רציפה (שניות) — ראו stt-segment. */
  segmentSeconds: number;
}

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readiness: { checkedAt: number; status: TranscriptionStatus } | null = null;

  private get configured(): boolean {
    const env = loadEnv();
    return env.STT_URL !== undefined && env.STT_SECRET !== undefined;
  }

  /**
   * האם התמלול בשרת *מוכן באמת* — לא רק מוגדר. בזמן משיכת המודל
   * הראשונה (כמה דקות), אחרי כשל חימום, או כשהקונטיינר למטה, הגדרה
   * בלבד הייתה שולחת את הממשק למצב שרת וההקלטה הראשונה הייתה
   * נתקעת עד ה-timeout. כאן שואלים את /health ובודקים loaded
   * (ביקורת Codex).
   */
  async status(): Promise<TranscriptionStatus> {
    const unavailable: TranscriptionStatus = {
      available: false,
      segmentSeconds: SEGMENT_DEFAULT_SECONDS,
    };
    if (!this.configured) return unavailable;

    const now = Date.now();
    if (this.readiness && now - this.readiness.checkedAt < READINESS_CACHE_MS) {
      return this.readiness.status;
    }

    const env = loadEnv();
    let status = unavailable;
    try {
      const res = await fetch(`${env.STT_URL}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = (await res.json()) as { loaded?: boolean; avgSeconds?: number };
        status = {
          available: body.loaded === true,
          segmentSeconds: recommendSegmentSeconds(body.avgSeconds),
        };
      }
    } catch {
      // שירות למטה או איטי ⇒ הממשק ממשיך עם זיהוי הדפדפן
      status = unavailable;
    }

    this.readiness = { checkedAt: now, status };
    return status;
  }

  async transcribe(audio: Buffer, filename: string): Promise<{ text: string }> {
    const env = loadEnv();
    if (env.STT_URL === undefined || env.STT_SECRET === undefined) {
      throw new ServiceUnavailableException("תמלול בשרת אינו מוגדר");
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)]), filename);
    form.append("prompt", DOMAIN_HINT);

    let res: Response;
    try {
      res = await fetch(`${env.STT_URL}/transcribe`, {
        method: "POST",
        headers: { "x-stt-secret": env.STT_SECRET },
        body: form,
        // מודל על CPU — הקלטה של דקה עשויה לקחת עשרות שניות
        signal: AbortSignal.timeout(env.STT_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`שירות התמלול לא זמין: ${String(error)}`);
      throw new ServiceUnavailableException("התמלול נכשל — נסו שוב או הקלידו");
    }

    if (res.status === 429) {
      // עומס רגעי — לא כשל של השירות. נשמר כ-429 כדי שהממשק ינסה שוב
      // במקום לוותר על התמלול בשרת לכל שאר הפעילות
      throw new HttpException("שירות התמלול עסוק — נסו שוב בעוד רגע", 429);
    }

    if (!res.ok) {
      this.logger.error(`שירות התמלול החזיר ${res.status}`);
      throw new ServiceUnavailableException("התמלול נכשל — נסו שוב או הקלידו");
    }

    const body = (await res.json()) as { text?: string };
    return { text: (body.text ?? "").trim() };
  }
}
