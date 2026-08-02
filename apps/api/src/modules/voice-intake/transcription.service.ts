import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { loadEnv } from "../../config/env";

/**
 * תמלול אודיו — שכבת הפשטה (docs/05 §0). המימוש הפעיל הוא שירות
 * מקומי בשרת (faster-whisper): ההקלטות של לקוחות המשרד לא יוצאות
 * מהמכונה, לא נשמרות בדיסק, ולא נשלחות לשום ספק חיצוני.
 *
 * לא מוגדר ⇒ הפיצ'ר פשוט לא מוצע בממשק, והדפדפן ממשיך לתמלל
 * מקומית (Web Speech API) כמו קודם — אין רגרסיה.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  get available(): boolean {
    const env = loadEnv();
    return env.STT_URL !== undefined && env.STT_SECRET !== undefined;
  }

  async transcribe(audio: Buffer, filename: string): Promise<{ text: string }> {
    const env = loadEnv();
    if (env.STT_URL === undefined || env.STT_SECRET === undefined) {
      throw new ServiceUnavailableException("תמלול בשרת אינו מוגדר");
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)]), filename);

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

    if (!res.ok) {
      this.logger.error(`שירות התמלול החזיר ${res.status}`);
      throw new ServiceUnavailableException("התמלול נכשל — נסו שוב או הקלידו");
    }

    const body = (await res.json()) as { text?: string };
    return { text: (body.text ?? "").trim() };
  }
}
