"use client";

import { use, useEffect, useState } from "react";
import type { MarketPublicEstimateDto, PropertyType } from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { Notice } from "../../../notice";
import { ils } from "../../../market/market-parts";

/**
 * ‎**„כמה שווה הדירה שלי?” — הטופס שהמשרד שם באתר שלו** (docs/14 §3, יכולת 4).
 *
 * ## מי קורא את העמוד הזה
 *
 * בעל דירה שמתלבט אם למכור, באתר של המשרד, לרוב בטלפון. הוא רוצה
 * מספר — לא טופס הרשמה. לכן התשובה מוצגת **מיד**, בלי פרטים, ורק
 * אחריה מוצע לו להשאיר טלפון לדו"ח מפורט ממתווך. פרטים שנמסרו
 * מרצון הם ליד אמיתי; פרטים שנסחטו הם 050-0000000.
 *
 * ## למה העמוד ניתן להטמעה
 *
 * כל שאר המערכת חסומה להטמעה (`frame-ancestors 'none'`), והנתיב
 * הזה בלבד פתוח — ראו `middleware.ts` ו-`next.config.ts`. אין בו
 * שום פעולה בשם משתמש מחובר: רק טופס של מבקר על הנתונים של עצמו,
 * ולכן הטמעה באתר זר אינה פותחת דרך לגרום למתווך ללחוץ על משהו.
 */

const ROOMS = [2, 3, 3.5, 4, 4.5, 5, 6] as const;

const TYPES: [PropertyType, string][] = [
  ["apartment", "דירה"],
  ["garden_apartment", "דירת גן"],
  ["penthouse", "פנטהאוז / דירת גג"],
  ["private_house", "בית פרטי / קוטג'"],
];

export default function ValueWidgetPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [officeName, setOfficeName] = useState<string | null>(null);
  const [unknownKey, setUnknownKey] = useState(false);

  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("apartment");
  const [rooms, setRooms] = useState<number>(4);
  const [area, setArea] = useState("");
  const [result, setResult] = useState<MarketPublicEstimateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [sent, setSent] = useState(false);

  useEffect(() => {
    apiGet<{ officeName: string }>(`/public/market/${encodeURIComponent(key)}`)
      .then((r) => setOfficeName(r.officeName))
      .catch(() => setUnknownKey(true));
  }, [key]);

  const areaValue = (): number | undefined => {
    const n = Number(area.trim());
    return area.trim() !== "" && Number.isInteger(n) && n >= 10 && n <= 2000 ? n : undefined;
  };

  const base = () => ({
    city: city.trim(),
    ...(street.trim() ? { street: street.trim() } : {}),
    ...(houseNumber.trim() ? { houseNumber: houseNumber.trim() } : {}),
    propertyType,
    rooms,
    ...(areaValue() === undefined ? {} : { areaSqm: areaValue() }),
  });

  const estimate = async () => {
    if (city.trim().length < 2) {
      setError("נא לכתוב את שם היישוב");
      return;
    }
    if (area.trim() !== "" && areaValue() === undefined) {
      setError('השטח הוא מספר שלם במ"ר, בין 10 ל-2000');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await apiPost<MarketPublicEstimateDto>(`/public/market/${encodeURIComponent(key)}/estimate`, base()));
    } catch (err: unknown) {
      setError(err instanceof ApiError && err.status === 429 ? "יותר מדי בקשות — נסו שוב בעוד דקה" : "לא הצלחנו לחשב כרגע. נסו שוב.");
    } finally {
      setBusy(false);
    }
  };

  const leaveDetails = async () => {
    if (name.trim().length < 2 || phone.trim().length < 9) {
      setError("נא למלא שם וטלפון");
      return;
    }
    if (!consent) {
      setError("כדי שנחזור אליכם צריך לסמן את האישור");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost<MarketPublicEstimateDto>(`/public/market/${encodeURIComponent(key)}/estimate`, {
        ...base(),
        name: name.trim(),
        phone: phone.trim(),
        consent: true,
        ...(website ? { website } : {}),
      });
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השליחה נכשלה. נסו שוב.");
    } finally {
      setBusy(false);
    }
  };

  if (unknownKey) {
    return (
      <div className="mx-auto max-w-xl py-8">
        <Notice tone="danger">הטופס אינו פעיל. פנו למשרד ישירות.</Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl py-4">
      {officeName ? (
        <p className="m-0 mb-3 text-center font-bold" style={{ color: "var(--color-primary)" }}>
          {officeName}
        </p>
      ) : null}
      <div className="rounded-2xl border p-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h1 className="m-0 text-2xl font-bold">כמה שווה הדירה שלי?</h1>
        <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
          לפי עסקאות מכר אמיתיות שדווחו לרשות המסים, של דירות דומות באזור.
        </p>

        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void estimate();
          }}
          aria-describedby={error ? "value-error" : undefined}
        >
          <label className="flex flex-col gap-1" htmlFor="v-city">
            <span className="font-semibold">יישוב</span>
            <input id="v-city" className="mv-input" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} required />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1" htmlFor="v-street">
              <span className="font-semibold">רחוב (לא חובה)</span>
              <input id="v-street" className="mv-input" autoComplete="address-line1" value={street} onChange={(e) => setStreet(e.target.value)} />
            </label>
            <label className="flex w-28 flex-col gap-1" htmlFor="v-number">
              <span className="font-semibold">מספר</span>
              <input id="v-number" className="mv-input" inputMode="numeric" value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1" htmlFor="v-type">
            <span className="font-semibold">סוג הנכס</span>
            <select id="v-type" className="mv-input" value={propertyType} onChange={(e) => setPropertyType(e.target.value as PropertyType)}>
              {TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 font-semibold">מספר חדרים</legend>
            <div className="flex flex-wrap gap-2">
              {ROOMS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="mv-chip"
                  aria-pressed={rooms === r}
                  onClick={() => setRooms(r)}
                  style={{
                    borderColor: rooms === r ? "var(--color-primary)" : "var(--color-input-border)",
                    background: rooms === r ? "var(--color-primary)" : "var(--color-surface)",
                    color: rooms === r ? "var(--color-surface)" : "var(--color-text)",
                  }}
                >
                  {r === 6 ? "6+" : r}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1" htmlFor="v-area">
            <span className="font-semibold">שטח במ&quot;ר (לא חובה, אבל מדייק מאוד)</span>
            <input id="v-area" className="mv-input" inputMode="numeric" value={area} onChange={(e) => setArea(e.target.value)} />
          </label>
          {error && !result ? (
            <Notice tone="danger" id="value-error">
              {error}
            </Notice>
          ) : null}
          <button type="submit" className="mv-btn-primary" disabled={busy}>
            {busy && !result ? "מחשב…" : "חשבו לי"}
          </button>
        </form>

        <div aria-live="polite">
          {result ? (
            <section className="mt-6 border-t pt-5" style={{ borderColor: "var(--color-border)" }} aria-labelledby="v-result">
              {result.estimate ? (
                <>
                  <h2 id="v-result" className="m-0 text-lg font-bold">
                    דירות דומות נמכרו ב-{ils(result.estimate.low)} עד {ils(result.estimate.high)}
                  </h2>
                  <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
                    לפי {result.sampleSize} עסקאות{result.settlement ? ` ב${result.settlement}` : ""}. מחיר
                    בפועל תלוי בקומה, במצב הדירה ובמה שסביבה — שם מתווך עושה את ההבדל.
                  </p>
                </>
              ) : (
                <h2 id="v-result" className="m-0 text-lg font-bold">
                  {result.settlement ? "אין מספיק עסקאות דומות להצגת טווח" : "לא מצאנו את היישוב במאגר העסקאות"}
                </h2>
              )}

              {sent ? (
                <Notice tone="success" className="mt-4">
                  תודה! נחזור אליכם בהקדם עם הערכה מפורטת.
                </Notice>
              ) : (
                <form
                  className="mt-5 flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void leaveDetails();
                  }}
                  aria-describedby={error ? "value-contact-error" : undefined}
                >
                  <p className="m-0 font-semibold">רוצים הערכה מדויקת ממתווך? השאירו פרטים:</p>
                  <label className="flex flex-col gap-1" htmlFor="v-name">
                    <span>שם</span>
                    <input id="v-name" className="mv-input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1" htmlFor="v-phone">
                    <span>טלפון</span>
                    <input id="v-phone" className="mv-input" type="tel" autoComplete="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </label>
                  {/* מלכודת לבוטים — מוסתרת מבני אדם ומקוראי מסך */}
                  <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="mv-visually-hidden"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                  <label className="flex items-start gap-2" htmlFor="v-consent">
                    <input id="v-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <span>אני מאשר/ת שהמשרד{officeName ? ` ${officeName}` : ""} ייצור איתי קשר בנוגע לנכס.</span>
                  </label>
                  {error ? (
                    <Notice tone="danger" id="value-contact-error">
                      {error}
                    </Notice>
                  ) : null}
                  <button type="submit" className="mv-btn-action" disabled={busy}>
                    {busy ? "שולח…" : "שלחו לי הערכה מפורטת"}
                  </button>
                </form>
              )}
              <p className="m-0 mt-4" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption)" }}>
                {result.attribution}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
