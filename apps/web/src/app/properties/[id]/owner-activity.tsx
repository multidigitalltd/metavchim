"use client";

import { useCallback, useEffect, useState } from "react";
import {
  OWNER_ACTIVITY_KIND_LABELS,
  OWNER_ACTIVITY_RESULT_LABELS,
  ownerActivityFileName,
  ownerActivityText,
  type OwnerActivityKind,
  type OwnerActivityResult,
} from "@metavchim/shared";
import { API_BASE, apiGet } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { Notice } from "../../notice";

/**
 * דוח הפעילות שהמתווך מוסר לבעל הנכס.
 *
 * השאלה שבעל נכס שואל אחרי חודש היא "מה עשיתם בשביל הדירה שלי",
 * והתשובה שהייתה בידי המתווך עד כה היא מה שהוא זוכר. כאן היא רשימה:
 * מתי היה ביקור ומה יצא ממנו, כמה מתעניינים התקשרו וכמה נענו.
 *
 * **מה שאין כאן, ולא במקרה:** שם של מתעניין, מספר טלפון, סיכום
 * שיחה או הערה פנימית. השרת אינו שולף אותם מלכתחילה — הדוח מתאר
 * פעולות ולא אנשים, כי הוא עוזב את המערכת אל מי שאינו משתמש בה.
 */

interface ActivityEntry {
  at: string;
  kind: OwnerActivityKind;
  result: OwnerActivityResult;
  durationMinutes?: number;
}

interface ActivityReport {
  entries: ActivityEntry[];
  summary: { total: number; held: number; upcoming: number; inquiries: number; lastAt?: string };
  truncated: boolean;
}

/** שלוש התקופות שמתווך באמת מבקש, ולא בורר תאריכים שאיש לא ממלא. */
const PERIODS = [
  { key: "all", label: "כל התקופה", days: null },
  { key: "30", label: "30 יום", days: 30 },
  { key: "90", label: "90 יום", days: 90 },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

const DAY_MS = 24 * 60 * 60 * 1000;

const dateTimeFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * גוון לפי מה שקרה בפועל: מה שהתקיים ירוק, מה שנקבע נייטרלי, ומה
 * שלא יצא לפועל אדום. בעל נכס סורק את העמודה הזו ולא קורא אותה.
 */
const RESULT_TONE: Record<OwnerActivityResult, string> = {
  scheduled: "var(--color-text-soft)",
  held: "var(--color-success)",
  cancelled: "var(--color-danger)",
  no_show: "var(--color-danger)",
  liked: "var(--color-success)",
  not_fit: "var(--color-text-soft)",
  negotiating: "var(--color-success)",
  needs_other: "var(--color-text-soft)",
  answered: "var(--color-success)",
  unanswered: "var(--color-danger)",
  voicemail: "var(--color-warning)",
};

export function OwnerActivity({
  propertyId,
  propertyLabel,
  officeName,
}: {
  propertyId: string;
  propertyLabel: string;
  officeName: string;
}) {
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const copy = useCopy();

  /*
   * הטווח מחושב פעם אחת לכל טעינה ולא נגזר מ-`Date.now()` בשני
   * מקומות: הרשימה שעל המסך והקובץ שיורד חייבים לתאר את אותה
   * תקופה, אחרת המתווך שולח ללקוח קובץ שאינו מה שהוא ראה.
   */
  const query = useCallback((): string => {
    const days = PERIODS.find((p) => p.key === period)?.days ?? null;
    if (days === null) return "";
    return `?from=${new Date(Date.now() - days * DAY_MS).toISOString()}`;
  }, [period]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setReport(await apiGet<ActivityReport>(`/properties/${propertyId}/activity${query()}`));
    } catch {
      setError("טעינת הפעילות נכשלה");
    } finally {
      setLoading(false);
    }
  }, [propertyId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * הורדה ב-fetch ולא בקישור ישיר: עוגיית ה-Session אינה נשלחת
   * בניווט חוצה-מקור בכל דפדפן. אותו דפוס של ייצוא הנתונים בהגדרות.
   */
  async function download(): Promise<void> {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/properties/${propertyId}/activity.csv${query()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("הורדת הדוח נכשלה");
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = ownerActivityFileName(propertyLabel);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "הורדת הדוח נכשלה");
    } finally {
      setDownloading(false);
    }
  }

  function messageText(): string {
    const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "כל התקופה";
    return ownerActivityText({
      propertyLabel,
      officeName,
      periodLabel,
      entries: (report?.entries ?? []).map((entry) => ({
        at: new Date(entry.at),
        kind: entry.kind,
        result: entry.result,
        ...(entry.durationMinutes === undefined ? {} : { durationMinutes: entry.durationMinutes }),
      })),
      /*
       * בלי זה השורה האחרונה הייתה מחשבת „ועוד N פעולות” מתוך המערך
       * שבידה — מספר מדויק שהוא שגוי, כי הוא אינו יודע על מה שנחתך
       * כבר במסד (ביקורת Codex).
       */
      ...(report?.truncated === true ? { truncated: true } : {}),
      now: new Date(),
    });
  }

  const empty = report !== null && report.entries.length === 0;

  return (
    <section className="mv-list-card px-[22px] py-[18px]">
      <h2 className="m-0 text-[17px] font-bold">דוח פעילות לבעל הנכס</h2>
      <p className="m-0 mt-[6px] text-[14px]" style={{ color: "var(--color-text-muted)" }}>
        ביקורים, פגישות ופניות של מתעניינים בנכס. בלי שמות, בלי מספרי טלפון ובלי תוכן השיחות.
      </p>

      <div className="mt-[14px] flex flex-wrap gap-2">
        {PERIODS.map((option) => (
          <button
            key={option.key}
            type="button"
            className="mv-chip"
            aria-pressed={period === option.key}
            onClick={() => setPeriod(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {loading ? (
        <p className="m-0 mt-[14px] text-[14px]" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : null}

      {!loading && empty ? (
        <p className="m-0 mt-[14px] text-[14px]" style={{ color: "var(--color-text-muted)" }}>
          לא נרשמה פעילות בתקופה שנבחרה.
        </p>
      ) : null}

      {!loading && report !== null && report.entries.length > 0 ? (
        <>
          <p className="m-0 mt-[14px] text-[14.5px] font-bold">
            {[
              report.summary.held > 0 ? `${report.summary.held} מפגשים התקיימו` : null,
              report.summary.upcoming > 0 ? `${report.summary.upcoming} נקבעו וטרם התקיימו` : null,
              report.summary.inquiries > 0 ? `${report.summary.inquiries} פניות` : null,
            ]
              .filter((part): part is string => part !== null)
              .join(" · ")}
          </p>

          <div className="mt-[12px] max-h-[360px] overflow-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  <th className="p-[6px] text-right font-bold">מתי</th>
                  <th className="p-[6px] text-right font-bold">פעולה</th>
                  <th className="p-[6px] text-right font-bold">תוצאה</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((entry, index) => (
                  <tr
                    key={`${entry.at}-${index}`}
                    style={{ borderTop: "1px solid var(--color-border)" }}
                  >
                    <td className="p-[6px] whitespace-nowrap">
                      {dateTimeFmt.format(new Date(entry.at))}
                    </td>
                    <td className="p-[6px]">
                      {OWNER_ACTIVITY_KIND_LABELS[entry.kind]}
                      {entry.durationMinutes === undefined
                        ? null
                        : ` · ${entry.durationMinutes} דק׳`}
                    </td>
                    <td className="p-[6px] font-bold" style={{ color: RESULT_TONE[entry.result] }}>
                      {OWNER_ACTIVITY_RESULT_LABELS[entry.result]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* קיטום נאמר ולא נבלע — דוח חתוך בשקט הוא דוח שקרי */}
          {report.truncated ? (
            <Notice tone="warning">
              הוצגו הפריטים האחרונים בלבד. לתקופה ארוכה מזו כדאי לייצא בטווחים קצרים יותר.
            </Notice>
          ) : null}

          <div className="mt-[14px] flex flex-wrap gap-2">
            <button
              type="button"
              className="mv-btn-plain"
              style={{ padding: "8px 16px", fontSize: 14.5 }}
              disabled={downloading}
              onClick={() => void download()}
            >
              {downloading ? "מוריד…" : "הורדת קובץ"}
            </button>
            <button
              type="button"
              className="mv-btn-plain"
              style={{ padding: "8px 16px", fontSize: 14.5 }}
              onClick={() => void copy.copy(messageText(), "activity")}
            >
              {copy.key === "activity" && copy.state === "copied"
                ? "✓ ההודעה הועתקה"
                : "העתקת הודעה לשליחה"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
