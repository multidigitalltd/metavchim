import { z } from "zod";
import { IdSchema, MoneyAgorotSchema } from "./common.js";
import { PropertyTypeSchema, DealTypeSchema } from "./property.js";
import {
  MAX_SEARCH_AREAS,
  MAX_SEARCH_RADIUS_KM,
  MIN_SEARCH_RADIUS_KM,
} from "../logic/proximity.js";

export const BuyerMaturitySchema = z.enum(["very_hot", "hot", "interested", "not_ripe"]);
export type BuyerMaturity = z.infer<typeof BuyerMaturitySchema>;

/** תוויות עברית לבשלות — מקור אמת אחד ל-UI ולטקסטים שהשרת כותב (ציר, ייצוא). */
export const MATURITY_LABELS: Record<BuyerMaturity, string> = {
  very_hot: "חם מאוד",
  hot: "חם",
  interested: "מתעניין",
  not_ripe: "לא בשל",
};

export const FinancingStatusSchema = z.enum([
  "cash",
  "pre_approved",
  "in_process",
  "not_started",
  "unknown",
]);
export type FinancingStatus = z.infer<typeof FinancingStatusSchema>;

/** תוויות מימון — אותו כלל כמו בבשלות: הטיפוס אוכף שכל ערך בסכימה מתורגם. */
export const FINANCING_LABELS: Record<FinancingStatus, string> = {
  cash: "מזומן",
  pre_approved: "אישור עקרוני ביד",
  in_process: "משכנתא בתהליך",
  not_started: "טרם התחיל מימון",
  unknown: "לא ידוע",
};

/** דרישה בודדת של קונה: חובה או עדיפות — ההבחנה מזינה ישירות את מנוע ההתאמות. */
export const RequirementLevelSchema = z.enum(["must", "nice"]);

export const BuyerRequirementsSchema = z.object({
  /*
   * ריק = בלי מגבלת אזור, וזה ערך תקין: ייבוא מגיליון בלי עמודת עיר
   * לא אמור להידחות, וקונה "כל הארץ" הוא לקוח אמיתי. ההתאמות
   * מדלגות על קריטריון המיקום כשהרשימה ריקה — חוסר מידע אינו
   * אי-התאמה, כפי שכבר נכון לשאר השדות.
   */
  cities: z.array(z.string().min(1)).default([]),
  neighborhoods: z.array(z.string()).default([]),
  /**
   * אזורי חיפוש על המפה — נקודה, רדיוס ושם.
   *
   * **גוברים על רשימת הערים** כשהנכס ממוקם: מי שסימן על המפה אמר
   * משהו מדויק יותר משם עיר, ונכס מעבר לגבול מוניציפלי אינו אמור
   * להיעלם בגללו. רשימת הערים נשארת כגיבוי — לקונה שלא סימן, ולנכס
   * שאין לו קואורדינטה.
   *
   * כמה אזורים ולא אחד: קונה מחפש ליד ההורים **וגם** ליד העבודה,
   * ולכל אחד מהם טווח סבירות משלו.
   */
  searchAreas: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radiusKm: z.number().min(MIN_SEARCH_RADIUS_KM).max(MAX_SEARCH_RADIUS_KM),
        label: z.string().max(60).optional(),
      }),
    )
    .max(MAX_SEARCH_AREAS)
    .default([]),
  dealType: DealTypeSchema,
  propertyTypes: z.array(PropertyTypeSchema).default([]),
  budgetMinAgorot: MoneyAgorotSchema.optional(),
  /**
   * תקציב מקסימלי. **רשות** — לקוח בלי תקציב ידוע הוא מצב נורמלי.
   *
   * שיחה נכנסת שנרשמו בה שם וטלפון היא לקוח לכל דבר, והתקציב
   * מתברר בשיחה הבאה. כשהשדה היה חובה המסכים שלחו 0 במקומו,
   * ומנוע ההתאמות קרא את זה כ"לא יכול להרשות לעצמו כלום" —
   * כלומר הכרטיס נשמר והתוצאה הייתה גרועה משמירה בלעדיו.
   *
   * בלי תקציב קריטריון התקציב פשוט אינו נספר בהתאמה, והציון
   * מנורמל לפי מה שכן נבחן.
   */
  budgetMaxAgorot: MoneyAgorotSchema.optional(),
  roomsMin: z.number().multipleOf(0.5).optional(),
  roomsMax: z.number().multipleOf(0.5).optional(),
  areaSqmMin: z.number().int().optional(),
  /** מאפיין → רמת דרישה. למשל: { hasElevator: "must", hasSafeRoom: "nice" } */
  /*
   * מפתח חופשי ולא `enum` סגור: מאז שהמשרד יכול להוסיף מאפיינים
   * משלו, רשימה סגורה הייתה דוחה דרישה למאפיין שהנכס כן נושא.
   * המפתחות המותאמים נושאים קידומת `custom:` ולכן אינם יכולים
   * להתנגש בחמשת הקבועים — ראו `logic/custom-features.ts`.
   */
  features: z.record(z.string().min(1).max(64), RequirementLevelSchema).default({}),
  /**
   * מתי הקונה צריך להיכנס — כמו בנכס, המצב ולא רק התאריך.
   *
   * `immediate` = צריך עכשיו · `by_date` = לא יאוחר מ-`entryBy` ·
   * `flexible` = אין אילוץ, וזה משנה את ההתאמה: קונה גמיש לא ייפסל
   * על נכס שמתפנה בעוד חצי שנה.
   */
  entryType: z.enum(["immediate", "by_date", "flexible"]).optional(),
  /** רלוונטי ל-`by_date` בלבד. */
  entryBy: z.coerce.date().optional(),
  flexibilityNotes: z.string().max(1000).optional(),
});
export type BuyerRequirements = z.infer<typeof BuyerRequirementsSchema>;

export const BuyerSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  contactId: IdSchema,
  requirements: BuyerRequirementsSchema,
  financing: FinancingStatusSchema.default("unknown"),
  maturity: BuyerMaturitySchema,
  /** דריסה ידנית של המתווך גוברת על החישוב האוטומטי. */
  maturityOverridden: z.boolean().default(false),
  source: z.string().max(60),
  aiNotes: z.string().max(4000).optional(),
  agentNotes: z.string().max(4000).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Buyer = z.infer<typeof BuyerSchema>;
