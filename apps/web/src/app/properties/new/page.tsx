"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { shekelsToAgorot, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { DictateFor } from "../../dictation-field";
import { PriceField } from "../../price-field";
import { FeatureChips } from "../feature-chips";
import { EntryTimingField } from "../entry-timing-field";

const inputStyle = {
  borderColor: "var(--color-border)",
  background: "var(--color-bg)",
} as const;

/** נרמול טלפון ישראלי ל-E.164 — ‎050-1234567 → ‎+972501234567 */
function normalizeOwnerPhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/gu, "");
  if (digits.startsWith("+972")) return digits;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return digits;
}

function triState(form: FormData, name: string): boolean | undefined {
  const value = String(form.get(name) ?? "");
  return value === "yes" ? true : value === "no" ? false : undefined;
}

export default function NewPropertyPage() {
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
    const priceShekels = num("price");
    const entry = String(f.get("entryDate") ?? "");
    const entryType = String(f.get("entryType") ?? "");

    try {
      const created = await apiPost<{ id: string }>("/properties", {
        city: String(f.get("city")).trim(),
        neighborhood: String(f.get("neighborhood") ?? "").trim() || undefined,
        street: String(f.get("street") ?? "").trim() || undefined,
        propertyType: String(f.get("propertyType")),
        dealType: String(f.get("dealType")),
        rooms: num("rooms"),
        areaSqm: num("areaSqm"),
        floor: num("floor"),
        totalFloors: num("totalFloors"),
        priceAgorot: priceShekels === undefined ? undefined : shekelsToAgorot(priceShekels),
        entryType: entryType || undefined,
        entryDate: entry ? new Date(entry).toISOString() : undefined,
        entryNote: String(f.get("entryNote") ?? "").trim() || undefined,
        // תלת-מצבי: "" = לא ידוע (נשאר חוסר), yes/no = עובדה מפורשת.
        // "אין מעלית" הוא מידע קריטי להתאמות — לא היעדר מידע (ביקורת Codex, PR #1).
        hasElevator: triState(f, "hasElevator"),
        hasParking: triState(f, "hasParking"),
        hasBalcony: triState(f, "hasBalcony"),
        hasSafeRoom: triState(f, "hasSafeRoom"),
        marketingTitle: String(f.get("marketingTitle") ?? "").trim() || undefined,
        ...(String(f.get("ownerName") ?? "").trim() !== "" &&
        String(f.get("ownerPhone") ?? "").trim() !== ""
          ? {
              ownerName: String(f.get("ownerName")).trim(),
              ownerPhone: normalizeOwnerPhone(String(f.get("ownerPhone"))),
            }
          : {}),
      });
      router.replace(`/properties/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הנכס נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">נכס חדש</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        מלאו מה שידוע — המערכת תסמן מה חסר להשלמה. (קליטה בקול תתווסף בקרוב)
      </p>

      <form onSubmit={onSubmit} noValidate>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">מיקום</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="city" className="mb-1 block font-medium">עיר *</label>
              <input id="city" name="city" required className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="neighborhood" className="mb-1 block font-medium">שכונה</label>
              <input id="neighborhood" name="neighborhood" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="street" className="mb-1 block font-medium">רחוב</label>
              <input id="street" name="street" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
          </div>
        </fieldset>

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">פרטי הנכס</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="propertyType" className="mb-1 block font-medium">סוג נכס *</label>
              <select id="propertyType" name="propertyType" required className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dealType" className="mb-1 block font-medium">סוג עסקה *</label>
              <select id="dealType" name="dealType" required className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="sale">מכירה</option>
                <option value="rent">השכרה</option>
              </select>
            </div>
            <div>
              <label htmlFor="rooms" className="mb-1 block font-medium">חדרים</label>
              <input id="rooms" name="rooms" type="number" step="0.5" min="1" max="20" inputMode="decimal" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="areaSqm" className="mb-1 block font-medium">שטח (מ&quot;ר)</label>
              <input id="areaSqm" name="areaSqm" type="number" min="10" max="2000" inputMode="numeric" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="floor" className="mb-1 block font-medium">קומה</label>
              <input id="floor" name="floor" type="number" min="-2" max="60" inputMode="numeric" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="totalFloors" className="mb-1 block font-medium">קומות בבניין</label>
              <input id="totalFloors" name="totalFloors" type="number" min="1" max="60" inputMode="numeric" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
          </div>

          <FeatureChips
            features={[
              ["hasElevator", "מעלית"],
              ["hasParking", "חניה"],
              ["hasBalcony", "מרפסת"],
              ["hasSafeRoom", 'ממ"ד'],
            ]}
          />
        </fieldset>

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">מחיר וכניסה</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* המחיר גם במילים — ספרה עודפת במיליונים קופצת לעין */}
            <PriceField id="price" name="price" label="מחיר (₪)" />
            <EntryTimingField side="property" inputStyle={inputStyle} />
          </div>
        </fieldset>

        <div className="mb-6">
          <label htmlFor="marketingTitle" className="mb-1 block font-medium">כותרת שיווקית</label>
          <input id="marketingTitle" name="marketingTitle" maxLength={160} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          <DictateFor targetId="marketingTitle" />
        </div>

        <fieldset className="mb-6">
          <legend className="mb-2 font-medium">בעל הנכס (אופציונלי)</legend>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1" style={{ minWidth: "180px" }}>
              <label htmlFor="ownerName" className="mb-1 block text-sm">שם</label>
              <input id="ownerName" name="ownerName" maxLength={120} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div className="flex-1" style={{ minWidth: "180px" }}>
              <label htmlFor="ownerPhone" className="mb-1 block text-sm">טלפון</label>
              <input id="ownerPhone" name="ownerPhone" type="tel" dir="ltr" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            נקשר לאיש הקשר לפי הטלפון — יופיע בתיק הלקוח המאוחד.
          </p>
        </fieldset>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "שומר…" : "שמור נכס"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            ביטול
          </Button>
        </div>
      </form>
    </div>
  );
}
