"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  DEFAULT_CREDIT_ECONOMY,
  packageDiscountPercent,
  packageUnitPriceAgorot,
  settleReferral,
  type CreditEconomy,
  type CreditPackage,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { IconCoins } from "../icons";

/**
 * כלכלת הרשת — **כל מספר מסחרי במקום אחד, וכולם עריכים.**
 *
 * הדרישה הייתה מפורשת: המחירים משתנים כל הזמן. לכן אין כאן שום מספר
 * שקבוע בקוד — מחיר קרדיט, חבילות, בונוס, שתי העמלות, סף המשיכה,
 * התפוגה ומענק הפתיחה נקראים מהשרת ונשמרים אליו. שינוי מחיר אינו
 * אמור להיות גרסה חדשה.
 *
 * **שדה ריק = חזרה לברירת המחדל, לא אפס.** ההבחנה הזו קריטית:
 * `Number("")` הוא 0, ומסך שמתייחס לשדה שנוקה כאפס היה מאפס מחיר
 * בשקט ומוכר קרדיטים חינם.
 *
 * המסך מציג תרחיש חי מתחת למספרים. תמחור דו-מסלולי קשה לדמיין בראש,
 * וטעות כאן היא כסף אמיתי — עדיף לראות את התוצאה לפני ששומרים.
 */

/** שקלים במסך, אגורות בשרת — ההמרה בקצה, כמו בכל כסף במערכת. */
const toShekels = (agorot: number): string => (agorot / 100).toFixed(2).replace(/\.00$/u, "");
const toAgorot = (shekels: string): number => Math.round(Number(shekels) * 100);

/** שדה מספרי אחד. `hint` מסביר מה קורה כשמשאירים ריק. */
function NumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
  step = "1",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  suffix?: string;
  hint?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border px-2.5 py-2"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
        {suffix !== undefined ? (
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{suffix}</span>
        ) : null}
      </span>
      {hint !== undefined ? (
        <span className="mt-0.5 block text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function CreditEconomySection() {
  const [economy, setEconomy] = useState<CreditEconomy | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ creditEconomy: CreditEconomy }>("/platform/settings")
      .then(({ creditEconomy }) => {
        setEconomy(creditEconomy);
        setPackages(creditEconomy.packages);
        setForm({
          unitPrice: toShekels(creditEconomy.unitPriceAgorot),
          bonus: String(creditEconomy.creditBonusPercent),
          feeCash: String(creditEconomy.feeCashPercent),
          payoutMin: toShekels(creditEconomy.payoutMinimumAgorot),
          expiry: String(creditEconomy.expiryMonths),
          grant: String(creditEconomy.initialGrantCredits),
        });
      })
      .catch(() => setError("טעינת ההגדרות נכשלה"));
  }, []);

  /*
   * ריק נשלח כמחרוזת ריקה ולא כאפס — השרת מבין אותה כ"חזרה לברירת
   * המחדל". מספר עובר כמספר, כולל אפס, שהוא החלטה לגיטימית.
   */
  const numeric = (raw: string | undefined): number | "" =>
    raw === undefined || raw.trim() === "" ? "" : Number(raw);
  const money = (raw: string | undefined): number | "" =>
    raw === undefined || raw.trim() === "" ? "" : toAgorot(raw);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await apiPatch("/platform/settings", {
        creditUnitPriceAgorot: money(form.unitPrice),
        creditBonusPercent: numeric(form.bonus),
        creditFeeCashPercent: numeric(form.feeCash),
        creditPayoutMinimumAgorot: money(form.payoutMin),
        creditExpiryMonths: numeric(form.expiry),
        creditInitialGrant: numeric(form.grant),
        creditPackages: packages,
      });
      const { creditEconomy } = await apiGet<{ creditEconomy: CreditEconomy }>(
        "/platform/settings",
      );
      setEconomy(creditEconomy);
      setNote("נשמר");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (economy === null) {
    return (
      <section className="mb-8 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p aria-live="polite">{error ?? "טוען…"}</p>
      </section>
    );
  }

  /*
   * תרחיש חי — עם המספרים שבטופס.
   *
   * שדה ריק נופל ל**ברירת המחדל** ולא לערך השמור: ריק פירושו מחיקת
   * ההגדרה, והשרת יחזור לברירת המחדל. תצוגה שמראה את הערך הישן דווקא
   * ברגע האיפוס מטעה בדיוק כשצריך לראות מה עומד לקרות.
   */
  const fromForm = (raw: string | undefined, fallback: number, isMoney = false): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    return isMoney ? toAgorot(raw) : Number(raw);
  };
  const preview = {
    ...economy,
    unitPriceAgorot: fromForm(form.unitPrice, DEFAULT_CREDIT_ECONOMY.unitPriceAgorot, true),
    creditBonusPercent: fromForm(form.bonus, DEFAULT_CREDIT_ECONOMY.creditBonusPercent),
    feeCashPercent: fromForm(form.feeCash, DEFAULT_CREDIT_ECONOMY.feeCashPercent),
  };
  const asCredits = settleReferral(100, "credits", preview);
  const asCash = settleReferral(100, "cash", preview);

  return (
    <section
      aria-labelledby="credit-economy"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="credit-economy" className="mb-1 text-lg font-semibold">
        <IconCoins s={16} /> כלכלת הרשת
      </h2>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כל המספרים המסחריים במקום אחד. <b>שדה ריק חוזר לברירת המחדל</b> ואינו
        מתפרש כאפס — אפס הוא החלטה מפורשת שצריך להקליד.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <NumberField
          label="מחיר קרדיט בודד"
          suffix="₪"
          step="0.01"
          value={form.unitPrice ?? ""}
          onChange={(v) => setForm({ ...form, unitPrice: v })}
          hint="הבסיס לחישוב ההנחה בחבילות ולפדיון בכסף"
        />
        <NumberField
          label="מענק פתיחה למשרד חדש"
          suffix="קרדיטים"
          value={form.grant ?? ""}
          onChange={(v) => setForm({ ...form, grant: v })}
          hint="0 = בלי מענק"
        />
        <NumberField
          label="תוקף קרדיט"
          suffix="חודשים"
          value={form.expiry ?? ""}
          onChange={(v) => setForm({ ...form, expiry: v })}
          hint="0 = ללא תפוגה. פגים רק מענק פתיחה ותמורה על הפניות — קרדיט שנרכש בכסף אינו פג"
        />
      </div>

      {/* ---------- חבילות ---------- */}
      <h3 className="mb-1 text-sm font-semibold">חבילות למכירה</h3>
      <p className="mb-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
        בלי חבילות נמכר ביחידות בלבד. ההנחה מחושבת מול מחיר הקרדיט הבודד.
      </p>
      <div className="mb-2 flex flex-col gap-2">
        {packages.map((pkg, i) => {
          const discount = packageDiscountPercent(pkg, preview.unitPriceAgorot);
          return (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="grow">
                <span className="mb-1 block text-xs font-semibold">כמות</span>
                <input
                  type="number"
                  min="1"
                  value={pkg.credits}
                  onChange={(e) =>
                    setPackages(
                      packages.map((p, j) =>
                        j === i ? { ...p, credits: Number(e.target.value) } : p,
                      ),
                    )
                  }
                  className="w-full rounded-lg border px-2.5 py-2"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                />
              </label>
              <label className="grow">
                <span className="mb-1 block text-xs font-semibold">מחיר (₪)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={toShekels(pkg.priceAgorot)}
                  onChange={(e) =>
                    setPackages(
                      packages.map((p, j) =>
                        j === i ? { ...p, priceAgorot: toAgorot(e.target.value) } : p,
                      ),
                    )
                  }
                  className="w-full rounded-lg border px-2.5 py-2"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                />
              </label>
              <span className="pb-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                {toShekels(Math.round(packageUnitPriceAgorot(pkg)))} ₪ לקרדיט
                {/* הנחה שלילית מוצגת ככזו: חבילה יקרה ממחיר היחידה היא טעות הקלדה */}
                {discount !== 0 ? (
                  <b style={{ color: discount > 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                    {" "}
                    · {discount > 0 ? `${discount}% הנחה` : `${-discount}% יקר יותר`}
                  </b>
                ) : null}
              </span>
              <button
                type="button"
                className="mv-btn-plain pb-2"
                style={{ color: "var(--color-danger)" }}
                onClick={() => setPackages(packages.filter((_, j) => j !== i))}
              >
                הסר
              </button>
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        onClick={() => setPackages([...packages, { credits: 50, priceAgorot: preview.unitPriceAgorot * 45 }])}
      >
        + הוסף חבילה
      </Button>

      {/* ---------- התמורה על הפניה ---------- */}
      <h3 className="mb-1 mt-5 text-sm font-semibold">התמורה על הפניית לקוח</h3>
      <p className="mb-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
        <b>שני המסלולים פעילים.</b> המשרד המפנה בוחר ברגע הפרסום, והבחירה
        נצרבת על ההפניה — שינוי מחיר אחר כך אינו נוגע בעסקה שכבר פורסמה. עמלת
        מסלול הקרדיטים נערכת למעלה כ&quot;עמלת הפלטפורמה על הפניית לקוח&quot;,
        הגדרה אחת ולא שתיים לאותה גבייה.
        <br />
        מסלול הכסף מזכה את המשרד ב<b>יתרה כספית</b> שאותה הוא מושך לחשבון הבנק,
        באישורכם, בתור &quot;בקשות משיכה&quot; שלמעלה במסך.
      </p>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <NumberField
          label="בונוס על בחירת קרדיטים"
          suffix="%"
          value={form.bonus ?? ""}
          onChange={(v) => setForm({ ...form, bonus: v })}
        />
        <NumberField
          label="עמלת פלטפורמה — מסלול כסף"
          suffix="%"
          value={form.feeCash ?? ""}
          onChange={(v) => setForm({ ...form, feeCash: v })}
          hint="גבוה מעמלת הקרדיטים — זה מחיר הנזילות"
        />
      </div>
      <NumberField
        label="סף משיכה מינימלי"
        suffix="₪"
        step="0.01"
        value={form.payoutMin ?? ""}
        onChange={(v) => setForm({ ...form, payoutMin: v })}
        hint="מתחת לסכום הזה אי אפשר לבקש משיכה — העברה בין עוסקים היא אירוע חשבונאי עם עלות קבועה"
      />

      {/* תרחיש חי: תמחור דו-מסלולי קשה לדמיין, וטעות כאן היא כסף אמיתי */}
      <div
        className="mt-3 rounded-lg border p-3 text-[14.5px]"
        style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      >
        <b>לדוגמה — הפניה שנמכרה ב-100 קרדיטים:</b>
        <div className="mt-1">
          בחר <b>קרדיטים</b>: הפלטפורמה שומרת {asCredits.platformFeeCredits}, המשרד מקבל{" "}
          <b>{asCredits.payoutCredits} קרדיטים</b> (כולל הבונוס).
        </div>
        <div>
          בחר <b>כסף</b>: הפלטפורמה שומרת {asCash.platformFeeCredits}, המשרד מקבל{" "}
          <b>{toShekels(asCash.payoutAgorot)} ₪</b>.
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      {note !== null ? (
        <p role="status" className="mt-3 text-sm font-bold" style={{ color: "var(--color-primary)" }}>
          ✓ {note}
        </p>
      ) : null}

      <div className="mt-3">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "שומר…" : "שמור"}
        </Button>
      </div>
    </section>
  );
}
