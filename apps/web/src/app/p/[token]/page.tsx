"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import { API_BASE, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { LogoMark } from "../../icons";

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
      <p role="alert" className="mx-auto max-w-lg py-16 text-center" style={{ color: "var(--color-text-muted)" }}>
        {error}
      </p>
    );
  }
  if (view === null) return <p aria-live="polite" className="py-16 text-center">טוען…</p>;

  if (view.status === "unavailable") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="mb-2 text-xl font-extrabold">הנכס כבר לא זמין</h1>
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
    <div className="mx-auto max-w-3xl pb-16">
      {/* כותרת */}
      <header className="mb-5 pt-4">
        <p className="m-0 text-[14.5px] font-bold" style={{ color: "var(--color-primary)" }}>
          {view.officeName}
        </p>
        <h1 className="m-0 mt-1" style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.01em" }}>
          {view.title}
        </h1>
        <p className="m-0 mt-1 flex flex-wrap items-baseline gap-3">
          <span style={{ color: "var(--color-text-muted)" }}>
            {[view.neighborhood, view.city].filter(Boolean).join(", ")}
          </span>
          {view.priceAgorot !== undefined ? (
            <span className="text-2xl font-extrabold">{formatPrice(view.priceAgorot)}</span>
          ) : null}
        </p>
      </header>

      {/* תמונות */}
      {view.images.length > 0 ? (
        <div className="mb-6 grid gap-2.5" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          {view.images.slice(0, 6).map((img, index) => (
            // img רגיל בכוונה — מוזרם דרך ה-API הציבורי
            <img
              key={img.url}
              src={API_BASE + img.url}
              alt={img.alt ?? `תמונת הנכס ${index + 1}`}
              className="w-full rounded-xl object-cover"
              style={{ height: index === 0 ? 280 : 160, gridColumn: index === 0 ? "1 / -1" : undefined }}
            />
          ))}
        </div>
      ) : null}

      {/* מפרט */}
      {specs.length > 0 || view.features.length > 0 ? (
        <section className="mv-list-card mb-6 p-5" aria-label="פרטי הנכס">
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
            {specs.map(([label, value]) => (
              <div key={label}>
                <div className="text-sm font-semibold" style={{ color: "var(--color-text-muted)" }}>
                  {label}
                </div>
                <div className="mt-0.5 text-[16px] font-bold">{value}</div>
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
      <section className="mv-list-card p-6" aria-labelledby="contact-heading">
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
            <h2 id="contact-heading" className="m-0 mb-1" style={{ fontSize: 20, fontWeight: 800 }}>
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
                  style={{ height: 44 }}
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
                  style={{ height: 44 }}
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
                <p role="alert" className="m-0 text-sm sm:col-span-2" style={{ color: "var(--color-danger)" }}>
                  {formError}
                </p>
              ) : null}
              <div className="sm:col-span-2">
                <button type="submit" disabled={sending} className="mv-btn-action w-full" style={{ padding: "12px 0", fontSize: 16 }}>
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
        <a href="/privacy" className="underline">
          מדיניות פרטיות
        </a>{" "}
        ·{" "}
        <a href="/accessibility" className="underline">
          הצהרת נגישות
        </a>
      </p>
    </div>
  );
}
