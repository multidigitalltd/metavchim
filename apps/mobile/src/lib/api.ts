import { API_BASE } from "./config";
import { readSessionToken } from "./session-store";

/**
 * ‏לקוח ה-API של האפליקציה — אותו חוזה כמו `apps/web/src/lib/api.ts`,
 * ‏עם הבדל אחד: ה-Session נוסע בכותרת `Authorization` ולא בעוגייה
 * ‏(ראו `apps/api/src/common/session-token.ts`).
 */

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: ApiIssue[] = [],
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** ‏מי שמאזין ל-401 — המעטפת, שמנתקת ומחזירה למסך ההתחברות. */
type UnauthorizedListener = () => void;
let onUnauthorized: UnauthorizedListener | null = null;

export function setUnauthorizedListener(listener: UnauthorizedListener | null): void {
  onUnauthorized = listener;
}

/**
 * ‏בקשה שנתקעת אינה „טוענת” לנצח: ברשת סלולרית חלשה בקשה יכולה לא
 * ‏להיענות כלל, ומסך שמחכה בלי סוף נראה כמו אפליקציה שקרסה.
 */
const TIMEOUT_MS = 20_000;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await readSessionToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...init?.headers,
      },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiError(0, aborted ? "השרת לא ענה בזמן — נסו שוב" : "אין חיבור לשרת — בדקו את הרשת");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 401 && token !== null) {
    // Session שפג או נותק ממכשיר אחר — המעטפת מחזירה למסך ההתחברות
    onUnauthorized?.();
  }
  if (!res.ok) {
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

/**
 * ‏רשימה שהגיעה מהשרת — או תקלה, ולא „ריק”. אותו כלל כמו ב-web:
 * ‏שדה חסר הוא כשל טעינה, לא רשימה ריקה שקרית.
 */
export function apiList<T>(value: readonly T[] | null | undefined, field: string): T[] {
  if (Array.isArray(value)) return value as T[];
  throw new ApiError(502, "התשובה מהשרת הגיעה חסרה — נסו שוב", [
    { path: field, message: "רשימה חסרה בתשובה" },
  ]);
}

/** ‏הודעה שמוצגת למשתמש — מ-ApiError, או ניסוח כללי לכל דבר אחר. */
export function errorMessage(error: unknown, fallback = "משהו השתבש — נסו שוב"): string {
  return error instanceof ApiError ? error.message : fallback;
}
