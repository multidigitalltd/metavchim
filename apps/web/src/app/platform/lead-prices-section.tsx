"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import type { LeadSourcePrice } from "@metavchim/shared";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { IconDiamond } from "../icons";

/**
 * מחיר ליד לפי מקור.
 *
 * המחיר הוא נתון ולא קבוע בקוד, כי מה שמשלמים לספק שונה בין ספק
 * לספק ומשתנה בזמן — מחיר אחד לכולם היה מחייב שינוי קוד ופריסה בכל
 * משא ומתן.
 *
 * `network` באפס אינו "טרם תומחר": שיתוף פעולה בין משרדים חינם בכל
 * המסלולים, וזו הצהרה מסחרית ולא ברירת מחדל טכנית.
 */
export function LeadPricesSection(): React.JSX.Element {
  const [prices, setPrices] = useState<LeadSourcePrice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    apiGet<{ prices: LeadSourcePrice[] }>("/platform/lead-prices")
      .then((res) => setPrices(res.prices))
      .catch(() => setPrices([]));
  }

  useEffect(load, []);

  async function save(event: FormEvent<HTMLFormElement>, source: string): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiPatch(`/platform/lead-prices/${encodeURIComponent(source)}`, {
        label: String(form.get("label")).trim(),
        creditsCost: Number(form.get("creditsCost")),
      });
      setMessage("✓ המחיר נשמר");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="lead-prices-heading"
    >
      <h2 id="lead-prices-heading" className="mb-1 text-lg font-semibold">
        <IconDiamond s={16} /> מחירי לידים
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כמה קרדיטים עולה למשרד להציע נכס על ביקוש, לפי מקור הביקוש. שיתוף פעולה בין
        משרדים (&quot;רשת&quot;) הוא חינם בכל המסלולים — אפס כאן הוא החלטה, לא היעדר
        תמחור.
      </p>

      {message ? (
        <p role="status" className="mb-2 text-sm" style={{ color: "var(--color-primary)" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {prices === null ? (
        <p aria-live="polite">טוען…</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {prices.map((price) => (
            <li key={price.source} className="mb-2">
              <form
                onSubmit={(e) => void save(e, price.source)}
                className="flex flex-wrap items-end gap-3"
              >
                <code
                  dir="ltr"
                  className="rounded px-2 py-1 text-sm"
                  style={{ background: "var(--color-bg)" }}
                >
                  {price.source}
                </code>
                <label className="flex-1" style={{ minWidth: "160px" }}>
                  <span className="mb-1 block text-sm font-medium">שם לתצוגה</span>
                  <input
                    name="label"
                    defaultValue={price.label}
                    maxLength={60}
                    className="w-full rounded-lg border px-3 py-2"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                  />
                </label>
                <label style={{ width: "120px" }}>
                  <span className="mb-1 block text-sm font-medium">קרדיטים</span>
                  <input
                    name="creditsCost"
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    defaultValue={price.creditsCost}
                    className="w-full rounded-lg border px-3 py-2"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  שמור
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
