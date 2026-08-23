"use client";

import { useEffect, useMemo, useState } from "react";
import { labelOf } from "@metavchim/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost } from "@/lib/api";
import { formatPrice, MATURITY_LABELS } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { IconMic, IconPlus, IconSheet } from "../icons";
import { CapNote, FilterBar, FilterSelect, textMatches,
  useFilterFromUrl,
} from "../list-controls";
import {
  EMPTY_FILTERS,
  ListFilters,
  filtersToQuery,
  hasActiveFilters,
  type ListFilterValues,
} from "../list-filters";
import { Notice } from "../notice";

/**
 * מסך הקונים לפי קובץ העיצוב: מקרא בשלות בכותרת, טבלת grid עם גלולת
 * בשלות, "הצעות שקיבל" ו"פעילות אחרונה".
 */

interface BuyerRow {
  id: string;
  contact: { name: string; phone: string };
  requirements: {
    dealType?: string;
    cities: string[];
    budgetMinAgorot?: number;
    budgetMaxAgorot?: number;
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
  // תקציב הוא נתון שמתברר; "לא צוין" הוא מידע, "0 ₪" הוא שקר
  if (b.requirements.budgetMaxAgorot === undefined) return "תקציב לא צוין";
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
      {labelOf(MATURITY_LABELS, maturity) ?? maturity}
    </span>
  );
}

const GRID = "1.6fr 0.9fr 1.1fr 1.4fr 0.9fr 0.9fr";

export default function BuyersPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const canImport = useFeature("data_io");
  const canVoice = useFeature("voice_intake");
  const router = useRouter();
  const [items, setItems] = useState<BuyerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListFilterValues>(EMPTY_FILTERS);
  const [maturity, setMaturity] = useState("");
  const [offersFilter, setOffersFilter] = useState("");
  /** קונה (sale) או שוכר (rent) — הלשונית היא "קונים · שוכרים" */
  const [dealType, setDealType] = useState("");
  /**
   * הכרטיסים שסומנו לפעולה מרוכזת.
   *
   * `Set` של מזהים ולא דגל על השורה: הסינון והמיון משנים את
   * הרשימה תוך כדי, ובחירה ששמורה על האובייקטים הייתה נעלמת
   * ברגע שהמשתמש מקליד בחיפוש.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  // קישורי הפילוח מהדשבורד: /buyers?maturity=hot וכדומה
  useFilterFromUrl({ maturity: setMaturity, dealType: setDealType });

  /*
   * טווחי התקציב והחדרים נשלחים לשרת; החיפוש הטקסטואלי נשאר בדפדפן.
   *
   * ההפרדה אינה שרירותית: שם הלקוח והטלפון שלו **מוצפנים במסד**,
   * ואי אפשר לחפש בהם בשאילתה. חיפוש שרת היה מאבד בדיוק את מה
   * שמתווך מחפש הכי הרבה — "איפה הכרטיס של כהן". החיפוש לפי שם על
   * פני כל המאגר קיים בחיפוש הגלובלי, שמשתמש ב-name_hash.
   */
  useEffect(() => {
    if (authLoading) return;
    setItems(null);
    apiGet<{ items: BuyerRow[] }>(`/buyers?limit=100${filtersToQuery({ ...filters, q: "" })}`)
      .then((res) =>
        setItems(
          [...res.items].sort(
            (a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity),
          ),
        ),
      )
      .catch(() => setError("טעינת הקונים נכשלה"));
  }, [authLoading, filters]);

  function toggle(id: string): void {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (b) =>
          textMatches(filters.q, b.contact.name, b.contact.phone, ...b.requirements.cities) &&
          (!maturity || b.maturity === maturity) &&
          (!dealType || (b.requirements.dealType ?? "sale") === dealType) &&
          // "מי לא קיבל כלום" הוא הסינון שמייצר עבודה בפועל
          (offersFilter === "" ||
            (offersFilter === "none" && (b.offersReceived ?? 0) === 0) ||
            (offersFilter === "some" && (b.offersReceived ?? 0) > 0)),
      ),
    [items, filters.q, maturity, offersFilter, dealType],
  );

  /*
   * הבחירה מוצגת רק למי שרשאי למחוק.
   *
   * `buyers.delete` היא יכולת נפרדת מ-`buyers.edit`, ואינה חלק
   * מברירת המחדל של סוכן. בלי השער הזה המסך היה מציע לסמן ולמחוק,
   * והשרת היה עונה 403 על פעולה שהמסך עצמו הזמין (ביקורת Codex).
   */
  const mayDelete = can(user, "buyers.delete");
  /* העלאה מרוכזת לרשת — יכולת נפרדת; תיבות הסימון מוצגות לשתיהן */
  const mayShare = can(user, "collaboration.share");
  const maySelect = mayDelete || mayShare;

  /* בחירה שיצאה מהסינון אינה נמחקת — היא פשוט אינה מוצגת ואינה נספרת */
  const selectedVisible = visible.filter((b) => selected.has(b.id));
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;

  function toggleAll(): void {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((b) => b.id)));
  }

  /**
   * מחיקה מרוכזת — ארכיון, או לצמיתות באישור נפרד.
   *
   * ברירת המחדל היא ארכיון בדיוק כמו במחיקה בודדת. הכפתור השני
   * קיים בשביל המקרה שבשבילו הפעולה נבנתה — ייבוא שגוי שצריך
   * להיעלם — ולכן האישור שלו מציין את המספר ואת אי-ההפיכות.
   */
  async function removeSelected(permanent: boolean): Promise<void> {
    const ids = selectedVisible.map((b) => b.id);
    if (ids.length === 0) return;
    const question = permanent
      ? `למחוק לצמיתות ${ids.length} כרטיסים? הפעולה אינה הפיכה, וכל ההיסטוריה שלהם תימחק.`
      : `להעביר ${ids.length} כרטיסים לארכיון? הם יורדו מהרשימות וההיסטוריה תישמר.`;
    if (!window.confirm(question)) return;

    setBulkBusy(true);
    setBulkNote(null);
    setError(null);
    try {
      const res = await apiPost<{ removed: number; skipped: number }>("/buyers/bulk-delete", {
        ids,
        permanent,
      });
      setBulkNote(
        res.skipped === 0
          ? `${res.removed} כרטיסים ${permanent ? "נמחקו" : "הועברו לארכיון"}`
          : `${res.removed} ${permanent ? "נמחקו" : "הועברו לארכיון"}, ${res.skipped} דולגו — כרטיס של סוכן אחר, או כזה שכבר נמחק`,
      );
      setSelected(new Set());
      setItems(null);
      const fresh = await apiGet<{ items: BuyerRow[] }>(
        `/buyers?limit=100${filtersToQuery({ ...filters, q: "" })}`,
      );
      setItems(
        [...fresh.items].sort(
          (a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity),
        ),
      );
    } catch {
      setError("המחיקה נכשלה — נסו שוב");
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * העלאה מרוכזת לרשת השיתופים.
   *
   * השרת מפרסם כל קונה במסלול הבודד המלא — ברירת המחדל של חלוקת
   * העמלה, והתיאור מהערות הקונה. כשל של אחד אינו עוצר את השאר,
   * והסיכום אומר בדיוק מי לא עלה ולמה (בלי אזור חיפוש, כבר משותף,
   * מכסה).
   */
  async function shareSelected(): Promise<void> {
    const ids = selectedVisible.map((b) => b.id);
    if (ids.length === 0) return;
    if (!window.confirm(`לפרסם ${ids.length} קונים לרשת השיתופים? יפורסמו בלי שם ובלי טלפון, בחלוקת עמלה 50/50.`)) return;

    setBulkBusy(true);
    setBulkNote(null);
    setError(null);
    try {
      const res = await apiPost<{ results: { id: string; ok: boolean; error?: string }[] }>(
        "/collaboration/share/bulk",
        { buyerIds: ids },
      );
      const failed = res.results.filter((r) => !r.ok);
      const reasons = [...new Set(failed.map((r) => r.error ?? "השיתוף נכשל"))];
      setBulkNote(
        failed.length === 0
          ? `${res.results.length} קונים פורסמו לרשת`
          : `${res.results.length - failed.length} פורסמו, ${failed.length} לא — ${reasons.join(" · ")}`,
      );
      setSelected(new Set());
    } catch {
      setError("הפרסום לרשת נכשל — נסו שוב");
    } finally {
      setBulkBusy(false);
    }
  }

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
        <div className="ms-auto flex flex-wrap items-center gap-2.5">
          {/* כפתור שמוביל לפיצ'ר שאינו במסלול נחסם בשרת ממילא —
              עדיף לא להציג אותו מאשר להסביר 403 אחרי בחירת קובץ */}
          {canImport ? (
            <Link href="/import" className="mv-btn-plain" style={{ minHeight: 38, paddingInline: 14, fontSize: "14px" }}>
              <IconSheet s={15} /> ייבוא מאקסל
            </Link>
          ) : null}
          {canVoice ? (
            <Link href="/voice" className="mv-btn-plain" style={{ minHeight: 38, paddingInline: 14, fontSize: "14px" }}>
              <IconMic s={15} /> קונה בקול
            </Link>
          ) : null}
          <Link href="/buyers/new" className="mv-btn-action" style={{ minHeight: 38 }}>
            <IconPlus s={15} /> קונה חדש
          </Link>
        </div>
      </div>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : items === null ? (
        <p aria-live="polite">טוען קונים…</p>
      ) : items.length === 0 && !hasActiveFilters(filters) ? (
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
          {/*
            הסינון מוצג גם כשאין תוצאות.
            מאז שהסינון עבר לשרת, רשימה ריקה כבר לא אומרת "אין
            קונים במשרד" אלא "הסינון לא מצא כלום" — ומסך שמסתיר את
            הסינון במצב הזה משאיר את המשתמש בלי דרך לנקות אותו,
            מלבד רענון הדף (ביקורת Codex).
          */}
          <ListFilters
            values={filters}
            onApply={setFilters}
            searchLabel="חיפוש קונה"
            searchHint="שם, טלפון או עיר מבוקשת"
            priceLabel="תקציב"
          />
          <FilterBar
            shown={visible.length}
            total={items.length}
            noun="קונים"
            active={
              hasActiveFilters(filters) || maturity !== "" || offersFilter !== "" || dealType !== ""
            }
            onClear={() => {
              setFilters(EMPTY_FILTERS);
              setMaturity("");
              setOffersFilter("");
              setDealType("");
            }}
          >
            <FilterSelect
              label="סינון לפי קונה או שוכר"
              value={dealType}
              onChange={setDealType}
              allLabel="קונים ושוכרים"
              options={[
                ["sale", "קונים"],
                ["rent", "שוכרים"],
              ]}
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
                  setFilters(EMPTY_FILTERS);
                  setMaturity("");
                  setOffersFilter("");
                  setDealType("");
                }}
              >
                נקה סינון
              </Button>
            </div>
          ) : (
            <>
              {/*
                סרגל הבחירה מופיע רק כשיש מה לעשות איתו. סרגל קבוע
                עם "0 נבחרו" הוא רעש בכל מסך שבו לא בוחרים כלום.
              */}
              {maySelect && selected.size > 0 ? (
                <div
                  className="mv-list-card mb-3 flex flex-wrap items-center gap-2 px-4 py-3"
                  role="status"
                >
                  <strong className="text-[15px]">{selectedVisible.length} נבחרו</strong>
                  <button
                    type="button"
                    className="mv-btn-plain"
                    disabled={bulkBusy}
                    onClick={() => setSelected(new Set())}
                  >
                    בטל בחירה
                  </button>
                  {mayShare ? (
                    <button
                      type="button"
                      className="mv-btn-plain ms-auto"
                      disabled={bulkBusy}
                      onClick={() => void shareSelected()}
                      style={{ color: "var(--color-primary)" }}
                    >
                      {bulkBusy ? "מפרסם…" : "העלה לרשת השיתופים"}
                    </button>
                  ) : null}
                  {mayDelete ? (
                    <>
                      <button
                        type="button"
                        className={mayShare ? "mv-btn-plain" : "mv-btn-plain ms-auto"}
                        disabled={bulkBusy}
                        onClick={() => void removeSelected(false)}
                      >
                        העבר לארכיון
                      </button>
                      <button
                        type="button"
                        className="mv-btn-plain"
                        disabled={bulkBusy}
                        onClick={() => void removeSelected(true)}
                        style={{ color: "var(--color-danger)" }}
                      >
                        מחק לצמיתות
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}

              {bulkNote ? <Notice tone="success">{bulkNote}</Notice> : null}

              {/* מובייל: כרטיסים במקום טבלה בת 6 עמודות (docs/06 §1.5) */}
              <ul className="flex flex-col gap-3 sm:hidden">
                {visible.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2">
                        {maySelect ? (
                          <input
                            type="checkbox"
                            checked={selected.has(b.id)}
                            onChange={() => toggle(b.id)}
                            aria-label={`בחר את ${b.contact.name}`}
                          />
                        ) : null}
                        <Link href={`/buyers/${b.id}`} className="font-bold underline">
                          {b.contact.name}
                        </Link>
                      </label>
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
                  <span className="flex items-center gap-2">
                    {maySelect ? (
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        aria-label="בחר את כל הקונים המוצגים"
                        title="בחר הכל"
                      />
                    ) : null}
                    שם
                  </span>
                  <span>בשלות</span>
                  <span>תקציב</span>
                  <span>מחפש</span>
                  <span>הצעות שקיבל</span>
                  <span>פעילות אחרונה</span>
                </div>
                {visible.map((b) => {
                  const noOffers = (b.offersReceived ?? 0) === 0;
                  return (
                    /*
                      תיבת הסימון יושבת **לצד** השורה ולא בתוכה:
                      השורה כולה היא כפתור ניווט, ותיבת סימון בתוך
                      כפתור אינה תקינה ואינה נגישה — לחיצה עליה
                      הייתה מנווטת לכרטיס במקום לסמן.
                    */
                    <div key={b.id} className="mv-list-select-row">
                      {maySelect ? (
                        <input
                          type="checkbox"
                          checked={selected.has(b.id)}
                          onChange={() => toggle(b.id)}
                          aria-label={`בחר את ${b.contact.name}`}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="mv-list-row grow"
                        style={{ gridTemplateColumns: GRID }}
                        onClick={() => router.push(`/buyers/${b.id}`)}
                      >
                      <span className="truncate text-[15.5px] font-bold">{b.contact.name}</span>
                      <span>
                        <MaturityPill maturity={b.maturity} />
                      </span>
                      <span className="text-sm font-bold">{budgetText(b)}</span>
                      <span className="truncate text-[14.5px]" style={{ color: "var(--color-text-soft)" }}>
                        {wantsText(b)}
                      </span>
                      <span
                        className="text-[15px] font-bold"
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
                      <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                        {lastActivityText(b.lastActivityAt)}
                      </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <CapNote
            show={
              (hasActiveFilters(filters) ||
                maturity !== "" ||
                offersFilter !== "" ||
                dealType !== "") &&
              items.length === 100
            }
            noun="קונים"
          />
        </>
      )}
    </>
  );
}
