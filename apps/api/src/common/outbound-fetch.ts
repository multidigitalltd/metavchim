/**
 * ‎**קריאה החוצה שעומדת בתקלת רשת חולפת — ואומרת מה קרה כשלא.**
 *
 * ‏‎`fetch` של Node זורק `TypeError: fetch failed` על כל תקלה ברשת, והסיבה
 * ‏האמיתית (‎`ECONNRESET`, ‏`UND_ERR_CONNECT_TIMEOUT`, ‏`EAI_AGAIN`…) יושבת
 * ‏ב-`cause`. ‏`String(error)` משמיט אותה, ולכן הדוח היומי הראה „fetch
 * ‏failed” שש פעמים ביום מול Google בלי שום דרך לדעת למה.
 *
 * ‏שני דברים כאן:
 *
 * ‏1. **ניסיון חוזר קצר על תקלת רשת** — עד שניים, אחרי 0.4 ו-1.2 שניות.
 * ‏   חיבור שנפל באמצע יום רגיל חוזר בתוך שנייה, והקריאה מצליחה במקום
 * ‏   להפיל סנכרון או התחברות.
 * ‏2. **הסיבה בהודעה** — ‏`describeFetchFailure` מחזירה את הקוד, כדי שתקלה
 * ‏   שכן חוזרת תיראה בניטור כמו שהיא.
 *
 * ‏‎**מה נשלח שוב, ומה לא.** קריאה שאינה אידמפוטנטית (יצירת אירוע, החלפת
 * ‏קוד הרשאה חד-פעמי) נשלחת שוב רק כשהחיבור לא נוצר כלל — אז הבקשה לא
 * ‏יצאה. ניתוק אחרי שליחה עלול להיות בקשה שכבר בוצעה, ושליחה שנייה הייתה
 * ‏יוצרת כפילות או נכשלת על קוד שכבר נוצל. תם הזמן אינו נשלח שוב בשום מקרה:
 * ‏הוא כבר המתין את מלוא הזמן, וניסיון שני היה מכפיל את ההמתנה.
 */

/** ‏החיבור לא נוצר — הבקשה לא יצאה, ושליחה חוזרת בטוחה לכל קריאה. */
const NOT_SENT = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

/** ‏נפל אחרי שהחיבור נוצר — חוזרים רק על קריאה אידמפוטנטית. */
const DROPPED = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET"]);

const RETRY_DELAYS_MS = [400, 1200] as const;

/** ‏הקוד של תקלת הרשת — מהשרשרת של `cause`, או `null` כשאינה תקלת רשת. */
export function fetchFailureCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const record = current as { code?: unknown; errors?: unknown; cause?: unknown };
    if (typeof record.code === "string") return record.code;
    // ‏ניסיון לשתי משפחות הכתובות (IPv4/IPv6) — הקוד של הראשון מייצג
    if (Array.isArray(record.errors) && record.errors.length > 0) current = record.errors[0];
    else current = record.cause;
  }
  return null;
}

/** ‏„fetch failed (ECONNRESET)” — ההודעה עם הסיבה, לניטור. */
export function describeFetchFailure(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "תם הזמן להמתנה לתשובה";
  const code = fetchFailureCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return code === null ? message : `${message} (${code})`;
}

/**
 * ‏‎`fetch` עם ניסיון חוזר על תקלת רשת חולפת. ‏`timeoutMs` — לכל ניסיון,
 * ‏ולכן האות נבנה מחדש בכל פעם. ‏`idempotent` — ראו ההסבר למעלה.
 */
export async function resilientFetch(
  url: string,
  init: Omit<RequestInit, "signal">,
  options: { idempotent: boolean; timeoutMs: number },
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
    } catch (error) {
      const code = fetchFailureCode(error);
      const retryable =
        code !== null && (NOT_SENT.has(code) || (options.idempotent && DROPPED.has(code)));
      const delay = RETRY_DELAYS_MS[attempt];
      if (!retryable || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
