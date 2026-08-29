"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import { API_BASE, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { LogoMark } from "../../icons";
import { Notice } from "../../notice";

/**
 * דף הנחיתה הציבורי של נכס — מה שהמתווך שולח ללקוחות ומטמיע במודעות.
 * ציבורי לגמרי (בלי Session), מזוהה בטוקן בלבד. טופס הפנייה נכנס
 * ישירות ללידים של המשרד עם מקור "דף נחיתה".
 */

interface LandingView {
  status: "ok" | "unavailable";
  title: string;
  description?: string;
  city?: string;
  neighborhood?: string;
  propertyType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  priceAgorot?: number;
  features: string[];
  images: { url: string; alt?: string }[];
  officeName: string;
}

export default function LandingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<LandingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<LandingView>(`/public/landing/${token}`)
      .then(setView)
      .catch(() => setError("הדף לא נמצא או שהקישור כבר אינו פעיל."));
  }, [token]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSending(true);
    setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiPost(`/public/landing/${token}/lead`, {
        name: String(form.get("name")).trim(),
        phone: String(form.get("phone")).trim(),
        ...(String(form.get("message")).trim()
          ? { message: String(form.get("message")).trim() }
          : {}),
        website: String(form.get("website") ?? ""),
      });
      setSent(true);
    } catch (err: unknown) {
      setFormError(
        err instanceof ApiError ? "בדקו את השם והטלפון ונסו שוב" : "השליחה נכשלה — נסו שוב",
      );
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Notice tone="danger">{error}</Notice>
      </div>
    );
  }
  if (view === null) {
    return (
      <p aria-live="polite" className="py-16 text-center">
        טוען…
      </p>
    );
  }

  if (view.status === "unavailable") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="mb-2 text-xl font-extrabold" style={{ color: "var(--domain-peach-fg)" }}>
          הנכס כבר לא זמין
        </h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          לפרטים על נכסים דומים — פנו אל {view.officeName}.
        </p>
      </div>
    );
  }

  const specs: [string, string][] = [
    ...(view.propertyType
      ? ([["סוג", PROPERTY_TYPE_LABELS[view.propertyType] ?? view.propertyType]] as [string, string][])
      : []),
    ...(view.rooms !== undefined ? ([["חדרים", String(view.rooms)]] as [string, string][]) : []),
    ...(view.areaSqm !== undefined ? ([["שטח", `${view.areaSqm} מ"ר`]] as [string, string][]) : []),
    ...(view.floor !== undefined ? ([["קומה", String(view.floor)]] as [string, string][]) : []),
  ];

  return (
    /*
     * בלי ריפוד צדדי משלו: המעטפת הציבורית (`AppShell`, ענף
     * `isPublic`) כבר עוטפת כל מסך ציבורי ב-`px-4`. ריפוד נוסף כאן
     * היה מכפיל אותו ל-32px, כלומר מצר את התוכן דווקא במסך הצר.
     */
    <div className="mx-auto max-w-3xl pb-16">
      {/* כותרת */}
      <header className="mb-5 pt-5">
        <p className="m-0 text-[length:var(--type-caption-lg)] font-bold" style={{ color: "var(--color-primary)" }}>
          {view.officeName}
        </p>
        {/*
          ‎`clamp` ולא גודל קבוע: 27px על מסך של 360 שובר כותרת
          לשלוש שורות ודוחף את המחיר אל מתחת לקיפול.
        */}
        <h1
          className="m-0 mt-1"
          style={{
            fontSize: "clamp(1.4rem, 5.5vw, calc(27 / 16 * 1rem))",
            fontWeight: 800,
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
            color: "var(--domain-peach-fg)",
          }}
        >
          {view.title}
        </h1>
        {/*
          המחיר בשורה משלו בנייד ולצד המיקום ברוחב גדול: הוא המספר
          שבגללו נכנסים לדף, ובשורה משותפת צרה הוא נדחק לקצה.
        */}
        <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-3">
          <span style={{ color: "var(--color-text-muted)" }}>
            {[view.neighborhood, view.city].filter(Boolean).join(", ")}
          </span>
          {view.priceAgorot !== undefined ? (
            <span
              className="font-extrabold"
              style={{ fontSize: "clamp(1.25rem, 5vw, 1.5rem)" }}
            >
              {formatPrice(view.priceAgorot)}
            </span>
          ) : null}
        </div>
      </header>

      {/*
        גלריה ביחס-ממדים ולא בגבהים קבועים.

        ‎`height: 160` על מסך של 360 נותן תמונה ברוחב 165 וגובה 160 —
        כמעט ריבוע, שחותך כל צילום פנים לרוחב. יחס קבוע נותן לתמונה
        להתכווץ עם המסך במקום להתעוות, והראשונה נשארת רחבה כי היא זו
        שמחליטה אם ממשיכים לגלול.
      */}
      {view.images.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:gap-2.5">
          {view.images.slice(0, 6).map((img, index) => (
            // img רגיל בכוונה — מוזרם דרך ה-API הציבורי
            <img
              key={img.url}
              src={API_BASE + img.url}
              alt={img.alt ?? `תמונת הנכס ${index + 1}`}
              className="w-full rounded-xl object-cover"
              style={{
                aspectRatio: index === 0 ? "16 / 10" : "4 / 3",
                gridColumn: index === 0 ? "1 / -1" : undefined,
              }}
            />
          ))}
        </div>
      ) : null}

      {/* מפרט */}
      {specs.length > 0 || view.features.length > 0 ? (
        <section className="mv-list-card mb-6 p-4 sm:p-5" aria-label="פרטי הנכס">
          {/*
            שתי עמודות בנייד ואז auto-fit: `minmax(110px, 1fr)` לבדו
            נותן על 360px שתי עמודות עם עמודה שלישית חסרה למחצה,
            ושורה אחרונה יתומה. מספר עמודות מפורש בנייד נקי יותר.
          */}
          <div className="grid grid-cols-2 gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]">
            {specs.map(([label, value]) => (
              <div key={label}>
                <div className="text-sm font-semibold" style={{ color: "var(--color-text-muted)" }}>
                  {label}
                </div>
                <div className="mt-0.5 text-[length:var(--type-button)] font-bold">{value}</div>
              </div>
            ))}
          </div>
          {view.features.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {view.features.map((f) => (
                <span key={f} className="mv-pill" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                  {f}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* תיאור */}
      {view.description ? (
        <section className="mb-8" aria-label="תיאור">
          <p className="whitespace-pre-wrap" style={{ lineHeight: 1.7 }}>{view.description}</p>
        </section>
      ) : null}

      {/* טופס פנייה */}
      <section className="mv-list-card p-4 sm:p-6" aria-labelledby="contact-heading">
        {sent ? (
          <div className="text-center" role="status">
            <p className="mb-1 text-lg font-extrabold" style={{ color: "var(--color-primary)" }}>
              ✓ הפנייה התקבלה
            </p>
            <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
              {view.officeName} יחזרו אליכם בהקדם.
            </p>
          </div>
        ) : (
          <>
            <h2
              id="contact-heading"
              className="m-0 mb-1"
              style={{
                fontSize: "var(--type-metric)",
                fontWeight: 800,
                color: "var(--domain-peach-fg)",
              }}
            >
              מעוניינים בנכס?
            </h2>
            <p className="m-0 mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              השאירו פרטים — {view.officeName} יחזרו אליכם.
            </p>
            <form onSubmit={(e) => void onSubmit(e)} className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1 block text-sm font-semibold">שם מלא</span>
                <input
                  name="name"
                  required
                  minLength={2}
                  className="mv-search-input"
                  style={{ minHeight: 44 }}
                />
              </label>
              <label>
                <span className="mb-1 block text-sm font-semibold">טלפון</span>
                <input
                  name="phone"
                  required
                  dir="ltr"
                  inputMode="tel"
                  className="mv-search-input"
                  style={{ minHeight: 44 }}
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm font-semibold">הודעה (לא חובה)</span>
                <textarea name="message" rows={3} className="mv-search-input" style={{ height: "auto", paddingBlock: 10 }} />
              </label>
              {/* honeypot לבוטים — מוסתר מעיניים ומקוראי מסך */}
              <input
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="mv-visually-hidden"
              />
              {formError ? (
                <Notice tone="danger">{formError}</Notice>
              ) : null}
              <div className="sm:col-span-2">
                <button type="submit" disabled={sending} className="mv-btn-action w-full" style={{ padding: "12px 0", fontSize: "var(--type-button)" }}>
                  {sending ? "שולח…" : "השאירו לי פרטים"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      {/* לקוח קצה שמשאיר פרטים בטופס הזה זכאי לדעת מה נעשה בהם — הקישור
          למדיניות הפרטיות הוא חלק מהאיסוף, לא קישוט בתחתית העמוד */}
      <p className="mt-6 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
        <span className="mb-1 flex items-center justify-center gap-1.5">
          <LogoMark s={16} />
          הדף מופעל על ידי {view.officeName} · מערכת מתווכים
        </span>
        {/*
          ‎`inline-block` עם ריפוד אנכי: הקישורים האלה היו בגובה 16px,
          כלומר יעד מגע שצריך לכוון אליו. הם משפטיים ולא שיווקיים,
          ולכן הם נשארים קטנים בטיפוגרפיה — אבל שטח הלחיצה גדל.
        */}
        <a href="/privacy" className="inline-block px-1 py-2 underline">
          מדיניות פרטיות
        </a>
        <span aria-hidden="true"> · </span>
        <a href="/accessibility" className="inline-block px-1 py-2 underline">
          הצהרת נגישות
        </a>
      </p>
    </div>
  );
}
