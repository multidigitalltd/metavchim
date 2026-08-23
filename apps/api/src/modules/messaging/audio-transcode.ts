import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * המרת הקלטה לפורמט ש-WhatsApp מקבל.
 *
 * ## למה זה נדרש בכלל
 *
 * ההקלטות נשמרות אצלנו כ-`audio/wav` (מרכזייה) או `audio/webm`
 * (הקלטה מהדפדפן). WhatsApp Cloud API אינה מקבלת אף אחד משניהם
 * בנתיב ה-`audio`, וההצהרה על `type` בהעלאה אינה ממירה דבר — היא
 * רק מתארת את הבייטים. כלומר שליחה בלי המרה נדחית ב-Meta, והמתווך
 * מקבל את הקישור החלופי במקום את ההקלטה — בדיוק במקרה הנפוץ
 * (ביקורת Codex).
 *
 * ## למה ffmpeg ולא ספריית npm
 *
 * זהו אותו כלי שכבר עושה את העבודה הזאת בשירותי התמלול והזיהוי
 * (`infra/stt`, `infra/diarize`), על אותם קבצים בדיוק. ספריית קידוד
 * ב-JS הייתה מימוש שני לאותה המרה, עם באגים משלה על אותם קלטים.
 *
 * ## מה קורה כשההמרה נכשלת
 *
 * `null`, והקורא שולח את הקישור למסך השיחות. זה גם מה שקורה כשאין
 * ffmpeg בסביבה — פיתוח מקומי, למשל — ולכן היעדרו אינו מפיל דבר.
 */

/**
 * הפורמטים שנתיב ה-`audio` של Meta מקבל.
 *
 * `audio/ogg` נקלט רק עם קודק Opus, וזה בדיוק מה שאנחנו מייצרים.
 * הפורמטים האחרים מגיעים מבחוץ (הודעה קולית שהמתווך העביר, למשל)
 * ואין סיבה לקודד אותם מחדש.
 */
const SUPPORTED = new Set(["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"]);

/** `audio/ogg; codecs=opus` ⟵ `audio/ogg`. Meta מצפה לטיפוס בלבד. */
function bareType(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

export function isWhatsAppAudio(mimeType: string): boolean {
  return SUPPORTED.has(bareType(mimeType));
}

/** מה שיוצא מההמרה — הפורמט שהודעה קולית מנוגנת בו בוואטסאפ. */
const OPUS_TYPE = "audio/ogg";

/**
 * ההמרה לא תרוץ לנצח על קלט פגום, ולא תחזיק זיכרון על פלט ענק.
 * שיחה של שעה נכנסת הרבה מתחת לשתי התקרות.
 */
const TRANSCODE_TIMEOUT_MS = 30_000;

export interface WhatsAppAudio {
  body: Buffer;
  mimeType: string;
}

/**
 * ההקלטה כפי ש-WhatsApp יכולה לקבל אותה. `null` = לא ניתן לשלוח
 * אותה כשמע, והקורא יפנה למסך השיחות.
 */
export async function toWhatsAppAudio(
  body: Buffer,
  mimeType: string,
): Promise<WhatsAppAudio | null> {
  if (isWhatsAppAudio(mimeType)) return { body, mimeType: bareType(mimeType) };

  /*
   * קובץ ולא צינור: ffmpeg זקוק לקריאה חוזרת בקובץ כדי לזהות את
   * מבנה ה-webm, ו-`pipe:0` אינו ניתן לחיפוש. אותו שיקול בדיוק
   * הביא את `infra/diarize` לכתוב לקובץ זמני לפני הפענוח.
   */
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "wa-audio-"));
    const src = join(dir, "in");
    const out = join(dir, "out.ogg");
    await writeFile(src, body);
    await run(
      "ffmpeg",
      [
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src,
        // הודעה קולית היא מונו; סטריאו רק מכפיל את המשקל
        "-vn",
        "-ac",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        out,
      ],
      { timeout: TRANSCODE_TIMEOUT_MS },
    );
    return { body: await readFile(out), mimeType: OPUS_TYPE };
  } catch {
    /*
     * בכוונה בלי פרטי השגיאה ביומן: הנתיב הזה נוגע בהקלטות של
     * לקוחות, ופלט של ffmpeg עלול לכלול את שם הקובץ ואת המזהה שבו.
     */
    return null;
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
