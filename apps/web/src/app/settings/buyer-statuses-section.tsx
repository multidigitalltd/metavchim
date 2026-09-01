"use client";

import { useEffect, useState } from "react";
import {
  MAX_OFFICE_STATUS_LABEL,
  MAX_OFFICE_STATUSES,
  type BuyerMaturity,
  type OfficeBuyerStatus,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { MATURITY_LABELS } from "@/lib/format";
import { Notice } from "../notice";

/**
 * ‎**סטטוסי הקונים של המשרד — שכבה ב׳.**
 *
 * ## מה המסך הזה קובע
 *
 * ‎`maturity` (חם מאוד · חם · מתעניין · לא בשל) נשארת כפי שהיא ומזינה
 * את הדשבורד, דירוג ההתאמות וההתראות. הרשימה כאן היא **המילים של
 * המשרד** מעליה: „בסבב סיורים”, „ממתין למשכנתא”, „שלב 3”.
 *
 * ## למה כל סטטוס חייב דרגה
 *
 * זה לא שדה טכני שהמשתמש צריך לסבול. הוא התשובה לשאלה „מה המערכת
 * תעשה עם זה”: קונה ב„במשא ומתן” צריך להופיע בדשבורד כדחוף, ולעורר
 * את ההתראה על קונה חם בלי הצעות. בלי הדרגה, סטטוס מותאם אישית היה
 * תווית יפה שהמערכת עיוורת אליה.
 *
 * ## למה „הסרה” ולא „מחיקה”
 *
 * סטטוס שכרטיסים נושאים אותו אינו נמחק אלא יוצא מהבוררים ונשאר קריא
 * במקום שבו הוא כתוב. מחיקה הייתה הופכת עשרות כרטיסים ל„סטטוס לא
 * ידוע” — כלומר מוחקת היסטוריה כדי לנקות תפריט. סטטוס שאיש אינו
 * נושא נמחק לגמרי, כי אין שם מה לשמר.
 */

const MATURITY_OPTIONS = Object.entries(MATURITY_LABELS) as [BuyerMaturity, string][];

const inputStyle = {
  background: "var(--color-field)",
  borderColor: "var(--color-input-border)",
  color: "var(--color-text)",
};

function errorText(error: unknown): string {
  return error instanceof ApiError && error.message !== ""
    ? error.message
    : "השמירה נכשלה";
}

export function BuyerStatusesSection() {
  const [statuses, setStatuses] = useState<OfficeBuyerStatus[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newMaturity, setNewMaturity] = useState<BuyerMaturity>("interested");

  useEffect(() => {
    apiGet<{ statuses: OfficeBuyerStatus[] }>("/settings/buyer-statuses")
      .then((res) => setStatuses(res.statuses))
      .catch(() => setNotice("טעינת הסטטוסים נכשלה"));
  }, []);

  /**
   * ‎**כל כתיבה מחזירה את הרשימה כולה, והמסך כותב אותה כמו שהיא.**
   *
   * מחיקה של סטטוס בשימוש הופכת בשרת להסתרה, ולכן מסך שהיה מעדכן
   * את המצב לפי מה ש**נשלח** היה מוחק שורה שנשארה קיימת — ומראה
   * מצב שאינו במסד עד לרענון.
   */
  async function run(call: () => Promise<{ statuses: OfficeBuyerStatus[] }>) {
    setBusy(true);
    setNotice(null);
    try {
      setStatuses((await call()).statuses);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function add(): Promise<void> {
    await run(async () => {
      const saved = await apiPost<{ statuses: OfficeBuyerStatus[] }>(
        "/settings/buyer-statuses",
        { label: newLabel.trim(), maturity: newMaturity },
      );
      setNewLabel("");
      return saved;
    });
  }

  const full = (statuses?.length ?? 0) >= MAX_OFFICE_STATUSES;

  return (
    <section
      className="mv-list-card px-5 py-[17px]"
      aria-labelledby="buyer-statuses-heading"
    >
      <h2
        id="buyer-statuses-heading"
        className="m-0 mb-1"
        style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
      >
        סטטוסי קונים
      </h2>
      <p className="mb-3.5 mt-0 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-muted)" }}>
        השלבים שהמשרד עובד לפיהם, מעל ארבע רמות הבשלות. כל סטטוס נשען על
        רמת בשלות — היא מה שקובע איפה הקונה מופיע בדשבורד ובהתראות.
      </p>

      {notice ? <Notice tone="warning">{notice}</Notice> : null}

      {statuses === null ? (
        <p aria-live="polite">טוען…</p>
      ) : (
        <>
          <ul className="m-0 mb-4 list-none p-0">
            {statuses.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-2 border-b py-2.5 last:border-b-0"
                style={{ borderColor: "var(--color-border)" }}
              >
                <label className="sr-only" htmlFor={`label-${entry.id}`}>
                  שם הסטטוס
                </label>
                <input
                  id={`label-${entry.id}`}
                  defaultValue={entry.label}
                  maxLength={MAX_OFFICE_STATUS_LABEL}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded-lg border px-3 py-2"
                  style={inputStyle}
                  /*
                    ‎**שמירה ביציאה מהשדה ולא בכפתור „שמור” לכל שורה.**
                    שורה עם כפתור משלה היא מסך שמלא בכפתורים זהים, וזה
                    בדיוק מה שגורם לאנשים לערוך ולעזוב בלי לשמור.
                  */
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    if (label === entry.label || label.length < 2) {
                      event.target.value = entry.label;
                      return;
                    }
                    void run(() =>
                      apiPatch<{ statuses: OfficeBuyerStatus[] }>(
                        `/settings/buyer-statuses/${entry.id}`,
                        { label },
                      ),
                    );
                  }}
                />
                <label className="sr-only" htmlFor={`maturity-${entry.id}`}>
                  רמת הבשלות של {entry.label}
                </label>
                <select
                  id={`maturity-${entry.id}`}
                  value={entry.maturity}
                  disabled={busy}
                  className="rounded-lg border px-3 py-2"
                  style={inputStyle}
                  onChange={(event) =>
                    void run(() =>
                      apiPatch<{ statuses: OfficeBuyerStatus[] }>(
                        `/settings/buyer-statuses/${entry.id}`,
                        { maturity: event.target.value },
                      ),
                    )
                  }
                >
                  {MATURITY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {entry.archived ? (
                  <>
                    <span
                      className="mv-pill"
                      style={{
                        background: "var(--chip-neutral-bg)",
                        color: "var(--chip-neutral-fg)",
                      }}
                    >
                      הוסר
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      className="mv-btn-plain"
                      onClick={() =>
                        void run(() =>
                          apiPatch<{ statuses: OfficeBuyerStatus[] }>(
                            `/settings/buyer-statuses/${entry.id}`,
                            { archived: false },
                          ),
                        )
                      }
                    >
                      החזרה לשימוש
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    className="mv-btn-plain"
                    onClick={() =>
                      void run(() =>
                        apiDelete<{ statuses: OfficeBuyerStatus[] }>(
                          `/settings/buyer-statuses/${entry.id}`,
                        ),
                      )
                    }
                  >
                    הסרה
                  </button>
                )}
              </li>
            ))}
            {statuses.length === 0 ? (
              <li className="py-2.5 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-muted)" }}>
                אין סטטוסים. כרטיס הקונה יציג את רמת הבשלות בלבד.
              </li>
            ) : null}
          </ul>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="new-status" className="mb-1 block text-sm font-semibold">
                סטטוס חדש
              </label>
              <input
                id="new-status"
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                placeholder="ממתין למשכנתא"
                maxLength={MAX_OFFICE_STATUS_LABEL}
                disabled={busy || full}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="new-maturity" className="mb-1 block text-sm font-semibold">
                רמת בשלות
              </label>
              <select
                id="new-maturity"
                value={newMaturity}
                onChange={(event) => setNewMaturity(event.target.value as BuyerMaturity)}
                disabled={busy || full}
                className="rounded-lg border px-3 py-2.5"
                style={inputStyle}
              >
                {MATURITY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="mv-btn-action"
              disabled={busy || full || newLabel.trim().length < 2}
            >
              הוספה
            </button>
          </form>
          {full ? (
            <p className="mb-0 mt-2 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-muted)" }}>
              הגעתם ל־{MAX_OFFICE_STATUSES} סטטוסים. הסירו אחד קיים כדי להוסיף חדש.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
