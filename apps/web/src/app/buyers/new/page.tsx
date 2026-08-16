"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { DictateFor } from "../../dictation-field";
import { FormSection } from "../../form-section";
import { FeatureRequirements } from "../feature-requirements";
import { PriceField } from "../../price-field";
import { EntryTimingField } from "../../properties/entry-timing-field";
import { shekelsToAgorot } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-field)" } as const;

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

    /*
     * סריקה על כל שדה `feature_*` ולא על חמשת הקבועים בלבד — מאז
     * שהמשרד יכול להוסיף מאפיינים, רשימה קשיחה כאן הייתה בולעת
     * בשקט כל דרישה למאפיין מותאם.
     */
    const features: Record<string, "must" | "nice"> = {};
    for (const [field, value] of f.entries()) {
      if (!field.startsWith("feature_")) continue;
      const level = String(value);
      if (level === "must" || level === "nice") features[field.slice("feature_".length)] = level;
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
          /* ריק = "לא נבחר" — מוסר מהדרישות ולא נשמר כמחרוזת ריקה */
          entryType: String(f.get("entryType") ?? "") || undefined,
          entryBy: String(f.get("entryBy") ?? "")
            ? new Date(String(f.get("entryBy"))).toISOString()
            : undefined,
          features,
        },
        /* ריק לא נשלח: הערה ריקה בכרטיס נראית כמו הערה שנמחקה. */
        agentNotes: String(f.get("agentNotes") ?? "").trim() || undefined,
      });
      router.replace(`/buyers/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הקונה נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">קונה חדש</h1>
      <p className="mb-5 text-[13.5px]" style={{ color: "var(--color-text-muted)" }}>
        שם וטלפון מספיקים כדי לשמור. כל שדה נוסף מדייק את ההתאמות —
        ואפשר להשלים אותו אחר כך מהכרטיס.
      </p>

      <form onSubmit={onSubmit} noValidate>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}

        <FormSection step={1} title="פרטי קשר" hint="השם והטלפון הם היחידים שחובה למלא.">
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
        </FormSection>

        <FormSection
          step={2}
          title="מה הוא מחפש"
          hint="זה מה שמנוע ההתאמות עובד לפיו. ככל שיהיה כאן יותר, כך יוצגו פחות נכסים לא רלוונטיים."
        >
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
            {/* התקציב גם במילים — טעות ספרה במיליונים משנה קונה לגמרי */}
            <PriceField id="budgetMax" name="budgetMax" label="תקציב מקסימלי (₪) *" required />
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
            {/*
              מועד הכניסה כבר ברגע הקליטה. הוא היה קיים רק במסך העריכה,
              כלומר נשאל אחרי שהשיחה עם הלקוח נגמרה — ובפועל כמעט אף
              פעם לא מולא. זהו אחד מקריטריוני ההתאמה, ובלעדיו הציון של
              כל קונה חדש נבנה על נתון חסר.
            */}
            <EntryTimingField side="buyer" inputStyle={inputStyle} />
          </div>

          <FeatureRequirements builtin={FEATURES} />
        </FormSection>

        <FormSection step={3} title="סטטוס" hint="הבשלות קובעת את סדר העבודה במסך הקונים.">
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
        </FormSection>

        {/*
          הערה חופשית — **מה שהשדות למעלה לא יכולים להכיל.**

          הטופס שואל את מה שמנוע ההתאמות עובד לפיו. מה שנאמר בשיחה
          ואינו נכנס לאף שדה — "האישה מחליטה", "חייב לצאת מהשכירות
          עד מרץ", "רוצה ליד ההורים ברחוב הזה" — הוא לרוב מה שיסגור
          את העסקה, וקודם הוא נשאר בראש של הסוכן. השדה בסוף ולא
          באמצע: הוא נכתב אחרי שכבר יודעים מה מילאו.
        */}
        <FormSection
          step={4}
          title="הערות"
          hint="מה שנאמר בשיחה ואין לו שדה. לא משתתף בניקוד ההתאמות — זה הקשר, לא קריטריון."
        >
          <label htmlFor="agentNotes" className="mv-visually-hidden">
            הערות
          </label>
          <textarea
            id="agentNotes"
            name="agentNotes"
            rows={4}
            maxLength={4000}
            placeholder="מה הוא סיפר? מי מחליט? מה חשוב לו שלא נכנס לשדות?"
            className="w-full rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
          <DictateFor targetId="agentNotes" />
        </FormSection>

        <div className="mv-form-actions">
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
