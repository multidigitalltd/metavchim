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

const LIMIT = 12;

function push(ring: string[], entry: string): void {
  ring.push(entry);
  if (ring.length > LIMIT) ring.shift();
}

const failedRequests: string[] = [];
const errors: string[] = [];
const breadcrumbs: string[] = [];

/** בקשת API שנכשלה — "500 GET /properties". נקרא מלקוח ה-API. */
export function recordFailedRequest(status: number, method: string, path: string): void {
  push(failedRequests, `${status} ${method} ${path}`);
}

/** שגיאת JavaScript שנתפסה. */
export function recordClientError(message: string): void {
  push(errors, message.slice(0, 300));
}

/** מסך שהמשתמש היה בו — מסלול השחזור של התקלה. */
export function recordScreen(path: string): void {
  if (breadcrumbs[breadcrumbs.length - 1] === path) return;
  push(breadcrumbs, path);
}

export function collectDiagnostics(): {
  errors: string[];
  failedRequests: string[];
  breadcrumbs: string[];
} {
  return {
    errors: [...errors],
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
    recordClientError(`${e.message} (${e.filename ?? "?"}:${e.lineno ?? 0})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason: unknown = e.reason;
    recordClientError(
      `Promise שנדחה ללא טיפול: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  });
}
