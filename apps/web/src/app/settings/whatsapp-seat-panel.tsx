"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatPlanPrice,
  VAT_EXCLUDED_SUFFIX,
  type WhatsappSeatOffer,
} from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import { formatDate } from "@/lib/format";
import { Notice } from "../notice";

/**
 * מקומות נוספים לסוכן הוואטסאפ — **מנוי חודשי, לא רכישה לצמיתות.**
 *
 * מקום אחד כלול בכל מסלול שכולל את הסוכן; כל נוסף נרכש כאן, מחויב
 * מדי חודש, וניתן לביטול. חלק מחודש מחויב כחודש מלא, וביטול משאיר
 * את המקום עד סוף התקופה ששולמה — בדיוק כמו השכרת מספר.
 *
 * ## למה הפאנל מוצג גם כשאין מה לקנות
 *
 * הוא מציג קודם כול **כמה מקומות יש וכמה תפוסים**. בעל משרד שמנסה
 * להקצות את הסוכן לסוכן נוסף ונחסם צריך לראות למה, ובאותו מקום —
 * לא להסיק את הסיבה מהודעת שגיאה. מסלול שאינו מוכר מקומות אומר
 * זאת במפורש: „לא נמכר” אינו „טרם הוגדר”.
 */

interface SeatRow {
  id: string;
  monthlyAgorot: number;
  status: string;
  statusLabel: string;
  currentPeriodEnd: string | null;
}

interface Offering {
  seats: number;
  used: number;
  offer: WhatsappSeatOffer;
  checkoutAvailable: boolean;
  rows: SeatRow[];
}

export function WhatsAppSeatPanel(): React.JSX.Element | null {
  const { user } = useRequireAuth();
  const [offering, setOffering] = useState<Offering | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mayPay = can(user, "billing.manage");

  const load = useCallback(() => {
    apiGet<Offering>("/billing/whatsapp-seats")
      .then(setOffering)
      // כולל 403: מי שאין לו הרשאה פשוט אינו רואה את הפאנל
      .catch(() => setOffering(null));
  }, []);

  useEffect(load, [load]);

  async function buy(): Promise<void> {
    if (offering?.offer.kind !== "purchase") return;
    const price = `${formatPlanPrice(offering.offer.monthlyAgorot)} לחודש ${VAT_EXCLUDED_SUFFIX}`;
    /*
     * האישור אומר את **שלושת הדברים שמפתיעים אחר כך**: שזה מתחדש,
     * שחלק מחודש מחויב כחודש, ושביטול אינו מחזיר כסף. מנוי שנרכש
     * בלי שנאמרו הוא בדיוק המנוי שמגיע לשירות הלקוחות.
     */
    if (
      !window.confirm(
        `להוסיף מקום נוסף לסוכן הוואטסאפ תמורת ${price}?\n\nהתשלום מתחדש אוטומטית מדי חודש (חלק מחודש מחויב כחודש מלא), וניתן לבטל בכל עת — המקום יישאר עד סוף התקופה ששולמה.`,
      )
    ) {
      return;
    }
    setBusy("checkout");
    setError(null);
    try {
      const res = await apiPost<{ url: string }>("/billing/whatsapp-seats/checkout", {});
      window.location.assign(res.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "פתיחת התשלום נכשלה");
      setBusy(null);
    }
  }

  async function cancel(row: SeatRow): Promise<void> {
    const message =
      row.status === "pending"
        ? "לבטל את המקום שממתין לתשלום?"
        : "לבטל את חידוש המקום הנוסף?\n\nהמקום יישאר פעיל עד סוף התקופה ששולמה ואז ייסגר. אין החזר על חלק מחודש.\n\nכשהמקום ייסגר, ההקצאה של הסוכן שהצטרף אחרון תבוטל אוטומטית.";
    if (!window.confirm(message)) return;
    setBusy(row.id);
    setError(null);
    try {
      await apiPost(`/billing/whatsapp-seats/${row.id}/cancel`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "הביטול נכשל");
    } finally {
      setBusy(null);
    }
  }

  // מסלול בלי הסוכן כלל — אין מקומות, ואין על מה לדבר כאן
  if (offering === null || offering.seats === 0) return null;

  return (
    <div
      className="mb-4 rounded-xl border p-3"
      style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
    >
      <p className="m-0 mb-2 text-sm">
        <b>
          {offering.used} מתוך {offering.seats} {offering.seats === 1 ? "מקום" : "מקומות"} בשימוש
        </b>{" "}
        — מקום אחד כלול במסלול, וכל מקום נוסף הוא מנוי חודשי.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {offering.rows.length > 0 ? (
        <ul className="m-0 mb-2 flex list-none flex-col gap-1.5 p-0 text-sm">
          {offering.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <b>{formatPlanPrice(row.monthlyAgorot)} לחודש</b>
              <span
                style={
                  row.status === "past_due"
                    ? { color: "var(--color-danger)", fontWeight: 700 }
                    : { color: "var(--color-text-muted)" }
                }
              >
                {row.statusLabel}
              </span>
              {row.currentPeriodEnd ? (
                <span style={{ color: "var(--color-text-muted)" }}>
                  שולם עד {formatDate(row.currentPeriodEnd)}
                </span>
              ) : null}
              {mayPay &&
              (row.status === "active" || row.status === "past_due" || row.status === "pending") ? (
                <button
                  type="button"
                  className="mv-btn-plain ms-auto"
                  disabled={busy !== null}
                  onClick={() => void cancel(row)}
                >
                  {row.status === "pending" ? "בטל" : "בטל חידוש"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        ‎**כשאי אפשר לקנות — אומרים למה, ולא מציעים כפתור.** אותה
        הכרעה כמו במסך החיבור: כפתור שיכשל גרוע מהיעדר כפתור.
      */}
      {!mayPay ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          הוספת מקום נעשית על ידי בעל/ת המשרד.
        </p>
      ) : offering.offer.kind !== "purchase" ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          המסלול הנוכחי אינו כולל מקומות נוספים — פנו אלינו ונתאים.
        </p>
      ) : offering.checkoutAvailable === false ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          התשלום המקוון טרם הופעל במערכת — פנו אלינו כדי להוסיף מקום.
        </p>
      ) : (
        <button type="button" className="mv-btn-primary" disabled={busy !== null} onClick={() => void buy()}>
          {busy === "checkout"
            ? "פותח תשלום…"
            : `הוספת מקום — ${formatPlanPrice(offering.offer.monthlyAgorot)} לחודש ${VAT_EXCLUDED_SUFFIX}`}
        </button>
      )}
    </div>
  );
}
