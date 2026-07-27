"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { shekelsToAgorot, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

const inputStyle = {
  borderColor: "var(--color-border)",
  background: "var(--color-bg)",
} as const;

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
        entryDate: entry ? new Date(entry).toISOString() : undefined,
        hasElevator: f.get("hasElevator") === "on" ? true : undefined,
        hasParking: f.get("hasParking") === "on" ? true : undefined,
        hasBalcony: f.get("hasBalcony") === "on" ? true : undefined,
        hasSafeRoom: f.get("hasSafeRoom") === "on" ? true : undefined,
        marketingTitle: String(f.get("marketingTitle") ?? "").trim() || undefined,
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

          <fieldset className="mt-4">
            <legend className="mb-2 font-medium">מאפיינים</legend>
            <div className="flex flex-wrap gap-4">
              {[
                ["hasElevator", "מעלית"],
                ["hasParking", "חניה"],
                ["hasBalcony", "מרפסת"],
                ["hasSafeRoom", 'ממ"ד'],
              ].map(([name, label]) => (
                <label key={name} className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input type="checkbox" name={name} className="size-5" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">מחיר וכניסה</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="price" className="mb-1 block font-medium">מחיר (₪)</label>
              <input id="price" name="price" type="number" min="0" step="1000" inputMode="numeric" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="entryDate" className="mb-1 block font-medium">תאריך כניסה</label>
              <input id="entryDate" name="entryDate" type="date" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
          </div>
        </fieldset>

        <div className="mb-6">
          <label htmlFor="marketingTitle" className="mb-1 block font-medium">כותרת שיווקית</label>
          <input id="marketingTitle" name="marketingTitle" maxLength={160} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
        </div>

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
