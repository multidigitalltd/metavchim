"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { PriceField } from "../../../price-field";
import { shekelsToAgorot, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { DictateFor } from "../../../dictation-field";
import { FeatureChips } from "../../feature-chips";

/**
 * עריכת נכס קיים — סוגר את הלולאה של "השלם פרטים": הדשבורד שולח לכאן
 * מתווך שהנכס שלו לא מוכן לשיווק, וכאן הוא משלים את החוסרים.
 * שדה שנשאר ריק לא נשלח כלל — לא דורס ערך קיים ולא מוחק אותו.
 */

const inputStyle = {
  borderColor: "var(--color-border)",
  background: "var(--color-bg)",
} as const;

interface PropertyDetail {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasBalcony?: boolean;
  hasSafeRoom?: boolean;
  hasStorage?: boolean;
  priceAgorot?: number;
  entryDate?: string;
  marketingTitle?: string;
  marketingDescription?: string;
}

function triState(form: FormData, name: string): boolean | undefined {
  const value = String(form.get(name) ?? "");
  return value === "yes" ? true : value === "no" ? false : undefined;
}

const FEATURES: [keyof PropertyDetail & string, string][] = [
  ["hasElevator", "מעלית"],
  ["hasParking", "חניה"],
  ["hasBalcony", "מרפסת"],
  ["hasSafeRoom", 'ממ"ד'],
  ["hasStorage", "מחסן"],
];

export default function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    apiGet<PropertyDetail>(`/properties/${id}`)
      .then(setProperty)
      .catch(() => setError("הנכס לא נמצא"));
  }, [authLoading, id]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const f = new FormData(event.currentTarget);
    const str = (name: string): string | undefined => {
      const v = String(f.get(name) ?? "").trim();
      return v === "" ? undefined : v;
    };
    const num = (name: string): number | undefined => {
      const v = String(f.get(name) ?? "").trim();
      return v === "" ? undefined : Number(v);
    };
    const priceShekels = num("price");
    const entry = String(f.get("entryDate") ?? "");

    // רק שדות עם ערך נשלחים — PATCH חלקי, לא דריסה
    const patch: Record<string, unknown> = {
      city: str("city"),
      neighborhood: str("neighborhood"),
      street: str("street"),
      propertyType: str("propertyType"),
      dealType: str("dealType"),
      rooms: num("rooms"),
      areaSqm: num("areaSqm"),
      floor: num("floor"),
      totalFloors: num("totalFloors"),
      priceAgorot: priceShekels === undefined ? undefined : shekelsToAgorot(priceShekels),
      entryDate: entry ? new Date(entry).toISOString() : undefined,
      hasElevator: triState(f, "hasElevator"),
      hasParking: triState(f, "hasParking"),
      hasBalcony: triState(f, "hasBalcony"),
      hasSafeRoom: triState(f, "hasSafeRoom"),
      hasStorage: triState(f, "hasStorage"),
      marketingTitle: str("marketingTitle"),
      marketingDescription: str("marketingDescription"),
    };
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) delete patch[key];
    }

    try {
      await apiPatch(`/properties/${id}`, patch);
      router.replace(`/properties/${id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת השינויים נכשלה");
      setSubmitting(false);
    }
  }

  if (error && !property) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/properties" className="underline">חזרה לרשימה</Link>
      </p>
    );
  }
  if (!property) return <p aria-live="polite">טוען…</p>;

  const address = [property.street, property.neighborhood, property.city].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-2xl">
      <nav aria-label="נתיב" className="mb-4 text-sm">
        <Link href="/properties" className="underline">נכסים</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/properties/${id}`} className="underline">{address || "נכס"}</Link>
        <span aria-hidden="true"> / </span>
        <span>עריכה</span>
      </nav>
      <h1 className="mb-6 text-2xl font-bold">עריכת נכס</h1>

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
              <label htmlFor="city" className="mb-1 block font-medium">עיר</label>
              <input id="city" name="city" defaultValue={property.city ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="neighborhood" className="mb-1 block font-medium">שכונה</label>
              <input id="neighborhood" name="neighborhood" defaultValue={property.neighborhood ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="street" className="mb-1 block font-medium">רחוב</label>
              <input id="street" name="street" defaultValue={property.street ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
          </div>
        </fieldset>

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">פרטי הנכס</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="propertyType" className="mb-1 block font-medium">סוג נכס</label>
              <select id="propertyType" name="propertyType" defaultValue={property.propertyType ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="">לא נבחר</option>
                {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dealType" className="mb-1 block font-medium">סוג עסקה</label>
              <select id="dealType" name="dealType" defaultValue={property.dealType ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="">לא נבחר</option>
                <option value="sale">מכירה</option>
                <option value="rent">השכרה</option>
              </select>
            </div>
            <div>
              <label htmlFor="rooms" className="mb-1 block font-medium">חדרים</label>
              <input id="rooms" name="rooms" type="number" step="0.5" min="1" max="20" inputMode="decimal" defaultValue={property.rooms ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="areaSqm" className="mb-1 block font-medium">שטח (מ&quot;ר)</label>
              <input id="areaSqm" name="areaSqm" type="number" min="10" max="2000" inputMode="numeric" defaultValue={property.areaSqm ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="floor" className="mb-1 block font-medium">קומה</label>
              <input id="floor" name="floor" type="number" min="-2" max="60" inputMode="numeric" defaultValue={property.floor ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="totalFloors" className="mb-1 block font-medium">קומות בבניין</label>
              <input id="totalFloors" name="totalFloors" type="number" min="1" max="60" inputMode="numeric" defaultValue={property.totalFloors ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
          </div>

          <FeatureChips
            features={FEATURES}
            initial={Object.fromEntries(
              FEATURES.map(([name]) => [name, property[name] as boolean | undefined]),
            )}
          />
        </fieldset>

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">מחיר וכניסה</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <PriceField
              id="price"
              name="price"
              label="מחיר (₪)"
              defaultValue={property.priceAgorot === undefined ? "" : Math.round(property.priceAgorot / 100)}
            />
            <div>
              <label htmlFor="entryDate" className="mb-1 block font-medium">תאריך כניסה</label>
              <input
                id="entryDate"
                name="entryDate"
                type="date"
                defaultValue={property.entryDate ? property.entryDate.slice(0, 10) : ""}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
          </div>
        </fieldset>

        <div className="mb-4">
          <label htmlFor="marketingTitle" className="mb-1 block font-medium">כותרת שיווקית</label>
          <input id="marketingTitle" name="marketingTitle" maxLength={160} defaultValue={property.marketingTitle ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          <DictateFor targetId="marketingTitle" />
        </div>
        <div className="mb-6">
          <label htmlFor="marketingDescription" className="mb-1 block font-medium">תיאור שיווקי</label>
          <textarea id="marketingDescription" name="marketingDescription" rows={4} maxLength={4000} defaultValue={property.marketingDescription ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          <DictateFor targetId="marketingDescription" />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "שומר…" : "שמור שינויים"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push(`/properties/${id}`)}>
            ביטול
          </Button>
        </div>
      </form>
    </div>
  );
}
