"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { DictateFor } from "../../../dictation-field";
import { FormSection } from "../../../form-section";
import { PriceField } from "../../../price-field";
import { FINANCING_LABELS, shekelsToAgorot } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { EntryTimingField } from "../../../properties/entry-timing-field";
import { FeatureRequirements } from "../../feature-requirements";
import { PropertyTypesField, readPropertyTypes } from "../../property-types-field";
import { SearchAreas } from "../../search-areas";
import type { SearchArea } from "@metavchim/shared";
import { Notice } from "../../../notice";

/**
 * עריכת דרישות קונה — התקציב גדל? נוספה עיר? הדרישות הן הדלק של מנוע
 * ההתאמות, ולכן חייבות להישאר עדכניות.
 *
 * **אותו עיצוב כמו טופס הקליטה, ובכוונה.** המסך הזה נשאר מאחור
 * כשהקליטה עברה לכרטיסי שלב: אותן שאלות בדיוק, פעם אחת בכרטיסים
 * ממוספרים עם הסבר ופעם אחת ב-`fieldset` עם מסגרת דקה. מי שממלא
 * את שניהם באותו יום לומד שתי שפות לאותו תוכן.
 *
 * שדות שאינם בטופס (שכונות) נשמרים כמו שהם — נשלח אובייקט מלא עם
 * הערכים הקיימים.
 */

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

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
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  areaSqmMin?: number;
  features: Record<string, "must" | "nice">;
  searchAreas?: SearchArea[];
  entryType?: string;
  entryBy?: string;
  flexibilityNotes?: string;
}

interface BuyerDetail {
  id: string;
  contact: { name: string };
  requirements: BuyerRequirements;
  financing: string;
  agentNotes?: string;
}

export default function EditBuyerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [buyer, setBuyer] = useState<BuyerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /*
   * האזורים אינם שדה של `FormData` — הם רשימה עם מפה — ולכן מצב
   * נפרד שמאותחל מהשרת ונשלח בשמירה.
   */
  const [areas, setAreas] = useState<SearchArea[]>([]);
  /** המפה נטענת רק כשפותחים — ראו ההסבר בטופס קליטת הנכס. */
  const [areasOpen, setAreasOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    apiGet<BuyerDetail>(`/buyers/${id}`)
      .then((row) => {
        setBuyer(row);
        setAreas(row.requirements.searchAreas ?? []);
      })
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
    const budgetMinShekels = num("budgetMin");
    try {
      await apiPatch(`/buyers/${id}`, {
        financing: String(f.get("financing")),
        /*
         * ריק נשלח כמחרוזת ריקה ולא מדולג: כאן זו **מחיקה מכוונת**
         * של הערה קיימת, בניגוד לטופס הקליטה שבו אין מה למחוק.
         */
        agentNotes: String(f.get("agentNotes") ?? "").trim(),
        requirements: {
          ...buyer.requirements,
          cities: String(f.get("cities"))
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          /*
           * עד כה השכונות נשמרו רק דרך ‎...buyer.requirements‎ — כלומר
           * מה שנקלט בייבוא או בקול נשאר, ומהמסך לא היה אפשר לתקן
           * אותו. עכשיו הטופס הוא המקור, וריקון השדה באמת מוחק.
           */
          neighborhoods: String(f.get("neighborhoods") ?? "")
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
          dealType: String(f.get("dealType")),
          propertyTypes: readPropertyTypes(f.get("propertyTypes")),
          budgetMinAgorot:
            budgetMinShekels === undefined ? undefined : shekelsToAgorot(budgetMinShekels),
          /*
           * שדה שרוקן מוחק את התקציב, ולא משמר את הישן.
           *
           * עד כה ריקון השדה החזיר בשקט את הערך הקודם — כלומר
           * מתווך שגילה שהתקציב שנרשם שגוי לא יכול היה להסיר אותו,
           * רק להחליפו במספר אחר. עכשיו התנהגות זהה לזו של תקציב
           * המינימום בשורה שמעל.
           */
          budgetMaxAgorot:
            budgetShekels === undefined ? undefined : shekelsToAgorot(budgetShekels),
          roomsMin: num("roomsMin"),
          roomsMax: num("roomsMax"),
          areaSqmMin: num("areaSqmMin"),
          /*
             ריק = "לא נבחר", ונשלח כ-undefined כדי שהשדה יוסר מהדרישות
             במקום להישמר כמחרוזת ריקה שאף בדיקה לא מזהה.
          */
          entryType: String(f.get("entryType") ?? "") || undefined,
          entryBy: String(f.get("entryBy") ?? "")
            ? new Date(String(f.get("entryBy"))).toISOString()
            : undefined,
          features,
          searchAreas: areas,
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
      <Notice tone="danger">{error} — <Link href="/buyers" className="underline">חזרה לרשימה</Link></Notice>
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
          <Notice tone="danger">{error}</Notice>
        ) : null}

        <FormSection
          step={1}
          title="מה הוא מחפש"
          hint="זה מה שמנוע ההתאמות עובד לפיו. ככל שיהיה כאן יותר, כך יוצגו פחות נכסים לא רלוונטיים."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="cities" className="mb-1 block font-medium">ערים * <span className="font-normal">(מופרדות בפסיק)</span></label>
              <input id="cities" name="cities" required defaultValue={req.cities.join(", ")} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />

              {/* שכונה כטקסט חופשי, צמוד לעיר — כמו בטופס הקליטה. */}
              <label htmlFor="neighborhoods" className="mb-1 mt-3 block font-medium">
                שכונות <span className="font-normal">(לא חובה, מופרדות בפסיק)</span>
              </label>
              <input
                id="neighborhoods"
                name="neighborhoods"
                defaultValue={req.neighborhoods.join(", ")}
                placeholder="רמת אהרון, פרדס כץ"
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
              {/*
                האזורים יושבים מתחת לערים ולא במסך נפרד: הם התשובה
                המדויקת לאותה שאלה, ומי שממלא "ערים" הוא מי שצריך
                לדעת שיש דרך טובה יותר.
              */}
              <details className="mt-3" onToggle={(e) => setAreasOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer text-sm font-medium">
                  אזורי חיפוש על המפה
                  {areas.length > 0 ? (
                    <span className="ms-1.5" style={{ color: "var(--color-success)" }}>
                      ✓ {areas.length}
                    </span>
                  ) : (
                    <span className="ms-1.5 font-normal" style={{ color: "var(--color-text-muted)" }}>
                      · מדויק יותר משם עיר
                    </span>
                  )}
                </summary>
                {areasOpen ? (
                  <div className="mt-3">
                    <SearchAreas value={areas} onChange={setAreas} disabled={submitting} />
                  </div>
                ) : null}
              </details>
            </div>
            <div>
              <label htmlFor="dealType" className="mb-1 block font-medium">סוג עסקה *</label>
              <select id="dealType" name="dealType" required defaultValue={req.dealType} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="sale">קנייה</option>
                <option value="rent">שכירות</option>
              </select>
            </div>
            {/*
              צמוד לסוג העסקה: „מה הוא קונה” ו„איזה נכס” הן שתי
              השאלות שנשאלות ברצף, ומנוע ההתאמות פוסל לפי שתיהן.
            */}
            <PropertyTypesField initial={req.propertyTypes} disabled={submitting} />
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
                label="עד (₪)"
                {...(req.budgetMaxAgorot === undefined
                  ? {}
                  : { defaultValue: Math.round(req.budgetMaxAgorot / 100) })}
              />
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
            {/*
              אילוץ הכניסה של הקונה — "גמיש" הוא תשובה, ולא היעדר.
            */}
            <EntryTimingField
              side="buyer"
              defaultMode={req.entryType}
              defaultDate={req.entryBy ? req.entryBy.slice(0, 10) : undefined}
              inputStyle={inputStyle}
            />
          </div>
        </FormSection>

        <FormSection
          step={2}
          title="מאפיינים"
          hint="&#8222;חובה&#8221; פוסל נכס שאין בו את המאפיין; &#8222;עדיפות&#8221; רק מוריד לו בציון. ההבדל הזה הוא מה שמונע רשימה ארוכה של נכסים שלא מתאימים."
        >
          <FeatureRequirements builtin={FEATURES} initial={req.features} />
        </FormSection>

        <FormSection
          step={3}
          title="מימון"
          hint="קונה עם משכנתה מאושרת וקונה שטרם התחיל אינם באותו מקום בתור, גם כשהתקציב זהה."
        >
          <div className="sm:max-w-xs">
            <label htmlFor="financing" className="mb-1 block font-medium">מצב המימון</label>
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
        </FormSection>

        {/*
          תיאור חופשי — **מה שהשדות למעלה לא יכולים להכיל.**

          הוא היה קיים רק בכרטיס, כלומר במסך אחר מזה שבו הסוכן מעדכן
          את הדרישות. מי שיושב ומעדכן תקציב אחרי שיחה הוא בדיוק מי
          שיש לו עכשיו מה לכתוב.
        */}
        <FormSection
          step={4}
          title="תיאור חופשי"
          hint="מה שנאמר בשיחה ואין לו שדה. לא משתתף בניקוד ההתאמות — זה הקשר, לא קריטריון."
        >
          <label htmlFor="agentNotes" className="mv-visually-hidden">
            תיאור חופשי
          </label>
          <textarea
            id="agentNotes"
            name="agentNotes"
            rows={4}
            maxLength={4000}
            defaultValue={buyer.agentNotes ?? ""}
            placeholder="מי מחליט? מה גמיש ומה לא? מה חשוב לו שלא נכנס לשדות?"
            className="w-full rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
          <DictateFor targetId="agentNotes" />
        </FormSection>

        <div className="mv-form-actions">
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
