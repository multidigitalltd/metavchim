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

/** אחרי כמה זמן הסבב מפסיק לנסות — חייב להתאים ל-`GIVE_UP_AFTER_MS`. */
export const RECORDING_GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;

export type RecordingState = "ready" | "none" | "pending" | "retrying" | "failed";

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
  occurredAt: Date;
}

/**
 * `now` נמסר ולא נקרא מהשעון: זו פונקציה טהורה, והבדיקות צריכות
 * לקבוע את הזמן כדי לבדוק את גבול הוויתור בשני צדיו.
 */
export function recordingStateOf(row: RecordingFields, now: number = Date.now()): RecordingStatus {
  if ((row.recordingKey ?? null) !== null) return { state: "ready" };
  if ((row.providerRecordingPath ?? null) === null) return { state: "none" };

  const reason = row.providerRecordingError ?? undefined;
  /*
   * הוויתור נמדד ממועד השיחה ולא ממועד הניסיון האחרון, בדיוק כמו
   * תנאי הבחירה בסבב: שיחה שיצאה מהחלון לא תיבחר שוב, ולכן
   * „ננסה שוב” אינו נכון לגביה גם אם הניסיון האחרון היה לפני רגע.
   */
  if (now - row.occurredAt.getTime() > RECORDING_GIVE_UP_MS) {
    return reason === undefined ? { state: "failed" } : { state: "failed", reason };
  }
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
    case "pending":
      return "ההקלטה בדרך מהמרכזייה — נמשכת תוך דקות";
    case "retrying":
      return `המשיכה מהמרכזייה נכשלה, ננסה שוב — ${recordingReasonLabel(status.reason)}`;
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
