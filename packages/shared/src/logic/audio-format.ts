/**
 * סוג ההקלטה → סיומת הקובץ שנשלח לתמלול.
 *
 * ## למה זה חשוב ולמה זה כאן
 *
 * שירות התמלול (`infra/stt/server.py`) כותב את ההעלאה לקובץ זמני
 * **לפי הסיומת של השם שהגיע**, ורק אז מפענח. סיומת שגויה אינה
 * אי-דיוק בתיעוד — היא קובץ שנפתח כשקר.
 *
 * הקוד בדפדפן בנה תמיד ‎`recording.webm`‎, וזה נכון במקרה רק בכרום
 * במחשב. ספארי אינו יודע להקליט webm **בכלל**: ב-iPhone וב-iPad
 * `MediaRecorder` מפיק `audio/mp4`, וכל דפדפן ב-iOS הוא ספארי מתחת
 * למכסה. כך יצא שההכתבה עבדה מצוין במחשב ולא עשתה דבר בטלפון
 * (דיווח המשתמש).
 *
 * הפונקציה יושבת ב-`shared` ולא ליד המקליט מפני שאין ב-`apps/web`
 * מריץ בדיקות, וזו בדיוק הלוגיקה שאסור שתישבר בשקט: היא טבלה
 * קטנה שקל לשנות בלי לשים לב, והנזק שלה שקט לגמרי — התמלול פשוט
 * מחזיר כלום.
 */

/**
 * הסיומת המתאימה לסוג MIME שהמקליט הכריז עליו.
 *
 * הקלט הוא מה ש-`MediaRecorder.mimeType` החזיר, ולכן הוא עשוי
 * לכלול פרמטרים (`audio/webm;codecs=opus`) ולהגיע בכל אות.
 *
 * סוג שאיננו מכירים מקבל `bin` ולא `webm`: הצהרה שגויה היא בדיוק
 * הבאג הזה, ואילו `bin` אומר לשירות „תזהה בעצמך” — ffmpeg מזהה
 * לפי התוכן כשאין לו רמז מהשם.
 */
export function extensionForAudioType(mimeType: string | undefined | null): string {
  const base = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  switch (base) {
    case "audio/webm":
    case "video/webm":
      /*
       * `video/webm` אינו טעות: חלק מהדפדפנים מכריזים כך גם על זרם
       * שיש בו אודיו בלבד, כי המכל זהה.
       */
      return "webm";
    case "audio/ogg":
    case "application/ogg":
      return "ogg";
    case "audio/mp4":
    case "video/mp4":
    case "audio/x-m4a":
    case "audio/aac":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return "wav";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    default:
      return "bin";
  }
}

/**
 * סדר ההעדפה להקלטה, מהטוב לפחות טוב.
 *
 * opus דחוס יותר ומדויק יותר לדיבור; mp4/aac הוא מה שנשאר בספארי,
 * שאין בו אף אחד מהראשונים. הרשימה כאן ולא בדפדפן כדי שהסיומת
 * והסוג יישארו זוג אחד שנבדק.
 */
export const AUDIO_RECORDING_FORMATS: readonly { mimeType: string; extension: string }[] = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "m4a" },
  { mimeType: "audio/mp4", extension: "m4a" },
];
