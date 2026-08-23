"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet, apiPost, ApiError } from "@/lib/api";
import { resyncA11yForUser } from "@/lib/a11y-sync";
import { clearSessionCache } from "@/lib/session-cache";
import { AuthShell } from "../auth-shell";
import { IconMail, LogoGoogle } from "../icons";
import { Notice } from "../notice";

/**
 * התחברות בשני שלבים אפשריים: אימייל+סיסמה, ואם השרת דורש (LOGIN_OTP_ENABLED)
 * — גם קוד חד-פעמי שנשלח לאימייל. כשהאימות כבוי, שלב הקוד לא מופיע כלל.
 */

type LoginResponse =
  | { user: { mustChangePassword: boolean } }
  | { otpRequired: true; otpToken: string };

/** שגיאות חזרה מ-Google — הודעה מדויקת בלי לחשוף פרטי מערכת. */
const GOOGLE_ERRORS: Record<string, string> = {
  unknown: "החשבון לא קיים במערכת — בקשו ממנהל המשרד להוסיף אתכם",
  unverified: "כתובת האימייל אינה מאומתת אצל Google",
  failed: "ההתחברות עם Google נכשלה — נסו שוב או התחברו עם סיסמה",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const justReset = params.get("reset") === "1";
  const googleError = params.get("googleError");
  const [error, setError] = useState<string | null>(
    googleError ? (GOOGLE_ERRORS[googleError] ?? GOOGLE_ERRORS["failed"]!) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // הכפתור מוצג רק כשהחיבור מוגדר בפועל — אחרת הוא היה מוביל לשגיאה
  useEffect(() => {
    apiGet<{ google: boolean }>("/auth/providers")
      .then((res) => setGoogleEnabled(res.google))
      .catch(() => setGoogleEnabled(false));
  }, []);

  /*
   * הטופס נושא `method="post"` אף שהוא נשלח כאן ב-fetch.
   *
   * זו הגנה על החלון שבין ציור הדף לבין ההידרציה: לחיצה על
   * "התחברות" לפני ש-React התחבר לטופס מפעילה שליחה **מקורית** של
   * הדפדפן, וברירת המחדל שלה היא GET — כלומר הסיסמה נכתבת בשורת
   * הכתובת, נשמרת בהיסטוריה וגם ביומן השרת. עם POST אותה לחיצה
   * אינה מדליפה דבר. אותו טיפול בכל טופס שיש בו שדה סיסמה.
   */
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
        setCode("");
        setSubmitting(false);
        return;
      }
      /* הזהות במטמון היא של מי שהיה מחובר קודם — ראו session-cache */
      clearSessionCache();
      /*
       * והנגישות — אותו היגיון בדיוק, בשכבה שנייה. הכניסה היא
       * `router.replace`, ולכן `AccessibilityRuntime` אינו מורכב
       * מחדש והסנכרון החד-פעמי שלו כבר נצרך בטעינת מסך זה.
       *
       * **בלי `await`.** הסנכרון הוא נוחות, והכניסה כבר הצליחה:
       * המתנה לו הציבה בקשה אופציונלית על הנתיב הקריטי, ובקשה
       * שנתקעת (ל-`apiGet` אין timeout) הייתה משאירה משתמש מאומת
       * תקוע על טופס ההתחברות (ביקורת Codex). ה-SPA ממשיך לחיות
       * אחרי הניווט, ולכן ההעדפות מוחלות כשהתשובה מגיעה.
       */
      void resyncA11yForUser();
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
    try {
      const { user } = await apiPost<{ user: { mustChangePassword: boolean } }>(
        "/auth/login/verify",
        { otpToken, code },
      );
      clearSessionCache();
      // בלי `await` — ראו ההסבר במסלול הסיסמה
      void resyncA11yForUser();
      router.replace(user.mustChangePassword ? "/change-password" : "/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "האימות נכשל — נסו שוב");
      setSubmitting(false);
    }
  }

  return (
    <>
      {justReset ? (
        <Notice tone="success">✓ הסיסמה עודכנה — התחברו עם הסיסמה החדשה.</Notice>
      ) : null}

      {error ? (
        <Notice tone="danger" id="login-error">{error}</Notice>
      ) : null}

      {otpToken ? (
        <form method="post" onSubmit={onVerify} noValidate aria-describedby={error ? "login-error" : undefined}>
          <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <IconMail s={15} /> שלחנו קוד בן 6 ספרות לאימייל שלך — הקלד אותו כאן. הקוד תקף ל-10 דקות.
          </p>
          <div className="mb-6">
            <label htmlFor="code" className="mb-1 block font-medium">
              קוד אימות
            </label>
            {/* שדה מבוקר שמקבל ספרות בלבד. מנהלי הסיסמאות של הדפדפן
                נוטים למלא אוטומטית את הסיסמה השמורה לשדה הטקסט היחיד
                שבטופס — ואז היא מוצגת על המסך בגלוי. הסינון כאן מוחק
                כל תו שאינו ספרה ברגע שהוא נכנס, וה-data-*ignore
                מבקשים מהמנהלים הנפוצים לדלג על השדה מלכתחילה. */}
            <input
              id="code"
              name="mv-otp"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore=""
              data-lpignore="true"
              data-bwignore=""
              data-form-type="other"
              pattern="\d{6}"
              maxLength={6}
              required
              dir="ltr"
              className="mv-auth-input text-center text-2xl tracking-widest"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || code.length !== 6}
            className="mv-auth-submit"
          >
            {submitting ? "מאמת…" : "אימות והתחברות"}
          </button>
          <Button
            type="button"
            variant="ghost"
            className="mt-2 w-full"
            onClick={() => {
              setOtpToken(null);
              setCode("");
              setError(null);
            }}
          >
            חזרה
          </Button>
        </form>
      ) : (
        <form method="post" onSubmit={onSubmit} noValidate aria-describedby={error ? "login-error" : undefined}>
          {googleEnabled ? (
            <>
              {/* ניווט מלא ולא fetch: זרימת OAuth דורשת הפניה של הדפדפן */}
              <a
                href={`${API_BASE}/auth/google/start`}
                className="mv-button mv-button--secondary w-full"
              >
                {/* הסימן של Google עצמו ולא אייקון מפתח כללי: כפתור
                    התחברות של ספק זהות מזוהה לפי הלוגו שלו, וזה גם
                    מה שתנאי השימוש של Google דורשים */}
                <LogoGoogle s={17} /> התחברות עם Google
              </a>
              <div className="my-4 flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
                <span style={{ color: "var(--color-text-muted)" }}>או עם אימייל וסיסמה</span>
                <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
              </div>
            </>
          ) : null}

          <div className="mv-auth-field">
            <label htmlFor="email">אימייל</label>
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

          <div className="mv-auth-field" style={{ marginBottom: 22 }}>
            <label htmlFor="password">סיסמה</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              dir="ltr"
              className="mv-auth-input"
            />
          </div>

          <button type="submit" disabled={submitting} className="mv-auth-submit">
            {submitting ? "מתחבר…" : "התחברות"}
          </button>

          <Link href="/forgot-password" className="mt-4 block text-center underline">
            שכחתי סיסמה
          </Link>
        </form>
      )}
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthShell
      title="התחברות"
      subtitle="ברוכים השבים — הזינו את פרטי הכניסה למשרד."
      foot={
        <>
          עוד אין לכם חשבון?{" "}
          <Link href="/signup" className="underline font-bold">
            פתחו משרד בחינם
          </Link>
        </>
      }
    >
      <Suspense fallback={<p aria-live="polite">טוען…</p>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
