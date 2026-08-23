/**
 * מה שהדפדפן זוכר על הדקה האחרונה — כדי שפנייה לתמיכה תגיע עם ראיות.
 *
 * "לא עובד לי" היא הפנייה השכיחה, והיא שווה סבב שאלות שלם שבו
 * המשתמש כבר לא באותו מסך. שלוש טבעות קטנות בזיכרון פותרות את זה:
 * מה נכשל, איזו שגיאה נזרקה, ואיפה המשתמש היה לפני כן.
 *
 * **בזיכרון בלבד ולא נשלח לשום מקום מעצמו.** הן נקראות אך ורק כשמישהו
 * לוחץ "שלח לתמיכה" — טלמטריה שקטה על מה שסוכן עושה במערכת אינה
 * חלק מהעסקה כאן. רענון דף מנקה הכול.
 */

import { EXTERNAL_ERROR_PREFIX, isExternalError } from "@metavchim/shared";

const LIMIT = 12;

/**
 * שגיאה שנרשמה, עם מונה חזרות.
 *
 * בלי המונה, סקריפט חיצוני שנכשל שמונה פעמים ברצף מילא את כל
 * הטבעת באותה שורה ודחק החוצה את הראיה האמיתית. חזרות הן מידע
 * ("קורה כל הזמן") ולא שמונה ראיות נפרדות.
 */
interface ErrorEntry {
  message: string;
  count: number;
  /** האם מקור השגיאה בקוד שלנו — ראו `isOurs`. */
  ours: boolean;
}

function push(ring: string[], entry: string): void {
  ring.push(entry);
  if (ring.length > LIMIT) ring.shift();
}

const failedRequests: string[] = [];
const errors: ErrorEntry[] = [];
const breadcrumbs: string[] = [];

/** בקשת API שנכשלה — "500 GET /properties". נקרא מלקוח ה-API. */
export function recordFailedRequest(status: number, method: string, path: string): void {
  push(failedRequests, `${status} ${method} ${path}`);
}

/** שגיאת JavaScript שנתפסה. `source` = הקובץ או ה-stack, לזיהוי המקור. */
function recordClientError(message: string, source?: string): void {
  const text = message.slice(0, 300);
  const existing = errors.find((e) => e.message === text);
  if (existing) {
    existing.count += 1;
    return;
  }
  /*
   * הסיווג יושב ב-`@metavchim/shared` ומכוסה בבדיקות: הוא נולד
   * מדיווח אמיתי שבו שמונה שגיאות של תוסף דפדפן נראו כמו תקלה
   * שלנו, וכלל שנקבע לפי ניחוש היה מחזיר את אותה בעיה.
   */
  errors.push({
    message: text,
    count: 1,
    ours: !isExternalError(source, typeof window === "undefined" ? "" : window.location.origin),
  });
  if (errors.length > LIMIT) errors.shift();
}

/** מסך שהמשתמש היה בו — מסלול השחזור של התקלה. */
export function recordScreen(path: string): void {
  if (breadcrumbs[breadcrumbs.length - 1] === path) return;
  push(breadcrumbs, path);
}

/**
 * הראיות לשליחה.
 *
 * השגיאות מנוסחות עם מקורן ועם מספר החזרות, כי שתי השאלות
 * הראשונות של מי שקורא פנייה הן "זה שלנו?" ו"זה קרה פעם אחת?".
 */
export function collectDiagnostics(): {
  errors: string[];
  failedRequests: string[];
  breadcrumbs: string[];
} {
  return {
    errors: errors.map(
      (e) =>
        `${e.ours ? "" : `${EXTERNAL_ERROR_PREFIX} — תוסף דפדפן או סקריפט אחר] `}${e.message}${
          e.count > 1 ? ` (×${e.count})` : ""
        }`,
    ),
    failedRequests: [...failedRequests],
    breadcrumbs: [...breadcrumbs],
  };
}

let listening = false;

/**
 * חיבור למאזיני השגיאות הגלובליים. אידמפוטנטי — נקרא מהמעטפת, שעשויה
 * להירכב מחדש.
 */
export function startDiagnostics(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("error", (e) => {
    recordClientError(`${e.message} (${e.filename ?? "?"}:${e.lineno ?? 0})`, e.filename);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason: unknown = e.reason;
    /*
     * ה-stack הוא מקור הזיהוי היחיד ב-`unhandledrejection`: לאירוע
     * עצמו אין `filename` כמו ל-`error`.
     */
    const stack = reason instanceof Error ? reason.stack : undefined;
    recordClientError(
      `Promise שנדחה ללא טיפול: ${reason instanceof Error ? reason.message : String(reason)}`,
      stack,
    );
  });
}
