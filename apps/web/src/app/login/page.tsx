"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const { user } = await apiPost<{ user: { mustChangePassword: boolean } }>("/auth/login", {
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      router.replace(user.mustChangePassword ? "/change-password" : "/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שגיאה בהתחברות — נסו שוב");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-1 text-2xl font-bold">התחברות</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        מערכת 360 למתווכים
      </p>

      <form onSubmit={onSubmit} noValidate aria-describedby={error ? "login-error" : undefined}>
        {error ? (
          <p
            id="login-error"
            role="alert"
            className="mb-4 rounded-lg border p-3"
            style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
          >
            {error}
          </p>
        ) : null}

        <div className="mb-4">
          <label htmlFor="email" className="mb-1 block font-medium">
            אימייל
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

        <div className="mb-6">
          <label htmlFor="password" className="mb-1 block font-medium">
            סיסמה
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            dir="ltr"
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
        </div>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "מתחבר…" : "התחברות"}
        </Button>
      </form>
    </div>
  );
}
