"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OWNER_ACTIVITY_KIND_LABELS,
  OWNER_ACTIVITY_RESULT_LABELS,
  ownerActivityFileName,
  ownerActivityText,
  type OwnerActivityKind,
  type OwnerActivityResult,
} from "@metavchim/shared";
import { API_BASE, ApiError, apiGet, apiPost } from "@/lib/api";
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
  /**
   * ‏במה אפשר להגיע לבעל הנכס — מהשרת, כי פרטיו מוצפנים והמסך אינו
   * מחזיק אותם. השדה אופציונלי כדי שגרסת מסך חדשה מול שרת ישן לא
   * תקרוס; היעדרו נקרא כ„אין ערוצים”, וזו התשובה הבטוחה.
   */
  owner?: { name?: string; whatsapp: boolean; email: boolean };
}

/** ‏באיזה ערוץ הדוח יוצא — המתווך בוחר. */
type SendChannel = "whatsapp" | "email";

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
  /*
   * ניטרלי ולא אדום: „לא ידוע אם נענתה” אינו כשל אלא היעדר מידע,
   * ואדום שמור לחסימה ולשגיאה. השורה מופיעה כדי שהפעילות תיספר —
   * הרי השיחה קרתה — בלי לטעון עליה מה שאיננו יודעים.
   */
  unknown: "var(--color-text-soft)",
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
  /*
   * התקופה **וגבול הטווח שלה יחד**, בעדכון מצב אחד.
   *
   * ההערה כאן קודם אמרה שהגבול מחושב פעם אחת, והקוד חישב אותו מחדש
   * בכל קריאה — כלומר `Date.now()` נפרד למסך ולהורדה. פעילות שנפלה
   * בדיוק על הגבול הופיעה במסך ונעדרה מהקובץ שנשלח ללקוח (ביקורת
   * Codex). עכשיו הגבול נקפא ברגע הבחירה, ושתי הבקשות נושאות את
   * אותה מחרוזת בדיוק.
   */
  const [selection, setSelection] = useState<{ period: PeriodKey; query: string }>({
    period: "all",
    query: "",
  });
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  /*
   * ‎`null` = לא נשלח כלום כרגע. שם הערוץ = הכפתור הזה בעבודה —
   * ולא דגל בוליאני אחד, שהיה מנטרל את שני הכפתורים כשנלחץ אחד.
   */
  const [sending, setSending] = useState<SendChannel | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const copy = useCopy();
  /*
   * מונה בקשות. בלעדיו החלפת תקופה מהירה משאירה שתי טעינות באוויר,
   * והאיטית מביניהן — זו של התקופה **הקודמת** — דורסת את החדשה:
   * הטבלה מציגה נתונים של תקופה אחת תחת הכותרת של אחרת, וההודעה
   * להעתקה מתייגת אותם בתווית השגויה (ביקורת Codex).
   */
  const requestId = useRef(0);

  function choose(key: PeriodKey): void {
    const days = PERIODS.find((p) => p.key === key)?.days ?? null;
    setSelection({
      period: key,
      query: days === null ? "" : `?from=${new Date(Date.now() - days * DAY_MS).toISOString()}`,
    });
  }

  const query = selection.query;

  const load = useCallback(async (): Promise<void> => {
    const mine = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ActivityReport>(`/properties/${propertyId}/activity${query}`);
      if (mine !== requestId.current) return;
      setReport(data);
    } catch {
      if (mine !== requestId.current) return;
      /*
       * הדוח הישן **נמחק** ולא נשאר על המסך.
       *
       * מונה הבקשות מתעלם מתשובה שהוחלפה, אבל טעינה נוכחית שנכשלה
       * החזירה את `loading` ל-false והשאירה את שורות התקופה
       * הקודמת — תחת הכותרת החדשה, ועם כפתור העתקה שמתייג אותן
       * בתווית התקופה שנבחרה עכשיו (ביקורת Codex). מוטב מסך ריק
       * עם הודעת שגיאה מאשר טבלה שנראית תקפה ואינה.
       */
      setReport(null);
      setError("טעינת הפעילות נכשלה");
    } finally {
      if (mine === requestId.current) setLoading(false);
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
      const res = await fetch(`${API_BASE}/properties/${propertyId}/activity.csv${query}`, {
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

  /**
   * ‎**השליחה בפועל — הפעולה שהמסך הזה לא ידע לעשות.**
   *
   * ‏עד עכשיו היו כאן „הורדת קובץ” ו„העתקת הודעה”, כלומר הדוח נבנה
   * והמתווך היה אמור להדביק אותו בעצמו לוואטסאפ. מי שלא עשה זאת
   * השאיר את בעל הנכס בלי דוח, ומהמסך זה נראה כאילו נשלח.
   *
   * ‏השגיאה מהשרת מוצגת כלשונה ולא מוחלפת ב„השליחה נכשלה”: היא
   * אומרת **מה** חסם — אין אימייל בכרטיס, הוואטסאפ אינו מחובר,
   * חלון 24 השעות של Meta נסגר — וזה ההבדל בין מתווך שיודע מה
   * לעשות עכשיו לבין מתווך שלוחץ שוב.
   */
  async function send(channel: SendChannel): Promise<void> {
    setSending(channel);
    setError(null);
    setSent(null);
    try {
      const periodLabel = PERIODS.find((p) => p.key === selection.period)?.label ?? "כל התקופה";
      const result = await apiPost<{ channel: SendChannel; to: string; count: number }>(
        `/properties/${propertyId}/activity/send${query}`,
        { channel, periodLabel },
      );
      setSent(
        channel === "whatsapp"
          ? `הדוח נשלח בוואטסאפ אל ${result.to}`
          : `הדוח נשלח באימייל אל ${result.to}, עם הרשימה המלאה כקובץ מצורף`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.message.trim() !== ""
          ? err.message
          : "שליחת הדוח נכשלה — אפשר להעתיק את ההודעה ולשלוח ידנית",
      );
    } finally {
      setSending(null);
    }
  }

  function messageText(): string {
    const periodLabel = PERIODS.find((p) => p.key === selection.period)?.label ?? "כל התקופה";
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
      <h2 className="m-0 text-[length:calc(17/16*1rem)] font-bold">דוח פעילות לבעל הנכס</h2>
      <p className="m-0 mt-[6px] text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        ביקורים, פגישות ופניות של מתעניינים בנכס. בלי שמות, בלי מספרי טלפון ובלי תוכן השיחות.
      </p>

      <div className="mt-[14px] flex flex-wrap gap-2">
        {PERIODS.map((option) => (
          <button
            key={option.key}
            type="button"
            className="mv-chip"
            aria-pressed={selection.period === option.key}
            onClick={() => choose(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {loading ? (
        <p className="m-0 mt-[14px] text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : null}

      {!loading && empty ? (
        <p className="m-0 mt-[14px] text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
          לא נרשמה פעילות בתקופה שנבחרה.
        </p>
      ) : null}

      {!loading && report !== null && report.entries.length > 0 ? (
        <>
          <p className="m-0 mt-[14px] text-[length:var(--type-caption-lg)] font-bold">
            {[
              report.summary.held > 0 ? `${report.summary.held} מפגשים התקיימו` : null,
              report.summary.upcoming > 0 ? `${report.summary.upcoming} נקבעו וטרם התקיימו` : null,
              report.summary.inquiries > 0 ? `${report.summary.inquiries} פניות` : null,
            ]
              .filter((part): part is string => part !== null)
              .join(" · ")}
          </p>

          <div className="mt-[12px] max-h-[360px] overflow-auto">
            <table className="w-full border-collapse text-[length:var(--type-caption)]">
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

          {sent ? <Notice tone="success">{sent}</Notice> : null}

          {/*
            ‏שתי השליחות ראשונות ומודגשות, ואחריהן ההורדה וההעתקה.
            הסדר הוא ההבדל: עד עכשיו הפעולה הראשונה במסך הייתה
            „הורדת קובץ”, כלומר המסך הציע למתווך לעשות את השליחה
            בעצמו — וזה בדיוק מה שלא קרה.
          */}
          <div className="mt-[14px] flex flex-wrap gap-2">
            <button
              type="button"
              className="mv-button mv-button--primary"
              disabled={sending !== null || report.owner?.whatsapp !== true}
              title={
                report.owner?.whatsapp === true
                  ? undefined
                  : "אין טלפון בכרטיס בעל הנכס — אפשר להוסיף אותו בכרטיס"
              }
              onClick={() => void send("whatsapp")}
            >
              {sending === "whatsapp" ? "שולח…" : "שליחה בוואטסאפ"}
            </button>
            <button
              type="button"
              className="mv-button mv-button--secondary"
              disabled={sending !== null || report.owner?.email !== true}
              title={
                report.owner?.email === true
                  ? undefined
                  : "אין אימייל בכרטיס בעל הנכס — אפשר להוסיף אותו בכרטיס"
              }
              onClick={() => void send("email")}
            >
              {sending === "email" ? "שולח…" : "שליחה באימייל"}
            </button>
            <button
              type="button"
              className="mv-btn-plain"
              style={{ padding: "8px 16px", fontSize: "var(--type-caption-lg)" }}
              disabled={downloading}
              onClick={() => void download()}
            >
              {downloading ? "מוריד…" : "הורדת קובץ"}
            </button>
            {/*
              ‏ההעתקה נשארת: היא המסלול של מי שרוצה לשלוח בערוץ אחר,
              והיא גם מה שהשגיאות מפנות אליו כשהשליחה נחסמה.
            */}
            <button
              type="button"
              className="mv-btn-plain"
              style={{ padding: "8px 16px", fontSize: "var(--type-caption-lg)" }}
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
