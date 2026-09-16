"use client";

import { useEffect, useState } from "react";
import { COMPARISON_MAX_PROPERTIES, COMPARISON_MIN_PROPERTIES } from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { formatDate } from "@/lib/format";
import { Notice } from "../../notice";

/**
 * ‏„דף השוואה” בכרטיס הקונה: מסמנים 2–3 נכסים ברשימת ההתאמות, לוחצים
 * ‏פעם אחת, ומקבלים קישור לשליחה בוואטסאפ. מתחת — הדפים שכבר נשלחו,
 * ‏עם כמה פעמים נפתחו ומה הקונה סימן.
 */

interface ComparisonDto {
  id: string;
  url: string;
  createdAt: string;
  openCount: number;
  titles: string[];
  interested: string[];
}

export function ComparisonPanel({
  buyerId,
  selected,
  onClear,
  canSend,
}: {
  buyerId: string;
  selected: { propertyId: string; title: string }[];
  onClear: () => void;
  canSend: boolean;
}) {
  const [rows, setRows] = useState<ComparisonDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signUrl, setSignUrl] = useState<string | null>(null);
  const [latest, setLatest] = useState<ComparisonDto | null>(null);
  const copy = useCopy();

  useEffect(() => {
    apiGet<ComparisonDto[]>(`/buyers/${buyerId}/comparisons`).then(setRows).catch(() => setRows([]));
  }, [buyerId]);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    setSignUrl(null);
    try {
      const created = await apiPost<ComparisonDto>(`/buyers/${buyerId}/comparisons`, { propertyIds: selected.map((s) => s.propertyId) });
      setRows((prev) => [created, ...prev]);
      setLatest(created);
      onClear();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (typeof err.body.signUrl === "string") setSignUrl(err.body.signUrl);
      } else {
        setError("יצירת הדף נכשלה");
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendWhatsApp(row: ComparisonDto): Promise<void> {
    /* ‏החלון נפתח לפני הבקשה — חוסם חלונות קופצים מכבד רק לחיצה ישירה */
    const popup = window.open("", "_blank");
    setBusy(true);
    try {
      const { waUrl } = await apiPost<{ waUrl: string }>(`/comparisons/${row.id}/whatsapp`, {});
      if (popup) popup.location.href = waUrl;
      else window.open(waUrl, "_blank", "noopener");
    } catch (err: unknown) {
      popup?.close();
      setError(err instanceof ApiError ? err.message : "השליחה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (!canSend && rows.length === 0) return null;

  return (
    <section className="mv-card mv-card--pad mt-3" aria-labelledby="compare-heading">
      <h3 id="compare-heading" className="m-0 text-[length:var(--type-body)] font-extrabold">דף השוואה לקונה</h3>
      {canSend ? (
        <p className="m-0 mt-1 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
          מסמנים {COMPARISON_MIN_PROPERTIES}–{COMPARISON_MAX_PROPERTIES} נכסים ברשימה למעלה — הקונה מקבל אותם זה לצד זה, עם כל המספרים, ויכול לסמן מה מעניין אותו.
        </p>
      ) : null}
      {canSend ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {selected.length === 0 ? "לא נבחרו נכסים" : `נבחרו ${selected.length} מתוך ${COMPARISON_MAX_PROPERTIES}: ${selected.map((s) => s.title).join(" · ")}`}
          </span>
          <button type="button" className="mv-btn-action" disabled={busy || selected.length < COMPARISON_MIN_PROPERTIES} onClick={() => void create()}>
            {busy ? "מכין…" : "ליצור דף השוואה"}
          </button>
          {selected.length > 0 ? (
            <button type="button" className="mv-btn-plain" onClick={onClear}>נקה בחירה</button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="mt-2">
          <Notice tone="danger">
            {error}
            {signUrl !== null ? (
              <>
                {" "}
                <a href={signUrl} target="_blank" rel="noreferrer" className="underline">לפתוח את ההסכם לחתימה</a>
              </>
            ) : null}
          </Notice>
        </div>
      ) : null}
      {latest !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="status">
          <span className="font-semibold">הדף מוכן:</span>
          <a href={latest.url} target="_blank" rel="noreferrer" className="mv-ltr break-all underline">{latest.url}</a>
          <button type="button" className="mv-btn-plain" onClick={() => void copy.copy(latest.url, latest.id)}>
            {copy.state === "copied" && copy.key === latest.id ? "✓ הועתק" : "העתק קישור"}
          </button>
          <button type="button" className="mv-btn-soft" disabled={busy} onClick={() => void sendWhatsApp(latest)}>לשלוח בוואטסאפ</button>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ol className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0" aria-label="דפי השוואה שנשלחו">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--type-caption-lg)]">
              <span style={{ color: "var(--color-text-muted)" }}>{formatDate(row.createdAt)}</span>
              <span className="font-semibold">{row.titles.join(" · ")}</span>
              <span style={{ color: "var(--color-text-muted)" }}>{row.openCount === 0 ? "טרם נפתח" : `נפתח ${row.openCount === 1 ? "פעם אחת" : `${row.openCount} פעמים`}`}</span>
              {row.interested.length > 0 ? (
                <span className="mv-pill" style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}>
                  מעוניין ב-{row.interested.length === 1 ? "נכס אחד" : `${row.interested.length} נכסים`}
                </span>
              ) : null}
              <a href={row.url} target="_blank" rel="noreferrer" className="mv-btn-plain">פתח</a>
              {canSend ? (
                <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void sendWhatsApp(row)}>וואטסאפ</button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
