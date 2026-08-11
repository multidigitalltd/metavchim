"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { PriceField } from "../../../price-field";
import { FINANCING_LABELS, shekelsToAgorot } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * עריכת דרישות קונה — התקציב גדל? נוספה עיר? הדרישות הן הדלק של מנוע
 * ההתאמות, ולכן חייבות להישאר עדכניות. שדות שאינם בטופס (שכונות,
 * הערות גמישות…) נשמרים כמו שהם — נשלח אובייקט מלא עם הערכים הקיימים.
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

const FEATURES = [
  ["hasElevator", "מעלית"],
  ["hasParking", "חניה"],
  ["hasBalcony", "מרפסת"],
  ["hasSafeRoom", 'ממ"ד'],
  ["hasStorage", "מחסן"],
] as const;

interface BuyerRequirements {
  cities: string[];
  neighborhoods: string[];
  dealType: string;
  propertyTypes: string[];
  budgetMinAgorot?: number;
  budgetMaxAgorot: number;
  roomsMin?: number;
  roomsMax?: number;
  areaSqmMin?: number;
  features: Record<string, "must" | "nice">;
  entryBy?: string;
  flexibilityNotes?: string;
}

interface BuyerDetail {
  id: string;
  contact: { name: string };
  requirements: BuyerRequirements;
  financing: string;
}

export default function EditBuyerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [buyer, setBuyer] = useState<BuyerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    apiGet<BuyerDetail>(`/buyers/${id}`)
      .then(setBuyer)
      .catch(() => setError("הקונה לא נמצא"));
  }, [authLoading, id]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!buyer) return;
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
    const budgetMinShekels = num("budgetMin");
    try {
      await apiPatch(`/buyers/${id}`, {
        financing: String(f.get("financing")),
        requirements: {
          ...buyer.requirements,
          cities: String(f.get("cities"))
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          dealType: String(f.get("dealType")),
          budgetMinAgorot:
            budgetMinShekels === undefined ? undefined : shekelsToAgorot(budgetMinShekels),
          budgetMaxAgorot:
            budgetShekels === undefined
              ? buyer.requirements.budgetMaxAgorot
              : shekelsToAgorot(budgetShekels),
          roomsMin: num("roomsMin"),
          roomsMax: num("roomsMax"),
          areaSqmMin: num("areaSqmMin"),
          features,
        },
      });
      router.replace(`/buyers/${id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת השינויים נכשלה");
      setSubmitting(false);
    }
  }

  if (error && !buyer) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/buyers" className="underline">חזרה לרשימה</Link>
      </p>
    );
  }
  if (!buyer) return <p aria-live="polite">טוען…</p>;

  const req = buyer.requirements;

  return (
    <div className="mx-auto max-w-2xl">
      <nav aria-label="נתיב" className="mb-4 text-sm">
        <Link href="/buyers" className="underline">קונים</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/buyers/${id}`} className="underline">{buyer.contact.name}</Link>
        <span aria-hidden="true"> / </span>
        <span>עריכת דרישות</span>
      </nav>
      <h1 className="mb-2 text-2xl font-bold">עריכת דרישות — {buyer.contact.name}</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        ההתאמות יחושבו מחדש אוטומטית אחרי השמירה.
      </p>

      <form onSubmit={onSubmit} noValidate>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}

        <fieldset className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <legend className="px-2 font-semibold">מה הוא מחפש</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cities" className="mb-1 block font-medium">ערים * <span className="font-normal">(מופרדות בפסיק)</span></label>
              <input id="cities" name="cities" required defaultValue={req.cities.join(", ")} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="dealType" className="mb-1 block font-medium">סוג עסקה *</label>
              <select id="dealType" name="dealType" required defaultValue={req.dealType} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="sale">קנייה</option>
                <option value="rent">שכירות</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PriceField
                id="budgetMin"
                name="budgetMin"
                label="תקציב מ- (₪)"
                defaultValue={req.budgetMinAgorot === undefined ? "" : Math.round(req.budgetMinAgorot / 100)}
              />
              <PriceField
                id="budgetMax"
                name="budgetMax"
                label="עד (₪) *"
                required
                defaultValue={Math.round(req.budgetMaxAgorot / 100)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="areaSqmMin" className="mb-1 block font-medium">שטח מינימלי (מ&quot;ר)</label>
                <input
                  id="areaSqmMin"
                  name="areaSqmMin"
                  type="number"
                  min="10"
                  max="2000"
                  inputMode="numeric"
                  defaultValue={req.areaSqmMin ?? ""}
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="financing" className="mb-1 block font-medium">מימון</label>
                <select
                  id="financing"
                  name="financing"
                  defaultValue={buyer.financing}
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={inputStyle}
                >
                  {Object.entries(FINANCING_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="roomsMin" className="mb-1 block font-medium">חדרים מ-</label>
                <input id="roomsMin" name="roomsMin" type="number" step="0.5" min="1" inputMode="decimal" defaultValue={req.roomsMin ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="roomsMax" className="mb-1 block font-medium">עד</label>
                <input id="roomsMax" name="roomsMax" type="number" step="0.5" min="1" inputMode="decimal" defaultValue={req.roomsMax ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
              </div>
            </div>
          </div>

          <fieldset className="mt-4">
            <legend className="mb-2 font-medium">מאפיינים — חובה או עדיפות?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURES.map(([name, label]) => (
                <div key={name} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3" style={{ borderColor: "var(--color-border)" }}>
                  <label htmlFor={`feature_${name}`} className="font-medium">{label}</label>
                  <select
                    id={`feature_${name}`}
                    name={`feature_${name}`}
                    defaultValue={req.features[name] ?? ""}
                    className="rounded-md border px-2 py-1.5"
                    style={inputStyle}
                  >
                    <option value="">לא רלוונטי</option>
                    <option value="nice">עדיפות</option>
                    <option value="must">חובה</option>
                  </select>
                </div>
              ))}
            </div>
          </fieldset>
        </fieldset>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "שומר…" : "שמור שינויים"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push(`/buyers/${id}`)}>
            ביטול
          </Button>
        </div>
      </form>
    </div>
  );
}
