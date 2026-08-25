"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  DISMISS_REASONS,
  DISMISS_REASON_LABEL,
  type DismissReason,
} from "@metavchim/shared";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { Notice } from "../notice";

/**
 * מסך ההתאמות לפי קובץ העיצוב: מתג "לפי נכס ← קונים / לפי קונה ←
 * נכסים", קבוצות ככרטיסים עם כותרת ומונה, וכל שורה עם טבעת ניקוד
 * (conic-gradient), הסבר מילולי וכפתור "שלח הצעה".
 */

interface MatchRow {
  id: string;
  propertyId: string;
  buyerId: string;
  score: number;
  explanation: string;
  status: string;
  property: { address: string; title?: string; priceAgorot?: number };
  buyerName: string | null;
}

/** תקרת ה-API. תג "N קונים מתאימים" עשוי להצביע על יותר — ואז מוצגת הערה. */
const LIST_LIMIT = 200;

type Direction = "byProperty" | "byBuyer";

interface Group {
  key: string;
  title: string;
  sub: string;
  items: MatchRow[];
}

function groupMatches(items: MatchRow[], direction: Direction): Group[] {
  const map = new Map<string, Group>();
  for (const m of items) {
    const key = direction === "byProperty" ? m.propertyId : m.buyerId;
    let group = map.get(key);
    if (group === undefined) {
      group =
        direction === "byProperty"
          ? {
              key,
              title: m.property.title ?? m.property.address,
              sub: m.property.priceAgorot !== undefined ? formatPrice(m.property.priceAgorot) : "",
              items: [],
            }
          : { key, title: m.buyerName ?? "קונה של סוכן אחר", sub: "", items: [] };
      map.set(key, group);
    }
    group.items.push(m);
  }
  const groups = [...map.values()];
  for (const g of groups) g.items.sort((a, b) => b.score - a.score);
  // הקבוצה עם ההתאמה החזקה ביותר — ראשונה
  groups.sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0));
  return groups;
}

function ScoreRing({ score }: { score: number }) {
  return (
    <span
      className="mv-score-ring"
      style={{ background: `conic-gradient(#2ECC66 ${Math.round(score * 3.6)}deg, var(--color-progress-track) 0deg)` }}
      aria-hidden="true"
    >
      <span>{score}%</span>
    </span>
  );
}

export default function MatchesPage() {
  // useSearchParams דורש גבול Suspense ב-App Router
  return (
    <Suspense fallback={<p aria-live="polite">טוען התאמות…</p>}>
      <MatchesView />
    </Suspense>
  );
}

function MatchesView() {
  const { loading: authLoading } = useRequireAuth();
  const searchParams = useSearchParams();
  // הגעה מ"17 קונים מתאימים" ברשימת הנכסים — מסננים לנכס אחד
  const propertyId = searchParams.get("property");
  const [items, setItems] = useState<MatchRow[] | null>(null);
  const [direction, setDirection] = useState<Direction>("byProperty");
  const [minScore, setMinScore] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signUrl, setSignUrl] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  /** ההתאמה שפתחה את בחירת סיבת הדחייה. */
  const [dismissing, setDismissing] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(
    (threshold: number, property: string | null) => {
      // מזהה בקשה — תגובה מאוחרת של סף ישן לא דורסת את הסף הנוכחי (ביקורת Codex)
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      const scope = property ? `&propertyId=${encodeURIComponent(property)}` : "";
      apiGet<MatchRow[]>(`/matches?minScore=${threshold}&limit=${LIST_LIMIT}${scope}`)
        .then((rows) => {
          if (requestSeq.current === seq) setItems(rows);
        })
        .catch(() => {
          if (requestSeq.current === seq) setError("טעינת ההתאמות נכשלה");
        });
    },
    [],
  );

  useEffect(() => {
    if (!authLoading) load(minScore, propertyId);
  }, [authLoading, minScore, propertyId, load]);

  const groups = useMemo(
    () => (items === null ? [] : groupMatches(items, direction)),
    [items, direction],
  );

  /**
   * דחייה **עם סיבה**.
   *
   * הסיבה אינה שאלה מיותרת: היא הדבר היחיד שהופך שמונה דחיות ביום
   * למידע שאפשר לכייל לפיו את משקלי ההתאמה. הבחירה היא לחיצה אחת
   * מרשימה קצרה — לא טופס — כי סוכן שדוחה התאמה רוצה שהיא תיעלם,
   * לא למלא שאלון.
   */
  async function dismiss(id: string, reason: DismissReason) {
    setDismissing(null);
    await apiPatch(`/matches/${id}/dismiss`, { reason });
    setItems((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
  }

  /** שליחת הצעה מהשורה. קונה שטרם חתם על הסכם — מוצג קישור ההחתמה. */
  async function sendOffer(m: MatchRow): Promise<void> {
    setSending(m.id);
    setNotice(null);
    setSignUrl(null);
    try {
      await apiPost("/offers", { matchId: m.id });
      setNotice(`ההצעה נשלחה — ${m.buyerName ?? "הקונה"} · ${m.property.title ?? m.property.address}`);
      setItems((prev) =>
        prev ? prev.map((x) => (x.id === m.id ? { ...x, status: "offered" } : x)) : prev,
      );
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        // שער החתימה (הסכמי תיווך): ההצעה חסומה עד שהקונה חותם
        if (err.body["code"] === "signature_required" && typeof err.body["signUrl"] === "string") {
          setSignUrl(err.body["signUrl"]);
          setNotice("הקונה טרם חתם על הסכם התיווך — שלחו לו קודם את קישור החתימה:");
        } else {
          setNotice(err.message);
        }
      } else {
        setNotice("שליחת ההצעה נכשלה — נסו שוב");
      }
    } finally {
      setSending(null);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3.5">
        <div className="mv-seg" role="group" aria-label="כיוון ההתאמות">
          <button
            type="button"
            aria-pressed={direction === "byProperty"}
            onClick={() => setDirection("byProperty")}
          >
            לפי נכס ← קונים
          </button>
          <button
            type="button"
            aria-pressed={direction === "byBuyer"}
            onClick={() => setDirection("byBuyer")}
          >
            לפי קונה ← נכסים
          </button>
        </div>
        <label className="ms-auto flex items-center gap-1.5 text-sm">
          <span className="mv-visually-hidden">סף התאמה</span>
          <select
            value={minScore}
            onChange={(event) => setMinScore(Number(event.target.value))}
            className="rounded-lg border px-2 py-1.5"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
          >
            <option value={85}>85%+ — מומלץ לשליחה</option>
            <option value={70}>70%+ — ייתכן שמתאים</option>
            <option value={50}>50%+ — הכל</option>
          </select>
        </label>
      </div>

      {propertyId ? (
        <p className="mb-4 flex flex-wrap items-center gap-2">
          <span className="mv-pill" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
            מסונן להתאמות של נכס אחד
          </span>
          <Link href="/matches" className="underline">
            הצג את כל ההתאמות
          </Link>
        </p>
      ) : null}

      {notice ? (
        <Notice tone="success">{notice}
          {signUrl ? (
            <>
              {" "}
              <a href={signUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline" style={{ color: "var(--color-primary)" }}>
                פתח את דף החתימה
              </a>
            </>
          ) : null}</Notice>
      ) : null}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : items === null ? (
        <p aria-live="polite">טוען התאמות…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="mb-2 text-lg font-semibold">אין התאמות בסף הזה</p>
          <p style={{ color: "var(--color-text-muted)" }}>
            {propertyId
              ? "אפשר להוריד את סף ההתאמה, או לחזור לכל ההתאמות."
              : "הוסיפו נכסים וקונים — ההתאמות מחושבות אוטומטית."}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mv-list-card mb-3.5" aria-label={g.title}>
            <div
              className="flex flex-wrap items-center gap-2.5 px-5 py-[13px]"
              style={{ background: "var(--color-table-head)", borderBottom: "1px solid var(--color-card-head-border)" }}
            >
              <span className="text-[16px] font-extrabold">
                {direction === "byProperty" ? (
                  <Link href={`/properties/${g.items[0]?.propertyId}`} className="no-underline hover:underline" style={{ color: "inherit" }}>
                    {g.title}
                  </Link>
                ) : g.items[0]?.buyerName ? (
                  <Link href={`/buyers/${g.items[0].buyerId}`} className="no-underline hover:underline" style={{ color: "inherit" }}>
                    {g.title}
                  </Link>
                ) : (
                  g.title
                )}
              </span>
              {g.sub ? (
                <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                  {g.sub}
                </span>
              ) : null}
              <span className="mv-pill ms-auto" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)", fontSize: "var(--type-caption)" }}>
                {g.items.length} התאמות
              </span>
            </div>
            {g.items.map((m) => (
              <div key={m.id} className="flex items-center gap-[15px] px-5 py-3" style={{ borderBottom: "1px solid var(--color-row-border)" }}>
                <ScoreRing score={m.score} />
                <div className="min-w-0" style={{ lineHeight: 1.4 }}>
                  <div className="text-[15.5px] font-bold">
                    {direction === "byProperty" ? (
                      m.buyerName ? (
                        <Link href={`/buyers/${m.buyerId}`} className="no-underline hover:underline" style={{ color: "inherit" }}>
                          {m.buyerName}
                        </Link>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>קונה של סוכן אחר</span>
                      )
                    ) : (
                      <Link href={`/properties/${m.propertyId}`} className="no-underline hover:underline" style={{ color: "inherit" }}>
                        {m.property.title ?? m.property.address}
                      </Link>
                    )}
                  </div>
                  <div className="text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
                    {m.explanation}
                  </div>
                </div>
                <div className="ms-auto flex flex-none items-center gap-2">
                  {m.status === "offered" ? (
                    <span className="mv-pill" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                      הצעה נשלחה
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="mv-btn-plain"
                        aria-expanded={dismissing === m.id}
                        onClick={() => setDismissing(dismissing === m.id ? null : m.id)}
                      >
                        לא רלוונטי
                      </button>
                      <button
                        type="button"
                        className="mv-btn-action"
                        style={{ padding: "7px 15px", fontSize: "var(--type-caption-lg)" }}
                        disabled={sending !== null}
                        onClick={() => void sendOffer(m)}
                      >
                        {sending === m.id ? "שולח…" : "שלח הצעה"}
                      </button>
                    </>
                  )}
                </div>
                {/*
                  הרשימה נפתחת מתחת לשורה ולא כדיאלוג: היא קצרה,
                  והלחיצה השנייה היא הפעולה עצמה — שני קליקים בסך
                  הכול, כמו קודם ועם המידע.
                */}
                {dismissing === m.id ? (
                  <div className="mt-2 flex w-full flex-wrap items-center gap-1.5 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
                    <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                      למה לא מתאים?
                    </span>
                    {DISMISS_REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        className="mv-chip"
                        style={{ cursor: "pointer" }}
                        onClick={() => void dismiss(m.id, reason)}
                      >
                        {DISMISS_REASON_LABEL[reason]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ))
      )}

      {/* המספר בתג "N קונים מתאימים" סופר את כל ההתאמות, והרשימה חסומה
          בתקרה — בלי ההערה הזו התאמות היו נעלמות בשקט (ביקורת Codex) */}
      {items && items.length === LIST_LIMIT ? (
        <p className="mt-3" style={{ color: "var(--color-text-muted)" }}>
          מוצגות {LIST_LIMIT} ההתאמות בעלות הציון הגבוה ביותר. יש התאמות
          נוספות מתחתיהן — העלו את סף ההתאמה כדי לצמצם את הרשימה.
        </p>
      ) : null}
    </>
  );
}
