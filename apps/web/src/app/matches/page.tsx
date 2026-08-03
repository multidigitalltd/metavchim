"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

/** מסך ההתאמות הדו-צדי (אפיון §15, מסך 4): קונים ⇄ נכסים עם אחוז והסבר. */

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

function scoreLabel(score: number): string {
  if (score >= 85) return "מומלץ לשליחה";
  if (score >= 70) return "ייתכן שמתאים";
  return "דורש בדיקה";
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
  const [minScore, setMinScore] = useState(50);
  const [error, setError] = useState<string | null>(null);
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

  async function dismiss(id: string) {
    await apiPatch(`/matches/${id}/dismiss`, {});
    setItems((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">התאמות</h1>
        <div>
          <label htmlFor="minScore" className="me-2 font-medium">סף התאמה:</label>
          <select
            id="minScore"
            value={minScore}
            onChange={(event) => setMinScore(Number(event.target.value))}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <option value={85}>85%+ — מומלץ לשליחה</option>
            <option value={70}>70%+ — ייתכן שמתאים</option>
            <option value={50}>50%+ — הכל</option>
          </select>
        </div>
      </div>

      {propertyId ? (
        <p className="mb-4 flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-3 py-1"
            style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
          >
            מסונן להתאמות של נכס אחד
            {items && items[0] ? `: ${items[0].property.title ?? items[0].property.address}` : ""}
          </span>
          <Link href="/matches" className="underline">
            הצג את כל ההתאמות
          </Link>
        </p>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
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
        <ul className="flex flex-col gap-3">
          {items.map((m) => (
            <li
              key={m.id}
              className="rounded-xl border p-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-2xl font-bold" style={{ minWidth: "4rem" }}>{m.score}%</span>
                <div className="flex-1">
                  <p>
                    <Link href={`/properties/${m.propertyId}`} className="font-semibold underline">
                      {m.property.title ?? m.property.address}
                    </Link>
                    {m.property.priceAgorot !== undefined ? (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {" "}· {formatPrice(m.property.priceAgorot)}
                      </span>
                    ) : null}
                  </p>
                  <p>
                    <span aria-hidden="true">⇄ </span>
                    {m.buyerName ? (
                      <Link href={`/buyers/${m.buyerId}`} className="underline">{m.buyerName}</Link>
                    ) : (
                      <span style={{ color: "var(--color-text-muted)" }}>קונה של סוכן אחר</span>
                    )}
                  </p>
                </div>
                <span
                  className="rounded-full px-3 py-0.5 text-sm font-medium"
                  style={{
                    background: m.score >= 85 ? "var(--color-primary)" : "var(--color-border)",
                    color: m.score >= 85 ? "var(--color-bg)" : "var(--color-text)",
                  }}
                >
                  {m.status === "offered" ? "הצעה נשלחה" : scoreLabel(m.score)}
                </span>
                {m.status === "suggested" ? (
                  <Button variant="ghost" onClick={() => void dismiss(m.id)}>
                    לא רלוונטי
                  </Button>
                ) : null}
              </div>
              <p className="mt-1" style={{ color: "var(--color-text-muted)" }}>{m.explanation}</p>
            </li>
          ))}
        </ul>
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
