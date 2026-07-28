"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { shekelsToAgorot } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

const FEATURES = [
  ["hasElevator", "מעלית"],
  ["hasParking", "חניה"],
  ["hasBalcony", "מרפסת"],
  ["hasSafeRoom", 'ממ"ד'],
  ["hasStorage", "מחסן"],
] as const;

/** נרמול טלפון ישראלי ל-E.164 — ‎050-1234567 → ‎+972501234567 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/gu, "");
  if (digits.startsWith("+972")) return digits;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return digits;
}

export default function NewBuyerPage() {
  useRequireAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const f = new FormData(event.currentTarget);
    const num = (name: string): number | undefined => {
      const v = String(f.get(name) ?? "").trim();
      return v === "" ? undefined : Number(v);
    };

    const features: Record<string, "must" | "nice"> = {};
    for (const [name] of FEATURES) {
      const level = String(f.get(`feature_${name}`) ?? "");
      if (level === "must" || level === "nice") features[name] = level;
    }

    const budgetShekels = num("budgetMax");
    try {
      const created = await apiPost<{ id: string }>("/buyers", {
        contactName: String(f.get("contactName")).trim(),
        contactPhone: normalizePhone(String(f.get("contactPhone"))),
        source: String(f.get("source")),
        maturity: String(f.get("maturity")),
        requirements: {
          cities: String(f.get("cities"))
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          neighborhoods: [],
          dealType: String(f.get("dealType")),
          propertyTypes: [],
          budgetMaxAgorot: budgetShekels === undefined ? 0 : shekelsToAgorot(budgetShekels),
          roomsMin: num("roomsMin"),
          roomsMax: num("roomsMax"),
          features,
        },
      });
      router.replace(`/buyers/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הקונה נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">קונה חדש</h1>

      <form onSubmit={onSubmit} noValidate>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">פרטי קשר</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="contactName" className="mb-1 block font-medium">שם מלא *</label>
              <input id="contactName" name="contactName" required minLength={2} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="contactPhone" className="mb-1 block font-medium">טלפון *</label>
              <input id="contactPhone" name="contactPhone" type="tel" required dir="ltr" placeholder="050-1234567" autoComplete="tel" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
          </div>
        </fieldset>

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">מה הוא מחפש</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cities" className="mb-1 block font-medium">ערים * <span className="font-normal">(מופרדות בפסיק)</span></label>
              <input id="cities" name="cities" required placeholder="בני ברק, פתח תקווה" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="dealType" className="mb-1 block font-medium">סוג עסקה *</label>
              <select id="dealType" name="dealType" required className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="sale">קנייה</option>
                <option value="rent">שכירות</option>
              </select>
            </div>
            <div>
              <label htmlFor="budgetMax" className="mb-1 block font-medium">תקציב מקסימלי (₪) *</label>
              <input id="budgetMax" name="budgetMax" type="number" required min="1000" step="10000" inputMode="numeric" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="roomsMin" className="mb-1 block font-medium">חדרים מ-</label>
                <input id="roomsMin" name="roomsMin" type="number" step="0.5" min="1" inputMode="decimal" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="roomsMax" className="mb-1 block font-medium">עד</label>
                <input id="roomsMax" name="roomsMax" type="number" step="0.5" min="1" inputMode="decimal" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
              </div>
            </div>
          </div>

          <fieldset className="mt-4">
            <legend className="mb-2 font-medium">מאפיינים — חובה או עדיפות?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURES.map(([name, label]) => (
                <div key={name} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3" style={{ borderColor: "var(--color-border)" }}>
                  <label htmlFor={`feature_${name}`} className="font-medium">{label}</label>
                  <select id={`feature_${name}`} name={`feature_${name}`} defaultValue="" className="rounded-md border px-2 py-1.5" style={inputStyle}>
                    <option value="">לא רלוונטי</option>
                    <option value="nice">עדיפות</option>
                    <option value="must">חובה</option>
                  </select>
                </div>
              ))}
            </div>
          </fieldset>
        </fieldset>

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">סטטוס</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="maturity" className="mb-1 block font-medium">רמת בשלות</label>
              <select id="maturity" name="maturity" defaultValue="interested" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="very_hot">חם מאוד — מחפש עכשיו</option>
                <option value="hot">חם — בתקופה הקרובה</option>
                <option value="interested">מתעניין — בשלב בדיקה</option>
                <option value="not_ripe">לא בשל</option>
              </select>
            </div>
            <div>
              <label htmlFor="source" className="mb-1 block font-medium">מקור הליד</label>
              <select id="source" name="source" defaultValue="phone" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="phone">טלפון</option>
                <option value="whatsapp">וואטסאפ</option>
                <option value="referral">המלצה</option>
                <option value="web">אתר</option>
                <option value="manual">אחר</option>
              </select>
            </div>
          </div>
        </fieldset>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "שומר…" : "שמור קונה"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            ביטול
          </Button>
        </div>
      </form>
    </div>
  );
}
