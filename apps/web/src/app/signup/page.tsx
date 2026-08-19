"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { featureLabel, FREE_PRICE_LABEL } from "@metavchim/shared";
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
  /** true = `monthlyPrice` הוא „בהתאמה” ולא סכום. */
  priceOnRequest: boolean;
  yearlyPrice: string | null;
  yearlySavingPercent: number | null;
  maxUsers: number | null;
  maxProperties: number | null;
  maxNetworkListings: number | null;
  maxNetworkDemands: number | null;
  features: string[];
  trialDays: number;
}

export default function SignupPage(): React.JSX.Element {
  const router = useRouter();
  const [plans, setPlans] = useState<OfferedPlan[] | null>(null);
  /*
   * הסייג מגיע מהשרת ואינו נצרב כאן — הוא נוסח מסחרי שמשתנה, וכל
   * מקום שמחזיק עותק משלו מציג ביום השינוי תנאי שכבר אינו נכון.
   * מחרוזת ריקה עד שהמחירון נטען, כדי לא להבטיח סייג בלי מחירים.
   */
  const [priceNote, setPriceNote] = useState("");
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
  /*
   * הקופון נבדק בלחיצה ולא בכל הקלדה.
   *
   * בדיקה בכל תו הייתה מקישה על נתיב ציבורי עשרות פעמים בזמן שהמשתמש
   * מקליד קוד אחד, ומגבלת הקצב שם הדוקה בכוונה — הוא היה נחסם באמצע
   * ההקלדה ורואה "הקוד אינו תקף" על קוד תקין לגמרי.
   */
  const [coupon, setCoupon] = useState("");
  const [couponState, setCouponState] = useState<
    { status: "idle" } | { status: "checking" } | { status: "ok"; text: string } | { status: "bad"; text: string }
  >({ status: "idle" });

  useEffect(() => {
    apiGet<{ plans: OfferedPlan[]; priceNote: string }>("/signup/plans")
      .then((res) => {
        setPlans(res.plans);
        setPriceNote(res.priceNote);
        // ברירת מחדל: המסלול האמצעי, לא הזול ביותר — הוא זה שמתאים
        // לרוב המשרדים, ומי שרוצה אחר בוחר בלחיצה
        setChosen(res.plans[Math.min(1, res.plans.length - 1)]?.code ?? null);
      })
      .catch(() => setPlans([]));
  }, []);

  async function checkCoupon(): Promise<void> {
    if (chosen === null) return;
    setCouponState({ status: "checking" });
    try {
      const res = await apiPost<{ valid: boolean; description?: string; message?: string }>(
        "/signup/coupon",
        { code: coupon.trim(), plan: chosen },
      );
      setCouponState(
        res.valid
          ? { status: "ok", text: res.description ?? "הקוד תקף" }
          : { status: "bad", text: res.message ?? "הקוד אינו תקף" },
      );
    } catch (err: unknown) {
      /*
       * 429 כאן הוא מגבלת הקצב, וההודעה מהשרת אומרת את זה. הצגתה
       * כ"הקוד אינו תקף" הייתה שולחת את המשתמש לזרוק קוד תקין.
       */
      setCouponState({
        status: "bad",
        text: err instanceof ApiError ? err.message : "לא הצלחנו לבדוק את הקוד",
      });
    }
  }

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
        // נשלח רק כשהוזן; השרת מנרמל ובודק שוב — הבדיקה במסך היא נוחות
        ...(coupon.trim() !== "" ? { coupon: coupon.trim() } : {}),
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
        <form method="post" onSubmit={(e) => void submit(e)} noValidate aria-describedby={error ? "signup-error" : undefined}>
          <fieldset className="m-0 mb-5 border-0 p-0">
            <legend className="mb-2 text-[15px] font-bold">בחרו מסלול</legend>
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
                        <strong style={{ fontSize: 16 }}>{plan.name}</strong>
                        <span style={{ fontSize: 15, fontWeight: 800 }}>
                          {plan.monthlyPrice}
                          {/*
                            „חינם / חודש” קורא כמו מבצע לחודש הראשון,
                            ו„בהתאמה / חודש” אינו קורא כמו כלום. יחידת
                            הזמן שייכת לסכום בלבד.

                            ההשוואה היא מול הקבוע המשותף ולא מול מחרוזת
                            שנכתבה כאן: הנוסח נקבע בשרת, ועותק מקומי שלו
                            היה מפסיק להתאים בשקט ביום שהוא משתנה —
                            והמסך היה מציג „חינם / חודש”.
                          */}
                          {plan.priceOnRequest || plan.monthlyPrice === FREE_PRICE_LABEL ? null : (
                            <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>
                              {" "}
                              / חודש
                            </span>
                          )}
                        </span>
                      </span>
                      <span
                        className="mt-0.5 block text-[14.5px]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {plan.description}
                      </span>
                      <span className="mt-1 block text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                        {plan.maxUsers === null ? "משתמשים ללא הגבלה" : `עד ${plan.maxUsers} משתמשים`}
                        {" · "}
                        {plan.maxProperties === null
                          ? "נכסים ללא הגבלה"
                          : `עד ${plan.maxProperties} נכסים`}
                        {plan.maxNetworkListings !== null ||
                        plan.maxNetworkDemands !== null ? (
                          <>
                            {" · "}
                            {`ברשת השיתופים: עד ${plan.maxNetworkListings ?? "∞"} נכסים ו-${plan.maxNetworkDemands ?? "∞"} קונים`}
                          </>
                        ) : null}
                      </span>
                      {active ? (
                        <span className="mt-1.5 block text-[14px]">
                          {plan.features.map(featureLabel).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {/*
              הסייג מתחת לרשימה ובתוך ה-fieldset של בחירת המסלול: הוא
              חל על כל המחירים שמעליו, וזה המקום שבו הוא נקרא לפני
              ההחלטה ולא אחריה.
            */}
            {priceNote === "" ? null : (
              <p
                className="mt-2 mb-0 text-[14px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                {priceNote}
              </p>
            )}
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
            הקופון אחרון ולא ראשון, ומסומן "לא חובה".
            שדה קוד בראש טופס הרשמה גורם למי שאין לו קוד לחשוב שהוא
            מפסיד משהו, ולעצור כדי לחפש אחד.
          */}
          <div className="mv-auth-field">
            <label htmlFor="coupon">קוד קופון (לא חובה)</label>
            <div className="flex gap-2">
              <input
                id="coupon"
                value={coupon}
                onChange={(e) => {
                  setCoupon(e.target.value);
                  setCouponState({ status: "idle" });
                }}
                maxLength={40}
                dir="ltr"
                autoComplete="off"
                className="mv-auth-input"
              />
              <button
                type="button"
                className="mv-btn-plain"
                disabled={coupon.trim() === "" || couponState.status === "checking" || chosen === null}
                onClick={() => void checkCoupon()}
              >
                {couponState.status === "checking" ? "בודק…" : "בדיקה"}
              </button>
            </div>
            {couponState.status === "ok" || couponState.status === "bad" ? (
              <p
                aria-live="polite"
                className="m-0 mt-1 text-xs"
                style={{
                  color:
                    couponState.status === "ok" ? "var(--color-success)" : "var(--color-danger)",
                }}
              >
                {couponState.status === "ok" ? `✓ ${couponState.text}` : couponState.text}
              </p>
            ) : null}
          </div>

          {/*
            אישור התנאים כתיבה מפורשת ולא כטקסט "בהמשך אתם מסכימים".
            השרת דורש `acceptTerms: true` ולא מקבל הרשמה בלעדיו, ולכן
            תיבה שלא סומנה עוצרת כאן ולא בשגיאת שרת סתומה.
          */}
          <label className="mb-4 flex items-start gap-2 text-[15px]">
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
