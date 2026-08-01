"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";

/**
 * התחברות בשני שלבים אפשריים: אימייל+סיסמה, ואם השרת דורש (LOGIN_OTP_ENABLED)
 * — גם קוד חד-פעמי שנשלח לאימייל. כשהאימות כבוי, שלב הקוד לא מופיע כלל.
 */

type LoginResponse =
  | { user: { mustChangePassword: boolean } }
  | { otpRequired: true; otpToken: string };

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [otpToken, setOtpToken] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiPost<LoginResponse>("/auth/login", {
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if ("otpRequired" in result) {
        // השרת דורש קוד אימייל — מעבר לשלב 2
        setOtpToken(result.otpToken);
        setSubmitting(false);
        return;
      }
      router.replace(result.user.mustChangePassword ? "/change-password" : "/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שגיאה בהתחברות — נסו שוב");
      setSubmitting(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!otpToken) return;
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const { user } = await apiPost<{ user: { mustChangePassword: boolean } }>(
        "/auth/login/verify",
        { otpToken, code: String(form.get("code")).trim() },
      );
      router.replace(user.mustChangePassword ? "/change-password" : "/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "האימות נכשל — נסו שוב");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-1 text-2xl font-bold">התחברות</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        מתווכים — מערכת ניהול למשרדי תיווך
      </p>

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

      {otpToken ? (
        <form onSubmit={onVerify} noValidate aria-describedby={error ? "login-error" : undefined}>
          <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            📧 שלחנו קוד בן 6 ספרות לאימייל שלך — הקלד אותו כאן. הקוד תקף ל-10 דקות.
          </p>
          <div className="mb-6">
            <label htmlFor="code" className="mb-1 block font-medium">
              קוד אימות
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              dir="ltr"
              className="w-full rounded-lg border px-3 py-2.5 text-center text-2xl tracking-widest"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "מאמת…" : "אימות והתחברות"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="mt-2 w-full"
            onClick={() => {
              setOtpToken(null);
              setError(null);
            }}
          >
            חזרה
          </Button>
        </form>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-describedby={error ? "login-error" : undefined}>
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
              style={inputStyle}
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
              style={inputStyle}
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "מתחבר…" : "התחברות"}
          </Button>
        </form>
      )}
    </div>
  );
}
