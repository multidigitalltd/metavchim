"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";

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
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-1 text-2xl font-bold">איפוס סיסמה</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        נשלח לך קישור לאיפוס הסיסמה במייל.
      </p>

      {sent ? (
        <>
          <p
            role="status"
            className="mb-4 rounded-lg border p-3"
            style={{ borderColor: "var(--color-success)", background: "var(--color-surface)" }}
          >
            📧 אם הכתובת רשומה במערכת — נשלח אליה קישור לאיפוס הסיסמה. הקישור תקף
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
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "שולח…" : "שלח קישור לאיפוס"}
          </Button>
          <Link href="/login" className="mt-4 block text-center underline">
            חזרה להתחברות
          </Link>
        </form>
      )}
    </div>
  );
}
