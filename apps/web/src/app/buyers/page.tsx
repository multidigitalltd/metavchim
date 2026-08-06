"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet } from "@/lib/api";
import { formatPrice, MATURITY_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { CapNote, FilterBar, FilterSelect, SearchField, textMatches } from "../list-controls";

/**
 * מסך הקונים לפי קובץ העיצוב: מקרא בשלות בכותרת, טבלת grid עם גלולת
 * בשלות, "הצעות שקיבל" ו"פעילות אחרונה".
 */

interface BuyerRow {
  id: string;
  contact: { name: string; phone: string };
  requirements: {
    cities: string[];
    budgetMinAgorot?: number;
    budgetMaxAgorot: number;
    roomsMin?: number;
    roomsMax?: number;
  };
  maturity: string;
  source: string;
  offersReceived?: number;
  lastActivityAt?: string;
}

const MATURITY_ORDER = ["very_hot", "hot", "interested", "not_ripe"];

/* גלולות הבשלות — הפלטה המדויקת מקובץ העיצוב (mat()) */
const MATURITY_PILL: Record<string, { fg: string; bg: string }> = {
  very_hot: { fg: "#b0512c", bg: "#faf1ec" },
  hot: { fg: "#7a5c1f", bg: "#f7efdd" },
  interested: { fg: "#0C6E34", bg: "#E5FCEA" },
  not_ripe: { fg: "#68716a", bg: "#eef1ec" },
};

function budgetText(b: BuyerRow): string {
  return b.requirements.budgetMinAgorot !== undefined
    ? `${formatPrice(b.requirements.budgetMinAgorot)}–${formatPrice(b.requirements.budgetMaxAgorot)}`
    : `עד ${formatPrice(b.requirements.budgetMaxAgorot)}`;
}

function wantsText(b: BuyerRow): string {
  const rooms =
    b.requirements.roomsMin || b.requirements.roomsMax
      ? `${b.requirements.roomsMin ?? ""}–${b.requirements.roomsMax ?? ""} חד׳`
      : "";
  return [rooms, b.requirements.cities.slice(0, 2).join(", ")].filter(Boolean).join(" · ") || "—";
}

function lastActivityText(iso?: string): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "היום";
  if (days === 1) return "אתמול";
  if (days < 30) return `לפני ${days} ימים`;
  const months = Math.floor(days / 30);
  return months === 1 ? "לפני חודש" : `לפני ${months} חודשים`;
}

function MaturityPill({ maturity }: { maturity: string }) {
  const colors = MATURITY_PILL[maturity] ?? MATURITY_PILL["not_ripe"]!;
  return (
    <span className="mv-pill" style={{ color: colors.fg, background: colors.bg }}>
      {MATURITY_LABELS[maturity] ?? maturity}
    </span>
  );
}

const GRID = "1.6fr 0.9fr 1.1fr 1.4fr 0.9fr 0.9fr";

export default function BuyersPage() {
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [items, setItems] = useState<BuyerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [maturity, setMaturity] = useState("");
  const [offersFilter, setOffersFilter] = useState("");

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ items: BuyerRow[] }>("/buyers?limit=100")
      .then((res) =>
        setItems(
          [...res.items].sort(
            (a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity),
          ),
        ),
      )
      .catch(() => setError("טעינת הקונים נכשלה"));
  }, [authLoading]);

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (b) =>
          textMatches(query, b.contact.name, b.contact.phone, ...b.requirements.cities) &&
          (!maturity || b.maturity === maturity) &&
          // "מי לא קיבל כלום" הוא הסינון שמייצר עבודה בפועל
          (offersFilter === "" ||
            (offersFilter === "none" && (b.offersReceived ?? 0) === 0) ||
            (offersFilter === "some" && (b.offersReceived ?? 0) > 0)),
      ),
    [items, query, maturity, offersFilter],
  );

  return (
    <>
      {/* מקרא הבשלות + פעולות — כמו בעיצוב */}
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          דירוג בשלות: <b style={{ color: "#b0512c" }}>חם מאוד</b> ·{" "}
          <b style={{ color: "#8a6414" }}>חם</b> ·{" "}
          <b style={{ color: "var(--color-primary)" }}>מתעניין</b> ·{" "}
          <b style={{ color: "var(--color-text-muted)" }}>לא בשל</b>
        </div>
        <div className="ms-auto flex flex-wrap gap-2.5">
          <Link href="/import" className="mv-btn-plain" style={{ padding: "8px 14px", fontSize: "13.5px" }}>
            ייבוא מאקסל
          </Link>
          <Link href="/buyers/voice" className="mv-btn-plain" style={{ padding: "8px 14px", fontSize: "13.5px" }}>
            🎤 קונה בקול
          </Link>
          <Link href="/buyers/new" className="mv-btn-action">
            + קונה חדש
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : items === null ? (
        <p aria-live="polite">טוען קונים…</p>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-3 text-lg font-semibold">עדיין אין קונים</p>
          <Link href="/buyers/new">
            <Button>הוסף קונה ראשון</Button>
          </Link>
        </div>
      ) : (
        <>
          <FilterBar
            shown={visible.length}
            total={items.length}
            noun="קונים"
            active={query.trim() !== "" || maturity !== "" || offersFilter !== ""}
            onClear={() => {
              setQuery("");
              setMaturity("");
              setOffersFilter("");
            }}
          >
            <SearchField
              label="חיפוש קונה"
              placeholder="🔍 שם, טלפון או עיר מבוקשת"
              value={query}
              onChange={setQuery}
            />
            <FilterSelect
              label="סינון לפי בשלות"
              value={maturity}
              onChange={setMaturity}
              allLabel="כל רמות הבשלות"
              options={Object.entries(MATURITY_LABELS)}
            />
            <FilterSelect
              label="סינון לפי הצעות שקיבל"
              value={offersFilter}
              onChange={setOffersFilter}
              allLabel="עם הצעות ובלי"
              options={[
                ["none", "לא קיבלו אף הצעה"],
                ["some", "קיבלו הצעות"],
              ]}
            />
          </FilterBar>

          {visible.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-3">אף קונה לא תואם את הסינון.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setMaturity("");
                }}
              >
                נקה סינון
              </Button>
            </div>
          ) : (
            <>
              {/* מובייל: כרטיסים במקום טבלה בת 6 עמודות (docs/06 §1.5) */}
              <ul className="flex flex-col gap-3 sm:hidden">
                {visible.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/buyers/${b.id}`} className="font-bold underline">
                        {b.contact.name}
                      </Link>
                      <MaturityPill maturity={b.maturity} />
                    </div>
                    <a
                      href={`tel:${b.contact.phone}`}
                      dir="ltr"
                      className="mt-1 block text-sm underline"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {b.contact.phone}
                    </a>
                    <p className="mt-2" style={{ color: "var(--color-text-muted)" }}>
                      {wantsText(b)} · {budgetText(b)}
                    </p>
                    <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {b.offersReceived
                        ? `${b.offersReceived} הצעות`
                        : "אף הצעה עדיין"}{" "}
                      · {lastActivityText(b.lastActivityAt)}
                    </p>
                  </li>
                ))}
              </ul>

              {/* שולחני: טבלת ה-grid מהעיצוב */}
              <div className="mv-list-card hidden sm:block">
                <div className="mv-list-head" style={{ gridTemplateColumns: GRID }}>
                  <span>שם</span>
                  <span>בשלות</span>
                  <span>תקציב</span>
                  <span>מחפש</span>
                  <span>הצעות שקיבל</span>
                  <span>פעילות אחרונה</span>
                </div>
                {visible.map((b) => {
                  const noOffers = (b.offersReceived ?? 0) === 0;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className="mv-list-row"
                      style={{ gridTemplateColumns: GRID }}
                      onClick={() => router.push(`/buyers/${b.id}`)}
                    >
                      <span className="truncate text-[14.5px] font-bold">{b.contact.name}</span>
                      <span>
                        <MaturityPill maturity={b.maturity} />
                      </span>
                      <span className="text-sm font-bold">{budgetText(b)}</span>
                      <span className="truncate text-[13px]" style={{ color: "var(--color-text-soft)" }}>
                        {wantsText(b)}
                      </span>
                      <span
                        className="text-[13.5px] font-bold"
                        style={{
                          // קונה חם מאוד בלי אף הצעה — הדגשה באדום, כמו בעיצוב
                          color:
                            noOffers && b.maturity === "very_hot"
                              ? "var(--color-danger)"
                              : "var(--color-text-soft)",
                        }}
                      >
                        {noOffers ? "אף אחת עדיין" : `${b.offersReceived} הצעות`}
                      </span>
                      <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                        {lastActivityText(b.lastActivityAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <CapNote show={(query.trim() !== "" || maturity !== "" || offersFilter !== "") && items.length === 100} noun="קונים" />
        </>
      )}
    </>
  );
}
