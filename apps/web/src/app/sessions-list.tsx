"use client";

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

/**
 * החיבורים הפתוחים — מי מחובר, מאיפה, ומתי התחבר.
 *
 * ## למה זה קיים
 *
 * סיסמה שדלפה אינה נראית כמו כלום. אין הודעה, אין תקלה, ואין שום
 * מסך שבו אפשר לשאול „האם מישהו אחר מחובר לחשבון שלי”. עד כה
 * התשובה היחידה הייתה החלפת סיסמה — פעולה שמנתקת את כולם, כולל
 * את מי ששואל, ורק אחרי שהוא כבר חושד.
 *
 * ## רכיב אחד לשני הקהלים
 *
 * המשתמש רואה את שלו (בלי `userId`), ומנהל המשרד רואה את של העובד
 * (עם `userId`). אותו רכיב ולא שניים: שתי טבלאות שמציגות את אותו
 * נתון היו מתפצלות בפרט הראשון שמישהו מוסיף לאחת מהן.
 *
 * ההבדל בין הקהלים אינו בעיצוב אלא בשתי החלטות מהותיות:
 *
 * - **מה הכפתור הגורף עושה.** אצל המשתמש הוא מנתק את *שאר*
 *   המכשירים ומשאיר אותו מחובר — מי שגילה פריצה צריך להישאר
 *   בפנים כדי להחליף סיסמה. אצל המנהל הוא מנתק את *הכול*,
 *   כולל המכשיר שהעובד עובד עליו: ניתוק שמשאיר חיבור אחד פתוח
 *   לא עשה כלום.
 * - **מי „אני”.** רק ברשימה האישית יש שורה שמסומנת „המכשיר
 *   הזה”. ברשימת המנהל אף חיבור אינו שלו, וסימון כזה היה שקר.
 */

export interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
  supportAdminEmail: string | null;
}

/**
 * מחרוזת ה-User-Agent → משהו שאדם יכול לזהות לפיו מכשיר.
 *
 * לא ניתוח מלא ולא ספרייה: המטרה היחידה היא שמי שמסתכל ברשימה
 * יבדיל בין „הטלפון שלי” ל„מחשב שאני לא מכיר”. מחרוזת גולמית
 * באורך 300 תווים אינה עונה על זה, ושם מדויק של גרסת דפדפן —
 * גם הוא לא.
 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "מכשיר לא ידוע";
  const ua = userAgent;
  const platform = /iPhone|iPad/u.test(ua)
    ? "iPhone/iPad"
    : /Android/u.test(ua)
      ? "Android"
      : /Macintosh|Mac OS/u.test(ua)
        ? "Mac"
        : /Windows/u.test(ua)
          ? "Windows"
          : /Linux/u.test(ua)
            ? "Linux"
            : null;
  /*
   * הסדר אינו שרירותי: Edge מכריז על עצמו גם כ-Chrome, ו-Chrome
   * מכריז על עצמו גם כ-Safari. בדיקה בסדר ההפוך הייתה מציגה כל
   * דפדפן כ-Safari.
   */
  const browser = /Edg\//u.test(ua)
    ? "Edge"
    : /OPR\//u.test(ua)
      ? "Opera"
      : /Chrome\//u.test(ua)
        ? "Chrome"
        : /Firefox\//u.test(ua)
          ? "Firefox"
          : /Safari\//u.test(ua)
            ? "Safari"
            : null;
  if (platform && browser) return `${browser} · ${platform}`;
  return browser ?? platform ?? "מכשיר לא ידוע";
}

interface Props {
  /**
   * `null` = החיבורים שלי. מזהה משתמש = החיבורים שלו, דרך נתיב
   * הניהול (דורש `users.manage` בשרת).
   */
  userId?: string | null;
  /** שם העובד — לניסוח האישור לפני ניתוק גורף */
  userName?: string;
}

export function SessionsList({ userId = null, userName }: Props): React.JSX.Element {
  const managing = userId !== null;
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const path = managing ? `/settings/users/${userId}/sessions` : "/auth/sessions";

  const load = useCallback(() => {
    apiGet<{ sessions: SessionRow[] }>(path)
      .then((res) => setRows(res.sessions))
      .catch((e: unknown) => {
        setRows([]);
        setError(e instanceof ApiError ? e.message : "טעינת החיבורים נכשלה");
      });
  }, [path]);

  useEffect(load, [load]);

  async function revokeOne(row: SessionRow): Promise<void> {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiDelete(`/auth/sessions/${row.id}`);
      /*
       * ניתוק המכשיר הנוכחי הוא התנתקות. רענון מלא ולא עדכון
       * רשימה: העוגייה כבר לא תקפה, וכל קריאה הבאה תחזיר 401
       * למסך שממשיך להיראות מחובר.
       */
      if (row.current) {
        window.location.href = "/login";
        return;
      }
      setMsg("החיבור נותק.");
      load();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "הניתוק נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function revokeAll(): Promise<void> {
    const question = managing
      ? `לנתק את כל החיבורים של ${userName ?? "המשתמש"}? הוא יצטרך להתחבר מחדש.`
      : "לנתק את כל שאר המכשירים? המכשיר הזה יישאר מחובר.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = managing
        ? await apiPost<{ revoked: number }>(`/settings/users/${userId}/sessions/revoke`, {})
        : await apiPost<{ revoked: number }>("/auth/sessions/revoke-others", {});
      setMsg(res.revoked === 0 ? "לא היו חיבורים לנתק." : `${res.revoked} חיבורים נותקו.`);
      load();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "הניתוק נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) {
    return (
      <p className="m-0 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
        טוען חיבורים…
      </p>
    );
  }

  /* הכפתור הגורף מיותר כשאין את מי לנתק חוץ מהמכשיר הנוכחי */
  const others = rows.filter((row) => !row.current).length;

  return (
    <div>
      {rows.length === 0 ? (
        <p className="m-0 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
          אין כרגע חיבורים פתוחים.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5 last:border-b-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold">
                  {describeDevice(row.userAgent)}
                  {row.current ? (
                    <span
                      className="mv-pill mr-2 text-[11.5px]"
                      style={{
                        background: "var(--color-primary-soft)",
                        color: "var(--color-primary)",
                      }}
                    >
                      המכשיר הזה
                    </span>
                  ) : null}
                  {/*
                    חיבור של התמיכה אינו חיבור של המשתמש, וסימון
                    שלו הוא חלק מההסכמה: מי שפתח גישה צריך לראות
                    בדיוק מי נכנס בה.
                  */}
                  {row.supportAdminEmail !== null ? (
                    <span
                      className="mv-pill mr-2 text-[11.5px]"
                      style={{ color: "var(--color-danger)", fontWeight: 700 }}
                    >
                      תמיכה · {row.supportAdminEmail}
                    </span>
                  ) : null}
                </span>
                <span className="block text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                  {/* הכתובת ב-LTR: ספרות ונקודות בכיוון עברי נקראות הפוך */}
                  התחברות: {formatDateTime(row.createdAt)}
                  {row.ipAddress !== null ? (
                    <>
                      {" · "}
                      <span dir="ltr">{row.ipAddress}</span>
                    </>
                  ) : null}
                  {" · פג בתאריך "}
                  {formatDateTime(row.expiresAt)}
                </span>
              </span>
              {/* המנהל אינו מנתק חיבור בודד: הפעולה שלו היא „נקה הכול” */}
              {managing ? null : (
                <button
                  type="button"
                  className="mv-btn-plain text-[13px]"
                  onClick={() => void revokeOne(row)}
                  disabled={busy}
                >
                  {row.current ? "התנתקות" : "ניתוק"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(managing ? rows.length > 0 : others > 0) ? (
        <button
          type="button"
          className="mv-btn-plain mt-3 text-[13px]"
          onClick={() => void revokeAll()}
          disabled={busy}
        >
          {managing ? "ניתוק כל החיבורים" : "ניתוק כל שאר המכשירים"}
        </button>
      ) : null}

      {/*
        role="status" ולא טקסט רגיל: קורא מסך אינו רואה שהרשימה
        התקצרה, ובלי ההכרזה הפעולה חוזרת אליו כשקט מוחלט.
      */}
      <p role="status" className="m-0 mt-2 text-[12.5px]" style={{ color: "var(--color-success)" }}>
        {msg ?? ""}
      </p>
      {error !== null ? (
        <p role="alert" className="m-0 mt-1 text-[12.5px]" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
