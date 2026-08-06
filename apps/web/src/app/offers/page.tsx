"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * מסך ההצעות לפי קובץ העיצוב: טבלת grid — קונה / נכס / נשלחה /
 * פתיחות / סטטוס / צפייה בדף. הצעה שנפתחה שוב ושוב בלי מענה מקבלת
 * רקע חם, ולמטה תיבת "שווה טלפון" עם הקונה המתלבט הבולט ביותר.
 */

interface OfferRow {
  id: string;
  status: string;
  title: string;
  priceAgorot?: number;
  score?: number;
  buyerName: string | null;
  openCount: number;
  sentAt?: string;
  firstOpenedAt?: string;
  url: string;
  createdAt: string;
}

const FILTERS: [string, string][] = [
  ["", "הכול"],
  ["sent", "נשלחו"],
  ["opened", "נפתחו"],
  ["interested", "מעוניינים"],
  ["declined", "נדחו"],
];

/* גלולות הסטטוס — הכללים מקובץ העיצוב (stChip) */
function statusChip(o: OfferRow): { label: string; fg: string; bg: string } {
  if (o.status === "interested") return { label: "מעוניין ✓", fg: "#0C6E34", bg: "#E5FCEA" };
  if (o.status === "declined") return { label: "לא מתאים", fg: "#68716a", bg: "#eef1ec" };
  if (o.status === "pending_approval") return { label: "ממתין לאישור", fg: "#68716a", bg: "#eef1ec" };
  if (o.openCount >= 3) return { label: "מתלבט — שווה טלפון", fg: "#7a5c1f", bg: "#f7efdd" };
  if (o.openCount > 0) return { label: "נפתחה", fg: "#3F4742", bg: "#EDEFED" };
  return { label: "נשלחה", fg: "#68716a", bg: "#eef1ec" };
}

/** קונה שמתלבט: פתח שוב ושוב ולא ענה. */
function isMulling(o: OfferRow): boolean {
  return o.openCount >= 3 && o.status !== "interested" && o.status !== "declined";
}

const GRID = "1.3fr 1.6fr 1fr 1fr 1.4fr 0.8fr";

export default function OffersPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<OfferRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    const query = status ? `?status=${status}` : "";
    apiGet<OfferRow[]>(`/offers${query}`)
      .then(setItems)
      .catch(() => setError("טעינת ההצעות נכשלה"));
  }, [authLoading, status]);

  const mulling = useMemo(
    () => (items ?? []).filter(isMulling).sort((a, b) => b.openCount - a.openCount)[0],
    [items],
  );

  return (
    <>
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          כל הצעה נשלחת כקישור לדף נכס נקי. רואים מתי נפתחה, כמה פעמים, ומה הקונה ענה —
          בלי אפליקציה ובלי הרשמה.
        </p>
        <div className="ms-auto flex flex-wrap gap-2">
          {FILTERS.map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              className="mv-chip"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : items === null ? (
        <p aria-live="polite">טוען הצעות…</p>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-2 text-lg font-semibold">אין הצעות להצגה</p>
          <p style={{ color: "var(--color-text-muted)" }}>
            הצעות נשלחות ממסך <Link href="/matches" className="underline">ההתאמות</Link> או
            מכרטיס הנכס.
          </p>
        </div>
      ) : (
        <>
          {/* מובייל: כרטיסים (docs/06 §1.5) */}
          <ul className="flex flex-col gap-3 sm:hidden">
            {items.map((offer) => {
              const chip = statusChip(offer);
              return (
                <li
                  key={offer.id}
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: "var(--color-border)",
                    background: isMulling(offer) ? "#fdfaf3" : "var(--color-surface)",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{offer.buyerName ?? "קונה של סוכן אחר"}</span>
                    <span className="mv-pill ms-auto" style={{ color: chip.fg, background: chip.bg }}>
                      {chip.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm" style={{ color: "var(--color-text-soft)" }}>
                    {offer.title}
                  </p>
                  <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {offer.sentAt ? `נשלחה ${formatDate(offer.sentAt)} · ` : ""}
                    {offer.openCount === 0 ? "טרם נפתחה" : `נפתחה ${offer.openCount} פעמים`}
                  </p>
                  <a href={offer.url} target="_blank" rel="noopener noreferrer" className="mv-btn-plain mt-2 inline-block" style={{ color: "var(--color-primary)" }}>
                    צפה בדף
                  </a>
                </li>
              );
            })}
          </ul>

          {/* שולחני: טבלת ה-grid מהעיצוב */}
          <div className="mv-list-card hidden sm:block">
            <div className="mv-list-head" style={{ gridTemplateColumns: GRID }}>
              <span>קונה</span>
              <span>נכס</span>
              <span>נשלחה</span>
              <span>פתיחות</span>
              <span>סטטוס</span>
              <span />
            </div>
            {items.map((offer) => {
              const chip = statusChip(offer);
              return (
                <div
                  key={offer.id}
                  className={`mv-list-row${isMulling(offer) ? " mv-list-row--highlight" : ""}`}
                  style={{ gridTemplateColumns: GRID }}
                >
                  <span className="truncate text-[14.5px] font-bold">
                    {offer.buyerName ?? "קונה של סוכן אחר"}
                  </span>
                  <span className="truncate text-[13.5px]" style={{ color: "var(--color-text-soft)" }}>
                    {offer.title}
                  </span>
                  <span className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                    {offer.sentAt ? formatDate(offer.sentAt) : "—"}
                  </span>
                  <span
                    className="text-[13.5px] font-extrabold"
                    style={{ color: isMulling(offer) ? "var(--color-danger)" : "var(--color-text-soft)" }}
                  >
                    {offer.openCount === 0 ? "טרם נפתחה" : `נפתחה ${offer.openCount} פעמים`}
                  </span>
                  <span>
                    <span className="mv-pill" style={{ color: chip.fg, background: chip.bg, fontSize: "12.5px" }}>
                      {chip.label}
                    </span>
                  </span>
                  <a
                    href={offer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mv-btn-plain justify-self-start"
                    style={{ color: "var(--color-primary)" }}
                  >
                    צפה בדף
                  </a>
                </div>
              );
            })}
          </div>

          {/* תיבת "שווה טלפון" — הקונה המתלבט הבולט ביותר, כמו בעיצוב */}
          {mulling !== undefined ? (
            <div
              className="mt-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border px-[18px] py-[13px]"
              style={{ background: "#fdf8ef", borderColor: "#ecdfc2" }}
            >
              <span className="text-[13.5px]" style={{ color: "#7a5c1f" }}>
                <b>{mulling.buyerName ?? "קונה"}</b> פתח את ההצעה ל{mulling.title}{" "}
                {mulling.openCount} פעמים ולא ענה — סימן שהוא מתלבט. שווה טלפון עכשיו.
              </span>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
