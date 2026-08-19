"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CustomFeature } from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { FormSection } from "../../form-section";
import { apiPost, ApiError } from "@/lib/api";
import { shekelsToAgorot, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { DictateFor } from "../../dictation-field";
import { PriceField } from "../../price-field";
import { FeatureChips } from "../feature-chips";
import { EntryTimingField } from "../entry-timing-field";
import { LocationPicker, type LocationValue } from "../location-picker";
import { Notice } from "../../notice";

const inputStyle = {
  borderColor: "var(--color-border)",
  background: "var(--color-field)",
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

/**
 * קריאת המאפיינים המותאמים מהשדה החבוי.
 *
 * מתגוננת בכוונה: JSON פגום (הרחבת דפדפן, מילוי אוטומטי) יחזיר
 * רשימה ריקה במקום להפיל את השמירה של כל הנכס. הנרמול האמיתי קורה
 * בשרת ממילא.
 */
function parseCustomFeatures(raw: FormDataEntryValue | null): CustomFeature[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CustomFeature =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CustomFeature).key === "string" &&
        typeof (item as CustomFeature).label === "string" &&
        typeof (item as CustomFeature).value === "boolean",
    );
  } catch {
    return [];
  }
}

export default function NewPropertyPage() {
  useRequireAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /*
   * המיקום בטופס הקליטה ולא רק בכרטיס.
   *
   * עד כה הוא הופיע רק אחרי שהנכס נוצר, ולכן רוב הנכסים נשארו בלי
   * קואורדינטה — וכל התאמה לפי מרחק נפלה חזרה לשם העיר. השרת מפענח
   * את הכתובת בעצמו ביצירה, וזה כאן למי שרוצה לדייק: "הבניין מול
   * בית הכנסת" אינו כתובת שאפשר לפענח, אבל אפשר להצביע עליו.
   */
  const [location, setLocation] = useState<LocationValue>({});
  /*
   * המפה נטענת רק כשפותחים אותה.
   *
   * `<details>` סגור עדיין מרנדר את תוכנו, ולכן MapLibre היה עולה
   * ומושך אריחים בכל כניסה לטופס קליטה — גם למי שלא נגע במפה.
   * זו תעבורה על חשבון המכסה של הספק, ועיכוב בטעינת מסך שהמפה
   * אינה חלק ממנו.
   */
  const [address, setAddress] = useState({
    city: "",
    neighborhood: "",
    street: "",
    houseNumber: "",
  });

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
        houseNumber: String(f.get("houseNumber") ?? "").trim() || undefined,
        propertyType: String(f.get("propertyType")),
        dealType: String(f.get("dealType")),
        rooms: num("rooms"),
        areaSqm: num("areaSqm"),
        floor: num("floor"),
        totalFloors: num("totalFloors"),
        priceAgorot:
          priceShekels === undefined
            ? undefined
            : shekelsToAgorot(priceShekels),
        entryType: entryType || undefined,
        entryDate: entry ? new Date(entry).toISOString() : undefined,
        entryNote: String(f.get("entryNote") ?? "").trim() || undefined,
        // תלת-מצבי: "" = לא ידוע (נשאר חוסר), yes/no = עובדה מפורשת.
        // "אין מעלית" הוא מידע קריטי להתאמות — לא היעדר מידע (ביקורת Codex, PR #1).
        hasElevator: triState(f, "hasElevator"),
        hasParking: triState(f, "hasParking"),
        hasBalcony: triState(f, "hasBalcony"),
        hasSafeRoom: triState(f, "hasSafeRoom"),
        /*
         * JSON משדה חבוי אחד — הרשימה גדלה ומשתנה, ולכן אין לה שם
         * שדה קבוע כמו לחמשת הקבועים. השרת מנרמל אותה שוב בשער
         * הכתיבה, ולכן קלט פגום כאן אינו יכול להיכנס למסד.
         */
        customFeatures: parseCustomFeatures(f.get("customFeatures")),
        marketingTitle:
          String(f.get("marketingTitle") ?? "").trim() || undefined,
        /* ריק לא נשלח: הערה ריקה בכרטיס נראית כמו הערה שנמחקה. */
        internalNotes: String(f.get("internalNotes") ?? "").trim() || undefined,
        // הסוכן סימן ידנית ⇒ השרת לא ידרוס בפענוח אוטומטי
        latitude: location.latitude,
        longitude: location.longitude,
        locationSource: location.locationSource,
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
          <Notice tone="danger">{error}</Notice>
        ) : null}

        <FormSection
          step={1}
          title="מיקום"
          hint="הכתובת מתורגמת לנקודה על המפה מעצמה, וזה מה שמאפשר התאמה לפי מרחק אמיתי ולא לפי שם עיר."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="city" className="mb-1 block font-medium">
                עיר *
              </label>
              <input
                id="city"
                name="city"
                required
                onChange={(e) =>
                  setAddress((a) => ({ ...a, city: e.target.value }))
                }
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
                onChange={(e) =>
                  setAddress((a) => ({ ...a, neighborhood: e.target.value }))
                }
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
                onChange={(e) =>
                  setAddress((a) => ({ ...a, street: e.target.value }))
                }
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            {/*
              מספר הבית הוא מה שהופך "רחוב הרצל" לכתובת: בלעדיו
              הפענוח למפה נופל על מרכז הרחוב, וההתאמה לפי מרחק אמיתי
              עובדת על נקודה שאינה הנכס. הוא נשאר לא-חובה, כי לא לכל
              נכס יש מספר בשלב הראשון.
            */}
            <div>
              <label htmlFor="houseNumber" className="mb-1 block font-medium">
                מספר בית
              </label>
              <input
                id="houseNumber"
                name="houseNumber"
                inputMode="numeric"
                maxLength={10}
                placeholder="למשל: 42א"
                onChange={(e) =>
                  setAddress((a) => ({ ...a, houseNumber: e.target.value }))
                }
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
          </div>

          {/*
            המפה גלויה ואינה מאחורי מקטע שצריך לפתוח.

            שדה שצריך לגלות הוא שדה שלא ממלאים: הסוכן הקליד עיר,
            המשיך, ואף נכס לא קיבל סימון ידני. הפענוח האוטומטי עדיין
            עושה את רוב העבודה — ולכן הכיתוב אומר במפורש שזה לא חובה
            — אבל "הבניין מול בית הכנסת" אינו כתובת שאפשר לפענח,
            ובדיוק שם צריך שהמפה כבר תהיה על המסך.
          */}
          <div className="mt-4">
            <p className="mb-1 font-medium">
              סימון על המפה
              {location.latitude !== undefined ? (
                <span
                  className="ms-1.5"
                  style={{ color: "var(--color-success)" }}
                >
                  ✓ סומן
                </span>
              ) : (
                <span
                  className="ms-1.5 text-sm font-normal"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  · לא חובה — הכתובת תפוענח אוטומטית
                </span>
              )}
            </p>
            <LocationPicker
              value={location}
              addressText={[
                [address.street, address.houseNumber]
                  .filter((part) => part.trim() !== "")
                  .join(" "),
                address.neighborhood,
                address.city,
              ]
                .filter((part) => part.trim() !== "")
                .join(", ")}
              onChange={setLocation}
            />
          </div>
        </FormSection>

        <FormSection
          step={2}
          title="פרטי הנכס"
          hint="חדרים, שטח וקומה הם שלושת השדות שקונים מסננים לפיהם."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="propertyType" className="mb-1 block font-medium">
                סוג נכס *
              </label>
              <select
                id="propertyType"
                name="propertyType"
                required
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              >
                {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dealType" className="mb-1 block font-medium">
                סוג עסקה *
              </label>
              <select
                id="dealType"
                name="dealType"
                required
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
                inputMode="decimal"
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="areaSqm" className="mb-1 block font-medium">
                שטח (מ&quot;ר)
              </label>
              <input
                id="areaSqm"
                name="areaSqm"
                type="number"
                min="10"
                max="2000"
                inputMode="numeric"
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
                inputMode="numeric"
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
                inputMode="numeric"
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
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
        </FormSection>

        <FormSection
          step={3}
          title="מחיר וכניסה"
          hint="מועד הכניסה הוא קריטריון התאמה — 'גמיש' ו'מיידי' אינם אותו דבר."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* המחיר גם במילים — ספרה עודפת במיליונים קופצת לעין */}
            <PriceField id="price" name="price" label="מחיר (₪)" />
            <EntryTimingField side="property" inputStyle={inputStyle} />
          </div>
        </FormSection>

        <div className="mb-6">
          <label htmlFor="marketingTitle" className="mb-1 block font-medium">
            כותרת שיווקית
          </label>
          <input
            id="marketingTitle"
            name="marketingTitle"
            maxLength={160}
            className="w-full rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
          <DictateFor targetId="marketingTitle" />
        </div>

        <FormSection
          step={4}
          title="בעל הנכס"
          hint="לא חובה עכשיו — אבל בלעדיו אי אפשר לשלוח עדכון שיווק ולא להחתים על בלעדיות."
        >
          <div className="flex flex-wrap gap-3">
            <div className="flex-1" style={{ minWidth: "180px" }}>
              <label htmlFor="ownerName" className="mb-1 block text-sm">
                שם
              </label>
              <input
                id="ownerName"
                name="ownerName"
                maxLength={120}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div className="flex-1" style={{ minWidth: "180px" }}>
              <label htmlFor="ownerPhone" className="mb-1 block text-sm">
                טלפון
              </label>
              <input
                id="ownerPhone"
                name="ownerPhone"
                type="tel"
                dir="ltr"
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
          </div>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            נקשר לאיש הקשר לפי הטלפון — יופיע בתיק הלקוח המאוחד.
          </p>
        </FormSection>

        {/*
          הערה חופשית — **מה שהשדות למעלה לא יכולים להכיל.**

          הטופס שואל את מה שמנוע ההתאמות עובד לפיו. מה שנאמר בשיחה
          עם בעל הנכס ואינו נכנס לאף שדה — "הדוד לא מסכים לפחות
          מ-2.1", "אפשר להיכנס רק אחרי החגים", "השכנים מלמעלה
          בשיפוץ" — הוא לרוב מה שיסגור או יפיל את העסקה.

          **פנימי ולא שיווקי**, ולכן נפרד מהכותרת השיווקית שמעליו:
          הכותרת נשלחת ללקוחות, וזה לא.
        */}
        <FormSection
          step={5}
          title="הערות פנימיות"
          hint="מה שנאמר בשיחה ואין לו שדה. פנימי בלבד — לא מופיע בדף הנחיתה ולא בהצעות ללקוחות."
        >
          <label htmlFor="internalNotes" className="mv-visually-hidden">
            הערות פנימיות
          </label>
          <textarea
            id="internalNotes"
            name="internalNotes"
            rows={4}
            maxLength={4000}
            placeholder="מי מחליט אצל המוכר? מה גמיש ומה לא? מה כדאי לדעת לפני הביקור?"
            className="w-full rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
          <DictateFor targetId="internalNotes" />
        </FormSection>

        <div className="mv-form-actions">
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
