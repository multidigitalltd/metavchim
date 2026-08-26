/**
 * מצב ההקלטה של שיחה — **שלושה מצבים שנראו על המסך כאחד.**
 *
 * ## מה היה
 *
 * הדגל היחיד שהגיע למסך היה „יש הקלטה”, והוא נגזר אך ורק מהקובץ
 * ששמור אצלנו. נתיב ההקלטה שהמרכזייה שלחה — המצביע שממנו הסבב
 * מושך את האודיו — לא השתתף בו כלל.
 *
 * לכן שלושה מצבים שונים לגמרי הופיעו זהים, „לא צורפה הקלטה”:
 *
 * 1. המרכזייה לא שלחה נתיב — באמת אין.
 * 2. שלחה, והסבב טרם הגיע אליה — עניין של דקות.
 * 3. שלחה, והמשיכה **נכשלת** — ולפעמים בשקט מוחלט, בלי אף שורת
 *    יומן, כשאישורי הגישה חסרים או פגו.
 *
 * מתווך שראה „אין הקלטה” לא יכול היה לדעת אם להמתין, לתקן הגדרה,
 * או לפנות לספק. השאלה הזו הגיעה מהשטח בדיוק בניסוח הזה.
 *
 * ## למה זו לוגיקה משותפת
 *
 * ההכרעה היא צירוף של ארבעה שדות וחלון זמן, והיא נדרשת גם בשרת
 * (ה-DTO) וגם כשמנסחים את הטקסט למסך. היגיון כזה נוטה להיכתב
 * פעמיים ולהתפצל, ולאפליקציית ה-web אין ממילא הרצת בדיקות.
 */

import { recordingWorthPulling } from "./telephony.js";

/**
 * אחרי כמה זמן הסבב מפסיק לנסות.
 *
 * ‎**המקור, ולא עותק.** `GIVE_UP_AFTER_MS` בשרת מיובא מכאן. קודם
 * ישבו כאן ושם שני מספרים זהים לצד הערה „חייב להתאים” — שהיא
 * בדיקה בדמות משפט, ואיש אינו מריץ משפטים.
 */
export const RECORDING_GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * הסיבה היחידה שאינה „ננסה שוב” אלא „אי אפשר לנסות”.
 *
 * ‎**המקור, ולא עותק.** `RECORDING_ERRORS.integration` בשרת מיובא
 * מכאן. הכיוון הזה ולא ההפוך, כי הלוגיקה המשותפת אינה תלויה ב-API.
 */
export const RECORDING_BLOCKED_REASON = "no_integration";

/**
 * המצבים עצמם כרשימה, והטיפוס נגזר ממנה — ולא להפך.
 *
 * הבדיקה שדורשת „לכל מצב משפט משלו” חייבת לרוץ על **כל** המצבים;
 * רשימה מועתקת בקובץ הבדיקה הייתה ממשיכה לעבור כשמצב חדש מצטרף
 * ונשאר בלי ניסוח. אותו לקח בדיוק כבר נלמד במשקלי ההתאמה.
 */
export const RECORDING_STATES = [
  "ready",
  "none",
  "skipped",
  "pending",
  "retrying",
  "blocked",
  "failed",
] as const;

export type RecordingState = (typeof RECORDING_STATES)[number];

export interface RecordingStatus {
  state: RecordingState;
  /** קוד מרשימה סגורה, ורק כשהייתה תקלה. לעולם לא הודעה של הספק. */
  reason?: string;
}

export interface RecordingFields {
  recordingKey?: string | null;
  providerRecordingPath?: string | null;
  providerRecordingAttemptAt?: Date | null;
  providerRecordingError?: string | null;
  /**
   * תוצאת השיחה — קובעת אם בכלל מנסים למשוך. ראו
   * ‎`recordingWorthPulling`. חסר ⇒ אין ידיעה, ולכן אין דילוג.
   */
  outcome?: string | null;
  occurredAt: Date;
}

/**
 * `now` נמסר ולא נקרא מהשעון: זו פונקציה טהורה, והבדיקות צריכות
 * לקבוע את הזמן כדי לבדוק את גבול הוויתור בשני צדיו.
 */
export function recordingStateOf(row: RecordingFields, now: number = Date.now()): RecordingStatus {
  if ((row.recordingKey ?? null) !== null) return { state: "ready" };
  if ((row.providerRecordingPath ?? null) === null) return { state: "none" };

  /*
   * ‎**שיחה שלא נענתה — לא נמשכת, ולכן גם לא „בדרך”.**
   *
   * ‎`recordingWorthPulling` היא אותה הכרעה שהסבב בוחר לפיה. בלי
   * השורה הזו המסך היה מכריז „ההקלטה בדרך מהמרכזייה — נמשכת תוך
   * דקות” על שיחה שלא תיגע בה לעולם, ואחרי שבוע היה מכריז עליה
   * „נכשלה”. שתי האמירות שקריות, וזו בדיוק התקלה שכבר תוקנה כאן
   * פעם אחת עם `no_integration`.
   *
   * ‎**אחרי `recordingKey`, ובכוונה.** הקלטה שכבר שמורה אצלנו —
   * למשל כזו שנמשכה לפני השינוי, או שמתווך צירף בעצמו — נשמעת
   * כרגיל. ההחלטה של אדם גוברת על הכלל האוטומטי.
   */
  if (!recordingWorthPulling(row.outcome)) return { state: "skipped" };

  const reason = row.providerRecordingError ?? undefined;
  /*
   * „נכשלה סופית” פירושו **הסבב לא יבחר את השיחה הזו שוב**, וזו
   * חייבת להיות בדיוק אותה הכרעה שהסבב מקבל — אחרת המסך מבטיח
   * „ננסה שוב” על משיכה שלא תקרה, או מכריז „נכשלה” על שיחה
   * שממתינה בתור.
   *
   * שני התנאים יחד: הוויתור נמדד ממועד השיחה, אבל הוא חל רק על מי
   * שכבר נוסתה. חותמת ניסיון ריקה פירושה שטרם נגענו בשיחה — חדשה,
   * או כזו שמתווך החזיר לתור בלחיצה — והסבב ייקח אותה בלי קשר
   * לגילה.
   */
  const attempted = (row.providerRecordingAttemptAt ?? null) !== null;
  if (attempted && now - row.occurredAt.getTime() > RECORDING_GIVE_UP_MS) {
    return reason === undefined ? { state: "failed" } : { state: "failed", reason };
  }
  /*
   * „חסום” ולא „ננסה שוב”: אין חיבור פעיל, ולכן הסבב חוזר ריק לפני
   * שהוא בוחר ולו שיחה אחת. „ננסה שוב” כאן הוא הבטחה שלא תתקיים
   * **לא משנה כמה זמן ימתינו**, והכפתור שנלווה אליה מחזיר „בתור”
   * ואינו עושה דבר. התיקון נמצא בהגדרות, לא בלחיצה נוספת (ביקורת
   * Codex).
   *
   * הבדיקה באה **אחרי** הוויתור: שיחה שכבר נוסתה ויצאה מהחלון
   * מתה גם אם יחזירו את החיבור, כי חותמת הניסיון שלה כתובה.
   */
  if (reason === RECORDING_BLOCKED_REASON) return { state: "blocked", reason };
  if (reason !== undefined) return { state: "retrying", reason };
  return { state: "pending" };
}

/** הניסוח שמופיע למתווך. הקוד עצמו אינו טקסט למסך. */
export function recordingStateLabel(status: RecordingStatus): string {
  switch (status.state) {
    case "ready":
      return "ההקלטה זמינה";
    case "none":
      return "לא צורפה הקלטה לשיחה הזו";
    case "skipped":
      // בלי „ננסה שוב”: אין מה לשמוע, וזו החלטה ולא תקלה
      return "השיחה לא נענתה — אין הקלטה לתמלל";
    case "pending":
      return "ההקלטה בדרך מהמרכזייה — נמשכת תוך דקות";
    case "retrying":
      return `המשיכה מהמרכזייה נכשלה, ננסה שוב — ${recordingReasonLabel(status.reason)}`;
    case "blocked":
      // בלי „ננסה שוב”: לא ננסה, ואין טעם בלחיצה נוספת
      return `אי אפשר למשוך את ההקלטה — ${recordingReasonLabel(status.reason)}`;
    case "failed":
      return `ההקלטה לא נמשכה מהמרכזייה — ${recordingReasonLabel(status.reason)}`;
  }
}

/**
 * הסיבה בשפה של מתווך, ולא בשפה של יומן שרת.
 *
 * כל קוד מתורגם למשפט שאומר **מה לעשות**: מי שרואה „אישורי
 * הגישה חסרים” יודע ללכת להגדרות, ומי שרואה „המרכזייה טרם
 * הכינה” יודע להמתין.
 */
export function recordingReasonLabel(reason: string | undefined): string {
  if (reason === undefined) return "הסיבה אינה ידועה";
  if (reason.startsWith("provider_rejected")) {
    const status = reason.slice("provider_rejected_".length);
    /*
     * הקוד מגיע משני מקורות — סטטוס ה-HTTP, ומעטפת `responses`
     * שבתוך תשובת 200 — ומשמעותו זהה בשניהם. שלושת המקרים שיש
     * לגביהם מה לעשות אומרים **מה** לעשות; השאר נשארים כמספר,
     * שאפשר להעביר לתמיכה של הספק כמו שהוא.
     */
    const known: Record<string, string> = {
      "401": "שם המשתמש או הסיסמה של המרכזייה שגויים — יש לעדכן אותם בהגדרות",
      "402": "לחבילה במרכזייה אין הרשאה למשוך הקלטות",
      "403": "לחבילה במרכזייה אין הרשאה למשוך הקלטות",
      "404": "ההקלטה אינה קיימת עוד אצל המרכזייה",
    };
    /*
     * המספר נשאר גם כשיש משפט — הוא מה שאפשר להקריא לתמיכה של
     * הספק, והבדיקה הקיימת דורשת אותו בכל דחייה.
     */
    const sentence = known[status];
    if (sentence !== undefined) return `${sentence} (${status})`;
    return /^\d+$/u.test(status)
      ? `המרכזייה דחתה את הבקשה (${status})`
      : "המרכזייה דחתה את הבקשה";
  }
  switch (reason) {
    case "no_integration":
      return "אין חיבור פעיל למרכזייה — יש להפעיל אותו בהגדרות";
    case "missing_credentials":
      return "אישורי הגישה למרכזייה חסרים — יש להשלים אותם בהגדרות";
    case "path_unreadable":
      return "נתיב ההקלטה שהמרכזייה שלחה אינו בצורה מוכרת";
    case "response_unreadable":
      return "התשובה מהמרכזייה לא נקראה";
    case "empty_audio":
      return "המרכזייה טרם הכינה את קובץ ההקלטה";
    case "too_large":
      return "ההקלטה גדולה מהמותר";
    case "network_error":
      return "לא הצלחנו להגיע למרכזייה";
    default:
      return "הסיבה אינה ידועה";
  }
}

/* ============ סיכום ייבוא ההקלטות — משפטים שאינם סותרים ============ */

/**
 * תוצאת ייבוא הקלטות היסטוריות, כפי שהמסך מקבל אותה.
 *
 * ‎`rowKeys` אינו כאן: הוא נטול היגיון וגם אינו משפט אלא רשימת
 * שמות שדות שהמסך מציג בנפרד.
 */
export interface RecordingImportSummary {
  found: number;
  /** צורפו ונכנסו לתור. */
  linked: number;
  /** צורפו ו**לא** ייכנסו לתור — שיחות שלא נענו. */
  skipped: number;
  alreadyHad: number;
  withoutCall: number;
  withoutRecordId: number;
}

/**
 * ‎**המשפטים שהמסך מציג, כרשימה — ולא כשרשור.**
 *
 * ## הכשל שזה מתקן
 *
 * הגרסה הקודמת פתחה במשפט אחד ובנתה את השאר סביבו: „סומנו
 * למשיכה” **או** „לא נמצאו הקלטות חדשות לצרף”, ואחריו משפטים עם
 * רווח מוביל. זה נכון כל עוד המשפט הראשון מכסה את כל המקרים.
 *
 * ברגע שהמונה פוצל ל-`linked` ול-`skipped`, נולד מצב שלא היה
 * קיים קודם: ייבוא שכל תוצאותיו שיחות שלא נענו. שם `linked === 0`,
 * ולכן המסך הכריז „לא נמצאו הקלטות חדשות לצרף” — ומיד אחר כך מנה
 * אותן. הנתיבים **כן** צורפו; מה שלא קרה הוא הכניסה לתור.
 *
 * ‎**זו הפעם הרביעית באותו שינוי שמשפט מפסיק להיות נכון בגלל
 * דילוג חדש.** ולכן התיקון אינו תנאי נוסף אלא צורה אחרת: „מה
 * מופיע” הוא `filter`, „איך זה מחובר” הוא `join`, ומשפט חדש מצטרף
 * בלי להחזיק דעה על מי לפניו.
 *
 * ## למה כאן ולא במסך
 *
 * לאפליקציית ה-web אין הרצת בדיקות, ושלוש מתוך ארבע הפעמים שהמשפט
 * הזה נשבר התגלו בקריאה ולא בבדיקה. כאן יש בדיקות.
 */
export function importSentences(summary: RecordingImportSummary): string[] {
  const lines: string[] = [];

  if (summary.linked > 0) {
    lines.push(`${summary.linked} הקלטות סומנו למשיכה — הן ייכנסו לכרטיסים תוך כמה דקות.`);
  }
  if (summary.alreadyHad > 0) {
    lines.push(`${summary.alreadyHad} כבר היו אצלנו.`);
  }
  if (summary.skipped > 0) {
    lines.push(
      `${summary.skipped} הקלטות שייכות לשיחות שלא נענו — הן צורפו לכרטיס, אך לא יימשכו ולא יתומללו.`,
    );
  }
  if (summary.withoutCall > 0) {
    lines.push(
      `${summary.withoutCall} הקלטות אצל הספק שייכות לשיחות שאינן רשומות במערכת — אלה שיחות שקדמו לחיבור, ואין להן כרטיס לקוח לשייך אליו.`,
    );
  }

  /*
   * ‎**„לא נמצאו” הוא נסיגה, ולא ענף של `linked`.** הוא נאמר רק
   * כשאין שום משפט אחר — כלומר כשבאמת לא היה מה לומר. `withoutRecordId`
   * אינו נספר כאן: המסך מציג אותו בשורה נפרדת משלו, והוא כן „נמצא
   * משהו”.
   */
  if (lines.length === 0 && summary.withoutRecordId === 0) {
    return ["לא נמצאו הקלטות חדשות לצרף."];
  }
  return lines;
}
