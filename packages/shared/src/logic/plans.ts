/**
 * מסלולי המנוי — מה כלול בכל אחד.
 *
 * עד כה "מסלול" היה מחרוזת אחת על המשרד, ומה שהוא מזכה בו היה כתוב
 * בקוד: `@RequirePlan("agency", "enterprise")` על מסך הדוחות. כלומר
 * כדי לפתוח פיצ'ר למסלול נמוך יותר, או להוסיף מסלול, היה צריך לשנות
 * קוד ולעלות גרסה.
 *
 * כאן ההגדרה עוברת לנתונים: לכל מסלול יש רשימת פיצ'רים ומגבלות, ובעל
 * הפלטפורמה עורך אותן ממסך. הקוד שואל **פיצ'ר**, לא מסלול — בדיוק
 * כמו שהוא שואל יכולת ולא תפקיד (docs/04 §3).
 *
 * הקובץ הזה לא נוגע בבסיס נתונים: הוא מגדיר את קטלוג הפיצ'רים, את
 * ברירות המחדל, ואת ההחלטות שקל לטעות בהן בשקט — מה קורה כשמסלול
 * חסר, מה נחשב חריגה ממגבלה, ומה מותר לשנות.
 */

/** קוד פיצ'ר — מה שהקוד שואל עליו. */
export type PlanFeature =
  | "analytics"
  | "telephony"
  | "transcription"
  | "collaboration"
  | "agreements"
  | "landing_pages"
  | "whatsapp"
  | "data_io"
  | "ai_coach"
  | "voice_intake";

export interface PlanFeatureInfo {
  code: PlanFeature;
  label: string;
  /** מה המשרד מקבל — הניסוח שמוצג גם בדף המסלולים וגם במסך העריכה. */
  description: string;
}

/**
 * קטלוג הפיצ'רים.
 *
 * הרשימה בקוד ולא ב-DB בכוונה: פיצ'ר קיים רק אם יש קוד שאוכף אותו.
 * מסלול שמפנה לקוד פיצ'ר לא מוכר הוא טעות הקלדה, לא הרשאה — ולכן
 * `sanitizeFeatures` זורק אותו במקום לשמור אותו בשקט.
 */
export const PLAN_FEATURES: readonly PlanFeatureInfo[] = [
  {
    code: "analytics",
    label: "דוחות וביצועי סוכנים",
    description: "תמונת המשרד: לידים, המרות, הצעות שנשלחו וביצועי כל סוכן.",
  },
  {
    code: "telephony",
    label: "חיבור מרכזייה טלפונית",
    description: "שיחות נכנסות נכנסות למערכת אוטומטית, וחיוג יוצא מתוך הכרטיס.",
  },
  {
    code: "transcription",
    label: "תמלול שיחות וזיהוי דוברים",
    description: "כל שיחה מוקלטת מתומללת בעברית, עם הפרדה בין המתווך ללקוח.",
  },
  {
    code: "collaboration",
    label: "שיתופי פעולה בין משרדים",
    description: "שיתוף נכסים וקונים עם משרדים אחרים וחלוקת עמלה מוסכמת.",
  },
  {
    code: "agreements",
    label: "החתמה דיגיטלית",
    description: "הסכמי תיווך ובלעדיות נשלחים לחתימה בקישור, בלי מדפסת.",
  },
  {
    code: "landing_pages",
    label: "דפי נחיתה לנכסים",
    description: "דף ציבורי לכל נכס; כל פנייה ממנו נכנסת ישירות ללידים.",
  },
  {
    code: "whatsapp",
    label: "שליחה בוואטסאפ",
    description: "הצעות ועדכוני שיווק נפתחים בוואטסאפ עם ההודעה מוכנה.",
  },
  {
    code: "data_io",
    label: "ייבוא וייצוא נתונים",
    description: "העלאת קובץ נכסים או קונים קיים, וייצוא הכול בכל רגע.",
  },
  {
    code: "ai_coach",
    label: "מאמן חכם",
    description: "המלצות יומיות על מי לחזור אליו ומה נתקע במשפך.",
  },
  {
    code: "voice_intake",
    label: "קליטה קולית והכתבה",
    description: "הקלטת נכס או קונה בדיבור, והמערכת ממלאת את השדות.",
  },
];

const FEATURE_CODES = new Set<string>(PLAN_FEATURES.map((f) => f.code));

export function isPlanFeature(value: string): value is PlanFeature {
  return FEATURE_CODES.has(value);
}

export function featureLabel(code: string): string {
  return PLAN_FEATURES.find((f) => f.code === code)?.label ?? code;
}

/**
 * ניקוי רשימת פיצ'רים שהגיעה מבחוץ.
 *
 * קוד לא מוכר נזרק וכפילויות מוסרות. השמירה על הסדר של הקטלוג ולא
 * על סדר הקלט היא מכוונת: שתי רשימות עם אותם פיצ'רים ייראו זהות
 * במסך ובהשוואה, בלי תלות בסדר שבו סומנו.
 */
export function sanitizeFeatures(input: readonly string[]): PlanFeature[] {
  const wanted = new Set(input);
  return PLAN_FEATURES.filter((f) => wanted.has(f.code)).map((f) => f.code);
}

/** מגבלת כמות. `null` = ללא הגבלה, וזה ערך תקין ומכוון. */
export type PlanLimit = number | null;

export interface PlanDefinition {
  code: string;
  name: string;
  description: string;
  monthlyPriceAgorot: number;
  /** מחיר שנתי — `null` כשהמסלול נמכר חודשי בלבד. */
  yearlyPriceAgorot: number | null;
  maxUsers: PlanLimit;
  maxProperties: PlanLimit;
  features: PlanFeature[];
  trialDays: number;
  /** האם המסלול מוצג בדף ההרשמה הציבורי. */
  isPublic: boolean;
  sortOrder: number;
}

/**
 * ברירות המחדל — המסלולים שהמערכת עולה איתם.
 *
 * הן נשארות בקוד גם אחרי שהטבלה קיימת, כי הן שתי דברים שונים:
 * הטבלה היא מה שבעל הפלטפורמה קבע, וזו נקודת ההתחלה שממנה הוא
 * התחיל. משרד שנרשם לפני שהוגדר משהו עדיין צריך לעבוד.
 */
export const DEFAULT_PLANS: readonly PlanDefinition[] = [
  {
    code: "basic",
    name: "בסיסי",
    description: "למתווך עצמאי שרוצה סדר בנכסים ובקונים.",
    monthlyPriceAgorot: 14_900,
    yearlyPriceAgorot: 149_000,
    maxUsers: 2,
    maxProperties: 60,
    features: ["whatsapp", "landing_pages", "voice_intake"],
    trialDays: 14,
    isPublic: true,
    sortOrder: 10,
  },
  {
    code: "pro",
    name: "מקצועי",
    description: "למשרד קטן שעובד עם צוות ורוצה שהמערכת תעבוד בשבילו.",
    monthlyPriceAgorot: 29_900,
    yearlyPriceAgorot: 299_000,
    maxUsers: 6,
    maxProperties: 300,
    features: [
      "whatsapp",
      "landing_pages",
      "voice_intake",
      "agreements",
      "data_io",
      "ai_coach",
    ],
    trialDays: 14,
    isPublic: true,
    sortOrder: 20,
  },
  {
    code: "agency",
    name: "סוכנות",
    description: "למשרד מלא: דוחות, מרכזייה, תמלול שיחות ושיתופי פעולה.",
    monthlyPriceAgorot: 59_900,
    yearlyPriceAgorot: 599_000,
    maxUsers: 20,
    maxProperties: null,
    features: [
      "whatsapp",
      "landing_pages",
      "voice_intake",
      "agreements",
      "data_io",
      "ai_coach",
      "analytics",
      "telephony",
      "transcription",
      "collaboration",
    ],
    trialDays: 14,
    isPublic: true,
    sortOrder: 30,
  },
  {
    code: "enterprise",
    name: "רשת",
    description: "לרשת סניפים — הכול פתוח, ללא הגבלת משתמשים ונכסים.",
    monthlyPriceAgorot: 0,
    yearlyPriceAgorot: null,
    maxUsers: null,
    maxProperties: null,
    features: PLAN_FEATURES.map((f) => f.code),
    trialDays: 30,
    /**
     * לא מוצג בדף ההרשמה: מסלול רשת נסגר בשיחה ולא בכרטיס אשראי.
     * ההסתרה כאן היא החלטה עסקית, לא הרשאה — הוא עדיין מסלול תקין
     * שבעל הפלטפורמה יכול לשייך אליו משרד.
     */
    isPublic: false,
    sortOrder: 40,
  },
];

export const DEFAULT_PLAN_CODE = "pro";

export function defaultPlan(code: string): PlanDefinition | undefined {
  return DEFAULT_PLANS.find((p) => p.code === code);
}

/**
 * האם המסלול מזכה בפיצ'ר.
 *
 * **מסלול לא מוכר לא מזכה בכלום.** משרד ששויך למסלול שנמחק, או
 * שהמחרוזת שלו שגויה, יקבל מסך חסום ולא גישה מלאה — הכיוון הבטוח
 * מבין השניים.
 */
export function planAllows(plan: PlanDefinition | undefined, feature: PlanFeature): boolean {
  return plan !== undefined && plan.features.includes(feature);
}

export interface LimitState {
  /** האם הפעולה הבאה חורגת מהמגבלה. */
  blocked: boolean;
  /** כמה נשאר עד המגבלה; `null` כשאין מגבלה. */
  remaining: number | null;
  /** אחוז ניצול לתצוגה; `null` כשאין מגבלה. */
  percent: number | null;
  /** מתקרבים לתקרה — הזמן להציע שדרוג, לא אחרי שנחסם. */
  warn: boolean;
}

const WARN_AT_PERCENT = 80;

/**
 * מצב מול מגבלה.
 *
 * `blocked` נבדק על **הפעולה הבאה** ולא על המצב הנוכחי: משרד עם 60
 * נכסים במסלול של 60 אינו חורג, אבל הנכס ה-61 חסום. ההפרדה הזו היא
 * מה שמונע חסימה של משרד שכבר קיים אחרי שהמגבלה הוקטנה.
 */
export function limitState(used: number, limit: PlanLimit): LimitState {
  if (limit === null || limit <= 0) {
    return { blocked: false, remaining: null, percent: null, warn: false };
  }
  const remaining = Math.max(0, limit - used);
  const percent = Math.min(100, Math.round((used / limit) * 100));
  return { blocked: used >= limit, remaining, percent, warn: percent >= WARN_AT_PERCENT };
}

/** מחיר לתצוגה — אגורות לשקלים, בלי אגורות מיותרות. */
export function formatPlanPrice(agorot: number): string {
  if (agorot <= 0) return "לפי הצעה";
  const shekels = agorot / 100;
  const rounded = Number.isInteger(shekels) ? shekels : Number(shekels.toFixed(2));
  return `${rounded.toLocaleString("he-IL")} ₪`;
}

/**
 * חיסכון שנתי באחוזים — `null` כשאין מחיר שנתי או שאין חיסכון.
 *
 * מוצג רק כשהוא אמיתי: "חסוך 0%" גרוע מלא להציג כלום.
 */
export function yearlySavingPercent(plan: PlanDefinition): number | null {
  if (plan.yearlyPriceAgorot === null || plan.monthlyPriceAgorot <= 0) return null;
  const fullYear = plan.monthlyPriceAgorot * 12;
  if (plan.yearlyPriceAgorot >= fullYear) return null;
  return Math.round(((fullYear - plan.yearlyPriceAgorot) / fullYear) * 100);
}

/**
 * בדיקת תקינות של הגדרת מסלול לפני שמירה.
 *
 * מחזיר הודעה בעברית או `null`. הכללים אינם פורמליים: מגבלה של אפס
 * משתמשים היא מסלול שאי אפשר להשתמש בו, ומחיר שנתי גבוה ממחיר חודשי
 * כפול 12 הוא כמעט תמיד טעות הקלדה של אפס עודף.
 */
export function planRejectionReason(plan: PlanDefinition): string | null {
  if (plan.name.trim().length < 2) return "שם המסלול קצר מדי";
  if (plan.monthlyPriceAgorot < 0 || (plan.yearlyPriceAgorot ?? 0) < 0) {
    return "מחיר שלילי אינו אפשרי";
  }
  if (plan.maxUsers !== null && plan.maxUsers < 1) {
    return "מסלול חייב לאפשר לפחות משתמש אחד";
  }
  if (plan.maxProperties !== null && plan.maxProperties < 1) {
    return "מסלול חייב לאפשר לפחות נכס אחד";
  }
  if (plan.trialDays < 0 || plan.trialDays > 90) {
    return "תקופת ניסיון חייבת להיות בין 0 ל-90 ימים";
  }
  if (
    plan.yearlyPriceAgorot !== null &&
    plan.monthlyPriceAgorot > 0 &&
    plan.yearlyPriceAgorot > plan.monthlyPriceAgorot * 12
  ) {
    return "המחיר השנתי גבוה מ-12 תשלומים חודשיים — כנראה ספרה עודפת";
  }
  return null;
}

/**
 * מה ייחסם אם המשרד יעבור למסלול הזה.
 *
 * נועד להצגה **לפני** האישור: הורדת מסלול בשקט היא הדרך המהירה
 * ביותר לשבור משרד עובד — סוכנים שנחסמים, מרכזייה שמפסיקה לקלוט
 * שיחות. עדיף לראות את זה מראש מאשר בטלפון של התמיכה.
 */
export function downgradeWarnings(
  from: PlanDefinition | undefined,
  to: PlanDefinition,
  usage: { users: number; properties: number },
): string[] {
  const warnings: string[] = [];
  const lost = (from?.features ?? []).filter((f) => !to.features.includes(f));
  if (lost.length > 0) {
    warnings.push(`ייסגרו: ${lost.map(featureLabel).join(", ")}`);
  }
  if (to.maxUsers !== null && usage.users > to.maxUsers) {
    warnings.push(`במשרד ${usage.users} משתמשים והמסלול מאפשר ${to.maxUsers}`);
  }
  if (to.maxProperties !== null && usage.properties > to.maxProperties) {
    warnings.push(`במשרד ${usage.properties} נכסים והמסלול מאפשר ${to.maxProperties}`);
  }
  return warnings;
}
