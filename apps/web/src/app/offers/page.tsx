"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { FilterBar, SearchField, textMatches } from "../list-controls";
import { Notice } from "../notice";

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
  if (o.status === "declined") return { label: "לא מתאים", fg: "#616a63", bg: "#eef1ec" };
  if (o.status === "pending_approval") return { label: "ממתין לאישור", fg: "#616a63", bg: "#eef1ec" };
  if (o.openCount >= 3) return { label: "מתלבט — שווה טלפון", fg: "#7a5c1f", bg: "#f7efdd" };
  if (o.openCount > 0) return { label: "נפתחה", fg: "#3F4742", bg: "#EDEFED" };
  return { label: "נשלחה", fg: "#616a63", bg: "#eef1ec" };
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
  const [query, setQuery] = useState("");
  const [openness, setOpenness] = useState("");
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

  /* סינון מקומי מעל הסינון בשרת: חיפוש חופשי בשם הקונה ובנכס,
     ומצב פתיחות — "מי לא פתח בכלל" הוא השאלה שהמתווך שואל בפועל */
  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (o) =>
          textMatches(query, o.buyerName ?? undefined, o.title) &&
          (openness === "" ||
            (openness === "unopened" && o.openCount === 0) ||
            (openness === "opened" && o.openCount > 0) ||
            (openness === "mulling" && isMulling(o))),
      ),
    [items, query, openness],
  );
  const filtering = query.trim() !== "" || openness !== "" || status !== "";

  return (
    <>
      {/* כותרת ולא הרצאה: „כל הצעה נשלחת כקישור לדף נכס נקי…” הוא
          טקסט שיווקי שנקרא פעם אחת ואז תופס מקום לנצח */}
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <h1 className="m-0" style={{ fontSize: 22, fontWeight: 800 }}>
          הצעות
        </h1>
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

      {items !== null && items.length > 0 ? (
        <FilterBar
          shown={visible.length}
          total={items.length}
          noun="הצעות"
          active={filtering}
          onClear={() => {
            setQuery("");
            setOpenness("");
            setStatus("");
          }}
        >
          <SearchField
            label="חיפוש הצעה"
            placeholder="שם קונה או נכס"
            value={query}
            onChange={setQuery}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <span className="mv-visually-hidden">סינון לפי פתיחות</span>
            <select
              value={openness}
              onChange={(e) => setOpenness(e.target.value)}
              className="rounded-lg border px-2 py-1.5"
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
            >
              <option value="">כל מצבי הפתיחה</option>
              <option value="unopened">טרם נפתחו</option>
              <option value="opened">נפתחו</option>
              <option value="mulling">מתלבטים (3+ פתיחות)</option>
            </select>
          </label>
        </FilterBar>
      ) : null}

      {error ? (
        <Notice tone="danger">{error}</Notice>
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
            {visible.map((offer) => {
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
            {visible.map((offer) => {
              const chip = statusChip(offer);
              return (
                <div
                  key={offer.id}
                  className={`mv-list-row${isMulling(offer) ? " mv-list-row--highlight" : ""}`}
                  style={{ gridTemplateColumns: GRID }}
                >
                  <span className="truncate text-[length:var(--type-body)] font-bold">
                    {offer.buyerName ?? "קונה של סוכן אחר"}
                  </span>
                  <span className="truncate text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-soft)" }}>
                    {offer.title}
                  </span>
                  <span className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                    {offer.sentAt ? formatDate(offer.sentAt) : "—"}
                  </span>
                  <span
                    className="text-[length:var(--type-body-sm)] font-extrabold"
                    style={{ color: isMulling(offer) ? "var(--color-danger)" : "var(--color-text-soft)" }}
                  >
                    {offer.openCount === 0 ? "טרם נפתחה" : `נפתחה ${offer.openCount} פעמים`}
                  </span>
                  <span>
                    <span className="mv-pill" style={{ color: chip.fg, background: chip.bg, fontSize: "var(--type-caption)" }}>
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
              <span className="text-[length:var(--type-body-sm)]" style={{ color: "#7a5c1f" }}>
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
