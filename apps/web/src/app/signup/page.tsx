"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { featureLabel, FREE_PRICE_LABEL, normalizeSignupCode } from "@metavchim/shared";
import { apiGet, apiPost, ApiError, apiList } from "@/lib/api";
import { activeA11yCount, loadA11y } from "@/lib/a11y-prefs";
import { persistA11yToServer, resyncA11yForUser } from "@/lib/a11y-sync";
import { clearSessionCache } from "@/lib/session-cache";
import { AuthShell } from "../auth-shell";
import { Notice } from "../notice";

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
 *
 * ## הקוד שנשלח לאימייל
 *
 * שליחת הטופס **אינה פותחת משרד** אלא שולחת קוד לכתובת שהוקלדה.
 * המשרד נפתח רק כשהקוד חוזר, ולכן כתובת שאיש אינו קורא אינה משאירה
 * שום עקבה במסד.
 *
 * הטופס אינו מפורק בין השלבים אלא **מוסתר**: משתמש שגילה במסך הקוד
 * שהקליד כתובת שגויה חוזר אחורה ומוצא את כל מה שמילא במקומו. טופס
 * שמתאפס בחזרה אחורה הוא טופס שנוטשים.
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

  /*
   * רשימה ריקה אמרה כאן „ההרשמה העצמית סגורה כרגע” — וזו הייתה גם
   * התשובה לתקלת רשת. לקוח פוטנציאלי שקרא את זה הבין שהמוצר לא
   * נמכר, סגר את הדף והלך. כישלון טעינה חייב להיראות כמו כישלון
   * טעינה, עם כפתור לנסות שוב.
   */
  const [plansFailed, setPlansFailed] = useState(false);

  /*
   * ההרשמה הממתינה: הטוקן שמייצג את הפרטים שנשמרו בשרת עד שהקוד
   * יחזור, והכתובת שאליה נשלח — כדי שהמסך יאמר לאן להסתכל. הסיסמה
   * אינה נשמרת כאן: היא כבר בשרת, מוצפנת, ואין שום סיבה שתמתין
   * בזיכרון הדפדפן.
   */
  const [pending, setPending] = useState<{ token: string; email: string } | null>(null);
  const [code, setCode] = useState("");
  const [resent, setResent] = useState<string | null>(null);

  const loadPlans = useCallback(() => {
    setPlansFailed(false);
    setPlans(null);
    apiGet<{ plans: OfferedPlan[]; priceNote: string }>("/signup/plans")
      .then((res) => {
        const rows = apiList(res.plans, "plans");
        setPlans(rows);
        setPriceNote(res.priceNote);
        // ברירת מחדל: המסלול האמצעי, לא הזול ביותר — הוא זה שמתאים
        // לרוב המשרדים, ומי שרוצה אחר בוחר בלחיצה
        setChosen(rows[Math.min(1, rows.length - 1)]?.code ?? null);
      })
      .catch(() => setPlansFailed(true));
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

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
      const res = await apiPost<{ token: string; email: string }>("/signup", {
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
      // עדיין לא נפתח משרד — נשלח קוד, וזה כל מה שקרה
      setPending(res);
      setCode("");
      setResent(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההרשמה נכשלה — נסו שוב");
    } finally {
      setSubmitting(false);
    }
  }

  /** השלב השני — הקוד חוזר, והמשרד נפתח. */
  async function confirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/signup/confirm", { token: pending.token, code });
      /*
       * האישור כבר הנפיק Session, ולכן ישר פנימה ולא למסך כניסה.
       * `replace` ולא `push`: חזרה אחורה אל טופס ההרשמה אחרי שהמשרד
       * כבר נפתח הייתה מובילה לניסיון הרשמה שני עם אותו אימייל.
       */
      clearSessionCache();
      /*
       * התאמות נגישות שנבחרו כדי להשלים את ההרשמה — נשמרות לחשבון
       * החדש, ולא נעלמות ברענון הבא.
       *
       * מסך ההרשמה ציבורי, והכפתור הצף שם שומר במכשיר בלבד. החשבון
       * שנוצר הרגע ריק, ובלי השמירה הסנכרון הבא היה קורא „אין
       * העדפות” ומאפס — בדיוק את מי שהגדיל טקסט כדי להירשם (ביקורת
       * Codex). ממתינים לשמירה לפני הסנכרון, אחרת הקריאה עלולה
       * להקדים אותה ולהחזיר את החשבון הריק.
       */
      const chosen = loadA11y();
      if (activeA11yCount(chosen) > 0) await persistA11yToServer(chosen);
      void resyncA11yForUser();
      router.replace("/setup");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "האימות נכשל — נסו שוב");
      setSubmitting(false);
    }
  }

  async function resend(): Promise<void> {
    if (pending === null) return;
    setError(null);
    setResent(null);
    try {
      await apiPost("/signup/resend", { token: pending.token });
      setResent("נשלח קוד חדש. הקוד הקודם כבר אינו תקף.");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "לא הצלחנו לשלוח קוד נוסף");
    }
  }

  const selected = plans?.find((plan) => plan.code === chosen);

  return (
    <AuthShell
      title="פתיחת משרד"
      subtitle={
        pending !== null
          ? "נשאר רק לאמת את כתובת האימייל."
          : selected && selected.trialDays > 0
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
        <Notice tone="danger" id="signup-error">{error}</Notice>
      ) : null}

      {plansFailed ? (
        <p role="alert">
          לא הצלחנו לטעון את המסלולים — זו תקלת טעינה, לא סגירה של ההרשמה.{" "}
          <button type="button" className="underline" onClick={loadPlans}>
            נסו שוב
          </button>
        </p>
      ) : plans === null ? (
        <p aria-live="polite">טוען מסלולים…</p>
      ) : plans.length === 0 ? (
        <p role="alert">
          ההרשמה העצמית סגורה כרגע.{" "}
          <Link href="/login" className="underline">
            למסך ההתחברות
          </Link>
        </p>
      ) : (
        <>
        {pending === null ? null : (
          <form
            method="post"
            onSubmit={(e) => void confirm(e)}
            noValidate
            className="mb-2"
            aria-describedby={error ? "signup-error" : undefined}
          >
            <p className="mt-0 mb-3 text-[length:var(--type-body-sm)]">
              שלחנו קוד בן שש ספרות אל{" "}
              <strong dir="ltr" className="inline-block">
                {pending.email}
              </strong>
              . הזינו אותו כדי לפתוח את המשרד.
            </p>

            <div className="mv-auth-field">
              <label htmlFor="signup-code">קוד האימות</label>
              <input
                id="signup-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                /*
                  ‎`inputMode="numeric"` ולא `type="number"`: מקלדת ספרות
                  בנייד בלי חצי החצים והגלגלת שמקפיצים ספרה בטעות.
                */
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={20}
                dir="ltr"
                autoFocus
                className="mv-auth-input"
              />
            </div>

            {resent === null ? null : (
              <p aria-live="polite" className="m-0 mb-3 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-success)" }}>
                {resent}
              </p>
            )}

            <button
              type="submit"
              /*
                הכפתור נדלק לפי אותו נרמול שהשרת מפעיל. שתי הכרעות
                שונות על אותה מחרוזת היו מייצרות בדיוק את הפער שבו
                הכפתור פעיל והשרת עונה „קוד שגוי”.
              */
              disabled={submitting || normalizeSignupCode(code) === null}
              className="mv-auth-submit"
            >
              {submitting ? "פותח משרד…" : "אישור ופתיחת המשרד"}
            </button>

            <p className="mt-3 mb-0 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
              לא הגיע?{" "}
              <button type="button" className="underline" onClick={() => void resend()}>
                שלחו קוד שוב
              </button>
              {" · "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setPending(null);
                  setError(null);
                  setResent(null);
                }}
              >
                לתיקון הפרטים
              </button>
            </p>
          </form>
        )}

        {/*
          הטופס מוסתר ואינו מפורק: כל מה שהמשתמש מילא נשאר במקומו,
          וחזרה מ„לתיקון הפרטים” מוצאת אותו כפי שהיה.
        */}
        <div style={{ display: pending === null ? "block" : "none" }}>
        <form method="post" onSubmit={(e) => void submit(e)} noValidate aria-describedby={error ? "signup-error" : undefined}>
          <fieldset className="m-0 mb-5 border-0 p-0">
            <legend className="mb-2 text-[length:var(--type-body-sm)] font-bold">בחרו מסלול</legend>
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
                        <strong style={{ fontSize: "var(--type-button)" }}>{plan.name}</strong>
                        <span style={{ fontSize: "var(--type-body-sm)", fontWeight: 800 }}>
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
                        className="mt-0.5 block text-[length:var(--type-caption-lg)]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {plan.description}
                      </span>
                      <span className="mt-1 block text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
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
                        <span className="mt-1.5 block text-[length:var(--type-caption)]">
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
                className="mt-2 mb-0 text-[length:var(--type-caption)]"
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
            <p id="password-hint" className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
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
                className="m-0 mt-1 text-sm"
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
          <label className="mb-4 flex items-start gap-2 text-[length:var(--type-body-sm)]">
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
            {/*
              הכפתור אומר מה יקרה ולא מה המטרה. „פתחו את המשרד” היה
              מבטיח שהמסך הבא הוא המערכת, והמסך הבא הוא בקשת קוד.
            */}
            {submitting ? "שולח קוד…" : "המשך — קוד לאימייל"}
          </button>
        </form>
        </div>
        </>
      )}
    </AuthShell>
  );
}
