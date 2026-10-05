"use client";

import { useEffect, useState, use } from "react";
import { comparisonRows, fitLabels, type ComparisonProperty, type ComparisonWants } from "@metavchim/shared";
import { API_BASE, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { LogoMark } from "../../icons";
import { Notice } from "../../notice";

/**
 * ‏דף ההשוואה ללקוח — ציבורי, לפי טוקן בלבד (docs/03 — comparisons).
 * ‏עמודה לכל נכס, שורה לכל מדד, והטוב ביותר בכל שורה מודגש. „מעוניין”
 * ‏על נכס מגיע לסוכן; „הדפסה” נותנת PDF מהדפדפן — בלי שרת.
 */

interface PublicComparison {
  agencyName: string;
  wants: ComparisonWants;
  properties: (ComparisonProperty & { available: boolean; images: { url: string; alt?: string }[] })[];
  interested: string[];
}

export default function ComparePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<PublicComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interested, setInterested] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PublicComparison>(`/public/compare/${token}`)
      .then((res) => {
        setData(res);
        setInterested(res.interested);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError && err.status === 410 ? "תוקף הקישור פג — פנו למתווך לקבלת דף עדכני." : "הדף לא נמצא.");
      });
  }, [token]);

  async function markInterested(propertyId: string): Promise<void> {
    setBusy(propertyId);
    try {
      await apiPost(`/public/compare/${token}/interest`, { propertyId });
      setInterested((prev) => [...prev, propertyId]);
    } catch {
      setError("השליחה נכשלה — נסו שוב.");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Notice tone="danger">{error}</Notice>
      </div>
    );
  }
  if (data === null) return <p aria-live="polite" className="py-16 text-center">טוען את ההשוואה…</p>;

  const rows = comparisonRows(data.properties);
  const columns = `minmax(88px, 0.8fr) repeat(${data.properties.length}, minmax(0, 1fr))`;

  return (
    <article className="mx-auto max-w-4xl pb-16">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>השוואת נכסים מ{data.agencyName}</p>
          <h1 className="m-0 text-2xl font-extrabold">
            {data.properties.length === 2 ? "שני נכסים" : `${data.properties.length} נכסים`} זה לצד זה
          </h1>
        </div>
        <button type="button" className="mv-btn-plain mv-no-print" onClick={() => window.print()}>
          הדפסה / שמירה כ-PDF
        </button>
      </header>

      <div className="mv-list-card mv-doc overflow-x-auto p-3 sm:p-5" role="table" aria-label="השוואת נכסים">
        {/* ‏כותרת: תמונה, שם ומיקום לכל נכס */}
        <div role="row" className="grid items-end gap-3" style={{ gridTemplateColumns: columns }}>
          <div role="columnheader" />
          {data.properties.map((p, index) => (
            <div key={p.propertyId} role="columnheader" className="min-w-0">
              {p.images[0] !== undefined ? (
                // img רגיל בכוונה — מוזרם דרך ה-API הציבורי
                <img src={API_BASE + p.images[0].url} alt={p.images[0].alt ?? p.title} className="mb-2 h-28 w-full rounded-lg object-cover" />
              ) : (
                <div className="mb-2 h-28 w-full rounded-lg" style={{ background: "var(--color-progress-track)" }} aria-hidden="true" />
              )}
              <div className="text-[length:var(--type-body)] font-extrabold">{p.title}</div>
              <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {[p.propertyType === undefined ? null : PROPERTY_TYPE_LABELS[p.propertyType] ?? p.propertyType, `נכס ${index + 1}`].filter(Boolean).join(" · ")}
              </div>
              {!p.available ? <span className="mv-pill mv-domain-neutral mt-1">כבר לא זמין</span> : null}
              {fitLabels(p, data.wants).map((label) => (
                <span key={label} className="mv-pill mt-1 ms-1" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>{label}</span>
              ))}
            </div>
          ))}
        </div>

        {rows.map((row) => (
          <div key={row.key} role="row" className="grid items-center gap-3 border-t py-2" style={{ gridTemplateColumns: columns, borderColor: "var(--color-border)" }}>
            <div role="rowheader" className="text-sm font-semibold" style={{ color: "var(--color-text-muted)" }}>{row.label}</div>
            {row.values.map((value, index) => (
              <div
                key={data.properties[index]!.propertyId}
                role="cell"
                className={row.best === index ? "rounded-md px-1.5 py-0.5 font-extrabold" : "font-semibold"}
                style={row.best === index ? { background: "var(--color-success-soft)", color: "var(--color-success)" } : undefined}
                aria-label={row.best === index ? `${value} — הכי טוב בשורה` : undefined}
              >
                {row.key === "price" && data.properties[index]!.priceAgorot !== undefined ? formatPrice(data.properties[index]!.priceAgorot) : value}
              </div>
            ))}
          </div>
        ))}

        {/* ‏מעוניין — לכל נכס בנפרד */}
        <div role="row" className="mv-no-print grid items-center gap-3 border-t pt-3" style={{ gridTemplateColumns: columns, borderColor: "var(--color-border)" }}>
          <div role="rowheader" />
          {data.properties.map((p) => (
            <div key={p.propertyId} role="cell">
              {!p.available ? null : interested.includes(p.propertyId) ? (
                <span className="mv-pill" style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}>✓ סימנתם — המתווך יחזור אליכם</span>
              ) : (
                <button type="button" className="mv-btn-action w-full" disabled={busy !== null} onClick={() => void markInterested(p.propertyId)}>
                  {busy === p.propertyId ? "שולח…" : "מעניין אותי"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-6 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
        <span className="flex items-center justify-center gap-1.5">
          <LogoMark s={16} />
          הדף מופעל על ידי {data.agencyName} · מערכת מתווכים
        </span>
      </p>
    </article>
  );
}
