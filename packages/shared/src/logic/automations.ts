/**
 * האוטומציות הפנימיות — מה המערכת עושה מעצמה, בשליטת המשרד.
 *
 * ## למה הקובץ הזה נולד
 *
 * המערכת כבר הריצה שמונה אוטומציות: ליד שלא נענה מוסלם, ליד שהתקרר
 * מחומם, הצעה שנפתחה ולא נענתה מקבלת פולו-אפ, נכס שיורד משיווק שולח
 * חלופה לקונה, ועוד. כולן היו **קבועות בקוד ובלתי נראות**: המשרד לא
 * ידע שהן קיימות, לא יכול היה לכבות אחת מהן, והספים שלהן היו משתני
 * סביבה — כלומר זהים לכל המשרדים במערכת.
 *
 * זה נראה למתווך כמו "המערכת יצרה לי משימה שלא ביקשתי". אוטומציה
 * שאי אפשר לראות ולכבות אינה עוזרת, היא מטרידה — ומשרד שמוצף
 * משימות אוטומטיות מפסיק להסתכל על **כל** המשימות, כולל אלה שהוא
 * כן יצר.
 *
 * ## מה כאן ומה לא
 *
 * כאן הקטלוג בלבד: מה קיים, מה כל אחת עושה במילים של מתווך, ואיזה
 * מספר אפשר לכוון בה. ההרצה עצמה נשארה ב-Worker, וההגדרה נשמרת
 * ב-`tenants.settings` — בדיוק כמו משקלי ההתאמה.
 *
 * הקטלוג הוא **מקום אחד** שגם המסך, גם ה-API וגם ה-Worker קוראים
 * ממנו. שלוש רשימות נפרדות היו נפרדות בפועל ביום שמוסיפים אוטומציה,
 * והתוצאה הייתה מסך שמבטיח שליטה על משהו שאף אחד לא אוכף.
 */

/** מפתח אוטומציה — נשמר ב-DB, ולכן אינו משתנה אחרי שיצא לאוויר. */
export type AutomationKey =
  | "lead_sla"
  | "stale_lead"
  | "offer_followup"
  | "viewing_followup"
  | "property_delisted"
  | "daily_brief"
  | "weekly_summary"
  | "exclusivity";

/** יחידת הסף שאפשר לכוון. `null` = לאוטומציה אין מספר, רק כן/לא. */
export type AutomationUnit = "hours" | "days" | null;

export interface AutomationSpec {
  key: AutomationKey;
  /** מה זה, בשורה — הכותרת שהמשרד רואה. */
  title: string;
  /** מה קורה בפועל, בניסוח שאומר גם *מה נוצר* ולמי. */
  what: string;
  /**
   * מתי היא רצה — הבהרה שמונעת את השאלה "למה זה לא קרה מיד".
   */
  when: string;
  unit: AutomationUnit;
  /** ברירת המחדל של הסף; חסר כשאין סף. */
  defaultValue?: number;
  min?: number;
  max?: number;
  /**
   * אוטומציה שאסור לכבות.
   *
   * התראות הבלעדיות הן היחידות כאלה: מועד השליש ותום הבלעדיות הם
   * מועדים שנובעים מחוזה שהמשרד חתם עליו, ומשרד שיכבה אותם יגלה
   * שהבלעדיות פגה רק כשהמוכר יתקשר לשאול. שליטה שמאפשרת לפספס
   * תאריך חוזי אינה שליטה, היא מלכודת.
   */
  required?: boolean;
}

export const AUTOMATIONS: readonly AutomationSpec[] = [
  {
    key: "lead_sla",
    title: "ליד חדש שלא נענה",
    what: "נפתחת משימה דחופה לסוכן האחראי, ומנהל המשרד מקבל התראה.",
    when: "כשעברו X שעות מכניסת הליד בלי מענה ראשון.",
    unit: "hours",
    defaultValue: 2,
    min: 1,
    max: 72,
  },
  {
    key: "stale_lead",
    title: "ליד שהתקרר",
    what: "נפתחת משימה לחזור אל הלקוח, עם התראה לסוכן שהליד שלו.",
    when: "כשליד בטיפול לא זז X ימים. נבדק פעם ביום.",
    unit: "days",
    defaultValue: 7,
    min: 1,
    max: 90,
  },
  {
    key: "offer_followup",
    title: "הצעה נפתחה ולא נענתה",
    what: "נפתחת משימת פולו-אפ לסוכן ששלח את ההצעה.",
    when: "כשעברו X שעות מהרגע שהקונה פתח את ההצעה ולא הגיב.",
    unit: "hours",
    defaultValue: 48,
    min: 1,
    max: 336,
  },
  {
    key: "viewing_followup",
    title: "פולו-אפ אחרי סיור",
    what: "נפתחת משימה לשאול את הקונה איך היה הסיור.",
    when: "X שעות אחרי שהסיור הסתיים.",
    unit: "hours",
    defaultValue: 1,
    min: 1,
    max: 72,
  },
  {
    key: "property_delisted",
    title: "נכס ירד משיווק",
    what: "נפתחת משימה להציע חלופה לכל קונה שהתעניין בו.",
    when: "מיד כשהנכס מסומן כנמכר, הושכר או הוקפא.",
    unit: null,
  },
  {
    key: "daily_brief",
    title: "תקציר יומי",
    what: "התראה עם מה שמחכה היום: פגישות, משימות ולידים ללא מענה.",
    when: "כל בוקר.",
    unit: null,
  },
  {
    key: "weekly_summary",
    title: "סיכום שבועי",
    what: "התראה עם מה שקרה במשרד בשבוע שעבר.",
    when: "פעם בשבוע.",
    unit: null,
  },
  {
    key: "exclusivity",
    title: "מועדי בלעדיות",
    what: "התראה לקראת מועד השליש ולקראת תום הבלעדיות.",
    when: "נבדק פעם ביום מול התאריכים שבחוזה.",
    unit: null,
    required: true,
  },
];

const BY_KEY = new Map(AUTOMATIONS.map((spec) => [spec.key, spec]));

export function automationSpec(key: AutomationKey): AutomationSpec | undefined {
  return BY_KEY.get(key);
}

/** הגדרת אוטומציה אחת. `value` קיים רק למי שיש לה סף. */
export interface AutomationSetting {
  enabled: boolean;
  value?: number;
}

export type AutomationSettings = Record<AutomationKey, AutomationSetting>;

/** ברירת המחדל: הכל פועל, בספים שהיו קבועים בקוד עד כה. */
export function defaultAutomationSettings(): AutomationSettings {
  const out = {} as AutomationSettings;
  for (const spec of AUTOMATIONS) {
    out[spec.key] = {
      enabled: true,
      ...(spec.defaultValue === undefined ? {} : { value: spec.defaultValue }),
    };
  }
  return out;
}

/**
 * קריאת ההגדרה השמורה, סלחנית בכוונה.
 *
 * הערך מגיע מ-JSON שנשמר בעבר, ולכן הוא יכול להיות חסר, חלקי, או
 * מגרסה שבה אוטומציה עדיין לא היה קיימת. **כל חוסר נופל לברירת
 * המחדל ולא מכבה כלום**: אוטומציה שנכבית בשקט בגלל שדה חסר היא
 * בדיוק התקלה שאי אפשר לאבחן — המשרד יגלה אותה כשליד לא ייענה
 * ואף אחד לא יידע.
 *
 * ערך מחוץ לתחום נחתך לתחום ולא נזרק, מאותה סיבה.
 */
export function resolveAutomationSettings(raw: unknown): AutomationSettings {
  const out = defaultAutomationSettings();
  if (typeof raw !== "object" || raw === null) return out;
  const source = raw as Record<string, unknown>;

  for (const spec of AUTOMATIONS) {
    const entry = source[spec.key];
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const current = out[spec.key];
    if (typeof record["enabled"] === "boolean" && spec.required !== true) {
      current.enabled = record["enabled"];
    }
    if (spec.unit !== null && typeof record["value"] === "number") {
      current.value = clampValue(spec, record["value"]);
    }
  }
  return out;
}

function clampValue(spec: AutomationSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.defaultValue ?? 1;
  const min = spec.min ?? 1;
  const max = spec.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * למה ההגדרה נדחית — `null` כשהיא תקפה.
 *
 * הסף נבדק כאן ולא רק נחתך, כי מסך ששולח 500 שעות צריך לדעת שהוא
 * שולח משהו לא סביר; החיתוך ב-`resolve` הוא ההגנה על **קריאה** של
 * ערך שכבר נשמר, לא היתר לכתוב כל דבר.
 */
export function automationRejectionReason(
  key: string,
  setting: { enabled?: unknown; value?: unknown },
): string | null {
  const spec = BY_KEY.get(key as AutomationKey);
  if (spec === undefined) return `אוטומציה לא מוכרת: ${key}`;

  if (setting.enabled !== undefined && typeof setting.enabled !== "boolean") {
    return `${spec.title}: "פועל" חייב להיות כן או לא`;
  }
  if (spec.required === true && setting.enabled === false) {
    return `${spec.title}: אי אפשר לכבות — אלו מועדים שנובעים מהחוזה`;
  }

  if (setting.value === undefined) return null;
  if (spec.unit === null) return `${spec.title}: אין לה סף לכוון`;
  if (typeof setting.value !== "number" || !Number.isFinite(setting.value)) {
    return `${spec.title}: הסף חייב להיות מספר`;
  }
  const min = spec.min ?? 1;
  const max = spec.max ?? Number.MAX_SAFE_INTEGER;
  if (setting.value < min || setting.value > max) {
    return `${spec.title}: הסף חייב להיות בין ${min} ל-${max}`;
  }
  return null;
}

/** תווית היחידה למסך. */
export function automationUnitLabel(unit: AutomationUnit): string {
  if (unit === "hours") return "שעות";
  if (unit === "days") return "ימים";
  return "";
}

/**
 * הסף במילישניות — הצורה שבה ה-Worker וה-Dispatcher צריכים אותו.
 *
 * ההמרה כאן ולא בכל קורא בנפרד: שעות וימים באותו שדה `value` הם
 * בדיוק המקום שבו מישהו יכפיל ב-24 פעם אחת יותר מדי.
 */
export function automationThresholdMs(
  key: AutomationKey,
  settings: AutomationSettings,
): number | null {
  const spec = BY_KEY.get(key);
  if (spec === undefined || spec.unit === null) return null;
  const value = settings[key].value ?? spec.defaultValue;
  if (value === undefined) return null;
  const hours = spec.unit === "days" ? value * 24 : value;
  return hours * 60 * 60 * 1000;
}
