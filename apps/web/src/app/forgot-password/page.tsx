"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { apiPost, ApiError } from "@/lib/api";
import { AuthShell } from "../auth-shell";
import { IconMail } from "../icons";

/**
 * "שכחתי סיסמה" — התשובה זהה תמיד, בין אם הכתובת רשומה ובין אם לא
 * (מניעת מיפוי משתמשים). הקישור נשלח למייל ותקף ל-30 דקות.
 */
export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiPost("/auth/forgot-password", { email: String(form.get("email")).trim() });
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השליחה נכשלה — נסו שוב");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="איפוס סיסמה"
      subtitle="נשלח לך קישור לאיפוס הסיסמה במייל."
      points={["הקישור תקף ל-30 דקות", "נשלח רק לכתובת שרשומה במערכת", "אף אחד אחר לא מקבל התראה"]}
    >

      {sent ? (
        <>
          <p
            role="status"
            className="mb-4 rounded-lg border p-3"
            style={{ borderColor: "var(--color-success)", background: "var(--color-surface)" }}
          >
            <IconMail s={15} /> אם הכתובת רשומה במערכת — נשלח אליה קישור לאיפוס הסיסמה. הקישור תקף
            ל-30 דקות. בדקו גם בתיקיית הספאם.
          </p>
          <Link href="/login" className="underline">
            חזרה להתחברות
          </Link>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border p-3"
              style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
            >
              {error}
            </p>
          ) : null}

          <div className="mb-6">
            <label htmlFor="email" className="mb-1 block font-medium">
              האימייל שלך
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              dir="ltr"
              className="mv-auth-input"
            />
          </div>

          <button type="submit" disabled={submitting} className="mv-auth-submit">
        {submitting ? "שולח…" : "שלח קישור לאיפוס"}
      </button>
          <Link href="/login" className="mt-4 block text-center underline">
            חזרה להתחברות
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
