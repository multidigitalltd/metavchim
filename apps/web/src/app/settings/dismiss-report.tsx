"use client";

import { useEffect, useState } from "react";
import { MATCH_CRITERION_LABELS, type DismissReport } from "@metavchim/shared";
import { apiGet } from "@/lib/api";

/**
 * למה התאמות נדחות — **הדוח שמכייל את מנוע ההתאמות.**
 *
 * משקלי ההתאמה ניתנים לעריכה בהגדרות המשרד מהיום הראשון, ועד עכשיו
 * לא היה שום נתון שלפיו לערוך אותם. סוכן שדוחה שמונה התאמות ביום
 * אומר שמונה פעמים שמשהו לא בסדר; כאן זה נספר.
 *
 * הדוח **אומר מסקנה** ולא רק מציג אחוזים: מספרים בלי משפט שמסביר
 * מה לעשות איתם הם מסך שמסתכלים עליו פעם אחת.
 */
export function DismissReportSection() {
  const [report, setReport] = useState<DismissReport | null>(null);
  const [days, setDays] = useState(90);

  useEffect(() => {
    /*
     * 403 אינו שגיאה כאן — סוכן בלי `analytics.view` פשוט אינו רואה
     * את המדור, בדיוק כמו שאר הדוח.
     */
    apiGet<DismissReport>(`/matches/dismiss-report?days=${days}`)
      .then(setReport)
      .catch(() => setReport(null));
  }, [days]);

  if (report === null) return null;

  return (
    <section aria-labelledby="dismiss-report" className="mb-8">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 id="dismiss-report" className="m-0 text-lg font-semibold">
          למה התאמות נדחות
        </h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="טווח הדוח"
          className="rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
        >
          <option value={30}>30 יום</option>
          <option value={90}>90 יום</option>
          <option value={365}>שנה</option>
        </select>
      </div>

      {report.total === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          לא נרשמו דחיות בטווח הזה. כשסוכן מסמן התאמה כ&quot;לא רלוונטי&quot; הוא נשאל
          למה, והתשובות מצטברות כאן.
        </p>
      ) : (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {/* יחיד ורבים — "1 דחיות" נקרא כמו טקסט שנשכח */}
            {report.total === 1 ? "דחייה אחת עם סיבה." : `${report.total} דחיות עם סיבה.`}
          </p>
          <ul className="m-0 list-none p-0">
            {report.tallies.map((tally) => (
              <li key={tally.reason} className="mb-2">
                <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[15px]">
                  <span>
                    {tally.label}
                    {tally.criterion !== null ? (
                      <span className="ms-1.5 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                        · קריטריון {MATCH_CRITERION_LABELS[tally.criterion]}
                      </span>
                    ) : null}
                  </span>
                  <b>
                    {tally.count}
                    <span className="ms-1 font-normal" style={{ color: "var(--color-text-muted)" }}>
                      ({tally.percent}%)
                    </span>
                  </b>
                </div>
                {/* עמודה ולא גרף: הסדר והיחס הם כל מה שצריך לראות */}
                <div
                  className="h-1.5 rounded-full"
                  style={{ background: "var(--color-border)" }}
                  aria-hidden="true"
                >
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${tally.percent}%`, background: "var(--color-primary)" }}
                  />
                </div>
              </li>
            ))}
          </ul>

          {report.insight !== null ? (
            <p
              className="m-0 mt-3 rounded-lg border p-3 text-[14.5px]"
              style={{ borderColor: "var(--color-primary)", background: "var(--color-bg)" }}
            >
              {report.insight}
            </p>
          ) : (
            <p className="m-0 mt-3 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
              עוד מעט דחיות ואפשר יהיה להסיק מהן מסקנה. מסקנה מתוך מדגם קטן גרועה
              מאין מסקנה.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
