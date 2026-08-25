"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_COMMISSION_SPLIT,
  demandChips,
  describeCommissionTerms,
  publisherStatedSplit,
  type CommissionTerms,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { NetChips } from "../collaboration/net-chips";
import { IconGlobe, IconHandshake } from "../icons";
import { Notice } from "../notice";

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
 * מה שנחשף על הביקוש הוא בדיוק מה שהרשת חושפת — הרשימה נבנית
 * ב-`packages/shared/logic/network-card.ts`, אותו מקור שמזין את פיד
 * הרשת. שם הקונה, הטלפון והמשרד לעולם לא כאן.
 */

interface NetworkDemandMatch {
  demandId: string;
  score: number;
  explanation: string;
  cities: string[];
  neighborhoods: string[];
  notes?: string;
  dealType: string;
  propertyTypes: string[];
  areaSqmMin?: number;
  budgetMinAgorot?: number;
  /** חסר = הקונה טרם מסר תקציב. */
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  entryType?: string;
  entryBy?: string;
  financing?: string;
  maturity?: string;
  mustFeatures: string[];
  niceFeatures: string[];
  commissionSplit: number;
  /** חלוקת העמלה לכל צד — זה מה שמוצג; `commissionSplit` הוא הכותרת. */
  terms: CommissionTerms;
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
    apiGet<NetworkDemandMatch[]>(
      `/collaboration/network-matches/property/${propertyId}`,
    )
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
      /*
       * האחוז שהמשרד המפרסם **הצהיר** עליו, ולא הכותרת: כשצד הקונה
       * שלו נוסח במילים הכותרת היא 50 שאיש לא ביקש, והמסך כאן שולח
       * בלי לשאול. הנפילה לברירת המחדל נשארת — אין מספר אחר —
       * אבל היא נאמרת ליד הכפתור במקום לצאת בשקט.
       */
      await apiPost(`/collaboration/demands/${row.demandId}/offer`, {
        propertyId,
        commissionSplit:
          publisherStatedSplit(row.terms, "buyer") ?? DEFAULT_COMMISSION_SPLIT,
      });
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.demandId === row.demandId ? { ...r, alreadyOffered: true } : r,
          ) ?? null,
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שליחת ההצעה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  if (!allowed) return null;

  return (
    <section
      className="mv-list-card px-[22px] py-[18px]"
      aria-labelledby="network-matches-heading"
    >
      <h2
        id="network-matches-heading"
        className="m-0 mb-1"
        style={{ fontSize: 16.5, fontWeight: 800 }}
      >
        <IconGlobe s={16} /> ביקושים ברשת
      </h2>
      <p
        className="m-0 mb-2.5 text-[14px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        קונים של משרדים אחרים שהנכס מתאים להם
      </p>

      {error !== null ? (
        <Notice tone="danger">{error}</Notice>
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
              className="mv-score-ring mv-score-ring--lg"
              style={{
                background: `conic-gradient(#7B61FF ${Math.round(row.score * 3.6)}deg, var(--color-progress-track) 0deg)`,
              }}
              aria-hidden="true"
            >
              <span>
                {row.score}%
              </span>
            </span>
            <div className="min-w-0 flex-1" style={{ lineHeight: 1.4 }}>
              {/* כל מה שידוע על הביקוש, למעט מה שמזהה אדם */}
              <NetChips chips={demandChips(row)} />
              <div
                className="text-[14.5px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                {row.notes ?? row.explanation}
              </div>
              <div
                className="text-[14px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                {/*
                  התנאים שפורסמו, ולא „העמלה שלי X%”. משפורדה החלוקה
                  לצד קונה ולצד מוכר אין מספר יחיד שאפשר להפחית
                  ממאה, ובוודאי לא כשצד נוסח במילים — מספר כזה היה
                  תנאי שאיש לא סיכם.
                */}
                <IconHandshake s={13} /> חלוקת עמלה:{" "}
                {describeCommissionTerms(row.terms)}
                {row.creditsCost > 0
                  ? ` · ההצעה תעלה ${row.creditsCost} קרדיטים`
                  : " · ללא עלות"}
              </div>
              {/*
                אין כאן בורר — ההצעה נשלחת בלחיצה אחת — ולכן כשאין
                אחוז מוצהר צריך לומר מה ייצא בפועל.
              */}
              {publisherStatedSplit(row.terms, "buyer") === null ? (
                <div
                  className="text-[14px]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  החלוקה נוסחה במילים, ולכן ההצעה תישלח על{" "}
                  {DEFAULT_COMMISSION_SPLIT}% / {100 - DEFAULT_COMMISSION_SPLIT}%
                  — סכמו את הניסוח מול המשרד המפרסם.
                </div>
              ) : null}
            </div>
            <div className="ms-auto flex-none">
              {row.alreadyOffered ? (
                <span
                  className="mv-pill"
                  style={{
                    background: "var(--color-primary-soft)",
                    color: "var(--color-primary)",
                  }}
                >
                  הוצע ✓
                </span>
              ) : (
                <button
                  type="button"
                  className="mv-btn-action"
                  style={{ padding: "7px 15px", fontSize: 14.5 }}
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
