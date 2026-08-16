"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "@/lib/api";

/**
 * אזור הסכנה — מחיקת חשבון מלאה. מוצג לבעל המשרד בלבד.
 *
 * שלוש שכבות הגנה מכוונות: כפתור שרק חושף את הטופס, הקלדת שם המשרד
 * המדויק, והסיסמה הנוכחית. אין window.confirm — אישור שנסגר בלחיצת
 * אנטר הוא לא אישור למחיקת עסק שלם.
 */
export function DeleteAccountSection({ tenantName }: { tenantName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** חשבון Google — אין סיסמה; שם המשרד הוא האישור */
  const [hasPassword, setHasPassword] = useState(true);

  useEffect(() => {
    apiGet<{ hasPassword: boolean }>("/auth/profile")
      .then((p) => setHasPassword(p.hasPassword))
      .catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiPost("/settings/delete-account", {
        confirmName: String(f.get("confirmName") ?? ""),
        ...(hasPassword ? { currentPassword: String(f.get("currentPassword") ?? "") } : {}),
      });
      // החיבור כבר לא קיים — כל בקשה הבאה תיפול ממילא
      router.replace("/login");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="mt-8 rounded-xl border px-5 py-[17px]"
      style={{ borderColor: "var(--color-danger)" }}
    >
      <h2 id="delete-account-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800, color: "var(--color-danger)" }}>
        מחיקת החשבון לצמיתות
      </h2>
      <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כל נתוני המשרד נמחקים ואינם ניתנים לשחזור: לקוחות, נכסים, קונים, לידים,
        שיחות ותמלולים, הסכמים חתומים, תמונות והקלטות, המשתמשים והמנוי (כולל
        פרטי האשראי השמורים). נשארות רק רשומות ללא שום פרט אישי: תשלומים (חובת
        שמירה חוקית), תנועות קרדיטים של רשת השת&quot;פ ויומן פעולות של מזהים בלבד.
      </p>

      {!open ? (
        <button
          type="button"
          className="mv-btn-plain"
          style={{ color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
          onClick={() => setOpen(true)}
        >
          מחק את החשבון…
        </button>
      ) : (
        <form method="post" onSubmit={(e) => void onSubmit(e)} className="flex max-w-sm flex-col gap-3">
          {error ? (
            <p role="alert" className="m-0 text-sm" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          ) : null}
          <label>
            <span className="mb-1 block text-sm font-semibold">
              הקלידו את שם המשרד לאישור: <b>{tenantName}</b>
            </span>
            <input name="confirmName" required autoComplete="off" className="mv-field" />
          </label>
          {hasPassword ? (
            <label>
              <span className="mb-1 block text-sm font-semibold">הסיסמה הנוכחית</span>
              <input name="currentPassword" type="password" required autoComplete="current-password" className="mv-field" />
            </label>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              className="mv-btn-action"
              style={{ background: "var(--color-danger)" }}
              disabled={busy}
            >
              {busy ? "מוחק…" : "מחק לצמיתות — אין דרך חזרה"}
            </button>
            <button type="button" className="mv-btn-plain" onClick={() => setOpen(false)} disabled={busy}>
              ביטול
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
