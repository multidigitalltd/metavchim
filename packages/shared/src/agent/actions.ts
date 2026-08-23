/**
 * קטלוג הפעולות של הסוכן — **מקור האמת היחיד** על מה הוא יודע לעשות.
 *
 * ## מה נגזר מכאן
 *
 * הסכימה ש-Gemini מקבל, הוולידציה בשרת, בדיקת ההרשאה, ותוויות
 * המסך — כולם נקראים מכאן. הוספת פעולה היא רשומה אחת, ולא ארבעה
 * מקומות שצריך לזכור לעדכן יחד.
 *
 * ## שלושת הכללים שהקטלוג אוכף
 *
 * **1. לכל פעולה יש `capability`.** הסוכן אינו ערוץ עוקף הרשאות:
 * מודל שיציע `update_property` למשתמש בלי `properties.edit` ייעצר
 * בשרת בדיוק כמו לחיצה על כפתור. הבדיקה נעשית מהקטלוג, לא מזיכרון
 * של מי שכתב את הנתיב, ובדיקה מבנית מוודאת שאין רשומה בלי יכולת.
 *
 * **2. אין פעולות הרסניות.** אין `delete_*` ואין ביטול. הצעה
 * שנוצרה מתמלול שגוי או מטקסט זדוני יכולה במקרה הגרוע לבקש רשומה
 * מיותרת — שאפשר למחוק — ולא למחוק רשומה שאי אפשר להחזיר.
 *
 * **3. `risk` קובע את חוויית האישור.** `read` רץ מיד ומציג תשובה,
 * `create`/`update` דורשים לחיצה על כרטיס ההצעה, ו-`outbound` דורש
 * גם בחירה מפורשת של הנמען שזוהה. פעולה שיוצאת ללקוח אינה יכולה
 * לקרות מדיבור בטעות.
 *
 * ## למה כל שדה משותף מוצהר פעם אחת
 *
 * סכימת Gemini אינה תומכת ב-`oneOf`, ולכן כל השדות מאוחדים
 * לאובייקט אחד שבו כל מפתח מופיע פעם אחת. שתי פעולות שמצהירות על
 * אותו מפתח בתיאור שונה גורמות לאחת מהן לקבל את ההגדרה של האחרת —
 * והמודל ימלא אותו לפי התיאור הלא נכון, בשקט. לכן השדות המשותפים
 * הם קבועים בעלי שם למטה, וכל פעולה **מפנה** אליהם במקום להצהיר
 * מחדש. בדיקה מבנית אוכפת את זה.
 */

import type { Capability } from "../rbac.js";
import type { AgentFieldSpec } from "./field-spec.js";

export const AGENT_ACTION_IDS = [
  "search",
  "find_buyers",
  "find_properties",
  "show_matches",
  "show_schedule",
  "show_tasks",
  "show_calls",
  "show_card",
  "play_recording",
  "show_deals",
  "office_report",
  "create_lead",
  "create_buyer",
  "create_property",
  "create_task",
  "complete_task",
  "add_note",
  "update_lead_status",
  "schedule_appointment",
  "update_buyer",
  "update_property",
  "share_property",
  "share_buyer",
  "send_offer",
] as const;

export type AgentActionId = (typeof AGENT_ACTION_IDS)[number];

/**
 * `read` — שאילתה בלבד, אין שינוי · `create` — רשומה חדשה ·
 * `update` — שינוי רשומה קיימת · `outbound` — יוצא אל מחוץ למשרד.
 */
export type AgentRisk = "read" | "create" | "update" | "outbound";

export interface AgentActionDef {
  id: AgentActionId;
  /** מה המתווך רואה בכרטיס ההצעה */
  title: string;
  /** מתי לבחור בה — נכנס לפרומפט כפי שהוא */
  when: string;
  /** דוגמאות בעברית מדוברת. מודל שרואה ניסוח אמיתי מדייק בסדר גודל. */
  examples: readonly string[];
  capability: Capability;
  /**
   * יכולת שנייה שגם היא **מספיקה** לפתיחת הפעולה.
   *
   * לרוב המכריע של הפעולות יש מודול אחד, ולשדה הזה אין מה לעשות
   * בהן. היוצא מן הכלל הוא פעולה שמזהה את הרשומה לפי מה שנאמר
   * ולא לפי סוגה: „תראה לי את הכרטיס של משה” יכול להתברר כקונה
   * או כליד, והשואל אינו יודע לומר מראש. הצהרה על יכולת אחת בלבד
   * חסמה שם משתמשים חוקיים לגמרי — מי שיש לו רק לידים לא יכול היה
   * לבקש כרטיס, ומי שיש לו רק קונים לא יכול היה לבקש הקלטה
   * (ביקורת Codex).
   *
   * זהו שער **הכניסה** בלבד, ולא ההיתר לרשומה שנבחרה: מיד אחרי
   * הזיהוי `cardTarget` בודק שוב את היכולת שמתאימה לסוג שנפתר,
   * ולכן ההרחבה כאן אינה מרחיבה שום גישה בפועל.
   */
  capabilityAlt?: Capability;
  risk: AgentRisk;
  fields: readonly AgentFieldSpec[];
  /**
   * שדות שהמודל **אינו** ממלא ובכל זאת שייכים לפעולה: תאריכים,
   * קואורדינטות ומזהי רשומות. הם נפתרים דטרמיניסטית אחרי התשובה.
   * מוצהרים כאן כדי שהכרטיס יידע להציג אותם.
   */
  resolved?: readonly { key: string; label: string }[];
}

// ---------------------------------------------------------------------------
// אוצר המונחים — תוויות הערכים, פעם אחת לכל המערכת
// ---------------------------------------------------------------------------

const DEAL_TYPE_LABELS = { sale: "מכירה", rent: "השכרה" } as const;

const PROPERTY_TYPE_LABELS = {
  apartment: "דירה",
  garden_apartment: "דירת גן",
  penthouse: "פנטהאוז",
  duplex: "דופלקס",
  private_house: "בית פרטי",
  two_family: "דו משפחתי",
  studio: "סטודיו",
  unit: "יחידת דיור",
  shared_tabu: "טאבו משותף",
  divisible_apartment: "דירה מתאימה לחלוקה",
  plot: "מגרש",
  commercial: "מסחרי",
  other: "אחר",
} as const;

const FEATURE_LABELS = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: 'ממ"ד',
  hasStorage: "מחסן",
} as const;

const FEATURE_KEYS = Object.keys(FEATURE_LABELS);

// ---------------------------------------------------------------------------
// שדות משותפים — כל אחד מוצהר פעם אחת ומופנה אליו מכל פעולה
// ---------------------------------------------------------------------------

const F_NAME: AgentFieldSpec = { key: "name", label: "שם", type: "string", maxLength: 120 };

/**
 * הטלפון מגיע כפי שנאמר ומנורמל בשרת: מודל שמתבקש לפרמט מספרים
 * מתחיל להמציא קידומות, ונרמול טלפון ישראלי הוא כלל ולא ניחוש.
 */
const F_PHONE: AgentFieldSpec = {
  key: "phone",
  label: "טלפון",
  type: "string",
  hint: "כפי שנאמר, בלי לתקן קידומת",
  maxLength: 30,
};

const F_EMAIL: AgentFieldSpec = {
  key: "email",
  label: 'דוא"ל',
  type: "string",
  maxLength: 160,
};

const F_DEAL_TYPE: AgentFieldSpec = {
  key: "dealType",
  label: "סוג עסקה",
  type: "enum",
  values: ["sale", "rent"],
  valueLabels: DEAL_TYPE_LABELS,
};

const F_CITIES: AgentFieldSpec = {
  key: "cities",
  label: "ערים / אזורים",
  type: "stringList",
  hint: 'כל שם מקום בישראל שנאמר — עיר, יישוב, שכונה או אזור, בצורתו המקובלת ובלי מילית חיבור ("בגבעתיים" ⇒ "גבעתיים"). כלול גם שמות קטנים או פחות מוכרים',
  maxItems: 8,
};

const F_NEIGHBORHOODS: AgentFieldSpec = {
  key: "neighborhoods",
  label: "שכונות",
  type: "stringList",
  hint: "רק כשנאמרה שכונה בנוסף לעיר",
  maxItems: 8,
};

const F_PROPERTY_TYPES: AgentFieldSpec = {
  key: "propertyTypes",
  label: "סוגי נכס",
  type: "enumList",
  values: Object.keys(PROPERTY_TYPE_LABELS),
  valueLabels: PROPERTY_TYPE_LABELS,
  maxItems: 5,
};

const F_ROOMS_MIN: AgentFieldSpec = {
  key: "roomsMin",
  label: "חדרים — מינימום",
  type: "number",
  hint: '"4 חדרים" ⇒ גם roomsMin וגם roomsMax = 4; "לפחות 3" ⇒ רק roomsMin',
  min: 1,
  max: 20,
  multipleOf: 0.5,
};

const F_ROOMS_MAX: AgentFieldSpec = {
  key: "roomsMax",
  label: "חדרים — מקסימום",
  type: "number",
  min: 1,
  max: 20,
  multipleOf: 0.5,
};

/**
 * שתי רשימות ולא מפה של מאפיין⟵רמה.
 *
 * הניסוח האנושי הוא בדיוק זה: "חייב מעלית, ורצוי מרפסת". מודל
 * שמתבקש למלא אובייקט מקונן שוגה בו הרבה יותר מאשר בשתי רשימות
 * שטוחות — וההמרה למפה שהסכימה של הקונה מצפה לה היא שורה אחת
 * בשרת.
 */
const F_MUST_FEATURES: AgentFieldSpec = {
  key: "mustFeatures",
  label: "מאפיינים — חובה",
  type: "enumList",
  hint: 'מה שנאמר עליו "חייב", "הכרחי", "בלי זה לא"',
  values: FEATURE_KEYS,
  valueLabels: FEATURE_LABELS,
  maxItems: 5,
};

const F_NICE_FEATURES: AgentFieldSpec = {
  key: "niceFeatures",
  label: "מאפיינים — רצוי",
  type: "enumList",
  hint: 'מה שנאמר עליו "רצוי", "יעדיף", "אם אפשר"',
  values: FEATURE_KEYS,
  valueLabels: FEATURE_LABELS,
  maxItems: 5,
};

/**
 * ביטוי מזהה — מה שנאמר, לא מזהה רשומה.
 *
 * המודל לעולם אינו מחזיר `id`: הוא אינו רואה את המאגר, וכל מזהה
 * שיחזיר יהיה המצאה שנראית תקינה. הוא מוסר את **הביטוי** שנאמר,
 * והקוד מחפש אותו מול הנתונים של המשרד ומחזיר מועמדים לבחירה.
 */
const F_BUYER_PHRASE: AgentFieldSpec = {
  key: "buyerPhrase",
  label: "איזה לקוח",
  type: "string",
  hint: "השם או התיאור שנאמר, כפי שנאמר",
  maxLength: 200,
};

const F_PROPERTY_PHRASE: AgentFieldSpec = {
  key: "propertyPhrase",
  label: "איזה נכס",
  type: "string",
  hint: "התיאור שנאמר — כתובת, עיר, סוג או שם הבעלים",
  maxLength: 200,
};

const F_TASK_PHRASE: AgentFieldSpec = {
  key: "taskPhrase",
  label: "איזו משימה",
  type: "string",
  hint: "מילים מתוך כותרת המשימה, כפי שנאמרו",
  maxLength: 200,
};

const F_CARD_PHRASE: AgentFieldSpec = {
  key: "cardPhrase",
  label: "על איזה כרטיס",
  type: "string",
  hint: "שם הלקוח או הליד שההערה נוגעת אליו",
  maxLength: 200,
};

const F_LEAD_PHRASE: AgentFieldSpec = {
  key: "leadPhrase",
  label: "איזה ליד",
  type: "string",
  hint: "השם או התיאור של הליד, כפי שנאמר",
  maxLength: 200,
};

const F_MATURITY: AgentFieldSpec = {
  key: "maturity",
  label: "בשלות",
  type: "enum",
  hint: "עד כמה הלקוח קרוב לעסקה, לפי מה שנאמר",
  values: ["very_hot", "hot", "interested", "not_ripe"],
  valueLabels: {
    very_hot: "חם מאוד",
    hot: "חם",
    interested: "מתעניין",
    not_ripe: "לא בשל",
  },
};

const F_FINANCING: AgentFieldSpec = {
  key: "financing",
  label: "מימון",
  type: "enum",
  values: ["cash", "pre_approved", "in_process", "not_started", "unknown"],
  valueLabels: {
    cash: "הון עצמי",
    pre_approved: "אישור עקרוני",
    in_process: "בתהליך",
    not_started: "טרם התחיל",
    unknown: "לא ידוע",
  },
};

const F_AGENT_NOTES: AgentFieldSpec = {
  key: "agentNotes",
  label: "הערות",
  type: "string",
  hint: "כל מה שנאמר ואין לו שדה — תזמון, נסיבות, העדפות אישיות",
  maxLength: 2000,
};

// --- ביקוש הקונה ---

const BUYER_REQUIREMENT_FIELDS: readonly AgentFieldSpec[] = [
  F_CITIES,
  F_NEIGHBORHOODS,
  F_DEAL_TYPE,
  F_PROPERTY_TYPES,
  {
    key: "budgetMinShekels",
    label: "תקציב מינימלי",
    type: "integer",
    hint: 'בשקלים ("מיליון וחצי" ⇒ 1500000)',
    min: 1,
    max: 1_000_000_000,
  },
  {
    key: "budgetMaxShekels",
    label: "תקציב מקסימלי",
    type: "integer",
    hint: 'בשקלים ("עד 2.3 מיליון" ⇒ 2300000). בהשכרה — שכר הדירה החודשי',
    min: 1,
    max: 1_000_000_000,
  },
  F_ROOMS_MIN,
  F_ROOMS_MAX,
  { key: "areaSqmMin", label: 'שטח מינימלי (מ"ר)', type: "integer", min: 10, max: 2000 },
  F_MUST_FEATURES,
  F_NICE_FEATURES,
  /*
   * מפתח נפרד מ-`entryType` של הנכס, ולא אותו שם.
   *
   * לקונה יש שלושה מצבים (מיידי / עד תאריך / גמיש) ולנכס ארבעה
   * (כולל "החל מתאריך"), ובסכימה המאוחדת מפתח אחד יכול לשאת רשימת
   * ערכים אחת בלבד. שם משותף היה נותן לאחד מהם את הערכים של השני.
   */
  {
    key: "entryNeed",
    label: "מתי צריך להיכנס",
    type: "enum",
    values: ["immediate", "by_date", "flexible"],
    valueLabels: {
      immediate: "מיידי",
      by_date: "לא יאוחר מתאריך",
      flexible: "גמיש",
    },
  },
];

const BUYER_PROFILE_FIELDS: readonly AgentFieldSpec[] = [
  F_MATURITY,
  F_FINANCING,
  F_AGENT_NOTES,
];

// --- שדות הנכס ---

const PROPERTY_FIELDS: readonly AgentFieldSpec[] = [
  { key: "city", label: "עיר", type: "string", maxLength: 80 },
  { key: "neighborhood", label: "שכונה", type: "string", maxLength: 80 },
  { key: "street", label: "רחוב", type: "string", maxLength: 120 },
  { key: "houseNumber", label: "מספר בית", type: "string", maxLength: 10 },
  {
    key: "propertyType",
    label: "סוג נכס",
    type: "enum",
    values: Object.keys(PROPERTY_TYPE_LABELS),
    valueLabels: PROPERTY_TYPE_LABELS,
  },
  F_DEAL_TYPE,
  { key: "rooms", label: "חדרים", type: "number", min: 1, max: 20, multipleOf: 0.5 },
  { key: "areaSqm", label: 'שטח (מ"ר)', type: "integer", min: 10, max: 2000 },
  {
    key: "floor",
    label: "קומה",
    type: "integer",
    hint: "קרקע ⇒ 0, מרתף ⇒ ‎-1",
    min: -2,
    max: 60,
  },
  { key: "totalFloors", label: "מתוך קומות", type: "integer", min: 1, max: 60 },
  { key: "hasElevator", label: "מעלית", type: "boolean" },
  { key: "hasParking", label: "חניה", type: "boolean" },
  { key: "hasBalcony", label: "מרפסת", type: "boolean" },
  { key: "hasSafeRoom", label: 'ממ"ד', type: "boolean" },
  { key: "hasStorage", label: "מחסן", type: "boolean" },
  {
    key: "condition",
    label: "מצב",
    type: "enum",
    values: ["new", "renovated", "good", "needs_renovation"],
    valueLabels: {
      new: "חדש מקבלן",
      renovated: "משופץ",
      good: "במצב טוב",
      needs_renovation: "דורש שיפוץ",
    },
  },
  {
    key: "priceShekels",
    label: "מחיר",
    type: "integer",
    hint: 'בשקלים. בהשכרה — המחיר החודשי ("4,500 בחודש" ⇒ 4500)',
    min: 1,
    max: 1_000_000_000,
  },
  { key: "priceFlexible", label: "מחיר גמיש", type: "boolean" },
  {
    key: "entryType",
    label: "מועד כניסה",
    type: "enum",
    values: ["immediate", "on_date", "from_date", "flexible"],
    valueLabels: {
      immediate: "מיידי",
      on_date: "בתאריך נקוב",
      from_date: "החל מתאריך",
      flexible: "גמיש / בתיאום",
    },
  },
  {
    key: "entryNote",
    label: "הערת כניסה",
    type: "string",
    hint: 'הניואנס שאין לו שדה — "אחרי פינוי השוכר", "בכפוף למשכנתה"',
    maxLength: 160,
  },
  { key: "exclusive", label: "בבלעדיות", type: "boolean" },
  {
    key: "marketingDescription",
    label: "תיאור שיווקי",
    type: "string",
    hint: "מה שנאמר על הנכס כטקסט חופשי — נוף, שכנים, יתרונות",
    maxLength: 2000,
  },
];

/** תאריכים וקואורדינטות — נפתרים בשרת, לא על ידי המודל. */
const PROPERTY_RESOLVED = [
  { key: "entryDate", label: "תאריך כניסה" },
  { key: "latitude", label: "קו רוחב" },
  { key: "longitude", label: "קו אורך" },
] as const;

// ---------------------------------------------------------------------------
// הקטלוג
// ---------------------------------------------------------------------------

export const AGENT_ACTIONS: readonly AgentActionDef[] = [
  {
    id: "search",
    title: "חיפוש",
    when: "חיפוש אדם, נכס או כרטיס מסוים לפי שם או כתובת — לא שאלה עם קריטריונים.",
    examples: ["חפש את שרה לוי", "איפה הכרטיס של יוסי", "תראה לי את הדירה בהרב שך 12"],
    capability: "properties.view",
    risk: "read",
    fields: [{ key: "query", label: "מה לחפש", type: "string", maxLength: 200 }],
  },
  {
    id: "find_buyers",
    title: "אילו קונים מתאימים",
    when: 'שאלה על מאגר הקונים לפי קריטריונים. "קונים" ברבים עם תנאים ⇒ תמיד כאן.',
    examples: [
      "מי מחפש 4 חדרים בגבעתיים?",
      "תחפש קונים עד שני מיליון",
      "יש לי קונים לרמת גן?",
      "מי מוכן לשלם 3 מיליון על פנטהאוז",
    ],
    capability: "buyers.view_own",
    risk: "read",
    fields: [
      F_CITIES,
      F_PROPERTY_TYPES,
      BUYER_REQUIREMENT_FIELDS[4]!, // budgetMinShekels
      BUYER_REQUIREMENT_FIELDS[5]!, // budgetMaxShekels
      F_ROOMS_MIN,
      F_ROOMS_MAX,
      F_DEAL_TYPE,
    ],
  },
  {
    id: "find_properties",
    title: "אילו נכסים מתאימים",
    when: "שאלה על מאגר הנכסים לפי קריטריונים — מה יש במלאי שעונה על תנאים.",
    examples: [
      "מה יש לי ברמת גן עד שני מיליון",
      "תראה נכסים 4 חדרים עם מעלית",
      "אילו דירות יש בבני ברק להשכרה",
    ],
    capability: "properties.view",
    risk: "read",
    fields: [
      F_CITIES,
      F_PROPERTY_TYPES,
      F_DEAL_TYPE,
      { key: "priceMinShekels", label: "מחיר מ־", type: "integer", min: 1, max: 1_000_000_000 },
      { key: "priceMaxShekels", label: "מחיר עד", type: "integer", min: 1, max: 1_000_000_000 },
      F_ROOMS_MIN,
      F_ROOMS_MAX,
      F_MUST_FEATURES,
    ],
  },
  {
    id: "show_matches",
    title: "התאמות",
    when: "בקשה לראות או לרענן התאמות — לכרטיס מסוים או למשרד כולו.",
    examples: [
      "תראה לי התאמות לדירה ברמת גן",
      "רענן התאמות",
      "למי מתאים הנכס של משפחת כהן",
      "יש התאמות חדשות?",
    ],
    capability: "matches.view",
    risk: "read",
    fields: [
      F_PROPERTY_PHRASE,
      F_BUYER_PHRASE,
      {
        key: "refresh",
        label: "לרענן קודם",
        type: "boolean",
        hint: 'רק אם נאמר במפורש "רענן" / "תחשב מחדש"',
      },
    ],
  },
  {
    id: "show_schedule",
    title: "מה ביומן",
    when: "שאלה על הפגישות והלו״ז — של היום, של מחר או של יום שנאמר.",
    examples: ["מה יש לי ביומן", "מה הפגישות שלי מחר", "מה יש לי היום"],
    capability: "calendar.manage",
    risk: "read",
    fields: [],
    resolved: [{ key: "day", label: "יום" }],
  },
  {
    id: "show_tasks",
    title: "המשימות שלי",
    when: "שאלה על משימות ותזכורות פתוחות.",
    examples: ["מה המשימות שלי", "אילו משימות פתוחות יש לי", "מה נשאר לי לעשות"],
    capability: "calendar.manage",
    risk: "read",
    fields: [],
  },
  {
    id: "show_calls",
    title: "שיחות אחרונות",
    when: "שאלה על שיחות טלפון שהתקבלו או בוצעו.",
    examples: ["מי התקשר אליי היום", "תראה לי את השיחות האחרונות", "אילו שיחות פספסתי"],
    /*
     * שיחה תלויה בלקוח, ולקוח יכול להיות ליד או קונה — בדיוק כמו
     * ב-`show_card` וב-`play_recording`, ובדיוק כמו נתיבי ה-REST של
     * השיחות. מי שמודול הלידים חסום אצלו עדיין רשאי לשמוע על
     * השיחות של הקונים שלו (ביקורת Codex).
     */
    capability: "leads.view_own",
    capabilityAlt: "buyers.view_own",
    risk: "read",
    fields: [],
  },
  {
    id: "show_card",
    title: "כרטיס הלקוח המלא",
    when: "בקשה לראות את כל מה שיש על לקוח מסוים — פרטי קשר, מה הוא מחפש, הערות והשיחות איתו.",
    examples: [
      "תראה לי את הכרטיס של משה כהן",
      "מה יש לנו על דנה לוי",
      "כל הפרטים של שרה",
    ],
    capability: "buyers.view_own",
    capabilityAlt: "leads.view_own",
    risk: "read",
    fields: [F_CARD_PHRASE],
  },
  {
    id: "play_recording",
    title: "השמעת הקלטת שיחה",
    when: "בקשה לשמוע הקלטה של שיחה עם לקוח מסוים.",
    examples: [
      "תשמיע לי את ההקלטה של השיחה עם משה",
      "אני רוצה לשמוע את השיחה האחרונה עם דנה",
      "שלח לי את ההקלטה של שרה",
    ],
    capability: "leads.view_own",
    capabilityAlt: "buyers.view_own",
    risk: "read",
    fields: [F_CARD_PHRASE],
  },
  {
    id: "show_deals",
    title: "עסקאות שת״פ",
    when: "שאלה על עסקאות משותפות עם משרדים אחרים — חדרי העסקה ברשת.",
    examples: ["מה קורה עם העסקאות המשותפות", "תראה לי את חדרי העסקה שלי", "אילו שת״פים פתוחים יש לי"],
    capability: "collaboration.offer",
    risk: "read",
    fields: [],
  },
  {
    id: "office_report",
    title: "דוח המשרד",
    when: "בקשה לנתוני המשרד — לידים, עסקאות, ביצועים בתקופה.",
    examples: ["תן לי את דוח המשרד", "כמה לידים נכנסו החודש", "סיכום החודש"],
    capability: "analytics.view",
    risk: "read",
    fields: [
      {
        key: "windowDays",
        label: "תקופה",
        type: "enum",
        hint: '"החודש" ⇒ 30, "הרבעון" ⇒ 90, "השנה" ⇒ 365',
        values: ["30", "90", "365"],
        valueLabels: { "30": "30 יום", "90": "רבעון", "365": "שנה" },
      },
    ],
  },
  {
    id: "create_lead",
    title: "ליד חדש",
    when: "תיעוד פנייה או שיחה שהתקיימה, בלי מספיק פרטים לכרטיס קונה מלא.",
    examples: [
      "דיברתי עם יוסי שרוצה למכור את הדירה שלו",
      "התקשרה שרה 052-1234567, מתעניינת בדירות בחולון",
      "ליד חדש מהאתר — דני, רוצה לשמוע על נכסים",
    ],
    capability: "leads.edit",
    risk: "create",
    fields: [
      F_NAME,
      F_PHONE,
      F_EMAIL,
      {
        key: "intent",
        label: "מה הוא רוצה",
        type: "enum",
        values: ["buy", "sell", "rent_in", "rent_out", "info"],
        valueLabels: {
          buy: "לקנות",
          sell: "למכור",
          rent_in: "לשכור",
          rent_out: "להשכיר",
          info: "מידע בלבד",
        },
      },
      {
        key: "summary",
        label: "סיכום",
        type: "string",
        hint: "מה נאמר בשיחה, בניסוח ענייני",
        maxLength: 2000,
      },
    ],
  },
  {
    id: "create_buyer",
    title: "כרטיס קונה חדש",
    when: "לקוח שמחפש נכס, עם פרטים מספיקים לכרטיס — שם ולפחות אזור או תקציב.",
    examples: [
      "תוסיף קונה משה כהן 050-1234567, מחפש 4 חדרים בבני ברק עד 2.3 מיליון, חייב מעלית וממד",
      "לקוח חדש — משפחת לוי, רוצים דירת גן בגבעת שמואל, יש להם אישור עקרוני",
      "רשום שוכר לרמת גן, 3 חדרים, עד 6000 בחודש",
    ],
    capability: "buyers.edit",
    risk: "create",
    fields: [
      F_NAME,
      F_PHONE,
      F_EMAIL,
      ...BUYER_REQUIREMENT_FIELDS,
      ...BUYER_PROFILE_FIELDS,
    ],
    resolved: [{ key: "entryBy", label: "כניסה עד תאריך" }],
  },
  {
    id: "create_property",
    title: "נכס חדש",
    when: "נכס שנכנס למלאי — דירה, בית או מגרש שהמשרד מקבל לשיווק.",
    examples: [
      "תוסיף דירת 4 חדרים ברמת גן, קומה 3 מתוך 6, עם מעלית וחניה, 2.8 מיליון",
      "קיבלתי בלעדיות על פנטהאוז בנתניה, 5 חדרים, 140 מטר, כניסה מיידית",
      "נכס להשכרה בבני ברק, 3 חדרים, 5500 בחודש, משופץ",
    ],
    capability: "properties.create",
    risk: "create",
    fields: [
      ...PROPERTY_FIELDS,
      { key: "ownerName", label: "בעל הנכס", type: "string", maxLength: 120 },
      {
        key: "ownerPhone",
        label: "טלפון בעל הנכס",
        type: "string",
        hint: "כפי שנאמר",
        maxLength: 30,
      },
    ],
    resolved: PROPERTY_RESOLVED,
  },
  {
    id: "create_task",
    title: "תזכורת / משימה",
    when: '‎"תזכיר לי X" הוא תמיד כאן — גם כש-X נשמע כמו פעולה אחרת. "תזכיר לי לקבוע פגישה" הוא תזכורת, לא קביעת פגישה.',
    examples: [
      "תזכיר לי מחר להתקשר לדוד",
      "תוסיף משימה לבדוק את החוזה של משפחת כהן",
      "תזכיר לי ביום ראשון לשלוח את ההצעה",
    ],
    capability: "calendar.manage",
    risk: "create",
    fields: [
      {
        key: "title",
        label: "מה להזכיר",
        type: "string",
        hint: 'בלי המילים "תזכיר לי", ובלי המועד',
        maxLength: 200,
      },
      {
        key: "relatedPhrase",
        label: "קשור ל",
        type: "string",
        hint: "שם לקוח או נכס שהוזכר, אם הוזכר",
        maxLength: 120,
      },
    ],
    resolved: [{ key: "dueAt", label: "מועד" }],
  },
  {
    id: "complete_task",
    title: "סגירת משימה",
    when: "סימון משימה קיימת כבוצעה.",
    examples: ["סגור את המשימה להתקשר לדוד", "סיימתי את המשימה של החוזה", "תסמן שהתקשרתי למשפחת כהן"],
    capability: "calendar.manage",
    risk: "update",
    fields: [F_TASK_PHRASE],
  },
  {
    id: "add_note",
    title: "הוספת הערה",
    when: "הוספת הערה חופשית לכרטיס קיים — קונה או ליד.",
    examples: [
      "תוסיף הערה למשה כהן שהוא נוסע לחו״ל עד סוף החודש",
      "רשום הערה על הליד של שרה — ביקשה שנחזור אליה בערב",
      "תכתוב הערה אצל משפחת לוי שהם גמישים במחיר",
    ],
    capability: "buyers.edit",
    risk: "update",
    fields: [
      F_CARD_PHRASE,
      {
        key: "note",
        label: "ההערה",
        type: "string",
        hint: "תוכן ההערה, בלי מילות הפקודה",
        maxLength: 2000,
      },
    ],
  },
  {
    id: "update_lead_status",
    title: "עדכון סטטוס ליד",
    when: "שינוי הסטטוס של ליד קיים — בטיפול, ממתין ללקוח או סגור.",
    examples: [
      "תעדכן את הליד של דני לבטיפול",
      "תסגור את הליד של משפחת לוי",
      "הליד של שרה ממתין ללקוח",
    ],
    capability: "leads.edit",
    risk: "update",
    fields: [
      F_LEAD_PHRASE,
      {
        key: "leadStatus",
        label: "סטטוס",
        type: "enum",
        values: ["new", "in_progress", "waiting_customer", "closed"],
        valueLabels: {
          new: "חדש",
          in_progress: "בטיפול",
          waiting_customer: "ממתין ללקוח",
          closed: "סגור",
        },
      },
    ],
  },
  {
    id: "schedule_appointment",
    title: "פגישה / סיור",
    when: "קביעת מפגש עכשיו — פגישה, סיור בנכס או שיחה מתוזמנת.",
    examples: [
      "קבע סיור מחר בעשר בדירה ברמת גן",
      "פגישה עם משפחת לוי ביום שלישי בארבע",
      "אני מראה לשמוליק את הדירה מחר",
    ],
    capability: "calendar.manage",
    risk: "create",
    fields: [
      {
        key: "kind",
        label: "סוג",
        type: "enum",
        values: ["viewing", "meeting", "call"],
        valueLabels: { viewing: "סיור בנכס", meeting: "פגישה", call: "שיחה" },
      },
      F_BUYER_PHRASE,
      F_PROPERTY_PHRASE,
      { key: "notes", label: "הערות", type: "string", maxLength: 1000 },
    ],
    resolved: [{ key: "startsAt", label: "מועד" }],
  },
  {
    id: "update_buyer",
    title: "עדכון כרטיס קונה",
    when: "שינוי פרט בכרטיס קונה קיים — תקציב שעלה, אזור שהתווסף, בשלות שהשתנתה.",
    examples: [
      "משה כהן העלה את התקציב לשלושה מיליון",
      "תעדכן שמשפחת לוי מחפשים גם בגבעתיים",
      "הקונה של רמת גן הפך לחם מאוד",
    ],
    capability: "buyers.edit",
    risk: "update",
    fields: [F_BUYER_PHRASE, ...BUYER_REQUIREMENT_FIELDS, ...BUYER_PROFILE_FIELDS],
  },
  {
    id: "update_property",
    title: "עדכון נכס",
    when: "שינוי פרט בנכס קיים — מחיר שירד, סטטוס, מועד כניסה.",
    examples: [
      "הדירה ברמת גן ירדה ל-2.6 מיליון",
      "תעדכן שהפנטהאוז בנתניה נמכר",
      "הנכס בהרב שך עכשיו בבלעדיות",
    ],
    capability: "properties.edit",
    risk: "update",
    fields: [
      F_PROPERTY_PHRASE,
      ...PROPERTY_FIELDS,
      {
        key: "status",
        label: "סטטוס",
        type: "enum",
        values: ["draft", "active", "on_hold", "sold", "rented", "archived"],
        valueLabels: {
          draft: "טיוטה",
          active: "פעיל",
          on_hold: "בהמתנה",
          sold: "נמכר",
          rented: "הושכר",
          archived: "בארכיון",
        },
      },
    ],
    resolved: PROPERTY_RESOLVED,
  },
  {
    id: "share_property",
    title: "שיתוף נכס ברשת",
    when: "פרסום נכס לרשת השיתופים בין המשרדים. הפעולה פותחת את מסך השיתוף — הפרסום עצמו נעשה שם.",
    examples: [
      "שתף את הדירה ברמת גן ברשת",
      "תפרסם את הפנטהאוז לרשת השיתופים",
      "תעלה את הנכס בהרב שך לרשת",
    ],
    capability: "collaboration.share",
    risk: "read",
    fields: [F_PROPERTY_PHRASE],
  },
  {
    id: "share_buyer",
    title: "שיתוף ביקוש ברשת",
    when: "פרסום ביקוש של קונה לרשת השיתופים. הפעולה פותחת את מסך השיתוף — הפרסום עצמו נעשה שם.",
    examples: [
      "שתף את הקונה של רמת גן ברשת",
      "תעלה את הביקוש של משפחת כהן לרשת",
      "תפרסם את הדרישה של משה לרשת השיתופים",
    ],
    capability: "collaboration.share",
    risk: "read",
    fields: [F_BUYER_PHRASE],
  },
  {
    id: "send_offer",
    title: "שליחת הצעה ללקוח",
    when: "שליחת נכס אל לקוח. הפעולה יוצאת מהמשרד ולכן תמיד דורשת בחירה מפורשת של הנמען.",
    examples: [
      "שלח את הדירה בהרב שך למשה כהן",
      "תשלח לשרה את הפנטהאוז בנתניה",
      "תציע את הנכס ברמת גן למשפחת לוי",
    ],
    capability: "offers.send",
    risk: "outbound",
    fields: [
      F_PROPERTY_PHRASE,
      F_BUYER_PHRASE,
      {
        key: "message",
        label: "הודעה נלווית",
        type: "string",
        hint: "רק אם נאמרה במפורש",
        maxLength: 1000,
      },
    ],
  },
];

const BY_ID = new Map(AGENT_ACTIONS.map((action) => [action.id, action]));

export function agentAction(id: string): AgentActionDef | undefined {
  return BY_ID.get(id as AgentActionId);
}

/** תווית עברית לשדה — למסך ולהודעות שהשרת כותב. */
export function agentFieldLabel(actionId: string, key: string): string {
  const action = agentAction(actionId);
  const field = action?.fields.find((f) => f.key === key);
  if (field) return field.label;
  return action?.resolved?.find((r) => r.key === key)?.label ?? key;
}

/**
 * פעולה שאינה משנה דבר — רצה מיד ומציגה תשובה, בלי כרטיס אישור.
 *
 * ההבחנה אינה נוחות בלבד: אישור על שאילתה מאמן את המתווך ללחוץ
 * „אשר” בלי לקרוא, וכשיגיע כרטיס שכן משנה משהו הוא ילחץ עליו באותה
 * מהירות. אישור שמופיע רק כשיש מה לאשר נשאר אישור.
 */
export function isReadOnlyAction(id: string): boolean {
  return agentAction(id)?.risk === "read";
}

/**
 * שער הכניסה לפעולה — היכולת שהיא מצהירה עליה, או החלופה שלה.
 *
 * פונקציה אחת ולא שלוש בדיקות מפוזרות: הרשימה שהמודל רואה, השער
 * לפני הביצוע והרשימה שנשלחת לפרומפט חייבים להסכים ביניהם. שתי
 * מהן שנשארו על `has(action.capability)` בזמן שהשלישית התעדכנה היו
 * מייצרות בדיוק את מה שהמשתמש חווה כשרירותי: פעולה שמוצעת ונדחית.
 */
export function mayUseAction(
  action: AgentActionDef,
  capabilities: { has(capability: Capability): boolean },
): boolean {
  if (capabilities.has(action.capability)) return true;
  return action.capabilityAlt !== undefined && capabilities.has(action.capabilityAlt);
}
