import { formatIsraeliNumber } from "./israel-time.js";
import { grossFromNet } from "./invoice.js";
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
  | "automations"
  | "transcription"
  | "agreements"
  | "landing_pages"
  | "whatsapp"
  /**
   * ‎**הבוט שעונה ללקוחות על הקו של המשרד** (docs/12).
   *
   * נפרד מ-`whatsapp` בכוונה, ולא מפני שנעים לגבות פעמיים: חיבור
   * המספר וקליטת הפניות אינם עולים לנו דבר (Meta אינה מחייבת על
   * הודעות נכנסות, והחיוב על היוצאות הוא של המשרד מול Meta), בעוד
   * שכל תשובה של הבוט היא קריאת LLM שאנחנו משלמים עליה. פיצ'ר
   * אחד לשניהם היה או חוסם בחינם מה שעולה לנו, או מחייב על מה
   * שאינו עולה.
   */
  | "whatsapp_bot"
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
    code: "automations",
    label: "אוטומציות שהמשרד בונה",
    description:
      "בניית כללים משלכם — מתי זה קורה, על מה, ומה לעשות. כולל המשימות האוטומטיות הקבועות.",
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
    code: "whatsapp_bot",
    label: "בוט מענה ללקוחות בוואטסאפ",
    description:
      "הבוט עונה ללקוחות על המספר של המשרד, מאפיין את הפנייה ומעביר לסוכן. חיבור המספר וקליטת הפניות כלולים בכל מסלול — כאן נוסף המענה האוטומטי.",
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

/** חריגי הפלטפורמה על משרד יחיד — מעל המסלול, בשני הכיוונים. */
export interface TenantFeatureOverrides {
  /** תכונות שנפתחו למשרד הזה למרות שאינן במסלול. */
  grants: readonly string[];
  /** תכונות שנסגרו למשרד הזה למרות שהן במסלול. */
  denials: readonly string[];
}

/**
 * התכונות שפתוחות למשרד בפועל: `(מסלול ∪ הענקות) \ דחיות`.
 *
 * **דחייה גוברת על הענקה**, ולא בגלל סדר מקרי. סגירה חייבת להיות
 * ודאית: מי שסוגר תכונה למשרד — בגלל חוב, שימוש לרעה או תקלה —
 * צריך שהסגירה תחזיק גם אם אותה תכונה הוענקה קודם למישהו ונשכחה.
 * הכיוון ההפוך היה הופך כל סגירה לתלויה בהיסטוריה שאיש לא זוכר.
 *
 * זהו אותו כלל שנוהג ב-`blockedModules`: שכבת פלטפורמה חוסמת
 * ולעולם לא נעקפת מלמטה.
 *
 * הפלט עובר `sanitizeFeatures`, ולכן קוד שאינו בקטלוג — שריד
 * מגרסה קודמת או טעות הקלדה — נושר במקום להבטיח תכונה שאף שורת
 * קוד אינה אוכפת.
 */
export function effectiveFeatures(
  planFeatures: readonly string[],
  overrides?: TenantFeatureOverrides,
): PlanFeature[] {
  const open = new Set(planFeatures);
  for (const code of overrides?.grants ?? []) open.add(code);
  for (const code of overrides?.denials ?? []) open.delete(code);
  return sanitizeFeatures([...open]);
}

/**
 * למה אי אפשר להוסיף עוד אוטומציה — או `null` כשאפשר.
 *
 * המונה כולל **את שני הסוגים**: כללים שהמשרד בנה ומשימות אוטומטיות
 * קבועות. מבחינת הלקוח שתיהן אותו דבר — "המערכת עושה משהו בשבילי
 * מעצמה" — ומכסות נפרדות היו מייצרות את השאלה למה נגמרה אחת בזמן
 * שהשנייה פנויה.
 *
 * ההודעה נוקבת במספר ולא אומרת "הגעתם למכסה": משרד שרואה 5/5 יודע
 * מה לעשות (לכבות אחת או לשדרג), ומשרד שרואה הודעה כללית פונה
 * לתמיכה.
 */
export function automationQuotaRejection(used: number, limit: PlanLimit): string | null {
  if (limit === null) return null;
  if (used < limit) return null;
  return `המסלול שלכם כולל ${limit} אוטומציות, וכולן בשימוש. אפשר למחוק אחת קיימת או לשדרג מסלול.`;
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
  /**
   * כמה נכסים המשרד רשאי לפרסם **ברשת השיתופים** בו־זמנית.
   *
   * מכסה נפרדת מ-`maxProperties` במכוון, ולא החמרה שלה. שמירה
   * במאגר היא מה שהמשרד עושה עם הנתונים שלו; פרסום ברשת הוא מה
   * שהוא לוקח ממנה — חשיפה לכל שאר המשרדים. מסלול חינמי יכול
   * להיות נדיב לחלוטין בראשון ומוגבל בשני, וזה בדיוק מה שמאפשר
   * לתת מסלול חינם בלי שהרשת תתמלא במודעות של מי שאינו משלם.
   *
   * `null` = ללא הגבלה, וזה המצב של כל המסלולים בתשלום.
   */
  maxNetworkListings: PlanLimit;
  /**
   * כמה אוטומציות המשרד רשאי להגדיר. `null` = ללא הגבלה.
   *
   * **מונה אחד לשני הסוגים** — כללים שנבנו וגם משימות אוטומטיות
   * קבועות. שתי מכסות נפרדות היו מכריחות את בעל הפלטפורמה לנחש את
   * התמהיל של כל משרד, ואת המשרד להבין למה נגמרה לו מכסה אחת בזמן
   * שהשנייה פנויה. מבחינת הלקוח שתיהן אותו דבר: "המערכת עושה משהו
   * בשבילי מעצמה".
   */
  maxAutomations: PlanLimit;
  /**
   * מחיר חודשי לכל **סוכן וואטסאפ נוסף**, באגורות — מעבר לאחד
   * שכלול במסלול.
   *
   * ‎`null` = לא נמכר במסלול הזה, והמסך יאמר „פנו אלינו” במקום
   * להציג כפתור קנייה. זה מצב תקין ומכוון ולא „טרם הוגדר”: מסלול
   * בסיסי יכול בכוונה לא למכור מקומות נוספים, ומסלול גבוה יכול
   * למכור אותם בזול. המחיר יושב **במסלול** ולא כמספר גלובלי בדיוק
   * מהסיבה הזו (הנחיית בעל המוצר).
   */
  whatsappSeatMonthlyAgorot: number | null;
  /** אותו היגיון לביקושים (קונים) שמתפרסמים ברשת. */
  maxNetworkDemands: PlanLimit;
  features: PlanFeature[];
  trialDays: number;
  /**
   * המחיר נסגר בשיחה ואינו מוצג כמספר.
   *
   * **הדגל הזה הוא מה שמבדיל בין „חינם” ל„בהתאמה”**, ואי אפשר
   * להסיק את ההבדל מ-`monthlyPriceAgorot: 0` — שני המצבים נראים
   * שם זהה. קודם כל מסלול באפס הוצג „בהתאמה”, ולכן מסלול השת"פים
   * החינמי הבטיח ללקוח בדיוק את ההפך ממה שהוא.
   *
   * הדגל אינו `isPublic`: זו שאלה אחרת — האם אפשר לקנות אותו
   * בכרטיס אשראי — ומסלול יכול להיות מתומחר וגם להיסגר בשיחה.
   */
  priceOnRequest: boolean;
  /** האם המסלול מוצג בדף ההרשמה הציבורי. */
  isPublic: boolean;
  sortOrder: number;
}

/**
 * מסלול חינמי באמת — אפס בשני המחזורים **ולא** "לפי הצעה".
 *
 * ההגדרה יושבת כאן, פעם אחת: היא קובעת מי נרשם בלי ניסיון, מי עובר
 * מסלול בלי דף תשלום, ואיך המחיר מוצג — ושלושה עותקים שלה היו
 * נפרדים זה מזה בדיוק ביום שמשנים מסלול.
 */
export function isFreePlan(
  plan: Pick<PlanDefinition, "monthlyPriceAgorot" | "yearlyPriceAgorot" | "priceOnRequest">,
): boolean {
  return (
    !plan.priceOnRequest &&
    plan.monthlyPriceAgorot === 0 &&
    (plan.yearlyPriceAgorot ?? 0) === 0
  );
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
    maxAutomations: null,
    whatsappSeatMonthlyAgorot: null,
    maxNetworkListings: null,
    maxNetworkDemands: null,
    features: ["whatsapp", "landing_pages", "voice_intake"],
    trialDays: 14,
    priceOnRequest: false,
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
    maxAutomations: null,
    whatsappSeatMonthlyAgorot: null,
    maxNetworkListings: null,
    maxNetworkDemands: null,
    features: [
      "whatsapp",
      "landing_pages",
      "voice_intake",
      "agreements",
      "data_io",
      "ai_coach",
    ],
    trialDays: 14,
    priceOnRequest: false,
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
    maxAutomations: null,
    whatsappSeatMonthlyAgorot: null,
    maxNetworkListings: null,
    maxNetworkDemands: null,
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
    ],
    trialDays: 14,
    priceOnRequest: false,
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
    maxAutomations: null,
    whatsappSeatMonthlyAgorot: null,
    maxNetworkListings: null,
    maxNetworkDemands: null,
    features: PLAN_FEATURES.map((f) => f.code),
    trialDays: 30,
    /* מסלול רשת נסגר בשיחה — אין לו מחיר קבוע להציג */
    priceOnRequest: true,
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

/** מה שמוצג במקום מחיר כשאין מחיר קבוע. */
export const CUSTOM_PRICE_LABEL = "בהתאמה";
export const FREE_PRICE_LABEL = "חינם";

/**
 * ‎**כל מחיר במערכת נקוב לפני מע"מ.**
 *
 * זו הנורמה בעסק-לעסק בישראל — הלקוח הוא עוסק שמקזז את המע"מ, ולכן
 * המספר שמעניין אותו הוא הנטו — וכך כבר נכתב בעמוד המחירים של
 * הטלפוניה. מה שהיה חסר הוא שזה ייאמר **בכל מקום**: מחיר שמוצג
 * בלי הסייג נקרא כסכום שיירד מהכרטיס, והפער מתגלה בדף התשלום.
 *
 * הסיומת קצרה בכוונה — היא נצמדת למספר עצמו ולא לפסקה מתחתיו,
 * כי היא חלק מהמחיר ולא הערת שוליים.
 */
export const VAT_EXCLUDED_SUFFIX = "+ מע\"מ";

/** משפט מלא, למקום שבו הסיומת לבדה אינה מספיקה (מחירון, דף תשלום). */
export const VAT_EXCLUDED_NOTE = "כל המחירים אינם כוללים מע\"מ.";

/**
 * הסייג שמלווה כל מחיר מוצג.
 *
 * המחירון תקף למצטרפים חדשים ולשנה הראשונה, ואינו כולל מע"מ. מחיר
 * שמוצג בלי הסייג הזה נקרא כהתחייבות לתמיד, וזה בדיוק מה שמייצר
 * ויכוח בחידוש.
 */
export const PRICE_TERMS_NOTE =
  `${VAT_EXCLUDED_NOTE} המחירים למצטרפים חדשים ולשנה הראשונה בלבד.`;

/**
 * המחיר החודשי לתצוגה.
 *
 * **שלושה מצבים, לא שניים.** מסלול מתומחר מציג מספר; מסלול שסומן
 * `priceOnRequest` מציג „בהתאמה”; ומסלול באפס בלי הדגל הוא **חינם**
 * ומציג „חינם”.
 *
 * ההבחנה הזו לא הייתה קיימת, וכל מסלול באפס הוצג „בהתאמה”. התוצאה
 * הייתה שמסלול השת"פים החינמי — שכל הרעיון שלו הוא שאין בו מה
 * לשלם — הבטיח ללקוח בדיוק את ההפך: „דבר איתנו על המחיר”.
 *
 * וזו גם הסיבה שאסור להסיק מאפס: אפס יכול להיות „לא נקבע מחיר”
 * ויכול להיות „אין מחיר”, ואלה שתי הבטחות מסחריות מנוגדות.
 */
export function planPriceLabel(plan: PlanDefinition): string {
  if (plan.priceOnRequest) return CUSTOM_PRICE_LABEL;
  return formatPriceExVat(plan.monthlyPriceAgorot);
}

/** מחיר לתצוגה — אגורות לשקלים, בלי אגורות מיותרות. */
export function formatPlanPrice(agorot: number): string {
  if (agorot <= 0) return FREE_PRICE_LABEL;
  const shekels = agorot / 100;
  const rounded = Number.isInteger(shekels) ? shekels : Number(shekels.toFixed(2));
  return `${formatIsraeliNumber(rounded)} ₪`;
}

/**
 * מחיר לתצוגה **עם ציון שהוא לפני מע"מ** — וזו ברירת המחדל.
 *
 * ‎**„חינם + מע"מ” אינו דבר**, וזו בדיוק הסיבה שההחלטה יושבת
 * בפונקציה אחת ולא בשרשור מחרוזות באתר הקריאה: מסלול באפס, קופון
 * שמכסה הכול, ומסלול שנסגר בשיחה — בכולם אין מה לחייב, ולכן אין
 * מע"מ להוסיף. אתר קריאה שכותב `` `${formatPlanPrice(x)} + מע"מ` ``
 * יפיק את השטות הזאת ברגע שהמחיר יהיה אפס, וזה קורה בפועל.
 */
export function formatPriceExVat(agorot: number): string {
  if (agorot <= 0) return FREE_PRICE_LABEL;
  return `${formatPlanPrice(agorot)} ${VAT_EXCLUDED_SUFFIX}`;
}

/**
 * ‎**מה באמת יירד מהכרטיס** — הנטו ועוד המע"מ, בשקלים.
 *
 * מוצג לצד המחיר ולא במקומו. „149 ₪ + מע"מ” לבדו מחייב את המשרד
 * לחשב בראש כמה יחויב, ומי שלא חישב מגלה את ההפרש בדף התשלום —
 * שם זה כבר נראה כמו הפתעה ולא כמו תמחור.
 */
export function formatPriceWithVatTotal(agorot: number, vatPercent: number): string | null {
  if (agorot <= 0) return null;
  const gross = grossFromNet(agorot, vatPercent);
  return `${formatPlanPrice(gross)} לתשלום`;
}

/**
 * חיסכון שנתי באחוזים — `null` כשאין מחיר שנתי או שאין חיסכון.
 *
 * מוצג רק כשהוא אמיתי: "חסוך 0%" גרוע מלא להציג כלום.
 */
export function yearlySavingPercent(plan: PlanDefinition): number | null {
  if (plan.priceOnRequest) return null;
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
  /*
   * גם כאן המינימום הוא 1 ולא 0, ולא רק לשם אחידות: `limitState`
   * קורא 0 כשדה ריק ומחזיר "ללא הגבלה" (ראו הבדיקה שם). מסלול
   * ששמור בו 0 היה מקבל בדיוק את ההפך ממה שנראה במסך — פרסום בלי
   * גבול. מי שרוצה לסגור את הרשת למסלול מסוים יעשה זאת בשער פיצ'ר,
   * לא במכסה של אפס.
   */
  if (plan.maxNetworkListings !== null && plan.maxNetworkListings < 1) {
    return "מכסת נכסים ברשת חייבת להיות לפחות 1, או ריקה לציון ללא הגבלה";
  }
  if (plan.maxNetworkDemands !== null && plan.maxNetworkDemands < 1) {
    return "מכסת קונים ברשת חייבת להיות לפחות 1, או ריקה לציון ללא הגבלה";
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
  usage: {
    users: number;
    properties: number;
    /** כמה מפורסמים ברשת עכשיו — אופציונלי לקוראים ישנים. */
    networkListings?: number;
    networkDemands?: number;
  },
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
  /*
   * המכסות של הרשת מוזכרות בנפרד, כי הן מתנהגות אחרת בירידת מסלול:
   * נכס שכבר מפורסם אינו יורד מהרשת מעצמו — הוא נשאר, ורק פרסום
   * חדש נחסם. עדיף לומר את זה מראש מאשר להשאיר את המנהל בהנחה
   * שמודעות ייעלמו, או בהנחה ההפוכה שאפשר להמשיך לפרסם.
   */
  if (
    to.maxNetworkListings !== null &&
    (usage.networkListings ?? 0) > to.maxNetworkListings
  ) {
    warnings.push(
      `${usage.networkListings} נכסים מפורסמים ברשת והמסלול מאפשר ${to.maxNetworkListings} — הקיימים יישארו, פרסום נוסף ייחסם`,
    );
  }
  if (
    to.maxNetworkDemands !== null &&
    (usage.networkDemands ?? 0) > to.maxNetworkDemands
  ) {
    warnings.push(
      `${usage.networkDemands} קונים מפורסמים ברשת והמסלול מאפשר ${to.maxNetworkDemands} — הקיימים יישארו, פרסום נוסף ייחסם`,
    );
  }
  return warnings;
}
