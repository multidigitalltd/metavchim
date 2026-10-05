"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  MARKET_COMP_SCOPE_LABELS,
  type PropertyMarketDto,
} from "@metavchim/shared";
import { ApiError, apiGet, api } from "@/lib/api";
import { IconPrinter, IconTarget } from "../../icons";
import { LoadError } from "../../load-error";
import { Notice } from "../../notice";
import { DealsTable, FreshnessNote, MarketAttribution, PositionPill, ils, ppsqm } from "../../market/market-parts";

/**
 * ‎**„מחיר ושוק” — הנכס מול עסקאות אמת** (docs/18 §3, יכולות 1–3).
 *
 * שלוש שאלות, בסדר שבו המתווך שואל אותן מול בעלים: כמה הנכס שווה
 * (טווח, ובכמה עסקאות), האם המחיר המבוקש סביר, ומה נמכר בבניין הזה
 * עצמו — ואם יש תת-חלקה, במה הבעלים קנה את הדירה.
 *
 * ‎**טווח ולא מספר**, ותמיד עם מספר העסקאות והיקף ההשוואה. מתווך
 * שמציג לבעלים „1.84 מיליון” בלי „לפי 9 עסקאות באותו גוש” מציג
 * שמאות שאין לו, ומספר שאינו יכול להגן עליו.
 */

function parseOptionalInt(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^\d{1,6}$/u.test(trimmed) ? Number(trimmed) : "invalid";
}

function ParcelEditor({
  data,
  propertyId,
  canEdit,
  onSaved,
}: {
  data: PropertyMarketDto;
  propertyId: string;
  canEdit: boolean;
  onSaved: (next: PropertyMarketDto) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [gush, setGush] = useState("");
  const [helka, setHelka] = useState("");
  const [sub, setSub] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const open = () => {
    setGush(data.parcel ? String(data.parcel.gush) : "");
    setHelka(data.parcel ? String(data.parcel.helka) : "");
    setSub(data.parcel?.subParcel !== null && data.parcel?.subParcel !== undefined ? String(data.parcel.subParcel) : "");
    setError(null);
    setEditing(true);
  };

  const save = async (clear: boolean) => {
    const g = parseOptionalInt(gush);
    const h = parseOptionalInt(helka);
    const s = parseOptionalInt(sub);
    if (!clear && (g === null || g === "invalid" || h === null || h === "invalid" || s === "invalid")) {
      setError("גוש וחלקה הם מספרים שלמים, ושניהם נדרשים. תת-חלקה — אם ידועה.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await api<PropertyMarketDto>(`/market/properties/${propertyId}/parcel`, {
        method: "PUT",
        body: JSON.stringify({
          parcel: clear ? null : { gush: g as number, helka: h as number, subParcel: s === null ? null : (s as number) },
        }),
      });
      onSaved(next);
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const sourceLabel =
    data.parcel?.source === "lookup" ? "נגזר מהמיקום על המפה" : data.parcel?.source ? "הוקלד בכרטיס" : null;

  return (
    <section className="mv-card mv-card--pad" aria-labelledby="parcel-heading">
      <div className="mv-card-head">
        <h3 id="parcel-heading" className="mv-card-head__title m-0">גוש, חלקה ותת-חלקה</h3>
      </div>
      {!editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0">
            {data.parcel ? (
              <>
                <span className="font-semibold">
                  גוש {data.parcel.gush} · חלקה {data.parcel.helka}
                  {data.parcel.subParcel !== null ? ` · תת-חלקה ${data.parcel.subParcel}` : ""}
                </span>
                {sourceLabel ? <span style={{ color: "var(--color-text-muted)" }}> — {sourceLabel}</span> : null}
              </>
            ) : (
              <span style={{ color: "var(--color-text-muted)" }}>
                עוד לא ידוע. אם לנכס יש מיקום על המפה, המערכת תמצא לבד את הגוש והחלקה בתוך כשעה. אפשר גם להזין אותם מנסח הטאבו.
              </span>
            )}
          </p>
          {canEdit ? (
            <button type="button" className="mv-btn-plain" onClick={open}>
              {data.parcel ? "עריכה" : "הזנה מנסח טאבו"}
            </button>
          ) : null}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
          aria-describedby={error ? "parcel-error" : undefined}
        >
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["parcel-gush", "גוש", gush, setGush],
                ["parcel-helka", "חלקה", helka, setHelka],
                ["parcel-sub", "תת-חלקה (לא חובה)", sub, setSub],
              ] as const
            ).map(([id, label, value, set]) => (
              <label key={id} htmlFor={id} className="flex flex-col gap-1">
                <span className="font-medium">{label}</span>
                <input
                  id={id}
                  className="mv-input"
                  inputMode="numeric"
                  autoComplete="off"
                  value={value}
                  onChange={(event) => set(event.target.value)}
                  style={{ width: 140 }}
                />
              </label>
            ))}
          </div>
          <p className="m-0 mt-2" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption-lg)" }}>
            תת-החלקה היא מה שמזהה את הדירה עצמה — איתה מוצג גם המחיר שבו הבעלים קנו.
          </p>
          {error ? (
            <Notice tone="danger" id="parcel-error" className="mt-2">
              {error}
            </Notice>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className="mv-btn-primary" disabled={saving}>
              {saving ? "שומר…" : "שמירה"}
            </button>
            <button type="button" className="mv-btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
              ביטול
            </button>
            {data.parcel ? (
              <button type="button" className="mv-btn-plain" onClick={() => void save(true)} disabled={saving}>
                ניתוק — לגזור שוב מהמיקום
              </button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}

export function PropertyMarket({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const [data, setData] = useState<PropertyMarketDto | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<PropertyMarketDto>(`/market/properties/${propertyId}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [propertyId]);

  useEffect(load, [load]);

  if (failed) return <LoadError message="לא הצלחנו לטעון את נתוני השוק" onRetry={load} />;
  if (!data) return <p aria-live="polite">טוען עסקאות…</p>;

  const comparison = data.comparison;
  const estimate = comparison?.estimate ?? null;

  return (
    <div className="flex flex-col gap-[18px]">
      <section className="mv-card mv-card--pad" aria-labelledby="market-value-heading">
        <div className="mv-card-head">
          <IconTarget s={18} />
          <h3 id="market-value-heading" className="mv-card-head__title m-0">מחיר מול השוק</h3>
          {estimate ? (
            <Link href={`/properties/${propertyId}/market-report`} className="mv-card-head__link inline-flex items-center gap-1">
              <IconPrinter s={16} /> דו&quot;ח מחיר לבעלים
            </Link>
          ) : null}
        </div>

        {!data.comparable ? (
          <p className="m-0">נכס להשכרה — מאגר רשות המסים כולל עסקאות מכר בלבד, ולכן אין כאן השוואת מחיר.</p>
        ) : !data.settlement ? (
          <p className="m-0">
            העיר של הנכס לא נמצאה במאגר העסקאות. בדקו שהעיר בכרטיס כתובה כפי שהיא נקראת רשמית.
          </p>
        ) : estimate && comparison ? (
          <>
            <p className="m-0" style={{ fontSize: "var(--type-body)" }}>
              <span style={{ color: "var(--color-text-muted)" }}>טווח עסקאות דומות: </span>
              <span className="font-bold">
                {ils(estimate.low)} – {ils(estimate.high)}
              </span>
              <span style={{ color: "var(--color-text-muted)" }}> · חציון </span>
              <span className="font-bold">{ils(estimate.mid)}</span>
            </p>
            <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption-lg)" }}>
              לפי {comparison.sampleSize} עסקאות{" "}
              {comparison.scope ? MARKET_COMP_SCOPE_LABELS[comparison.scope] : ""}
              {comparison.months ? ` ב-${comparison.months} החודשים האחרונים` : ""}
              {comparison.matchedOn.rooms || comparison.matchedOn.area
                ? `, בגודל דומה (${[comparison.matchedOn.rooms ? "חדרים" : null, comparison.matchedOn.area ? "שטח" : null].filter(Boolean).join(" ו")})`
                : ""}
              {estimate.basis === "ppsqm" && estimate.medianPpsqm !== null
                ? `; חציון ${ppsqm(estimate.medianPpsqm)} למ"ר כפול שטח הנכס`
                : ""}
              .
            </p>
            {data.position ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <PositionPill position={data.position} />
                {data.positionSentence ? <span>{data.positionSentence}</span> : null}
              </div>
            ) : (
              <p className="m-0 mt-3" style={{ color: "var(--color-text-muted)" }}>
                הזינו מחיר מבוקש בכרטיס כדי לראות אותו מול הטווח.
              </p>
            )}
          </>
        ) : (
          <p className="m-0">
            אין מספיק עסקאות דומות ({comparison?.sampleSize ?? 0} מתוך 5 הנדרשות) — גם אחרי הרחבה ליישוב כולו.
            {comparison && !comparison.matchedOn.area ? " הוספת שטח לנכס יכולה לחדד את ההשוואה." : ""}
          </p>
        )}
        <div className="mt-3">
          <FreshnessNote freshness={data.freshness} />
        </div>
      </section>

      <ParcelEditor data={data} propertyId={propertyId} canEdit={canEdit} onSaved={setData} />

      {data.apartment.length > 0 ? (
        <section className="mv-card mv-card--pad" aria-labelledby="apartment-history-heading">
          <div className="mv-card-head">
            <h3 id="apartment-history-heading" className="mv-card-head__title m-0">היסטוריית הדירה עצמה</h3>
          </div>
          <DealsTable deals={data.apartment} caption="עסקאות קודמות בדירה הזו (אותה תת-חלקה)" />
        </section>
      ) : null}

      {data.parcel ? (
        <section className="mv-card mv-card--pad" aria-labelledby="building-heading">
          <div className="mv-card-head">
            <h3 id="building-heading" className="mv-card-head__title m-0">עסקאות בבניין</h3>
            {data.building.total > data.building.deals.length ? (
              <Link href={`/forum?tab=market&view=building&gush=${data.parcel.gush}&helka=${data.parcel.helka}`} className="mv-card-head__link">
                כל {data.building.total} העסקאות
              </Link>
            ) : null}
          </div>
          <DealsTable
            deals={data.building.deals}
            caption={`עסקאות בגוש ${data.parcel.gush} חלקה ${data.parcel.helka}`}
            emptyText="לא נמצאו עסקאות בחלקה הזו במאגר."
          />
        </section>
      ) : null}

      {comparison && comparison.comps.length > 0 ? (
        <section className="mv-card mv-card--pad" aria-labelledby="comps-heading">
          <div className="mv-card-head">
            <h3 id="comps-heading" className="mv-card-head__title m-0">העסקאות הדומות</h3>
          </div>
          <DealsTable deals={comparison.comps} caption="העסקאות הדומות שעליהן נשען הטווח" showParcel />
        </section>
      ) : null}

      <MarketAttribution text={data.attribution} />
    </div>
  );
}
