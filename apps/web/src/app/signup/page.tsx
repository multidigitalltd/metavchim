"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { featureLabel } from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { AuthShell } from "../auth-shell";

/**
 * הרשמה עצמית של משרד תיווך.
 *
 * עד כה משרד הוקם רק ידנית ממסך הפלטפורמה — כלומר כל לקוח חדש דרש
 * נוכחות של בעל הפלטפורמה, וגם בשעה שתיים בלילה. כאן המשרד נרשם
 * בעצמו ומתחיל לעבוד מיד.
 *
 * שני שלבים ולא טופס אחד ארוך: בחירת מסלול היא החלטה, ומילוי פרטים
 * הוא ביצוע. טופס שמערבב אותם מבקש מהמשתמש להשוות מחירים בזמן שהוא
 * כבר מקליד סיסמה.
 *
 * המסלולים מגיעים מהשרת ולא נצרבים כאן: הם נערכים במסך הפלטפורמה,
 * ורשימה מקומית הייתה מציגה מחיר שכבר לא נכון.
 */

interface OfferedPlan {
  code: string;
  name: string;
  description: string;
  monthlyPrice: string;
  yearlyPrice: string | null;
  yearlySavingPercent: number | null;
  maxUsers: number | null;
  maxProperties: number | null;
  features: string[];
  trialDays: number;
}

export default function SignupPage(): React.JSX.Element {
  const router = useRouter();
  const [plans, setPlans] = useState<OfferedPlan[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * אישור התנאים במצב מבוקר ולא כשדה בטופס.
   *
   * הטופס הוא noValidate (כדי לשלוט בהודעות השגיאה בעברית), ולכן
   * `required` על תיבת הסימון אינו עוצר שליחה. שליחת `acceptTerms:
   * true` קבוע הייתה יוצרת חשבון עם הסכמה שהמשתמש מעולם לא נתן —
   * ולא רק באג טכני אלא הצהרה שגויה (ביקורת Codex).
   */
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    apiGet<{ plans: OfferedPlan[] }>("/signup/plans")
      .then((res) => {
        setPlans(res.plans);
        // ברירת מחדל: המסלול האמצעי, לא הזול ביותר — הוא זה שמתאים
        // לרוב המשרדים, ומי שרוצה אחר בוחר בלחיצה
        setChosen(res.plans[Math.min(1, res.plans.length - 1)]?.code ?? null);
      })
      .catch(() => setPlans([]));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (chosen === null) return;
    if (!accepted) {
      setError("יש לאשר את תנאי השימוש ומדיניות הפרטיות");
      return;
    }
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/signup", {
        agencyName: String(form.get("agencyName") ?? "").trim(),
        ownerName: String(form.get("ownerName") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        phone: String(form.get("phone") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        plan: chosen,
        acceptTerms: true,
      });
      /*
       * ההרשמה כבר הנפיקה Session, ולכן ישר פנימה ולא למסך כניסה.
       * `replace` ולא `push`: חזרה אחורה אל טופס ההרשמה אחרי שהמשרד
       * כבר נפתח הייתה מובילה לניסיון הרשמה שני עם אותו אימייל.
       */
      router.replace("/setup");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההרשמה נכשלה — נסו שוב");
      setSubmitting(false);
    }
  }

  const selected = plans?.find((plan) => plan.code === chosen);

  return (
    <AuthShell
      title="פתיחת משרד"
      subtitle={
        selected && selected.trialDays > 0
          ? `${selected.trialDays} ימי ניסיון, בלי כרטיס אשראי.`
          : "כמה פרטים, והמשרד שלכם פתוח."
      }
      points={[
        "המשרד נפתח מיד — בלי התקנה ובלי המתנה",
        "כל הנתונים שלכם, מבודדים ומוצפנים",
        "אפשר לבטל בכל רגע ולייצא הכול",
      ]}
      foot={
        <>
          כבר יש לכם חשבון?{" "}
          <Link href="/login" className="underline font-bold">
            התחברו
          </Link>
        </>
      }
    >
      {error ? (
        <p
          id="signup-error"
          role="alert"
          className="mb-4 rounded-lg border p-3 text-sm"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
        >
          {error}
        </p>
      ) : null}

      {plans === null ? (
        <p aria-live="polite">טוען מסלולים…</p>
      ) : plans.length === 0 ? (
        <p role="alert">
          ההרשמה העצמית סגורה כרגע.{" "}
          <Link href="/login" className="underline">
            למסך ההתחברות
          </Link>
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate aria-describedby={error ? "signup-error" : undefined}>
          <fieldset className="m-0 mb-5 border-0 p-0">
            <legend className="mb-2 text-[13.5px] font-bold">בחרו מסלול</legend>
            <div className="grid gap-2">
              {plans.map((plan) => {
                const active = plan.code === chosen;
                return (
                  <label
                    key={plan.code}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3"
                    style={{
                      borderColor: active ? "var(--color-primary-accent)" : "var(--color-border)",
                      background: active ? "var(--color-primary-soft)" : "var(--color-surface)",
                    }}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={plan.code}
                      checked={active}
                      onChange={() => setChosen(plan.code)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <strong style={{ fontSize: 15 }}>{plan.name}</strong>
                        <span style={{ fontSize: 14, fontWeight: 800 }}>
                          {plan.monthlyPrice}
                          <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>
                            {" "}
                            / חודש
                          </span>
                        </span>
                      </span>
                      <span
                        className="mt-0.5 block text-[13px]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {plan.description}
                      </span>
                      <span className="mt-1 block text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                        {plan.maxUsers === null ? "משתמשים ללא הגבלה" : `עד ${plan.maxUsers} משתמשים`}
                        {" · "}
                        {plan.maxProperties === null
                          ? "נכסים ללא הגבלה"
                          : `עד ${plan.maxProperties} נכסים`}
                      </span>
                      {active ? (
                        <span className="mt-1.5 block text-[12.5px]">
                          {plan.features.map(featureLabel).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mv-auth-field">
            <label htmlFor="agencyName">שם המשרד</label>
            <input
              id="agencyName"
              name="agencyName"
              required
              minLength={2}
              maxLength={120}
              autoComplete="organization"
              className="mv-auth-input"
            />
          </div>

          <div className="mv-auth-field">
            <label htmlFor="ownerName">השם שלכם</label>
            <input
              id="ownerName"
              name="ownerName"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              className="mv-auth-input"
            />
          </div>

          <div className="mv-auth-field">
            <label htmlFor="email">אימייל</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              dir="ltr"
              autoComplete="email"
              className="mv-auth-input"
            />
          </div>

          <div className="mv-auth-field">
            <label htmlFor="phone">טלפון (לא חובה)</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="050-1234567"
              className="mv-auth-input"
            />
          </div>

          <div className="mv-auth-field">
            <label htmlFor="password">סיסמה</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              dir="ltr"
              className="mv-auth-input"
              aria-describedby="password-hint"
            />
            <p id="password-hint" className="m-0 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
              לפחות 10 תווים. זו הסיסמה שמגינה על נתוני הלקוחות של המשרד.
            </p>
          </div>

          {/*
            אישור התנאים כתיבה מפורשת ולא כטקסט "בהמשך אתם מסכימים".
            השרת דורש `acceptTerms: true` ולא מקבל הרשמה בלעדיו, ולכן
            תיבה שלא סומנה עוצרת כאן ולא בשגיאת שרת סתומה.
          */}
          <label className="mb-4 flex items-start gap-2 text-[13.5px]">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              className="mt-1"
            />
            <span>
              קראתי ואני מסכים/ה ל
              <Link href="/terms" className="underline">
                תנאי השימוש
              </Link>{" "}
              ול
              <Link href="/privacy" className="underline">
                מדיניות הפרטיות
              </Link>
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting || chosen === null || !accepted}
            className="mv-auth-submit"
          >
            {submitting ? "פותח משרד…" : "פתחו את המשרד"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
