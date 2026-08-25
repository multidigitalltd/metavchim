"use client";

import { useState } from "react";
import { Button } from "@metavchim/ui";
import { packageDiscountPercent } from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import { Notice } from "../notice";

/**
 * רכישת קרדיטים.
 *
 * **עד כה לא הייתה דרך לקנות.** משרד שסיים את מענק הפתיחה נתקע,
 * והשרת אפילו הפנה אותו ל"ניתן לרכוש בהגדרות" — מקום שלא היה בו
 * כלום. זה המסך שסוגר את זה.
 *
 * החבילות והמחיר מגיעים מהשרת ולא נכתבים כאן: הם משתנים כל הזמן,
 * וזו בדיוק הסיבה שהם הגדרה ולא קוד. **הכמות בלבד נשלחת** — הסכום
 * נקבע בשרת, כי מחיר שמגיע מהדפדפן הוא הזמנה לשלם כמה שרוצים.
 */

interface CreditPackage {
  credits: number;
  priceAgorot: number;
}

const shekels = (agorot: number): string =>
  (agorot / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 });

export function BuyCredits({
  unitPriceAgorot,
  packages,
}: {
  unitPriceAgorot: number;
  packages: CreditPackage[];
}) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy(credits: number): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { url } = await apiPost<{ url: string }>(
        "/billing/credits/checkout",
        { credits },
      );
      // מעבר לדף התשלום המתארח של הסולק — פרטי הכרטיס לעולם לא אצלנו
      window.location.href = url;
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.status === 403
            ? "רכישת קרדיטים מותרת למי שמנהל את החיוב במשרד"
            : err.message
          : "פתיחת דף התשלום נכשלה",
      );
      setBusy(false);
    }
  }

  const customCredits = Number(custom);
  const customValid = Number.isInteger(customCredits) && customCredits > 0;

  return (
    <div
      className="mt-3 rounded-xl border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <h3 className="m-0 mb-2 text-sm font-semibold">רכישת קרדיטים</h3>

      {packages.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {packages.map((pkg) => {
            const discount = packageDiscountPercent(pkg, unitPriceAgorot);
            return (
              <button
                key={pkg.credits}
                type="button"
                disabled={busy}
                onClick={() => void buy(pkg.credits)}
                className="rounded-lg border px-3 py-2 text-start"
                style={{
                  borderColor: "var(--color-input-border)",
                  background: "var(--color-surface)",
                }}
              >
                <span className="block text-[length:var(--type-body)] font-bold">
                  {pkg.credits} קרדיטים
                </span>
                <span className="block text-[length:var(--type-caption-lg)]">
                  {shekels(pkg.priceAgorot)} ₪
                </span>
                {/* הנחה שלילית לא מוצגת כ"הנחה" — היא טעות תמחור, לא מבצע */}
                {discount > 0 ? (
                  <span
                    className="block text-[length:var(--type-caption)] font-bold"
                    style={{ color: "var(--color-success)" }}
                  >
                    {discount}% הנחה
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="grow">
          <span className="mb-1 block text-sm font-semibold">
            כמות אחרת ({shekels(unitPriceAgorot)} ₪ לקרדיט)
          </span>
          <input
            type="number"
            min="1"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="למשל 25"
            className="w-full rounded-lg border px-2.5 py-2"
            style={{
              borderColor: "var(--color-input-border)",
              background: "var(--color-surface)",
            }}
          />
        </label>
        <Button
          disabled={busy || !customValid}
          onClick={() => void buy(customCredits)}
        >
          {busy
            ? "מעביר לתשלום…"
            : customValid
              ? `לתשלום — ${shekels(unitPriceAgorot * customCredits)} ₪`
              : "לתשלום"}
        </Button>
      </div>

      {error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      <p
        className="m-0 mt-2 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        התשלום מתבצע בדף המאובטח של חברת הסליקה; פרטי האשראי אינם עוברים דרך
        המערכת. הקרדיטים נכנסים ליתרה מיד עם אישור התשלום.
      </p>
    </div>
  );
}
