"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";

/** קביעת סיסמה חדשה מקישור האיפוס שנשלח למייל (טוקן חד-פעמי). */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

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
          className="w-full rounded-lg border px-3 py-2.5"
          style={inputStyle}
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
          className="w-full rounded-lg border px-3 py-2.5"
          style={inputStyle}
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "שומר…" : "קבע סיסמה חדשה"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-1 text-2xl font-bold">סיסמה חדשה</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        בחרו סיסמה חדשה לחשבון שלכם.
      </p>
      <Suspense fallback={<p aria-live="polite">טוען…</p>}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
