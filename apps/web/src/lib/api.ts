/**
 * לקוח ה-API היחיד של האפליקציה — Session בעוגייה (credentials: include),
 * שגיאות טיפוסיות, ואפס הפתעות.
 */

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
  if (!res.ok) {
    const record = (body ?? {}) as { message?: string | string[]; issues?: ApiIssue[] };
    const message = Array.isArray(record.message)
      ? record.message.join(", ")
      : (record.message ?? "שגיאה לא צפויה");
    throw new ApiError(res.status, message, record.issues ?? []);
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
export const apiDelete = (path: string) => api<void>(path, { method: "DELETE" });
