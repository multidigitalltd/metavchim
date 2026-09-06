"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import {
  RECRUITMENT_SOURCES,
  RECRUITMENT_STATUSES,
  isValidSourceUrl,
  recruitmentSourceLabel,
  recruitmentStatusLabel,
} from "@metavchim/shared";
import { apiPatch, apiPost } from "@/lib/api";
import { PropertyTypeOptions } from "../../property-type-options";

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

export interface TargetValues {
  id?: string;
  status?: string;
  source?: string;
  sourceUrl?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  priceAgorot?: number;
  ownerName?: string;
  ownerPhone?: string;
  notes?: string;
}

/** מחרוזת ריקה אינה „אפס” — שדה שלא מולא אינו נשלח כלל. */
function num(form: FormData, name: string): number | undefined {
  const raw = String(form.get(name) ?? "").trim();
  if (raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function str(form: FormData, name: string): string | undefined {
  const raw = String(form.get(name) ?? "").trim();
  return raw === "" ? undefined : raw;
}

/**
 * ‏טופס נכס לגיוס — יצירה ועריכה באותו רכיב.
 *
 * ‏אותם שדות של „נכס חדש”, פחות מה שאי אפשר לדעת ממודעה (מאפיינים,
 * מיקום מדויק, בלעדיות) — ופלוס שני שדות שקיימים רק כאן: **מאיפה
 * הנכס הגיע והקישור למודעה**.
 */
export function TargetForm({ initial }: { initial?: TargetValues }) {
  const router = useRouter();
  const editing = initial?.id !== undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sourceUrl = str(form, "sourceUrl");

    /*
     * ‏אותה בדיקה שהשרת מריץ — כאן היא רק כדי לומר את זה מיד, ליד
     * השדה, במקום לשלוח בקשה שתחזור בשגיאה. השרת הוא האוכף.
     */
    if (sourceUrl !== undefined && !isValidSourceUrl(sourceUrl)) {
      setUrlError("הקישור חייב להתחיל ב-http:// או https://");
      return;
    }
    setUrlError(null);
    setError(null);
    setSaving(true);

    const body = {
      ...(str(form, "status") === undefined ? {} : { status: str(form, "status") }),
      ...(str(form, "source") === undefined ? {} : { source: str(form, "source") }),
      sourceUrl: sourceUrl ?? "",
      ...(str(form, "city") === undefined ? {} : { city: str(form, "city") }),
      ...(str(form, "neighborhood") === undefined
        ? {}
        : { neighborhood: str(form, "neighborhood") }),
      ...(str(form, "street") === undefined ? {} : { street: str(form, "street") }),
      ...(str(form, "houseNumber") === undefined
        ? {}
        : { houseNumber: str(form, "houseNumber") }),
      ...(str(form, "propertyType") === undefined
        ? {}
        : { propertyType: str(form, "propertyType") }),
      ...(str(form, "dealType") === undefined ? {} : { dealType: str(form, "dealType") }),
      ...(num(form, "rooms") === undefined ? {} : { rooms: num(form, "rooms") }),
      ...(num(form, "areaSqm") === undefined ? {} : { areaSqm: num(form, "areaSqm") }),
      ...(num(form, "floor") === undefined ? {} : { floor: num(form, "floor") }),
      ...(num(form, "totalFloors") === undefined
        ? {}
        : { totalFloors: num(form, "totalFloors") }),
      /* ‏המחיר מוזן בשקלים ונשמר באגורות — כמו בכל שאר המערכת */
      ...(num(form, "price") === undefined
        ? {}
        : { priceAgorot: Math.round((num(form, "price") as number) * 100) }),
      ...(str(form, "ownerName") === undefined ? {} : { ownerName: str(form, "ownerName") }),
      ...(str(form, "ownerPhone") === undefined ? {} : { ownerPhone: str(form, "ownerPhone") }),
      ...(str(form, "notes") === undefined ? {} : { notes: str(form, "notes") }),
    };

    try {
      if (editing) {
        await apiPatch(`/recruitment/${initial?.id}`, body);
      } else {
        await apiPost("/recruitment", body);
      }
      router.push("/properties/recruitment");
      router.refresh();
    } catch {
      setError("השמירה נכשלה. בדקו את השדות ונסו שוב.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mv-card space-y-5 p-5">
      <section className="space-y-3">
        <h2 className="font-bold">מאיפה זה הגיע</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="source" className="mb-1 block font-medium">
              מקור הנכס
            </label>
            <select
              id="source"
              name="source"
              defaultValue={initial?.source ?? "yad2"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              {RECRUITMENT_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {recruitmentSourceLabel(source)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sourceUrl" className="mb-1 block font-medium">
              קישור למודעה המקורית
            </label>
            <input
              id="sourceUrl"
              name="sourceUrl"
              type="url"
              inputMode="url"
              dir="ltr"
              placeholder="https://www.yad2.co.il/item/..."
              defaultValue={initial?.sourceUrl ?? ""}
              aria-describedby={urlError ? "sourceUrl-error" : "sourceUrl-hint"}
              aria-invalid={urlError ? true : undefined}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
            {urlError ? (
              <p id="sourceUrl-error" role="alert" className="mt-1 text-sm text-[var(--color-danger)]">
                {urlError}
              </p>
            ) : (
              <p id="sourceUrl-hint" className="mt-1 text-sm text-[var(--color-text-muted)]">
                כדי לחזור למודעה בלחיצה, גם אחרי שבועיים.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block font-medium">
              שלב בגיוס
            </label>
            <select
              id="status"
              name="status"
              defaultValue={initial?.status ?? "new"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              {RECRUITMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {recruitmentStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">הנכס</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="city" className="mb-1 block font-medium">
              עיר
            </label>
            <input
              id="city"
              name="city"
              defaultValue={initial?.city ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="neighborhood" className="mb-1 block font-medium">
              שכונה
            </label>
            <input
              id="neighborhood"
              name="neighborhood"
              defaultValue={initial?.neighborhood ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="street" className="mb-1 block font-medium">
              רחוב
            </label>
            <input
              id="street"
              name="street"
              defaultValue={initial?.street ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="houseNumber" className="mb-1 block font-medium">
              מספר בית
            </label>
            <input
              id="houseNumber"
              name="houseNumber"
              defaultValue={initial?.houseNumber ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="propertyType" className="mb-1 block font-medium">
              סוג נכס
            </label>
            <select
              id="propertyType"
              name="propertyType"
              defaultValue={initial?.propertyType ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              <option value="">לא ידוע</option>
              <PropertyTypeOptions />
            </select>
          </div>
          <div>
            <label htmlFor="dealType" className="mb-1 block font-medium">
              סוג עסקה
            </label>
            <select
              id="dealType"
              name="dealType"
              defaultValue={initial?.dealType ?? "sale"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              <option value="sale">מכירה</option>
              <option value="rent">השכרה</option>
            </select>
          </div>
          <div>
            <label htmlFor="rooms" className="mb-1 block font-medium">
              חדרים
            </label>
            <input
              id="rooms"
              name="rooms"
              type="number"
              step="0.5"
              min="1"
              max="20"
              defaultValue={initial?.rooms ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="areaSqm" className="mb-1 block font-medium">
              שטח במ״ר
            </label>
            <input
              id="areaSqm"
              name="areaSqm"
              type="number"
              min="10"
              max="2000"
              defaultValue={initial?.areaSqm ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="floor" className="mb-1 block font-medium">
              קומה
            </label>
            <input
              id="floor"
              name="floor"
              type="number"
              min="-2"
              max="60"
              defaultValue={initial?.floor ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="totalFloors" className="mb-1 block font-medium">
              קומות בבניין
            </label>
            <input
              id="totalFloors"
              name="totalFloors"
              type="number"
              min="1"
              max="60"
              defaultValue={initial?.totalFloors ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="price" className="mb-1 block font-medium">
              מחיר מבוקש (₪)
            </label>
            <input
              id="price"
              name="price"
              type="number"
              min="0"
              defaultValue={
                initial?.priceAgorot === undefined ? "" : Math.round(initial.priceAgorot / 100)
              }
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">בעל הנכס</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          נשמר כאן בלבד. הוא נכנס לאנשי הקשר של המשרד רק ברגע שתמירו את הנכס — כל עוד לא
          חתם, הוא אינו לקוח שלכם.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ownerName" className="mb-1 block font-medium">
              שם
            </label>
            <input
              id="ownerName"
              name="ownerName"
              defaultValue={initial?.ownerName ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="ownerPhone" className="mb-1 block font-medium">
              טלפון
            </label>
            <input
              id="ownerPhone"
              name="ownerPhone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              defaultValue={initial?.ownerPhone ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
        </div>
        <div>
          <label htmlFor="notes" className="mb-1 block font-medium">
            מה נאמר בשיחה
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={initial?.notes ?? ""}
            placeholder="ענה שיחשוב · מבקש 2.1 · יש לו מתווך אחר עד סוף החודש"
            className="w-full rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-md bg-[var(--color-danger-soft)] p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "שומר…" : editing ? "שמירת שינויים" : "הוספה לרשימת הגיוס"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          ביטול
        </Button>
      </div>
    </form>
  );
}
