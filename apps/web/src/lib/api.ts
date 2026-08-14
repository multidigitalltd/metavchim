/**
 * לקוח ה-API היחיד של האפליקציה — Session בעוגייה (credentials: include),
 * שגיאות טיפוסיות, ואפס הפתעות.
 */

import { recordFailedRequest } from "./client-diagnostics";

/** בסיס ה-API — משמש גם להרכבת URL-ים של תמונות שמוזרמות דרך השרת */
export const API_BASE = (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001") + "/api/v1";
const BASE = API_BASE;

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: ApiIssue[] = [],
    /** גוף השגיאה המלא — לשגיאות שנושאות מידע פעולה (code, signUrl…) */
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  /*
   * 402 — התקופה של המשרד נגמרה.
   *
   * המשרד מחובר, אבל כל נתיב שאינו מסך המנוי חסום. הפניה אוטומטית
   * לשם היא ההתנהגות הנכונה: כל מסך אחר יציג שגיאה שאי אפשר לפעול
   * לפיה, ומסך המנוי הוא מה שפותר את המצב.
   *
   * ההפניה מדלגת כשכבר שם, אחרת נוצרת לולאה.
   */
  if (res.status === 402 && typeof window !== "undefined") {
    if (!window.location.pathname.startsWith("/settings/billing")) {
      window.location.assign("/settings/billing?expired=1");
    }
  }
  if (!res.ok) {
    /*
     * הכישלון נרשם בטבעת המקומית לפני שהוא נזרק. פנייה לתמיכה שנשלחת
     * דקה אחר כך נושאת אותו איתה — וזה ההבדל בין "לא עובד לי" לבין
     * "500 בשמירת נכס". הרישום מקומי בלבד; ראו client-diagnostics.
     */
    recordFailedRequest(res.status, init?.method ?? "GET", path);
    const record = (body ?? {}) as { message?: string | string[]; issues?: ApiIssue[] };
    const message = Array.isArray(record.message)
      ? record.message.join(", ")
      : (record.message ?? "שגיאה לא צפויה");
    throw new ApiError(
      res.status,
      message,
      record.issues ?? [],
      (body ?? {}) as Record<string, unknown>,
    );
  }
  return body as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
export const apiPatch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const apiPut = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(data) });
/**
 * מחיקה, עם גוף בקשה כשצריך לאשר אותה.
 *
 * הגוף אופציונלי כי רוב המחיקות מזוהות בנתיב לבדו. המחיקות ההרסניות
 * — משרד שלם, מסלול על כל המשרדים שבו — דורשות אישור מפורש (שם
 * שהוקלד, מסלול יעד), והוא נשלח בגוף ולא ב-query כדי שלא ייכנס
 * ליומני שרת ולהיסטוריית דפדפן.
 */
export const apiDelete = (path: string, data?: unknown) =>
  api<void>(path, {
    method: "DELETE",
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
