"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { jerusalemWallIsoToUtc } from "@metavchim/shared";
import { Notice } from "../notice";
import { WhatsappPairing } from "../whatsapp-pairing";

/**
 * ‎**מנויי הוואטסאפ של משרד — מי מחזיק, מי אימת, ומה אפשר להוסיף.**
 *
 * ## למה זה כאן ולא במסך של המשרד
 *
 * המשרד רואה כמה מקומות יש לו וקונה עוד. מי שמוסיף מקום בחינם, פותח
 * פיילוט לחודש, או קובע מחיר שסוכם בטלפון — הוא מפעיל הפלטפורמה.
 *
 * ובעיקר: כשסוכן אינו מצליח לאמת את המספר שלו, מי שמקבל את הטלפון
 * הוא התמיכה — ועד עכשיו לא הייתה לה שום דרך לראות מה מצבו, ולא כלי
 * לעזור. כאן היא רואה מי מחובר ומי לא, ומפיקה ברקוד שאפשר לשלוח.
 *
 * ## מה לא מוצג כאן
 *
 * המספרים עצמם. ארבע ספרות אחרונות מספיקות כדי שהסוכן יזהה את המספר
 * שלו, ואינן מספיקות כדי לבנות רשימת מספרים של כל הסוכנים בכל
 * המשרדים — אותה הכרעה בדיוק כמו במסך הפרופיל של הסוכן עצמו.
 */

interface Subscriber {
  userId: string;
  name: string;
  role: string;
  isActive: boolean;
  whatsappAccess: boolean;
  linked: boolean;
  tail: string | null;
  verifiedAt: string | null;
  needsReverification: boolean;
  implicit: boolean;
}

interface SeatRow {
  id: string;
  origin: string;
  label: string;
  monthlyAgorot: number;
  status: string;
  currentPeriodEnd: string | null;
  createdAt: string;
}

interface Overview {
  seats: { total: number; used: number; grantedCounter: number };
  rows: SeatRow[];
  subscribers: Subscriber[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "ממתין לתשלום",
  active: "פעיל",
  past_due: "החיוב נכשל",
  cancelled: "בוטל — עד תום התקופה",
  released: "הסתיים",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "בעלים",
  manager: "מנהל",
  agent: "סוכן",
  assistant: "עוזר",
};

type Mode = "free" | "trial" | "billed";

export function WhatsappSeatsPanel({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** הקוד שהופק עכשיו — מוצג עם ברקוד, ולמי הוא שייך. */
  const [issued, setIssued] = useState<{ name: string; code: string; link: string | null } | null>(
    null,
  );

  const [mode, setMode] = useState<Mode>("free");
  const [endsAt, setEndsAt] = useState("");
  const [monthly, setMonthly] = useState("");

  const load = useCallback(() => {
    apiGet<Overview>(`/platform/agencies/${tenantId}/whatsapp`)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "טעינת מנויי הוואטסאפ נכשלה"),
      );
  }, [tenantId]);

  useEffect(load, [load]);

  async function issueFor(sub: Subscriber): Promise<void> {
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const res = await apiPost<{ code: string; link: string | null }>(
        `/platform/agencies/${tenantId}/whatsapp/link-code`,
        { userId: sub.userId },
      );
      setIssued({ name: sub.name, code: res.code, link: res.link });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפקת הקוד נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function grant(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/platform/agencies/${tenantId}/whatsapp/seats`, {
        mode,
        /*
         * סוף היום **בשעון ישראל**, כמו שאר התאריכים במסך הזה:
         * „ניסיון עד ה-30” פירושו שה-30 עוד פתוח. `+03:00` קבוע היה
         * שגוי חצי שנה, ו-`Z` היה סוגר את הניסיון שלוש שעות מוקדם.
         */
        ...(mode === "trial" && endsAt !== ""
          ? { endsAt: jerusalemWallIsoToUtc(`${endsAt}T23:59:59.000`).toISOString() }
          : {}),
        ...(mode === "billed" && monthly.trim() !== ""
          ? { monthlyAgorot: Math.round(Number(monthly) * 100) }
          : {}),
      });
      setEndsAt("");
      setMonthly("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הוספת המקום נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function release(row: SeatRow): Promise<void> {
    if (!window.confirm(`לסגור את המקום „${row.label}”? המכסה תרד מיד.`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/platform/agencies/${tenantId}/whatsapp/seats/${row.id}`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "סגירת המקום נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (error !== null && data === null) return <Notice tone="danger">{error}</Notice>;
  if (data === null) return <p aria-live="polite">טוען…</p>;

  return (
    <div>
      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      <p className="m-0 mb-3">
        <b>{data.seats.used}</b> מתוך <b>{data.seats.total}</b> מקומות בשימוש
        {data.seats.grantedCounter > 0 ? (
          <span style={{ color: "var(--color-text-muted)" }}>
            {" "}
            · {data.seats.grantedCounter} מהם מהמכסה הידנית
          </span>
        ) : null}
      </p>

      {/* --- מי מחזיק, ומי אימת --- */}
      <h4 className="mb-2 font-semibold">מנויים</h4>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--color-text-muted)" }}>
              <th scope="col" className="p-2 text-start">שם</th>
              <th scope="col" className="p-2 text-start">תפקיד</th>
              <th scope="col" className="p-2 text-start">גישה</th>
              <th scope="col" className="p-2 text-start">המכשיר</th>
              <th scope="col" className="p-2 text-start">
                <span className="mv-visually-hidden">פעולות</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.subscribers.map((sub) => (
              <tr key={sub.userId} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                <td className="p-2">
                  {sub.name}
                  {sub.isActive ? "" : " (מושבת)"}
                </td>
                <td className="p-2">{ROLE_LABEL[sub.role] ?? sub.role}</td>
                <td className="p-2">{sub.whatsappAccess ? "✓" : "—"}</td>
                <td className="p-2">
                  {!sub.linked ? (
                    <span style={{ color: "var(--color-text-muted)" }}>לא אומת</span>
                  ) : (
                    <>
                      <span dir="ltr">···{sub.tail}</span>
                      {sub.needsReverification ? (
                        <span className="ms-2" style={{ color: "var(--color-warning)" }}>
                          דורש אימות מחדש
                        </span>
                      ) : null}
                      {/*
                        „משתמע” = הקישור נוצר מהשוואת מספר טלפון ולא
                        מקוד. זה עובד, וזה גם ההבדל בין „המספר הזה
                        רשום אצלנו” לבין „מישהו הוכיח שהוא שלו”.
                      */}
                      {sub.implicit ? (
                        <span className="ms-2" style={{ color: "var(--color-text-muted)" }}>
                          משתמע
                        </span>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="p-2">
                  {sub.isActive ? (
                    <Button variant="secondary" disabled={busy} onClick={() => void issueFor(sub)}>
                      הפק קוד וברקוד
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {issued === null ? null : (
        <div className="mb-4">
          <p className="m-0 mb-1 text-sm">
            קוד חיבור עבור <b>{issued.name}</b>:
          </p>
          <WhatsappPairing code={issued.code} link={issued.link} forSomeoneElse />
        </div>
      )}

      {/* --- מקומות שנוספו --- */}
      {data.rows.length === 0 ? null : (
        <>
          <h4 className="mb-2 font-semibold">מקומות</h4>
          <ul className="mb-4 list-none p-0">
            {data.rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-2 border-t py-2 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              >
                <span className="font-semibold">{row.label}</span>
                {row.monthlyAgorot > 0 ? (
                  <span>{formatPrice(row.monthlyAgorot)} לחודש, לפני מע&quot;מ</span>
                ) : null}
                <span style={{ color: "var(--color-text-muted)" }}>
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
                {row.currentPeriodEnd === null ? null : (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {row.origin === "granted" ? "מסתיים" : "חיוב הבא"} ב-
                    {formatDate(row.currentPeriodEnd)}
                  </span>
                )}
                {row.origin === "granted" ? (
                  <Button variant="ghost" disabled={busy} onClick={() => void release(row)}>
                    סגור
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* --- הוספה --- */}
      <h4 className="mb-2 font-semibold">הוספת מנוי</h4>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block text-sm font-semibold">איך</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
          >
            <option value="free">בחינם — ללא הגבלת זמן</option>
            <option value="trial">בחינם לניסיון — עד תאריך</option>
            <option value="billed">תשלום חודשי</option>
          </select>
        </label>

        {mode === "trial" ? (
          <label>
            <span className="mb-1 block text-sm font-semibold">עד</span>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
            />
          </label>
        ) : null}

        {mode === "billed" ? (
          <label>
            {/*
              „לפני מע\"מ” נאמר בכל מקום שבו המערכת נוקבת במחיר —
              החיוב בפועל מוסיף מע\"מ מעל. מספר בלי המילים האלה הוא
              מספר שמישהו יסכם עליו בטלפון ויקבל חשבונית אחרת.
            */}
            <span className="mb-1 block text-sm font-semibold">₪ לחודש, לפני מע&quot;מ</span>
            <input
              type="number"
              min={1}
              step="1"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              className="w-28 rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
            />
          </label>
        ) : null}

        <Button variant="secondary" disabled={busy} onClick={() => void grant()}>
          הוסף
        </Button>
      </div>
      {/*
        ‎**מה יקרה בפועל** — נאמר לפני הלחיצה ולא מתגלה בחשבונית.
      */}
      <p className="m-0 mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {mode === "free"
          ? "המקום נפתח מיד ואינו מחויב לעולם. סגירה — ידנית מכאן."
          : mode === "trial"
            ? "המקום נפתח מיד, אינו מחויב, ונסגר מעצמו בתאריך שנבחר. אם המכסה תרד מתחת למספר המחזיקים — מישהו ינותק, והמשרד יקבל על כך מייל."
            : 'החודש הראשון על חשבון הבית, והחיוב הראשון ייגבה בעוד חודש מהכרטיס השמור של המשרד — הסכום שנקבע ועוד מע"מ. אין כרטיס — החיוב ייכשל, המשרד יקבל מייל, ואחרי שבועיים המקום ייסגר.'}
      </p>
    </div>
  );
}
