"use client";

import { useCallback, useEffect, useState } from "react";
import { VAT_EXCLUDED_SUFFIX } from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import { formatDate, formatNumber } from "@/lib/format";
import { Notice } from "../notice";

/**
 * השכרת מספר וירטואלי — מהמלאי של הפלטפורמה, בתשלום חודשי.
 *
 * המשרד בוחר מספר פנוי, משלם חודש מראש בדף קארדקום, והמספר נתפס
 * ומופיע ברשימת הניתוב אוטומטית. חלק מחודש מחויב כחודש מלא, וביטול
 * משאיר את המספר עד סוף התקופה ששולמה.
 *
 * הפאנל נעלם כשהפלטפורמה טרם הפעילה את השירות — תכונה שאי אפשר
 * להשתמש בה אינה מוצגת, לא "בקרוב".
 */

interface RentalRow {
  id: string;
  number: string;
  numberDisplay: string;
  monthlyAgorot: number;
  status: string;
  statusLabel: string;
  currentPeriodEnd: string | null;
  provisioned: boolean;
}

interface Offering {
  configured: boolean;
  checkoutAvailable: boolean;
  monthlyAgorot: number | null;
  available: string[];
  rentals: RentalRow[];
}

export function NumberRentalPanel(): React.JSX.Element | null {
  const { user } = useRequireAuth();
  const [offering, setOffering] = useState<Offering | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mayPay = can(user, "billing.manage");

  const load = useCallback(() => {
    apiGet<Offering>("/billing/number-rental")
      .then(setOffering)
      // כולל 403: מי שאין לו את הפיצ'ר פשוט לא רואה את הפאנל
      .catch(() => setOffering(null));
  }, []);

  useEffect(load, [load]);

  async function rent(number: string): Promise<void> {
    const price = offering?.monthlyAgorot ?? 0;
    if (
      !window.confirm(
        `לשכור את המספר ${number} תמורת ${formatNumber(price / 100)} ₪ לחודש ${VAT_EXCLUDED_SUFFIX}?\n\nהתשלום מתחדש אוטומטית מדי חודש (חלק מחודש מחויב כחודש מלא), וניתן לבטל בכל עת — המספר יישאר עד סוף התקופה ששולמה.`,
      )
    ) {
      return;
    }
    setBusy(number);
    setError(null);
    try {
      const res = await apiPost<{ url: string }>("/billing/number-rental/checkout", { number });
      window.location.assign(res.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "פתיחת התשלום נכשלה");
      setBusy(null);
    }
  }

  async function cancel(rental: RentalRow): Promise<void> {
    const message =
      rental.status === "pending"
        ? `לבטל את ההשכרה הממתינה של ${rental.numberDisplay}?`
        : `לבטל את חידוש ההשכרה של ${rental.numberDisplay}?\n\nהמספר יישאר פעיל עד סוף התקופה ששולמה ואז ישוחרר. אין החזר על חלק מחודש.`;
    if (!window.confirm(message)) return;
    setBusy(rental.id);
    setError(null);
    try {
      await apiPost(`/billing/number-rental/${rental.id}/cancel`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "הביטול נכשל");
    } finally {
      setBusy(null);
    }
  }

  if (offering === null || !offering.configured || offering.monthlyAgorot === null) return null;

  return (
    <div
      className="mb-4 rounded-xl border p-3"
      style={{ borderColor: "var(--color-primary-accent)", background: "var(--color-bg)" }}
    >
      <p className="m-0 mb-2 text-sm">
        <b>אין לכם מספר פנוי? שכרו אחד דרך המערכת</b> —{" "}
        {formatNumber(offering.monthlyAgorot / 100)} ₪ לחודש {VAT_EXCLUDED_SUFFIX}, מופעל
        אוטומטית אחרי התשלום.
        חלק מחודש מחויב כחודש מלא, וביטול משאיר את המספר עד סוף התקופה ששולמה.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {offering.rentals.length > 0 ? (
        <ul className="m-0 mb-2 flex list-none flex-col gap-1.5 p-0 text-sm">
          {offering.rentals.map((rental) => (
            <li key={rental.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <b className="mv-ltr">{rental.numberDisplay}</b>
              <span
                style={
                  rental.status === "past_due"
                    ? { color: "var(--color-danger)", fontWeight: 700 }
                    : { color: "var(--color-text-muted)" }
                }
              >
                {rental.statusLabel}
                {/*
                  שולם והמספר טרם נתפס — המשרד צריך לדעת שזה בטיפול,
                  לא לחשוב שהכסף נעלם.
                */}
                {rental.status === "active" && !rental.provisioned
                  ? " · בהקמה — ניצור קשר בהקדם"
                  : ""}
              </span>
              {rental.currentPeriodEnd ? (
                <span style={{ color: "var(--color-text-muted)" }}>
                  שולם עד {formatDate(rental.currentPeriodEnd)}
                </span>
              ) : null}
              {mayPay && (rental.status === "active" || rental.status === "past_due" || rental.status === "pending") ? (
                <button
                  type="button"
                  className="mv-btn-plain ms-auto"
                  disabled={busy !== null}
                  onClick={() => void cancel(rental)}
                >
                  {rental.status === "pending" ? "בטל" : "בטל חידוש"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!mayPay ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          השכרה חדשה נעשית על ידי בעל/ת המשרד.
        </p>
      ) : offering.checkoutAvailable === false ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          התשלום המקוון טרם הופעל במערכת — פנו אלינו כדי לשכור מספר.
        </p>
      ) : offering.available.length === 0 ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          אין כרגע מספרים פנויים במלאי — פנו אלינו ונשיג עבורכם מספר.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">מספרים פנויים:</span>
          {offering.available.slice(0, 8).map((number) => (
            <button
              key={number}
              type="button"
              className="mv-chip mv-ltr"
              disabled={busy !== null}
              onClick={() => void rent(number)}
            >
              {busy === number ? "פותח תשלום…" : number}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
