"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { DictateFor } from "../../dictation-field";
import { FormSection } from "../../form-section";
import { FeatureRequirements } from "../feature-requirements";
import { SearchAreas } from "../search-areas";
import { PropertyTypesField, readPropertyTypes } from "../property-types-field";
import { PriceField } from "../../price-field";
import { EntryTimingField } from "../../properties/entry-timing-field";
import { shekelsToAgorot } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { normalizePhone, type SearchArea } from "@metavchim/shared";
import { Notice } from "../../notice";

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

const FEATURES = [
  ["hasElevator", "מעלית"],
  ["hasParking", "חניה"],
  ["hasBalcony", "מרפסת"],
  ["hasSafeRoom", 'ממ"ד'],
  ["hasStorage", "מחסן"],
] as const;

export default function NewBuyerPage() {
  useRequireAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /*
   * אזורי החיפוש על המפה — כבר בקליטה ולא רק בעריכה. הקריטריון
   * המדויק ביותר של הקונה נאסף בשיחה הראשונה, ומסך שמבקש לחזור
   * לכרטיס אחר כך פשוט לא זוכה לזה.
   */
  const [areas, setAreas] = useState<SearchArea[]>([]);

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
        contactPhone: String(f.get("contactPhone")).trim(),
        /* ריק לא נשלח: הסכימה בשרת מקפידה, ומחרוזת ריקה אינה כתובת */
        contactEmail: String(f.get("contactEmail") ?? "").trim() || undefined,
        source: String(f.get("source")),
        maturity: String(f.get("maturity")),
        requirements: {
          cities: String(f.get("cities"))
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          neighborhoods: String(f.get("neighborhoods") ?? "")
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
          dealType: String(f.get("dealType")),
          propertyTypes: readPropertyTypes(f.get("propertyTypes")),
          /*
           * ריק = לא נמסר, ולא 0. אפס נקרא במנוע ההתאמות כ"לא יכול
           * להרשות לעצמו שום נכס", כלומר גרוע מלא לשלוח כלום.
           */
          budgetMaxAgorot:
            budgetShekels === undefined ? undefined : shekelsToAgorot(budgetShekels),
          roomsMin: num("roomsMin"),
          roomsMax: num("roomsMax"),
          /* ריק = "לא נבחר" — מוסר מהדרישות ולא נשמר כמחרוזת ריקה */
          entryType: String(f.get("entryType") ?? "") || undefined,
          entryBy: String(f.get("entryBy") ?? "")
            ? new Date(String(f.get("entryBy"))).toISOString()
            : undefined,
          features,
          searchAreas: areas,
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
      <p className="mb-5 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
        שם וטלפון מספיקים כדי לשמור. כל שדה נוסף מדייק את ההתאמות —
        ואפשר להשלים אותו אחר כך מהכרטיס.
      </p>

      <form onSubmit={onSubmit} noValidate>
        {error ? (
          <Notice tone="danger">{error}</Notice>
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
            {/*
              ‎**השדה שלא היה כאן.** הכתובת נשמרת בכרטיס איש הקשר, וכל
              מה שמתחת לטופס ידע לשמור אותה מאז ומתמיד — ייבוא מקובץ
              ופנייה מדף נחיתה שניהם כתבו אותה. רק הטופס שהסוכן ממלא
              לא שאל, ולכן קונה שהוקלד ידנית לא יכול היה לקבל הצעה
              במייל בלי מעבר נוסף בכרטיס.
            */}
            <div className="sm:col-span-2">
              <label htmlFor="contactEmail" className="mb-1 block font-medium">
                דוא&quot;ל{" "}
                <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>
                  (לא חובה — לשליחת הצעות והסכמים)
                </span>
              </label>
              <input
                id="contactEmail"
                name="contactEmail"
                type="email"
                dir="ltr"
                autoComplete="email"
                placeholder="name@example.com"
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          step={2}
          title="מה הוא מחפש"
          hint="זה מה שמנוע ההתאמות עובד לפיו. ככל שיהיה כאן יותר, כך יוצגו פחות נכסים לא רלוונטיים."
        >
          <div className="mb-4">
            <label htmlFor="cities" className="mb-1 block font-medium">ערים * <span className="font-normal">(מופרדות בפסיק)</span></label>
            <input id="cities" name="cities" required placeholder="בני ברק, פתח תקווה" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>

          {/*
            שכונה כטקסט חופשי, צמוד לעיר: „איפה” נשאל פעם אחת, ומי
            שאמר „רמת אהרון בבני ברק” צריך מקום לרשום את זה. הרשימה
            אינה סגורה — שמות שכונות אינם רשומים בשום מרשם, ורשימה
            נפתחת הייתה מכריחה לבחור „אחר” על כל שכונה שלא חשבנו
            עליה. השדה קיים בסכימה מזמן ופשוט לא נשאל בטופס.
          */}
          <div className="mb-4">
            <label htmlFor="neighborhoods" className="mb-1 block font-medium">
              שכונות <span className="font-normal">(לא חובה, מופרדות בפסיק)</span>
            </label>
            <input
              id="neighborhoods"
              name="neighborhoods"
              placeholder="רמת אהרון, פרדס כץ"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>

          {/*
            המפה מיד אחרי העיר (בקשת המשתמש): "איפה" הוא שאלה אחת —
            עיר ואזור מדויק נענים ברצף, לא בשני קצוות של הטופס.
          */}
          <div className="mb-4">
            <p className="m-0 mb-1 font-medium">אזור חיפוש על המפה</p>
            <SearchAreas value={areas} onChange={setAreas} disabled={submitting} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dealType" className="mb-1 block font-medium">סוג עסקה *</label>
              <select id="dealType" name="dealType" required className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="sale">קנייה</option>
                <option value="rent">שכירות</option>
              </select>
            </div>
            {/* צמוד לסוג העסקה, כמו במסך העריכה */}
            <PropertyTypesField disabled={submitting} />
            {/* התקציב גם במילים — טעות ספרה במיליונים משנה קונה לגמרי */}
            <PriceField id="budgetMax" name="budgetMax" label="תקציב מקסימלי (₪)" />
            <p className="-mt-2 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
              בלי תקציב הכרטיס נשמר, וקריטריון התקציב לא נספר בהתאמות.
            </p>
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
