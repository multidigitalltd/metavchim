"use client";

import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { formatPrice } from "@/lib/format";

/**
 * העמודה השנייה בכרטיס הנכס: **ביקושים ברשת**.
 *
 * ההתאמות הפנימיות שואלות "מי מהקונים שלי מתאים לנכס הזה". זו שואלת
 * את אותה שאלה בדיוק — רק שהקונה יושב במשרד אחר. עד כה התשובה חיה
 * במסך שת"פ נפרד, כלומר הסוכן שפתח כרטיס נכס ראה שלושה קונים, סגר,
 * ולא ידע שיש ברשת עוד ארבעה ביקושים שהנכס עונה עליהם.
 *
 * שתי העמודות מודדות באותו סרגל: אותו מנוע ניקוד, אותו סף. "82%"
 * פירושו אותו דבר בשתיהן, אחרת אי אפשר להשוות ביניהן.
 *
 * מה שנחשף על הביקוש הוא מה שהרשת חושפת: עיר, שכונות, תקציב ותיאור
 * חופשי. שם הקונה והמשרד לעולם לא כאן.
 */

interface NetworkDemandMatch {
  demandId: string;
  score: number;
  explanation: string;
  cities: string[];
  neighborhoods: string[];
  notes?: string;
  budgetMaxAgorot: number;
  commissionSplit: number;
  creditsCost: number;
  source: string;
  alreadyOffered: boolean;
}

export function NetworkDemandMatches({ propertyId }: { propertyId: string }) {
  const [rows, setRows] = useState<NetworkDemandMatch[] | null>(null);
  /** null = אין הרשאת שת"פ; העמודה נעלמת ולא מציגה שגיאה */
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<NetworkDemandMatch[]>(`/collaboration/network-matches/property/${propertyId}`)
      .then(setRows)
      .catch((err: unknown) => {
        // 403 = המשרד או המשתמש בלי שת"פ. זה לא כשל שצריך לצעוק עליו
        if (err instanceof ApiError && err.status === 403) setAllowed(false);
        else setRows([]);
      });
  }, [propertyId]);

  async function offer(row: NetworkDemandMatch): Promise<void> {
    setBusy(row.demandId);
    setError(null);
    try {
      await apiPost(`/collaboration/demands/${row.demandId}/offer`, {
        propertyId,
        commissionSplit: row.commissionSplit,
      });
      setRows(
        (prev) =>
          prev?.map((r) => (r.demandId === row.demandId ? { ...r, alreadyOffered: true } : r)) ??
          null,
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שליחת ההצעה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  if (!allowed) return null;

  return (
    <section className="mv-list-card px-[22px] py-[18px]" aria-labelledby="network-matches-heading">
      <h2 id="network-matches-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
        ביקושים ברשת
      </h2>
      <p className="m-0 mb-2.5 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        קונים של משרדים אחרים שהנכס מתאים להם
      </p>

      {error !== null ? (
        <p role="alert" className="m-0 mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p aria-live="polite">בודק ברשת…</p>
      ) : rows.length === 0 ? (
        <p className="m-0 py-2" style={{ color: "var(--color-text-muted)" }}>
          אין כרגע ביקוש מתאים ברשת.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.demandId}
            className="flex flex-wrap items-center gap-[15px] py-[13px]"
            style={{ borderBottom: "1px solid var(--color-row-border)" }}
          >
            <span
              className="mv-score-ring"
              style={{
                width: 46,
                height: 46,
                background: `conic-gradient(#7B61FF ${Math.round(row.score * 3.6)}deg, var(--color-progress-track) 0deg)`,
              }}
              aria-hidden="true"
            >
              <span style={{ width: 35, height: 35, fontSize: 12 }}>{row.score}%</span>
            </span>
            <div className="min-w-0 flex-1" style={{ lineHeight: 1.4 }}>
              <div className="text-[14.5px] font-bold">
                {row.cities.join(", ") || "כל האזורים"}
                {row.neighborhoods.length > 0 ? (
                  <span className="ms-1.5 text-[12.5px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
                    · {row.neighborhoods.join(", ")}
                  </span>
                ) : null}
                <span className="ms-1.5 text-[12.5px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
                  · עד {formatPrice(row.budgetMaxAgorot)}
                </span>
              </div>
              <div className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                {row.notes ?? row.explanation}
              </div>
              <div className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                העמלה שלי: {100 - row.commissionSplit}%
                {row.creditsCost > 0 ? ` · ההצעה תעלה ${row.creditsCost} קרדיטים` : " · ללא עלות"}
              </div>
            </div>
            <div className="ms-auto flex-none">
              {row.alreadyOffered ? (
                <span
                  className="mv-pill"
                  style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
                >
                  הוצע ✓
                </span>
              ) : (
                <button
                  type="button"
                  className="mv-btn-action"
                  style={{ padding: "7px 15px", fontSize: 13 }}
                  disabled={busy !== null}
                  onClick={() => void offer(row)}
                >
                  {busy === row.demandId ? "שולח…" : "הצע את הנכס"}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
