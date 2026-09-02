"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, ApiError, apiList } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * השכרות המספרים — הרשימה שהטיפול הידני עובד מולה.
 *
 * הרכישה והתפיסה אוטומטיות, אבל הניתוב הסופי אצל 015 ידני. שתי
 * השורות שדורשות פעולה מסומנות באדום: תשלום שהתקבל בלי שהמספר
 * נתפס (הכסף נגבה, המספר לא), וחיוב חודשי שנכשל (להחליט: גבייה
 * ידנית או שחרור). כפתור "שחרר עכשיו" הוא כלי ההחלטה — אין החזר
 * כספי אוטומטי; זיכוי נעשה במסך התשלומים.
 */

interface RentalRow {
  id: string;
  tenantId: string;
  tenantName: string;
  number: string;
  numberDisplay: string;
  monthlyAgorot: number;
  status: string;
  currentPeriodEnd: string | null;
  provisioned: boolean;
  /** `purchased` מהמלאי של 015, או `platform` — חיוב שנפתח משולחן החיבורים. */
  origin: string;
  providerError: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "ממתין לתשלום",
  active: "פעיל",
  past_due: "חיוב נכשל",
  cancelled: "בוטל — עד סוף התקופה",
  released: "שוחרר",
};

export function NumberRentalsSection(): React.JSX.Element {
  const [rentals, setRentals] = useState<RentalRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    setLoadFailed(false);
    apiGet<{ rentals: RentalRow[] }>("/platform/number-rentals")
      .then((res) => setRentals(apiList(res.rentals, "rentals")))
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, []);

  async function release(rental: RentalRow): Promise<void> {
    const consequence =
      rental.origin === "platform"
        ? "החיוב החודשי ייפסק. המספר של המשרד הוא, והניתוב שלו נשאר. אין החזר כספי אוטומטי."
        : "המספר יימחק מחשבון 015 של הפלטפורמה ושורת הניתוב של המשרד תכובה. אין החזר כספי אוטומטי.";
    if (
      !window.confirm(
        `לשחרר עכשיו את המספר ${rental.numberDisplay} של "${rental.tenantName}"?\n\n${consequence}`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiPost(`/platform/number-rentals/${rental.id}/release`, {});
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השחרור נכשל");
    }
  }

  /*
   * המסך מוסתר כשאין אף השכרה — רוב הזמן זה המצב, ורשימה ריקה
   * קבועה היא רעש. שגיאת טעינה כן מוצגת: "אין השכרות" על סמך בקשה
   * שנכשלה היה מסתיר בדיוק את השורה שדורשת טיפול.
   */
  if (!loadFailed && (rentals === null || rentals.length === 0)) return <></>;

  return (
    <section className="mv-list-card mb-8 px-5 py-[17px]" aria-labelledby="number-rentals-heading">
      <h2 id="number-rentals-heading" className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        השכרות וחיובי מספרים
      </h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
        השכרה מ-015: הרכישה והתפיסה אוטומטיות, הניתוב אצל 015 ידני. חיוב מהפלטפורמה: מספר
        של המשרד שנגבה עליו שירות חודשי. שורה אדומה = דרושה פעולה.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {loadFailed ? (
        <LoadError message="לא הצלחנו לטעון את ההשכרות" onRetry={load} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(rentals ?? []).map((rental) => {
            const platformCharge = rental.origin === "platform";
            /*
             * חיוב מהפלטפורמה שבוטל או הסתיים: המספר עדיין מנותב
             * ואיש לא משלם — זו שורה שדורשת החלטה, לא היסטוריה.
             */
            const unpaidRouting =
              platformCharge && (rental.status === "cancelled" || rental.status === "released");
            const needsAttention =
              rental.status === "past_due" ||
              (rental.status === "active" && !rental.provisioned && !platformCharge) ||
              unpaidRouting ||
              rental.providerError !== null;
            return (
              <li
                key={rental.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2.5 text-[length:var(--type-caption-lg)]"
                style={{
                  borderColor: needsAttention ? "var(--color-danger)" : "var(--color-border)",
                  opacity: rental.status === "released" && !unpaidRouting ? 0.55 : 1,
                }}
              >
                <b className="mv-ltr">{rental.numberDisplay}</b>
                <span>{rental.tenantName}</span>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {platformCharge ? "חיוב מהפלטפורמה" : "השכרה מ-015"}
                </span>
                <span>
                  {formatNumber(rental.monthlyAgorot / 100)} ₪ לחודש לפני מע&quot;מ
                </span>
                <span style={needsAttention ? { color: "var(--color-danger)", fontWeight: 700 } : undefined}>
                  {STATUS_LABELS[rental.status] ?? rental.status}
                  {rental.status === "active" && !rental.provisioned && !platformCharge
                    ? " · שולם אך לא נתפס!"
                    : ""}
                  {unpaidRouting ? " · המספר עדיין מנותב בלי תשלום — לטפל" : ""}
                </span>
                {rental.currentPeriodEnd ? (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    שולם עד {formatDate(rental.currentPeriodEnd)}
                  </span>
                ) : null}
                {rental.providerError ? (
                  <span className="basis-full text-[length:var(--type-caption)]" style={{ color: "var(--color-danger)" }}>
                    {rental.providerError}
                  </span>
                ) : null}
                {rental.status !== "released" && rental.status !== "pending" ? (
                  <button type="button" className="mv-btn-plain ms-auto" onClick={() => void release(rental)}>
                    שחרר עכשיו
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
