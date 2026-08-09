"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost, ApiError } from "@/lib/api";
import { AuthShell } from "../auth-shell";

/** קביעת סיסמה חדשה מקישור האיפוס שנשלח למייל (טוקן חד-פעמי). */


function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("הסיסמאות אינן זהות");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/auth/reset-password", { token, newPassword });
      router.replace("/login?reset=1");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "האיפוס נכשל — בקשו קישור חדש");
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <>
        <p role="alert" className="mb-4" style={{ color: "var(--color-danger)" }}>
          הקישור אינו תקין. בקשו קישור איפוס חדש.
        </p>
        <Link href="/forgot-password" className="underline">
          לבקשת קישור חדש
        </Link>
      </>
    );
  }

  return (
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

      <div className="mb-4">
        <label htmlFor="newPassword" className="mb-1 block font-medium">
          סיסמה חדשה <span className="font-normal">(לפחות 10 תווים)</span>
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={10}
          dir="ltr"
          autoComplete="new-password"
          className="mv-auth-input"
        />
      </div>

      <div className="mb-6">
        <label htmlFor="confirm" className="mb-1 block font-medium">
          אימות סיסמה
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={10}
          dir="ltr"
          autoComplete="new-password"
          className="mv-auth-input"
        />
      </div>

      <button type="submit" disabled={submitting} className="mv-auth-submit">
        {submitting ? "שומר…" : "קבע סיסמה חדשה"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="סיסמה חדשה"
      subtitle="בחרו סיסמה חדשה לחשבון שלכם."
      points={["בחרו סיסמה שלא השתמשתם בה במקום אחר", "כל החיבורים הפתוחים ינותקו", "10 תווים לפחות"]}
    >
      <Suspense fallback={<p aria-live="polite">טוען…</p>}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
