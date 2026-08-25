"use client";

import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { Notice } from "../notice";

/**
 * גישת תמיכה בהסכמה.
 *
 * הכפתור הזה הוא כל מודל האבטחה: אין לתמיכה דלת קבועה למשרד, ורק
 * הלחיצה כאן פותחת חלון של שעה. הביטול מנתק את התמיכה מיד — לא
 * בפקיעה הבאה — וכל פתיחה, כניסה וביטול נרשמים ביומן הפעילות של
 * המשרד, גלויים לבעליו.
 */
export function SupportAccessSection(): React.JSX.Element {
  const [activeUntil, setActiveUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // טיק לדקה — הכיתוב "פעיל עד" מציג שעה, אין טעם לרנדר כל שנייה
  const [, tick] = useState(0);

  function load(): void {
    apiGet<{ activeUntil: string | null }>("/settings/support-access")
      .then((res) => setActiveUntil(res.activeUntil))
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  async function grant(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ activeUntil: string }>("/settings/support-access", {});
      setActiveUntil(res.activeUntil);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiDelete("/settings/support-access");
      setActiveUntil(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const active = activeUntil !== null && new Date(activeUntil).getTime() > Date.now();

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="support-access-heading">
      <h2 id="support-access-heading" className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        גישת תמיכה
      </h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
        אם התמיכה תבקש לראות את המסך שלכם, אפשר לפתוח לה כאן גישה זמנית לחשבון —
        לשעה אחת בלבד, ורק בלחיצה שלכם. אפשר לסגור את הגישה בכל רגע, וכל כניסה
        של התמיכה נרשמת ביומן הפעילות של המשרד. פנייה רגילה אינה דורשת את זה:
        שולחים אותה מכפתור „תמיכה” שבצד כל מסך, או במייל ל־
        <a href="mailto:service@multidigital.co.il" className="underline" dir="ltr">
          service@multidigital.co.il
        </a>
        .
      </p>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {active ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-sm font-bold" style={{ color: "var(--color-success)" }}>
            ✓ הגישה פתוחה עד{" "}
            {new Date(activeUntil!).toLocaleTimeString("he-IL", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void revoke()}>
            סגור גישה עכשיו
          </button>
        </div>
      ) : (
        <button type="button" className="mv-btn-action" disabled={busy} onClick={() => void grant()}>
          {busy ? "פותח…" : "אפשר גישת תמיכה לשעה"}
        </button>
      )}
    </section>
  );
}
