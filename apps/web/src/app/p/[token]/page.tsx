"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import { formatJerusalemTime, openHouseWhen, type SlotAvailability } from "@metavchim/shared";
import { API_BASE, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { LogoMark } from "../../icons";
import { Notice } from "../../notice";
import { OfficeBrand } from "../../public-brand";

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
  logoUrl: string | null;
}

interface PublicOpenHouse {
  event: { id: string; startsAt: string; endsAt: string; slotMinutes: number; slots: SlotAvailability[] } | null;
}

export default function LandingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<LandingView | null>(null);
  const [openHouse, setOpenHouse] = useState<PublicOpenHouse["event"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<LandingView>(`/public/landing/${token}`)
      .then(setView)
      .catch(() => setError("הדף לא נמצא או שהקישור כבר אינו פעיל."));
    /* ‏בית פתוח — בקשה נפרדת: הדף עולה גם כשאין אירוע, ובלי לחכות לו */
    apiGet<PublicOpenHouse>(`/public/landing/${token}/open-house`)
      .then((res) => setOpenHouse(res.event))
      .catch(() => setOpenHouse(null));
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
      <Notice tone="danger">{error}</Notice>
    );
  }
  if (view === null) return <p aria-live="polite" className="py-16 text-center">טוען…</p>;

  if (view.status === "unavailable") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        {/*
          דווקא כאן המותג חשוב: זה הדף שממנו הלקוח פונה למשרד אחרי
          שהנכס ירד. בלי הלוגו הוא נראה כמו הודעת שגיאה של המערכת.
        */}
        <div className="mb-5 flex justify-center">
          <OfficeBrand officeName={view.officeName} logoUrl={view.logoUrl} />
        </div>
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
        {/*
          הלוגו של המשרד במקום שורת השם. דף נכס הוא חומר שיווקי של
          המשרד — הוא נשלח בוואטסאפ ומוטמע במודעות — ושם אפור בראשו
          גרם לו להיראות כמו דף של המערכת ולא של מי ששלח אותו.
        */}
        <div className="mb-3">
          <OfficeBrand officeName={view.officeName} logoUrl={view.logoUrl} />
        </div>
        <h1 className="m-0 mt-1" style={{ fontSize: "calc(27 / 16 * 1rem)", fontWeight: 800, letterSpacing: "-0.01em" }}>
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

      {/* בית פתוח — הרשמה למשבצת */}
      {openHouse !== null ? (
        <OpenHouseSignup token={token} event={openHouse} officeName={view.officeName} onRegistered={() => setOpenHouse(null)} />
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
            <h2 id="contact-heading" className="m-0 mb-1" style={{ fontSize: "var(--type-metric)", fontWeight: 800 }}>
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

/**
 * ‏הרשמה לבית פתוח — בוחרים שעה, שם וטלפון. הפרטים נכנסים ללידים
 * ‏של המשרד (אותה קליטה של טופס הפנייה) והמבקר מקבל מקום במשבצת.
 */
function OpenHouseSignup({
  token,
  event,
  officeName,
  onRegistered,
}: {
  token: string;
  event: NonNullable<PublicOpenHouse["event"]>;
  officeName: string;
  onRegistered: () => void;
}) {
  const [slotAt, setSlotAt] = useState<string>(event.slots.find((s) => s.remaining !== 0)?.startsAt ?? "");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (slotAt === "") {
      setFormError("בחרו שעה");
      return;
    }
    setSending(true);
    setFormError(null);
    const form = new FormData(e.currentTarget);
    try {
      await apiPost(`/public/landing/${token}/open-house/${event.id}/register`, {
        name: String(form.get("name")).trim(),
        phone: String(form.get("phone")).trim(),
        slotAt,
        website: String(form.get("website") ?? ""),
      });
      setDone(slotAt);
    } catch (err: unknown) {
      setFormError(err instanceof ApiError && err.status === 409 ? "השעה הזו התמלאה — בחרו שעה אחרת" : "ההרשמה נכשלה — בדקו את השם והטלפון ונסו שוב");
    } finally {
      setSending(false);
    }
  }

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  return (
    <section className="mv-list-card mb-6 p-6" aria-labelledby="open-house-heading">
      <h2 id="open-house-heading" className="m-0 mb-1" style={{ fontSize: "var(--type-metric)", fontWeight: 800 }}>
        🏠 בית פתוח — {openHouseWhen(startsAt, endsAt)}
      </h2>
      {done !== null ? (
        <p className="m-0 mt-2 font-bold" role="status" style={{ color: "var(--color-primary)" }}>
          ✓ נרשמתם לשעה {formatJerusalemTime(new Date(done))}. נתראה — {officeName}
          <button type="button" className="mv-btn-plain mr-2" onClick={onRegistered}>סגור</button>
        </p>
      ) : (
        <>
          <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            בוחרים שעה ומשאירים פרטים — בלי תור ובלי המתנה.
          </p>
          <form onSubmit={(e) => void onSubmit(e)} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 flex flex-wrap gap-2" role="radiogroup" aria-label="שעה">
              {event.slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  type="button"
                  role="radio"
                  aria-checked={slotAt === slot.startsAt}
                  disabled={slot.remaining === 0}
                  onClick={() => setSlotAt(slot.startsAt)}
                  className={slotAt === slot.startsAt ? "mv-btn-action" : "mv-btn-soft"}
                  style={{ minHeight: 44 }}
                >
                  {formatJerusalemTime(new Date(slot.startsAt))}
                  {slot.remaining === 0 ? " · מלא" : ""}
                </button>
              ))}
            </div>
            <label>
              <span className="mb-1 block text-sm font-semibold">שם מלא</span>
              <input name="name" required minLength={2} className="mv-search-input" style={{ minHeight: 44 }} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-semibold">טלפון</span>
              <input name="phone" required dir="ltr" inputMode="tel" className="mv-search-input" style={{ minHeight: 44 }} />
            </label>
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="mv-visually-hidden" />
            {formError ? <Notice tone="danger">{formError}</Notice> : null}
            <div className="sm:col-span-2">
              <button type="submit" disabled={sending} className="mv-btn-action w-full" style={{ padding: "12px 0", fontSize: "var(--type-button)" }}>
                {sending ? "רושם…" : "להירשם לבית הפתוח"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
