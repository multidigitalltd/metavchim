"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MARKET_COMP_SCOPE_LABELS,
  propertyTypeToNatureGroup,
  type MarketOverviewDto,
  type PropertyMarketDto,
  type PropertyType,
} from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { formatDate, formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { IconCopy, IconPrinter } from "../../../icons";
import { LoadError } from "../../../load-error";
import { DealsTable, PositionPill, ils, pct, ppsqm } from "../../../market/market-parts";

/**
 * ‎**דו"ח מחיר לבעלים** (docs/18 §3, יכולת 3).
 *
 * הכלי לשיחת הבלעדיות: הבעלים רואה במה נמכרו דירות כמו שלו, ולא רק
 * שומע את הדעה של המתווך. המסמך נבנה כאן ו**המתווך מחליט מה נכנס
 * ומה יוצא** — עיקרון-על 8: המערכת מנסחת, המתווך שולח. אין כפתור
 * „שלח לבעלים”: הדפסה, שמירה כ-PDF או העתקת סיכום לוואטסאפ, וכל אחד
 * מהם הוא החלטה של אדם.
 *
 * ‎**היסטוריית הדירה עצמה כבויה כברירת מחדל.** המחיר שבו הבעלים קנו
 * הוא מידע שהם מכירים טוב מכולם, והצגתו בדו"ח שהם מקבלים היא בחירה
 * מקצועית — לפעמים נכונה, לפעמים פוגענית. המתווך מדליק אותה במודע.
 */

interface PropertyHead {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: PropertyType;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  priceAgorot?: number;
  marketingTitle?: string;
}

type SectionKey = "position" | "comps" | "building" | "apartment" | "trend";

const SECTIONS: { key: SectionKey; label: string; initial: boolean }[] = [
  { key: "position", label: "המחיר המבוקש מול הטווח", initial: true },
  { key: "comps", label: "העסקאות הדומות", initial: true },
  { key: "building", label: "עסקאות בבניין", initial: true },
  { key: "apartment", label: "היסטוריית הדירה עצמה (כולל מחיר הקנייה)", initial: false },
  { key: "trend", label: "מגמת המחירים ביישוב", initial: true },
];

function addressOf(p: PropertyHead): string {
  const street = [p.street, p.houseNumber].filter(Boolean).join(" ");
  return [street, p.neighborhood, p.city].filter(Boolean).join(", ") || "הנכס";
}

export default function MarketReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  const [property, setProperty] = useState<PropertyHead | null>(null);
  const [market, setMarket] = useState<PropertyMarketDto | null>(null);
  const [trend, setTrend] = useState<MarketOverviewDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState<Record<SectionKey, boolean>>(
    () => Object.fromEntries(SECTIONS.map((s) => [s.key, s.initial])) as Record<SectionKey, boolean>,
  );
  const { state: copyState, copy } = useCopy();

  useEffect(() => {
    if (authLoading) return;
    setFailed(false);
    Promise.all([
      apiGet<PropertyHead>(`/properties/${id}`),
      apiGet<PropertyMarketDto>(`/market/properties/${id}`),
    ])
      .then(([p, m]) => {
        setProperty(p);
        setMarket(m);
        if (m.settlement) {
          const group = propertyTypeToNatureGroup(p.propertyType ?? null);
          return apiGet<MarketOverviewDto>(`/market/overview?settlementId=${m.settlement.id}&group=${group}`).then(setTrend);
        }
        return undefined;
      })
      .catch(() => setFailed(true));
  }, [authLoading, id]);

  const recentYears = useMemo(() => (trend ? trend.yearly.filter((y) => !y.partial).slice(-6) : []), [trend]);

  if (failed) return <LoadError message="לא הצלחנו להכין את הדו״ח" />;
  if (!property || !market) return <p aria-live="polite">מכין את הדו״ח…</p>;

  const comparison = market.comparison;
  const estimate = comparison?.estimate ?? null;
  const today = formatDate(new Date());

  const summary = estimate && comparison
    ? [
        `${addressOf(property)} — לפי ${comparison.sampleSize} עסקאות דומות ${comparison.scope ? MARKET_COMP_SCOPE_LABELS[comparison.scope] : ""}${comparison.months ? ` ב-${comparison.months} החודשים האחרונים` : ""}:`,
        `טווח ${ils(estimate.low)} – ${ils(estimate.high)}, חציון ${ils(estimate.mid)}.`,
        market.positionSentence ?? "",
        "מקור: עסקאות מיסוי מקרקעין של רשות המסים.",
        user?.tenantName ? `— ${user.name}, ${user.tenantName}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    <div className="mx-auto max-w-4xl py-6">
      {/* סרגל הבחירה — אינו חלק מהדו״ח ונעלם בהדפסה */}
      <div className="mb-5 flex flex-col gap-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 text-xl font-bold">דו״ח מחיר לבעלים</h1>
          <div className="flex flex-wrap gap-2">
            <Link href={`/properties/${id}?tab=market`} className="mv-btn-ghost no-underline">
              חזרה לנכס
            </Link>
            {summary ? (
              <button type="button" className="mv-btn-ghost inline-flex items-center gap-1" onClick={() => void copy(summary, "summary")}>
                <IconCopy s={15} /> {copyState === "copied" ? "הועתק" : "העתקת סיכום לוואטסאפ"}
              </button>
            ) : null}
            <button type="button" className="mv-btn-primary inline-flex items-center gap-1" onClick={() => window.print()}>
              <IconPrinter s={15} /> הדפסה / שמירה כ-PDF
            </button>
          </div>
        </div>
        <fieldset className="mv-card mv-card--pad m-0">
          <legend className="font-semibold">מה ייכנס לדו״ח</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SECTIONS.map((section) => (
              <label key={section.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={shown[section.key]}
                  onChange={(event) => setShown((prev) => ({ ...prev, [section.key]: event.target.checked }))}
                />
                {section.label}
              </label>
            ))}
          </div>
          <label htmlFor="report-note" className="mt-3 block font-semibold">
            מילה אישית לבעלים (לא חובה)
          </label>
          <textarea
            id="report-note"
            className="mv-input mt-1 w-full"
            rows={3}
            maxLength={600}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </fieldset>
      </div>

      <article
        className="rounded-xl border p-6 print:border-0 print:p-0"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        aria-label="דו״ח המחיר"
      >
        <header className="mb-5 border-b pb-4" style={{ borderColor: "var(--color-border)" }}>
          <p className="m-0 text-lg font-bold">{user?.tenantName ?? ""}</p>
          <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
            {user?.name} · {today}
          </p>
          <h2 className="m-0 mt-3 text-2xl font-bold">{addressOf(property)}</h2>
          <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
            {[
              property.rooms !== undefined ? `${property.rooms} חדרים` : null,
              property.areaSqm !== undefined ? `${property.areaSqm} מ"ר` : null,
              property.floor !== undefined ? `קומה ${property.floor}` : null,
              market.parcel ? `גוש ${market.parcel.gush} חלקה ${market.parcel.helka}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </header>

        {note.trim() !== "" ? <p className="mb-5 whitespace-pre-wrap leading-relaxed">{note.trim()}</p> : null}

        <section className="mb-6" aria-labelledby="report-value">
          <h3 id="report-value" className="mb-2 text-lg font-bold">במה נמכרות דירות כמו זו</h3>
          {estimate && comparison ? (
            <>
              <p className="m-0 text-xl">
                <span className="font-bold">
                  {ils(estimate.low)} – {ils(estimate.high)}
                </span>
                <span style={{ color: "var(--color-text-muted)" }}> · חציון {ils(estimate.mid)}</span>
              </p>
              <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
                הטווח הוא הרבעון התחתון עד העליון של {comparison.sampleSize} עסקאות מכר מדווחות{" "}
                {comparison.scope ? MARKET_COMP_SCOPE_LABELS[comparison.scope] : ""}
                {comparison.months ? ` ב-${comparison.months} החודשים האחרונים` : ""}, בגודל דומה.
                {estimate.basis === "ppsqm" && estimate.medianPpsqm !== null
                  ? ` חציון המחיר למ"ר: ${ppsqm(estimate.medianPpsqm)}.`
                  : ""}
              </p>
            </>
          ) : (
            <p className="m-0">אין עדיין מספיק עסקאות דומות כדי להציג טווח מבוסס.</p>
          )}
          {shown.position && market.position && property.priceAgorot !== undefined ? (
            <p className="m-0 mt-3 flex flex-wrap items-center gap-2">
              <span>המחיר המבוקש: {formatPrice(property.priceAgorot)}</span>
              <PositionPill position={market.position} />
            </p>
          ) : null}
        </section>

        {shown.comps && comparison && comparison.comps.length > 0 ? (
          <section className="mb-6" aria-labelledby="report-comps">
            <h3 id="report-comps" className="mb-2 text-lg font-bold">העסקאות הדומות</h3>
            <DealsTable deals={comparison.comps} caption="עסקאות מכר דומות" />
          </section>
        ) : null}

        {shown.building && market.parcel && market.building.deals.length > 0 ? (
          <section className="mb-6" aria-labelledby="report-building">
            <h3 id="report-building" className="mb-2 text-lg font-bold">עסקאות בבניין</h3>
            <DealsTable deals={market.building.deals.slice(0, 15)} caption="עסקאות מכר באותו בניין" />
          </section>
        ) : null}

        {shown.apartment && market.apartment.length > 0 ? (
          <section className="mb-6" aria-labelledby="report-apartment">
            <h3 id="report-apartment" className="mb-2 text-lg font-bold">היסטוריית הדירה</h3>
            <DealsTable deals={market.apartment} caption="עסקאות קודמות בדירה עצמה" />
          </section>
        ) : null}

        {shown.trend && trend && recentYears.length > 1 ? (
          <section className="mb-6" aria-labelledby="report-trend">
            <h3 id="report-trend" className="mb-2 text-lg font-bold">מגמת המחירים ב{trend.scope.settlement}</h3>
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
              <table className="w-full" style={{ fontSize: "var(--type-body-sm)" }}>
                <caption className="mv-visually-hidden">מספר עסקאות ומחיר חציוני לפי שנה</caption>
                <thead style={{ background: "var(--color-table-head)" }}>
                  <tr>
                    <th scope="col" className="p-2 text-start">שנה</th>
                    <th scope="col" className="p-2 text-start">עסקאות</th>
                    <th scope="col" className="p-2 text-start">מחיר חציוני</th>
                    <th scope="col" className="p-2 text-start">חציון למ&quot;ר</th>
                    <th scope="col" className="p-2 text-start">שינוי למ&quot;ר</th>
                  </tr>
                </thead>
                <tbody>
                  {recentYears.map((row, index) => {
                    const prev = recentYears[index - 1];
                    const change =
                      prev?.medianPpsqm && row.medianPpsqm
                        ? Math.round(((row.medianPpsqm - prev.medianPpsqm) / prev.medianPpsqm) * 100)
                        : null;
                    return (
                      <tr key={row.year} className="border-t" style={{ borderColor: "var(--color-row-border)" }}>
                        <th scope="row" className="p-2 text-start font-semibold">{row.year}</th>
                        <td className="p-2">{row.deals}</td>
                        <td className="p-2">{ils(row.medianPrice)}</td>
                        <td className="p-2">{ppsqm(row.medianPpsqm)}</td>
                        <td className="p-2">{index === 0 ? "—" : pct(change)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <footer className="mt-6 border-t pt-3" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)", fontSize: "var(--type-caption)" }}>
          <p className="m-0">{market.attribution}</p>
          <p className="m-0">
            הדו״ח מבוסס על עסקאות מדווחות ואינו שמאות. העסקאות של שלושת החודשים האחרונים עדיין מתעדכנות.
          </p>
        </footer>
      </article>
    </div>
  );
}
