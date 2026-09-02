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
 * **2. אין פעולות הרסניות.** אין `delete_*` ואין ביטול שמוחק. הצעה
 * שנוצרה מתמלול שגוי או מטקסט זדוני יכולה במקרה הגרוע לבקש רשומה
 * מיותרת — שאפשר למחוק — ולא למחוק רשומה שאי אפשר להחזיר.
 * ביטול **פגישה** עומד בכלל: הוא עדכון סטטוס הפיך — הפגישה נשארת
 * ביומן כמבוטלת, ודחייה מחזירה אותה — לא מחיקת שורה.
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

import {
  MARKETING_ACTION_KINDS,
  MARKETING_ACTION_LABEL,
} from "../logic/exclusivity.js";
import { SUPPORT_KINDS, SUPPORT_KIND_LABEL } from "../logic/support.js";
import { DISMISS_REASONS, DISMISS_REASON_LABEL } from "../logic/match-feedback.js";
import type { Capability } from "../rbac.js";
import type { PlanFeature } from "../logic/plans.js";
import type { AgentFieldSpec } from "./field-spec.js";
import type { PropertyType } from "../schemas/property.js";

export const AGENT_ACTION_IDS = [
  "search",
  "find_buyers",
  "find_properties",
  "show_matches",
  "show_schedule",
  "show_tasks",
  "show_callbacks",
  "show_leads",
  "show_calls",
  "log_call",
  "show_card",
  "play_recording",
  "show_deals",
  "show_credits",
  "show_payout_balance",
  "show_referral_board",
  "show_reach",
  "open_deal_room",
  "office_report",
  "agent_report",
  "show_recommendations",
  "create_lead",
  "create_buyer",
  "create_property",
  "create_task",
  "complete_task",
  "update_task",
  "create_recurring_task",
  "add_note",
  "update_lead_status",
  "convert_lead",
  "create_property_from_lead",
  "schedule_appointment",
  "reschedule_appointment",
  "update_appointment",
  "update_buyer",
  "add_contact_detail",
  "update_property",
  "share_property",
  "create_landing_page",
  "share_buyer",
  "send_offer",
  "send_offers_bulk",
  "send_agreement",
  "show_exclusivity",
  "start_exclusivity",
  "log_marketing_action",
  "show_agreements",
  "show_retained_documents",
  "show_offers",
  "show_demands",
  "show_network_listings",
  "show_network_inbox",
  "offer_to_demand",
  "express_interest",
  "post_deal_message",
  "move_deal_stage",
  "show_notifications",
  "mark_notifications_read",
  "show_emails",
  "dismiss_match",
  "assign_task",
  "send_email",
  "send_message",
  "call_contact",
  "send_intake_form",
  "message_owner",
  "send_owner_update",
  "open_support_ticket",
  "show_support_tickets",
  "set_preference",
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
   * יכולות נוספות שכל אחת מהן **מספיקה** לפתיחת הפעולה.
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
   *
   * ‎**רשימה ולא ערך יחיד**, כי „כרטיס” הוא כבר שלושה סוגים: קונה,
   * ליד ונכס. כשהיה כאן ערך אחד, `show_card` הצהיר על קונים ולידים
   * בלבד — ומשתמש שהרשאותיו צומצמו לנכסים נדחה בשער **לפני** שהענף
   * שנכתב במיוחד בשבילו נבדק (ביקורת Codex).
   */
  capabilityAlts?: readonly Capability[];
  /**
   * ‎**פיצ'ר המסלול שהפעולה דורשת** — הזכאות המסחרית, לא ההרשאה.
   *
   * הבקרים אוכפים אותה ב-`@RequireFeature`, והסוכן אינו עובר בהם:
   * הוא קורא לשירותים ישירות. כל פעולה שנוגעת ביכולת מתומחרת חייבת
   * להצהיר עליה כאן, והאכיפה נעשית **פעם אחת** בביצוע — לצד בדיקת
   * היכולת — ולא בכל מתודה בנפרד.
   *
   * זה לא היה תיאורטי: „מה כדאי לי היום” ו„דף נחיתה” נפתחו למשרד
   * שהמסלול שלו אינו כולל אותם, בזמן שהמסך המקביל חסום (ביקורת
   * Codex); ו-„דוח המשרד” עשה זאת מלכתחילה, לפני הסבב הזה.
   */
  feature?: PlanFeature;
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
  accessible_apartment: "דירת נכה",
  plot: "מגרש",
  commercial: "מסחרי (לא צוין)",
  commercial_shop: "חנות",
  commercial_office: "משרד",
  commercial_warehouse: "מחסן",
  commercial_industrial: "תעשייה",
  commercial_basement: "מרתף",
  commercial_building: "בניין",
  commercial_logistics: 'מרלו"ג',
  commercial_parking: "חניה",
  commercial_gas_station: "תחנת דלק",
  other: "אחר",
  /*
   * ‎`satisfies` ולא רק `as const`: הקטלוג הזה הוא מה שהסוכן הקולי
   * מקבל כרשימת הערכים החוקיים, וסוג שחסר בו פשוט אינו קיים בשבילו
   * — המתווך אומר „דירת נכה” והסוכן עונה שאינו מכיר סוג כזה. השגיאה
   * הזו שייכת להידור ולא לשיחה עם לקוח.
   */
} as const satisfies Record<PropertyType, string>;

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

/**
 * חלוקת העמלה מול המשרד השני, באחוזים.
 *
 * מוצהר זהה בשתי הפעולות שמסכמות תנאים (הצעה לביקוש, התעניינות
 * במודעה) — הקטלוג אוכף שמפתח משותף מוצהר אותו דבר בכולן.
 */
const F_COMMISSION_SPLIT: AgentFieldSpec = {
  key: "commissionSplit",
  label: "אחוז העמלה שלי",
  type: "integer",
  hint: 'ברירת המחדל 50 ("חצי חצי"). מותר 33 עד 67',
  min: 33,
  max: 67,
};

/** ביקוש שמשרד אחר פרסם ברשת — כפי שהוא מתואר בפיד. */
const F_DEMAND_PHRASE: AgentFieldSpec = {
  key: "demandPhrase",
  label: "איזה ביקוש",
  type: "string",
  hint: "מה שנאמר על הביקוש — עיר, חדרים או שם המשרד שפרסם",
  maxLength: 200,
};

/** מודעת נכס שמשרד אחר פרסם ברשת. */
const F_LISTING_PHRASE: AgentFieldSpec = {
  key: "listingPhrase",
  label: "איזה נכס ברשת",
  type: "string",
  hint: "מה שנאמר על המודעה — עיר, כותרת או שם המשרד שפרסם",
  maxLength: 200,
};

/** חדר עסקה משותף קיים. */
const F_DEAL_PHRASE: AgentFieldSpec = {
  key: "dealPhrase",
  label: "איזו עסקה",
  type: "string",
  hint: "מה שנאמר על העסקה — הנכס או שם המשרד השני",
  maxLength: 200,
};

/** פנייה נכנסת מהרשת — נכס שהוצע לביקוש, או התעניינות בנכס שפורסם. */
const F_APPROACH_PHRASE: AgentFieldSpec = {
  key: "approachPhrase",
  label: "איזו פנייה",
  type: "string",
  hint: "מה שנאמר על הפנייה — שם הנכס, העיר או שם המשרד השני",
  maxLength: 200,
};

/** תוכן מייל חופשי — מה שהמתווך הכתיב, מנוסח כפי שנאמר. */
const F_EMAIL_BODY: AgentFieldSpec = {
  key: "emailBody",
  label: "תוכן ההודעה",
  type: "string",
  hint: "מה לכתוב ללקוח — משפטים מלאים, כפי שהמתווך ניסח",
  maxLength: 5000,
};

const F_PROPERTY_PHRASE: AgentFieldSpec = {
  key: "propertyPhrase",
  label: "איזה נכס",
  type: "string",
  hint: "התיאור שנאמר — כתובת, עיר, סוג או שם הבעלים",
  maxLength: 200,
};

/** כותרת משימה — משותפת לתזכורת חד-פעמית ולמשימה הקבועה. */
const F_TASK_TITLE: AgentFieldSpec = {
  key: "title",
  label: "מה להזכיר",
  type: "string",
  hint: 'בלי המילים "תזכיר לי", ובלי המועד',
  maxLength: 200,
};

const F_TASK_PHRASE: AgentFieldSpec = {
  key: "taskPhrase",
  label: "איזו משימה",
  type: "string",
  hint: "מילים מתוך כותרת המשימה, כפי שנאמרו",
  maxLength: 200,
};

/**
 * ‎**סוכן במשרד — שדה אחד לשתי פעולות, ובכוונה.**
 *
 * „מה המשימות של דנה” ו„תעביר את זה לדנה” נוקבים באותו דבר בדיוק,
 * והתווית נייטרלית משום כך: הצהרה נפרדת בכל פעולה הייתה נותנת למודל
 * שני תיאורים לאותו מפתח, והוא היה ממלא את אחד מהם לפי התיאור של
 * האחר — בשקט. הבדיקה המבנית של הקטלוג תפסה בדיוק את זה.
 */
const F_ASSIGNEE_PHRASE: AgentFieldSpec = {
  key: "assigneePhrase",
  label: "הסוכן",
  type: "string",
  hint: "שם הסוכן במשרד, כפי שנאמר",
  maxLength: 120,
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

/**
 * סטטוס ליד — משותף לעדכון (`update_lead_status`) ולסינון
 * (`show_leads`). `converted` אינו כאן בכוונה: המרה היא מסלול נפרד
 * עם יצירת קונה, לא ערך שמציבים — וסכימת השדות מאוחדת, כלומר ערך
 * שנוסף לסינון היה נפתח גם לעדכון.
 */
const F_LEAD_STATUS: AgentFieldSpec = {
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
};

/**
 * מה קרה לפגישה. `cancelled` הוא עדכון סטטוס הפיך — הפגישה נשארת
 * ביומן כמבוטלת — ולכן אינו סותר את כלל „אין ביטול שמוחק”.
 */
const F_APPOINTMENT_STATUS: AgentFieldSpec = {
  key: "appointmentStatus",
  label: "מה קרה",
  type: "enum",
  values: ["cancelled", "completed", "no_show"],
  valueLabels: { cancelled: "בוטלה", completed: "התקיימה", no_show: "לא הגיע" },
};

/** תוצאת סיור — אותם ארבעה ערכים ותוויות כמו מסך הפולו-אפ. */
const F_VIEWING_OUTCOME: AgentFieldSpec = {
  key: "viewingOutcome",
  label: "תוצאת הסיור",
  type: "enum",
  hint: "רק לסיור בנכס, ורק כשנאמר איך היה",
  values: ["liked", "not_fit", "negotiating", "needs_other"],
  valueLabels: {
    liked: "אהב את הנכס",
    not_fit: "לא מתאים",
    negotiating: 'עוברים למו"מ',
    needs_other: "צריך נכס אחר",
  },
};

const F_MESSAGE_BODY: AgentFieldSpec = {
  key: "messageBody",
  label: "נוסח ההודעה",
  type: "string",
  hint: "מה לכתוב ללקוח, בדיוק כפי שנאמר",
  maxLength: 1500,
};

const F_SUPPORT_KIND: AgentFieldSpec = {
  key: "supportKind",
  label: "סוג הפנייה",
  type: "enum",
  values: SUPPORT_KINDS,
  valueLabels: SUPPORT_KIND_LABEL,
};

const F_SUPPORT_MESSAGE: AgentFieldSpec = {
  key: "supportMessage",
  label: "מה קרה",
  type: "string",
  hint: "תיאור הבעיה או הבקשה, כפי שנאמר",
  maxLength: 2000,
};

const F_VOICE_REPLIES: AgentFieldSpec = {
  key: "voiceReplies",
  label: "תשובות בקול",
  type: "boolean",
  hint: "רק כשנאמר „תמיד תענה לי בקול” (true) או „תפסיק לענות בקול” (false). לבקשה חד-פעמית אומרים „תקריא לי” בהודעה עצמה — זו אינה העדפה",
};

const F_PROPERTIES_ORDER: AgentFieldSpec = {
  key: "propertiesOrder",
  label: "סדר הנכסים",
  type: "enum",
  hint: "רק כשנאמר „תמיד” — העדפת קבע, לא בקשה חד-פעמית",
  values: ["newest", "price_asc", "price_desc"],
  valueLabels: { newest: "החדשים קודם", price_asc: "מהזול ליקר", price_desc: "מהיקר לזול" },
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

/**
 * ‎**סטטוס המשרד — טקסט, ולא `enum`.**
 *
 * רשימת הסטטוסים שונה לכל משרד וחיה ב-`tenants.settings`, בעוד
 * הקטלוג כאן הוא קבוע שנבנה בזמן קומפילציה. ההכרעה נעשית אחרי
 * התשובה, ב-`matchOfficeStatus`, מול הרשימה האמיתית — אותו דפוס
 * שהקובץ הזה כבר מגדיר לתאריך ולמיקום: מה שדורש ידע שאינו לשוני
 * אינו ממולא בידי המודל.
 *
 * ‎**מה שנאמר, ולא מה שהמודל חושב שהתכוונו.** הרמז מבקש במפורש את
 * המילים עצמן: פרפרזה („הוא מתקדם”) הייתה מרחיקה את הטקסט מהרשימה
 * ומפילה התאמה שהייתה נמצאת.
 */
const F_OFFICE_STATUS: AgentFieldSpec = {
  key: "officeStatus",
  label: "סטטוס המשרד",
  type: "string",
  hint: "שם השלב במשרד כפי שנאמר, במילים עצמן — „בסבב סיורים”, „ממתין למשכנתא”. רק כשנאמר שם של שלב; לדרגת דחיפות יש „בשלות”",
  maxLength: 40,
};

const BUYER_PROFILE_FIELDS: readonly AgentFieldSpec[] = [
  F_MATURITY,
  F_OFFICE_STATUS,
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
    when: "שאלה על משימות ותזכורות פתוחות — שלי, או של סוכן מסוים כשנקוב בשמו.",
    examples: [
      "מה המשימות שלי",
      "אילו משימות פתוחות יש לי",
      "מה נשאר לי לעשות",
      "מה המשימות של דנה",
    ],
    capability: "calendar.manage",
    risk: "read",
    fields: [
      /*
       * ‎**„מה המשימות של דנה” — למי שרואה את לוח המשרד.**
       *
       * ‎`tasks.view_all` כבר הרחיב את הרשימה מעצמו (`scopeFilter`),
       * ולכן מנהל **ראה** את כל המשימות — אבל לא יכול היה לשאול על
       * סוכן אחד. `TasksService.list` מקבל `assignee` מאז ומתמיד;
       * מה שחסר היה מי שיפתור שם לסוכן.
       *
       * רשות: בלי שם זו הרשימה הרגילה, וזו השאלה השכיחה.
       */
      F_ASSIGNEE_PHRASE,
    ],
  },
  {
    /*
     * הפעולה שחסרה, ולכן המודל בחר במשימות.
     *
     * המתווך ביקש „מספרי טלפון שצריך לחזור אליהם” וקיבל רשימת
     * משימות פתוחות. המודל לא טעה — פשוט לא הייתה פעולה כזו
     * בקטלוג, והוא בחר את הקרובה ביותר. משימה מחזירה כותרת בלבד,
     * בלי מספר, וזה בדיוק מה שהתבקש (דיווח המשתמש).
     *
     * הדוגמאות כאן מכסות בכוונה את שלוש הדרכים שמתווך שואל את זה:
     * לפי המספר („תן לי מספרים”), לפי האדם („למי לחזור”), ולפי
     * האירוע („מי התקשר ולא עניתי”).
     */
    id: "show_callbacks",
    title: "למי לחזור",
    when: "שאלה מי ממתין לחזרה, או בקשה למספרי טלפון להתקשר אליהם. גם כשמנוסח כ„מה דחוף” בהקשר של לקוחות.",
    examples: [
      "תן לי מספרי טלפון שצריך לחזור אליהם",
      "למי אני צריך לחזור",
      "מי התקשר ולא חזרתי אליו",
      "מי מחכה לי",
      "רשימת חזרות להיום",
    ],
    capability: "leads.view_own",
    risk: "read",
    fields: [],
  },
  {
    /*
     * ‎**„אילו לידים יש לי” — הרשימה שחסרה בקטלוג.**
     *
     * ליד נוצר מהצ'אט (`create_lead`), הסטטוס מתעדכן ממנו
     * (`update_lead_status`) — אבל אי אפשר היה **לשאול** עליהם.
     * מודל שנשאל בחר את הקרובה ביותר: החזרות או המשימות — אותו
     * דפוס בדיוק שהוליד את `show_callbacks`.
     *
     * ברירת המחדל היא הלידים **הפתוחים**: „מה יש לי” שואל על מה
     * שדורש טיפול, לא על הארכיון. סטטוס מפורש מצמצם לערך שנאמר.
     */
    id: "show_leads",
    title: "הלידים שלי",
    when: "שאלה על רשימת הלידים — מי חדש, מי בטיפול, מה נכנס. כשמבקשים למי **לחזור** אחרי שיחה שלא נענתה — זו „למי לחזור”, לא זו.",
    examples: [
      "אילו לידים חדשים יש לי",
      "תראה לי את הלידים הפתוחים",
      "מה נכנס מהאתר",
      "כמה לידים ממתינים לטיפול",
    ],
    capability: "leads.view_own",
    risk: "read",
    fields: [F_LEAD_STATUS],
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
    capabilityAlts: ["buyers.view_own"],
    risk: "read",
    fields: [],
  },
  {
    /*
     * ‎**שיחה שהתקיימה — תיעוד, לא הערה.** „תוסיף הערה” שומר טקסט
     * חופשי; שיחה היא רשומה עם כיוון, משך ותוצאה, וממנה נבנים
     * „מי ממתין לחזרה” ודוח הפעילות לבעל הנכס. הערה במקומה הייתה
     * מאבדת את כל אלה.
     */
    id: "log_call",
    title: "תיעוד שיחה",
    when: "רישום שיחה שכבר התקיימה עם לקוח קיים — כמה זמן ומה יצא ממנה. לחיוג עצמו יש „חיוג ללקוח”.",
    examples: [
      "תרשום שדיברתי עם שרה עשר דקות על הדירה",
      "התקשרתי למשה כהן והוא לא ענה",
      "היתה שיחה עם משפחת לוי, חמש דקות, הם מתלבטים",
    ],
    capability: "leads.edit",
    risk: "create",
    fields: [
      F_BUYER_PHRASE,
      {
        key: "callDirection",
        label: "כיוון",
        type: "enum",
        hint: "„התקשרתי” ⇒ יוצאת, „התקשרו אליי” ⇒ נכנסת. ברירת המחדל יוצאת",
        values: ["outbound", "inbound"],
        valueLabels: { outbound: "יוצאת", inbound: "נכנסת" },
      },
      {
        key: "callOutcome",
        label: "תוצאה",
        type: "enum",
        hint: "„דיברנו” ⇒ נענתה; „לא ענה” ⇒ ללא מענה",
        values: ["answered", "no_answer"],
        valueLabels: { answered: "נענתה", no_answer: "ללא מענה" },
      },
      {
        key: "durationMinutes",
        label: "משך בדקות",
        type: "integer",
        hint: "„עשר דקות” ⇒ 10",
        min: 0,
        max: 600,
      },
      { key: "callSummary", label: "מה נאמר", type: "string", maxLength: 4000 },
    ],
    resolved: [{ key: "occurredAt", label: "מתי" }],
  },
  {
    id: "show_card",
    /*
     * ‎**הכותרת והתיאור אומרים „נכס” — כי הביצוע כבר יודע.**
     *
     * הענף לנכסים נוסף ל-`showCard` ול-`anyCard`, והקטלוג נשאר מדבר
     * על „לקוח מסוים” בלבד. הקטלוג הוא מה שנכנס לפרומפט, ולכן המודל
     * מעולם לא נאמר לו שהפעולה מקבלת נכס — „מה יש על הדירה ברמת גן”
     * נותב למקום אחר, והענף שנכתב בשבילו נשאר בלתי מגיע מכיוון שני
     * (מלבד שער היכולת שביקורת Codex הצביעה עליו).
     */
    title: "הכרטיס המלא",
    when: "בקשה לראות את כל מה שיש על רשומה מסוימת — לקוח (פרטי קשר, מה הוא מחפש, הערות ושיחות) או נכס (פרטים, בעלים, בלעדיות ומה חסר).",
    examples: [
      "תראה לי את הכרטיס של משה כהן",
      "מה יש לנו על דנה לוי",
      "מה יש על הדירה ברמת גן",
      "כל הפרטים של הפנטהאוז בנתניה",
    ],
    capability: "buyers.view_own",
    /*
     * ‎**וגם נכסים**, כי הכרטיס כולל אותם מאז שנוסף הענף שלהם.
     * בלי זה מי שהרשאותיו צומצמו ל-`properties.view` נדחה בשער לפני
     * שהענף נבדק בכלל.
     */
    capabilityAlts: ["leads.view_own", "properties.view"],
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
    capabilityAlts: ["buyers.view_own"],
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
    /*
     * ‎**הצד היוצר של הרשת** — עד כה הפיד היה קריאה בלבד: אפשר היה
     * לשאול „מה מבוקש” ולא לענות על זה. `outbound` לא רק כי היא
     * יוצאת למשרד אחר, אלא כי הצעה לביקוש ממקור חיצוני עולה
     * קרדיטים — היא סוגרת תנאים מסחריים.
     */
    id: "offer_to_demand",
    title: "הצעת נכס לביקוש ברשת",
    when: "הצעת נכס שלי לביקוש שמשרד אחר פרסם ברשת. לשאלה מה מבוקש יש „ביקושים ברשת”.",
    examples: [
      "תציע את הדירה בהרב שך לביקוש של משרד כהן",
      "יש לי נכס מתאים לביקוש בגבעתיים — תציע אותו",
      "תציע את הפנטהאוז לביקוש של 5 חדרים בנתניה",
    ],
    capability: "collaboration.offer",
    risk: "outbound",
    fields: [F_DEMAND_PHRASE, F_PROPERTY_PHRASE, F_COMMISSION_SPLIT],
  },
  {
    id: "express_interest",
    title: "התעניינות בנכס ברשת",
    when: "הבעת התעניינות בנכס שמשרד אחר פרסם ברשת, בשם קונה שלי. לשאלה מה יש ברשת יש „נכסים ברשת”.",
    examples: [
      "תביע התעניינות בדירה שברשת בגבעתיים בשביל משה כהן",
      "הנכס ברמת גן שברשת מתאים למשפחת לוי — תפנה אליהם",
      "תגיד למשרד שפרסם את הפנטהאוז שיש לי קונה",
    ],
    /*
     * ‎`collaboration.offer` — אותה יכולת של הבקר. `share` הוא פרסום
     * שלי לרשת; פנייה **אל** מודעה של אחר היא הצעה, ו-`expressInterest`
     * אינו בודק יכולת בעצמו (ביקורת Codex).
     */
    capability: "collaboration.offer",
    risk: "outbound",
    fields: [F_LISTING_PHRASE, F_BUYER_PHRASE, F_COMMISSION_SPLIT],
  },
  {
    id: "post_deal_message",
    title: "הודעה בחדר עסקה",
    when: "כתיבת הודעה בחדר עסקה משותף — מה שנאמר נשלח למשרד השני. לרשימת החדרים יש „עסקאות שת״פ”.",
    examples: [
      "תכתוב בחדר העסקה עם משרד לוי שהלקוח מאשר את המחיר",
      "תעדכן בחדר העסקה על הדירה ברמת גן שנקבע סיור למחר",
      "תשלח למשרד השני בחדר העסקה שאנחנו ממתינים לתשובה",
    ],
    capability: "collaboration.offer",
    capabilityAlts: ["collaboration.share"],
    risk: "outbound",
    fields: [F_DEAL_PHRASE, F_MESSAGE_BODY],
  },
  {
    /*
     * ‎**„לא יצא לפועל” אינו נאמר בדיבור.** סגירת עסקה היא מצב סופי
     * שאי אפשר לפתוח ממנו מחדש, ולכן היא נשארת במסך — כמו כל פעולה
     * שאין ממנה חזרה. „נחתם” כן: זו הבשורה שמדווחים עליה מהשטח.
     */
    id: "move_deal_stage",
    title: "קידום עסקה משותפת",
    when: "העברת עסקה משותפת לשלב הבא — יצירת קשר, סיור, משא ומתן או נחתם. סגירת עסקה שלא יצאה לפועל נעשית במסך.",
    examples: [
      "תעביר את העסקה עם משרד כהן לשלב משא ומתן",
      "העסקה על הדירה ברמת גן נחתמה",
      "היה סיור בעסקה המשותפת — תעדכן",
    ],
    capability: "collaboration.offer",
    capabilityAlts: ["collaboration.share"],
    risk: "update",
    fields: [
      F_DEAL_PHRASE,
      {
        key: "dealStage",
        label: "שלב",
        type: "enum",
        values: ["contact", "viewing", "negotiation", "signed"],
        valueLabels: {
          contact: "יצירת קשר",
          viewing: "סיור בנכס",
          negotiation: "משא ומתן",
          signed: "נחתם",
        },
      },
    ],
  },
  {
    /*
     * ‎**חדר עסקה נפתח באישור פנייה** — אין „פתיחה” נפרדת במערכת:
     * המסך עושה בדיוק את זה בכפתור האישור, והסוכן קורא לאותו
     * שירות. `outbound` — האישור מודיע למשרד השני ופותח חדר משותף.
     */
    id: "open_deal_room",
    title: "פתיחת חדר עסקה",
    when: "אישור פנייה נכנסת מרשת השיתופים ופתיחת חדר עסקה משותף — נכס שהוצע לביקוש שפורסם, או משרד שמתעניין בנכס. „פתח חדר עסקה”, „תאשר את ההצעה”.",
    examples: [
      "פתח חדר עסקה על ההצעה לדירה בבני ברק",
      "תאשר את ההצעה ממשרד כהן נכסים",
      "יש התעניינות בנכס שפרסמתי — תפתח חדר עסקה",
    ],
    capability: "collaboration.offer",
    capabilityAlts: ["collaboration.share"],
    risk: "outbound",
    fields: [F_APPROACH_PHRASE],
  },
  {
    id: "show_payout_balance",
    title: "יתרת תשלומים",
    when: "שאלה על כסף שמגיע למשרד מהפניות ברשת — כמה נצבר ומה הסף למשיכה. הבקשה למשיכה עצמה נעשית במסך.",
    examples: ["כמה כסף מגיע לי מהפניות", "מה יתרת התשלומים שלי", "כמה צברתי מהרשת"],
    capability: "billing.manage",
    risk: "read",
    fields: [],
  },
  {
    id: "show_referral_board",
    title: "לידים ברשת",
    when: "שאלה על לידים שמשרדים אחרים פרסמו להפניה ברשת. קליטת ליד עצמה כרוכה בתשלום ונעשית במסך.",
    examples: ["אילו לידים יש ברשת", "מה יש בלוח ההפניות", "יש לידים למכירה ברשת?"],
    capability: "collaboration.offer",
    risk: "read",
    fields: [],
  },
  {
    id: "show_reach",
    title: "מה שווה לפרסם ברשת",
    when: "שאלה מה מהמאגר שלי מתאים למשהו שכבר ברשת ועדיין לא פורסם בה.",
    examples: ["מה שווה לי לפרסם ברשת", "מה אני מפספס ברשת", "יש לי משהו שמתאים לרשת?"],
    capability: "collaboration.offer",
    risk: "read",
    fields: [],
  },
  {
    id: "show_credits",
    title: "יתרת קרדיטים",
    when: "שאלה על קרדיטים של המשרד ברשת השיתופים — כמה נשארו, מתי פגים.",
    examples: ["כמה קרדיטים נשארו לנו?", "מה יתרת הקרדיטים", "מתי הקרדיטים שלי פגים"],
    capability: "collaboration.offer",
    risk: "read",
    fields: [],
  },
  {
    id: "office_report",
    title: "דוח המשרד",
    feature: "analytics",
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
    id: "agent_report",
    title: "ביצועי הסוכנים",
    feature: "analytics",
    when: "שאלה על ביצועי הסוכנים במשרד — מי הכניס כמה, מי סוגר. לנתוני המשרד כמכלול יש „דוח המשרד”.",
    examples: [
      "תראה לי איך הסוכנים עבדו החודש",
      "מי הסוכן הכי חזק שלי ברבעון",
      "ביצועים לפי סוכן",
    ],
    capability: "users.manage",
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
    id: "show_recommendations",
    title: "מה כדאי עכשיו",
    feature: "ai_coach",
    when: "בקשת הכוונה — „מה כדאי לי לעשות היום”, „ממה להתחיל”. ההמלצות של המאמן, לפי דחיפות.",
    examples: ["מה כדאי לי לעשות היום?", "ממה להתחיל את הבוקר", "מה הכי דחוף עכשיו"],
    capability: "matches.view",
    risk: "read",
    fields: [],
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
      // המשך לעדכון שהסוכן שלח — „אליו” הוא הכרטיס שבשורת ההקשר
      "תזכיר לי להתקשר אליו",
    ],
    capability: "calendar.manage",
    risk: "create",
    fields: [
      F_TASK_TITLE,
      {
        key: "relatedPhrase",
        label: "קשור ל",
        type: "string",
        /*
         * לקוח או ליד — לא נכס. כך נפתר השדה בפועל (חיפוש „כרטיס”),
         * ורמז שמזמין שם של נכס היה מייצר ביטוי שלעולם אינו נמצא.
         */
        hint: "שם הלקוח או הליד שהוזכר, או הסימון מהעדכון האחרון של הסוכן",
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
    id: "update_task",
    title: "עדכון משימה",
    when: "שינוי משימה קיימת — דחייה למועד אחר או שינוי דחיפות. לסימון כבוצעה יש „סגירת משימה”.",
    examples: [
      "תדחה את המשימה של החוזה למחר בבוקר",
      "תעביר את התזכורת להתקשר לדוד ליום ראשון",
      "תסמן את המשימה של ההצעה כדחופה",
    ],
    capability: "calendar.manage",
    risk: "update",
    fields: [
      F_TASK_PHRASE,
      {
        key: "priority",
        label: "דחיפות",
        type: "enum",
        values: ["low", "normal", "high"],
        valueLabels: { low: "נמוכה", normal: "רגילה", high: "דחופה" },
      },
    ],
    resolved: [{ key: "dueAt", label: "מועד חדש" }],
  },
  {
    /*
     * ‎**„כל יום ראשון בתשע” — הוראת קבע, לא תזכורת.** נשמרת ככלל
     * שמייצר משימה בכל מחזור — אותו מנגנון של מסך המשימות הקבועות,
     * ולכן `settings.manage`: כלל קבוע הוא הגדרת משרד.
     */
    id: "create_recurring_task",
    title: "משימה קבועה",
    feature: "automations",
    when: "תזכורת שחוזרת בקביעות — „כל יום”, „כל שבוע ביום ראשון”, „כל חודש ב-1”. לתזכורת חד-פעמית יש „תזכורת / משימה”.",
    examples: [
      "תזכיר לי כל יום ראשון בתשע לעבור על הלידים",
      "כל יום בשמונה בבוקר תזכיר לי לבדוק את ההתראות",
      "כל חודש באחד לחודש משימה לחדש את הפרסומים",
    ],
    capability: "settings.manage",
    risk: "create",
    fields: [
      F_TASK_TITLE,
      {
        key: "frequency",
        label: "תדירות",
        type: "enum",
        values: ["daily", "weekly", "monthly"],
        valueLabels: { daily: "כל יום", weekly: "כל שבוע", monthly: "כל חודש" },
      },
      {
        key: "weekday",
        label: "יום בשבוע",
        type: "enum",
        hint: "רק כשהתדירות שבועית",
        values: ["0", "1", "2", "3", "4", "5", "6"],
        valueLabels: {
          "0": "ראשון",
          "1": "שני",
          "2": "שלישי",
          "3": "רביעי",
          "4": "חמישי",
          "5": "שישי",
          "6": "שבת",
        },
      },
      {
        key: "dayOfMonth",
        label: "יום בחודש",
        type: "integer",
        hint: "רק כשהתדירות חודשית",
        min: 1,
        max: 31,
      },
      {
        key: "hour",
        label: "שעה",
        type: "integer",
        hint: '"בתשע בבוקר" ⇒ 9, "בשמונה בערב" ⇒ 20',
        min: 0,
        max: 23,
      },
      { key: "minute", label: "דקות", type: "integer", hint: "0 כשלא נאמר", min: 0, max: 59 },
    ],
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
      F_LEAD_STATUS,
    ],
  },
  {
    /*
     * ‎**ליד שהבשיל הופך לקונה** — אותו נתיב כמו כפתור ההמרה במסך:
     * קונה על אותו איש קשר, הליד מסומן כהומר, והמעבר נרשם בשני
     * הצירים. `buyers.edit` ולא `leads.edit` — נוצרת ישות קונה.
     */
    id: "convert_lead",
    title: "הפיכת ליד לקונה",
    when: "ליד שהבשיל הופך לכרטיס קונה מלא — „תהפוך את הליד לקונה”, „תפתח לו כרטיס”. אפשר לומר באותו משפט גם מה הוא מחפש.",
    examples: [
      "תהפוך את הליד של דני לכרטיס קונה",
      "דני רציני — תפתח לו כרטיס קונה, מחפש 4 חדרים בבני ברק עד 2.5 מיליון",
      "תמיר את הליד של משפחת לוי לקונה",
    ],
    capability: "buyers.edit",
    risk: "create",
    // בלי F_AGENT_NOTES: קלט ההמרה אינו נושא הערות, ושדה שנופל בשקט הוא שדה מת
    fields: [F_LEAD_PHRASE, ...BUYER_REQUIREMENT_FIELDS, F_MATURITY, F_FINANCING],
  },
  {
    /*
     * ‎**הצד השני של ההמרה** — ליד שרוצה למכור הופך לנכס, לא לקונה.
     * ‎`properties.create` ולא `edit`: הנתיב יוצר נכס, ומי שמורשה
     * לערוך בלבד אינו עוקף את זה דרך המרה.
     */
    id: "create_property_from_lead",
    title: "פתיחת נכס מליד",
    when: "ליד של מוכר הופך לכרטיס נכס. להפיכת ליד לקונה יש „הפיכת ליד לקונה”.",
    examples: [
      "תפתח נכס מהליד של יוסי שרוצה למכור",
      "הליד של משפחת דהן — תהפוך אותו לנכס, 4 חדרים ברמת גן",
      "תמיר את הליד של אבי לכרטיס נכס",
    ],
    capability: "properties.create",
    risk: "create",
    fields: [F_LEAD_PHRASE, ...PROPERTY_FIELDS],
    resolved: PROPERTY_RESOLVED,
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
    /*
     * ‎**איזו פגישה — הקרובה עם הלקוח שנאמר.** הביצוע מאתר את
     * הפגישה המתוכננת הקרובה של הכרטיס שנפתר, ואומר בתשובה מאיזה
     * מועד היא זזה — כך טעות בזיהוי גלויה מיד והפיכה בדחייה נוספת.
     */
    id: "reschedule_appointment",
    title: "דחיית פגישה",
    when: "הזזת פגישה קיימת למועד חדש — הפגישה הקרובה עם הלקוח שנאמר, או זו בנכס שנאמר. לקביעת פגישה חדשה יש „פגישה / סיור”.",
    examples: [
      "תזיז את הסיור עם משה כהן למחר בעשר",
      "תדחה את הפגישה עם דנה ליום ראשון בארבע",
      "תזיז את הסיור בדירה ברמת גן למחר בשש",
    ],
    capability: "calendar.manage",
    risk: "update",
    fields: [F_BUYER_PHRASE, F_PROPERTY_PHRASE],
    resolved: [{ key: "startsAt", label: "מועד חדש" }],
  },
  {
    id: "update_appointment",
    title: "עדכון פגישה",
    when: "מה קרה עם פגישה — ביטול (של הקרובה), או „התקיימה” / „לא הגיע” / תוצאת סיור (על האחרונה שהייתה). הפגישה מזוהה לפי הלקוח או לפי הנכס. הביטול הפיך: הפגישה נשארת ביומן כמבוטלת.",
    examples: [
      "בטל את הפגישה עם משה כהן",
      "הסיור בדירה ברמת גן התקיים והם אהבו את הנכס",
      "משפחת לוי לא הגיעו לסיור",
    ],
    capability: "calendar.manage",
    risk: "update",
    fields: [F_BUYER_PHRASE, F_PROPERTY_PHRASE, F_APPOINTMENT_STATUS, F_VIEWING_OUTCOME],
  },
  {
    id: "update_buyer",
    title: "עדכון כרטיס קונה",
    when: "שינוי פרט בכרטיס קונה קיים — תקציב שעלה, אזור שהתווסף, בשלות שהשתנתה, או שלב בתהליך של המשרד.",
    examples: [
      "משה כהן העלה את התקציב לשלושה מיליון",
      "תעדכן שמשפחת לוי מחפשים גם בגבעתיים",
      "הקונה של רמת גן הפך לחם מאוד",
      "תסמן את משה כהן בסבב סיורים",
    ],
    capability: "buyers.edit",
    risk: "update",
    fields: [F_BUYER_PHRASE, ...BUYER_REQUIREMENT_FIELDS, ...BUYER_PROFILE_FIELDS],
  },
  {
    /*
     * ‎**טלפון ואימייל לא היו ניתנים לתיקון בדיבור בכלל.**
     * ‎`update_buyer` נושא דרישות חיפוש בלבד — תקציב, ערים, חדרים —
     * ומספר שגוי בכרטיס נשאר שגוי עד שמישהו פתח מסך. זו הפעולה
     * שסוגרת את הפער, והיא **מוסיפה** ולא מוחקת: מספר קיים נשאר.
     */
    id: "add_contact_detail",
    title: "הוספת פרט קשר",
    when: "הוספת טלפון נוסף או קביעת אימייל בכרטיס לקוח קיים. לשינוי דרישות החיפוש יש „עדכון כרטיס קונה”.",
    examples: [
      "תוסיף למשה כהן עוד טלפון 052-1234567",
      "האימייל של דנה הוא dana@example.com",
      "תוסיף לכרטיס של משפחת לוי את הנייד של הבעל 054-9876543",
    ],
    capability: "buyers.edit",
    risk: "update",
    fields: [
      F_BUYER_PHRASE,
      /*
       * ‎**אותם קבועים של יצירת ליד, לא הצהרה מקומית.** מפתח שמופיע
       * בכמה פעולות חייב להיות מוצהר זהה בכולן — והשער תפס בדיוק
       * את זה כשניסחתי כאן „אימייל” מול „דוא\"ל”.
       */
      F_PHONE,
      F_EMAIL,
      {
        key: "phoneLabel",
        label: "סוג המספר",
        type: "enum",
        values: ["mobile", "home", "work", "other"],
        valueLabels: { mobile: "נייד", home: "בית", work: "עבודה", other: "אחר" },
      },
    ],
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
    id: "create_landing_page",
    title: "דף נחיתה לנכס",
    feature: "landing_pages",
    when: "יצירת קישור לדף נחיתה ציבורי של נכס — דף שאפשר לשלוח למתעניינים.",
    examples: [
      "תכין דף נחיתה לפנטהאוז בנתניה",
      "תעשה קישור ציבורי לדירה ברמת גן",
      "אני צריך דף נחיתה לנכס בהרב שך",
    ],
    capability: "properties.edit",
    risk: "create",
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
  /**
   * ‎**קישור חתימה על הזמנה בכתב.**
   *
   * המתווך בשטח צריך את הקישור עכשיו — הוא יושב מול הלקוח, והדרך
   * היחידה להפיק אותו הייתה לפתוח דשבורד. הסוכן ענה „אני עדיין לא
   * יכול” (דיווח המשתמשת).
   *
   * ‎**הזמנה בכתב בלבד, ובכוונה.** הסכם בלעדיות נחתם מול בעל הנכס,
   * שאינו קונה ואינו נמצא בחיפוש הקונים; זיהוי שלו דרך אותו מסלול
   * היה מחזיר את הקונה הדומה ביותר בשם — כלומר קישור חתימה על
   * מסמך משפטי שנשלח לאדם הלא נכון. הסוכן אומר זאת ומפנה לכרטיס
   * הנכס במקום לנחש.
   *
   * ‎`outbound`: הקישור נושא טוקן, ומי שמחזיק בו יכול לחתום. בחירת
   * הלקוח היא מפורשת תמיד, גם כשיש התאמה אחת.
   */
  {
    /*
     * ‎**שליחה מרובה — הפעולה שהמספר בה הוא כל הסיפור.** ההודעה
     * אומרת לכמה נשלח בפועל וכמה דולגו, כי „נשלח לכולם” בלי מספר
     * אינו מאפשר לזהות ששלושה קונים לא קיבלו כלום.
     */
    id: "send_offers_bulk",
    title: "שליחת הצעה לכל המתאימים",
    when: "שליחת נכס אחד לכל הקונים שמתאימים לו מעל סף ההתאמה. לשליחה לקונה אחד יש „שליחת הצעה”.",
    examples: [
      "תשלח את הדירה ברמת גן לכל הקונים המתאימים",
      "תפיץ את הפנטהאוז לכל מי שמתאים מעל 70 אחוז",
      "שלח הצעה על הנכס בהרב שך לכל ההתאמות",
    ],
    capability: "offers.send",
    risk: "outbound",
    fields: [
      F_PROPERTY_PHRASE,
      {
        key: "minScore",
        label: "סף התאמה",
        type: "integer",
        hint: 'באחוזים; ברירת המחדל 60 ("מעל 70 אחוז" ⇒ 70)',
        min: 1,
        max: 100,
      },
    ],
  },
  {
    id: "send_agreement",
    title: "קישור לחתימה על הזמנה בכתב",
    when: "הפקת קישור חתימה על הזמנה בכתב (הסכם תיווך) ללקוח על נכס מסוים. בחר בפעולה הזו כשמבקשים „קישור לחתימה”, „להחתים” או „הזמנה בכתב”. אין לבחור בה להסכם בלעדיות.",
    examples: [
      "תשלח לי קישור להחתמה של משה כהן על הדירה ברמת גן",
      "תכין הזמנה בכתב לשרה לוי על הפנטהאוז בנתניה",
      "אני צריך להחתים את משפחת ביטון על הנכס בהרב שך",
    ],
    capability: "offers.send",
    risk: "outbound",
    fields: [F_BUYER_PHRASE, F_PROPERTY_PHRASE],
  },
  /*
   * ‎**בלעדיות — המודול הרגולטורי היחיד שלסוכן לא הייתה אליו גישה
   * בכלל.**
   *
   * זו אינה עוד לשונית: בלעדיות שלא תועדו בה שתי פעולות שיווק
   * מסתיימת בתום שליש מהתקופה (חוק המתווכים, §9(ב2)) — חודשיים
   * לפני מה שכתוב בחוזה. עד כה הדרך היחידה לדעת מה בסיכון הייתה
   * לפתוח כרטיס אחרי כרטיס.
   */
  {
    id: "show_exclusivity",
    title: "בלעדיות — מה בסיכון",
    when: "שאלה על מצב הבלעדיות: מה מסתיים, מה בסיכון, כמה פעולות שיווק חסרות, ומתי מועד השליש. בלי שם נכס — כל הבלעדיות של המשרד לפי דחיפות.",
    examples: [
      "מה המצב עם הבלעדיות?",
      "איזה בלעדיות מסתיימות החודש",
      "כמה פעולות שיווק חסרות לדירה ברמת גן",
      "מה בסיכון",
    ],
    capability: "properties.view",
    risk: "read",
    fields: [F_PROPERTY_PHRASE],
  },
  /*
   * ‎**והפעולה שמצילה אותה.** תיעוד פעולת שיווק הוא מה שמאריך את
   * הבלעדיות מעבר לשליש, והוא נעשה בשטח — תולים שלט, מפרסמים — ולא
   * ליד המחשב. זו בדיוק פעולה שחייבת לעבוד מוואטסאפ.
   */
  {
    /*
     * ‎**הבלעדיות כישות, לא כדגל.** ל-`update_property` יש `exclusive`
     * בוליאני, והוא אינו יוצר את הרשומה המוסדרת ש„מה בסיכון” ותיעוד
     * פעולות השיווק נשענים עליה. בלי הפעולה הזו אי אפשר היה לפתוח
     * תקופת בלעדיות מהסוכן כלל.
     *
     * התקרה החוקית (סעיף 9(ב)) נאכפת בשירות ולא כאן — אותה אכיפה
     * בדיוק כמו מהמסך.
     */
    id: "start_exclusivity",
    title: "פתיחת בלעדיות",
    when: "פתיחת תקופת בלעדיות מוסדרת על נכס — „קיבלתי בלעדיות”. לשאלה מה מסתיים יש „בלעדיות — מה בסיכון”.",
    examples: [
      "קיבלתי בלעדיות על הדירה ברמת גן לשלושה חודשים",
      "תפתח בלעדיות על הפנטהאוז בנתניה עד סוף השנה",
      "חתמנו בלעדיות על הנכס בהרב שך לחצי שנה",
    ],
    capability: "properties.edit",
    risk: "create",
    fields: [
      F_PROPERTY_PHRASE,
      {
        key: "exclusivitySubject",
        label: "סוג הנכס לעניין החוק",
        type: "enum",
        hint: "דירה = עד 6 חודשים; מקרקעין אחרים = עד 12",
        values: ["apartment", "other"],
        valueLabels: { apartment: "דירה", other: "מקרקעין שאינם דירה" },
      },
      {
        key: "exclusivityMonths",
        label: "לכמה חודשים",
        type: "integer",
        hint: '„לשלושה חודשים” ⇒ 3. בדירה עד 6, במקרקעין אחרים עד 12',
        min: 1,
        max: 12,
      },
    ],
    resolved: [{ key: "startsAt", label: "מתחילה" }],
  },
  {
    id: "log_marketing_action",
    title: "תיעוד פעולת שיווק",
    when: "תיעוד פעולת שיווק שבוצעה על נכס בבלעדיות — שילוט, פרסום, פרסום לרשת המתווכים, יום מכירות, או פעולה שסוכמה בחוזה. בחר בזו כשנאמר שנעשתה פעולה, לא כששואלים מה חסר.",
    examples: [
      "תליתי שלט על הדירה ברמת גן",
      "פרסמתי את הפנטהאוז בנתניה בעיתון",
      "תרשום שעשיתי יום מכירות בהרב שך",
    ],
    capability: "properties.edit",
    risk: "create",
    fields: [
      F_PROPERTY_PHRASE,
      /*
       * ‎`actionKind` ולא `kind`. הקטלוג אוכף שמפתח שמופיע בכמה
       * פעולות יוצהר זהה בכולן, ו-`kind` כבר תפוס ב-
       * ‎`schedule_appointment` במשמעות אחרת לגמרי (סיור/פגישה/שיחה).
       * שני מפתחות באותו שם ובשתי משמעויות מבלבלים גם את המודל, לא
       * רק את הבדיקה שתפסה את זה.
       */
      {
        key: "actionKind",
        label: "סוג פעולת השיווק",
        type: "enum",
        values: [...MARKETING_ACTION_KINDS],
        valueLabels: MARKETING_ACTION_LABEL,
      },
      { key: "detail", label: "פרטים", type: "string", maxLength: 300 },
    ],
  },

  // -------------------------------------------------------------------------
  // מה שהמערכת ידעה והסוכן לא יכול היה לשאול
  // -------------------------------------------------------------------------

  /*
   * ‎**„מי לא חתם” — השאלה שהמערכת עונה עליה בשקט כל יום.**
   *
   * ‎`hasSigned` חוסמת הצעה ללקוח בלי הזמנה בכתב (חוק המתווכים §9),
   * וזה נכון — אבל החסימה **שקטה**: המתווך רואה שההצעות אינן יוצאות
   * ואינו יודע שהסיבה היא טופס שנשלח לפני חודש ופג. עד כה אפשר היה
   * לשאול על לקוח אחד בכל פעם, כלומר רק אם כבר ידעת את מי לבדוק.
   */
  {
    id: "show_agreements",
    title: "מי לא חתם",
    when: "שאלה על הסכמים והזמנות בכתב שנשלחו ולא נחתמו — מי ממתין, מי פתח ולא חתם, למי פג הקישור.",
    examples: ["מי לא חתם", "אילו הזמנות בכתב ממתינות", "מי פתח את ההסכם ולא חתם"],
    capability: "offers.send",
    risk: "read",
    fields: [],
  },

  /*
   * ‎**„מי פתח ולא הגיב” — ולא „הראה לי הצעות”.**
   *
   * ‎`openCount` נמדד מהדף הציבורי, וקונה שפתח ארבע פעמים ולא הגיב
   * הוא הלקוח החם ביותר במאגר באותו רגע. הנתון היה קיים במסך ההצעות
   * ולא היה נגיש בשאלה.
   */
  {
    id: "show_retained_documents",
    title: "מסמכים חתומים שמורים",
    when: "שאלה על מסמכים חתומים שנשמרו במשרד — הארכיון. להסכמים שממתינים לחתימה יש „הסכמים ממתינים”.",
    examples: [
      "אילו מסמכים חתומים שמורים אצלי",
      "תראה לי את ארכיון המסמכים",
      "מה יש בתיק המסמכים החתומים",
    ],
    capability: "settings.manage",
    risk: "read",
    fields: [],
  },
  {
    id: "show_offers",
    title: "סטטוס הצעות",
    when: "שאלה על הצעות שנשלחו ומה קרה איתן — מי פתח, מי הגיב, מה נכשל.",
    examples: [
      "מה קורה עם ההצעות ששלחתי",
      "מי פתח את ההצעה ולא הגיב",
      "אילו הצעות נכשלו",
    ],
    capability: "offers.send",
    risk: "read",
    fields: [
      /*
       * ‎**מסננים לפי מה שהמתווך שואל, לא לפי עמודת הסטטוס.**
       * „נפתחה ולא נענתה” אינו סטטוס אחד במסד, ו„ממתינה” הוא שניים.
       * חשיפת שמות הסטטוסים הגולמיים לסוכן קולי הייתה מחייבת אותו
       * לדבר בשפת הטבלה.
       */
      {
        key: "offerFilter",
        label: "אילו הצעות",
        type: "enum",
        values: ["opened_no_reply", "interested", "declined", "failed", "waiting"],
        valueLabels: {
          opened_no_reply: "נפתחו ולא נענו",
          interested: "הקונה סימן מעוניין",
          declined: "הקונה סימן לא רלוונטי",
          failed: "השליחה נכשלה",
          waiting: "נשלחו וממתינות",
        },
      },
    ],
  },

  /*
   * ‎**ביקושי הרשת — הצד שהמשרד מרוויח ממנו ואינו רואה.**
   *
   * הפיד כבר מחשב לכל ביקוש את ההתאמות מתוך הנכסים **שלי**, כלומר
   * התשובה אינה רשימת בקשות אלא „למי מהם יש לך נכס”. זה בדיוק סוג
   * הדבר שנשאל בדרך לפגישה ולא ליד המחשב.
   */
  {
    id: "show_demands",
    title: "ביקושים ברשת",
    when: "שאלה על ביקושים שמשרדים אחרים פרסמו ברשת הבין-משרדית — מה מבוקש, ולמי מהם יש לי נכס.",
    examples: [
      "מה מבוקש ברשת",
      "אילו ביקושים יש בגבעתיים",
      "יש למישהו ברשת ביקוש שמתאים לנכסים שלי",
    ],
    capability: "collaboration.offer",
    risk: "read",
    fields: [F_CITIES],
  },
  {
    id: "show_network_listings",
    title: "נכסים ברשת",
    when: "שאלה על נכסים שמשרדים אחרים פרסמו ברשת הבין-משרדית — מה מוצע ואיפה. לביקושים יש „ביקושים ברשת”.",
    examples: [
      "מה יש ברשת בגבעתיים",
      "אילו דירות מוצעות ברשת המשרדים",
      "יש ברשת משהו של 4 חדרים?",
    ],
    capability: "collaboration.offer",
    risk: "read",
    fields: [F_CITIES],
  },
  {
    id: "show_network_inbox",
    title: "פניות ממתינות מהרשת",
    when: "מה מחכה לתשובה שלי ברשת — נכסים שהוצעו לביקושים שפרסמתי, ומשרדים שמתעניינים בנכסים שפרסמתי.",
    examples: [
      "מי התעניין בנכסים שפרסמתי?",
      "אילו הצעות מחכות לי מהרשת",
      "יש פניות חדשות ברשת?",
    ],
    capability: "collaboration.offer",
    capabilityAlts: ["collaboration.share"],
    risk: "read",
    fields: [],
  },

  /*
   * ‎**„מה חדש”** — השאלה הראשונה בבוקר, ועד כה היא חייבה פתיחת מסך.
   */
  {
    id: "show_notifications",
    title: "מה חדש",
    when: "שאלה כללית על עדכונים והתראות שטרם נקראו.",
    examples: ["מה חדש", "יש לי התראות", "מה פספסתי"],
    /*
     * ‎**שער כניסה רחב, בדיוק כמו ב-`show_card`.** התראה יכולה לדבר
     * על ליד, על נכס או על התאמה, והשואל אינו יודע מראש על מה. תוכן
     * ההתראות עצמו מסונן בשירות לפי הנמען — היכולת כאן היא הרשות
     * לשאול, לא ההיתר למה שיוחזר.
     */
    /*
     * ‎**שלוש היכולות הן מה שיש לכל תפקיד, כולל `viewer`** — כלומר
     * בפועל „כל משתמש מחובר”, בדיוק כמו מסך ההתראות עצמו. הרשימה
     * הראשונה כאן החסירה קונים, ומשתמש שהרשאותיו צומצמו אליהם ראה
     * את פעמון ההתראות ולא יכול היה לשאול את אותה שאלה דרך הסוכן
     * (ביקורת Codex).
     */
    capability: "leads.view_own",
    capabilityAlts: ["buyers.view_own", "properties.view"],
    risk: "read",
    fields: [],
  },
  {
    /*
     * ‎`update` ולא פעולה הרסנית: סימון כנקרא אינו מוחק התראה —
     * היא נשארת ברשימה, רק בלי הסימון.
     */
    id: "mark_notifications_read",
    title: "סימון התראות כנקראו",
    when: "ניקוי סימון ההתראות שלא נקראו. לשאלה מה חדש יש „מה חדש”.",
    examples: ["סמן את כל ההתראות כנקראו", "תנקה לי את ההתראות", "קראתי הכול, תסמן"],
    capability: "leads.view_own",
    capabilityAlts: ["buyers.view_own", "properties.view", "calendar.manage"],
    risk: "update",
    fields: [],
  },
  {
    id: "show_emails",
    title: "תיבת המייל",
    when: "שאלה על מיילים שנכנסו מלקוחות — מי כתב, מה עוד לא נקרא.",
    examples: ["מה קיבלתי במייל", "יש מיילים חדשים מלקוחות?", "מי כתב לי ולא עניתי"],
    // אותו שער כמו נתיבי תיבת הדואר עצמם
    capability: "buyers.view_own",
    risk: "read",
    fields: [],
  },

  /*
   * ‎**משוב על התאמה — הכיוון היחיד שמכייל את המנוע.**
   *
   * הסיבה אינה קישוט: `dismissReport` מודד אילו קריטריונים מייצרים
   * התאמות שאיש לא רוצה, וזה מה שמאפשר לכייל משקלים לפי מציאות
   * ולא לפי תחושה. משוב שנאמר בקול ולא נרשם הוא בדיוק המשוב שאובד.
   */
  {
    id: "dismiss_match",
    title: "התאמה לא רלוונטית",
    when: "המתווך אומר שהתאמה בין קונה לנכס אינה מתאימה, ומדוע.",
    examples: [
      "הדירה ברמת גן לא מתאימה למשה כהן, המחיר גבוה מדי",
      "תסמן שההתאמה של דנה לפנטהאוז לא רלוונטית",
      "משפחת לוי לא מעוניינת בדירה בהרב שך — האזור",
    ],
    capability: "matches.manage",
    risk: "update",
    fields: [
      F_BUYER_PHRASE,
      F_PROPERTY_PHRASE,
      {
        key: "dismissReason",
        label: "הסיבה",
        type: "enum",
        values: [...DISMISS_REASONS],
        valueLabels: DISMISS_REASON_LABEL,
      },
      { key: "dismissNote", label: "פירוט", type: "string", maxLength: 300 },
    ],
  },

  /*
   * ‎**הטלת משימה על סוכן.**
   *
   * ‎`tasks.assign` קיימת במערכת מאז שנוספה, והמודול היה פנקס אישי
   * מצד הסוכן: אפשר היה ליצור משימה — תמיד על עצמך. מנהל שאומר
   * „תעביר את זה לדנה” לא יכול היה לעשות זאת בדיבור.
   */
  {
    id: "assign_task",
    title: "הטלת משימה",
    when: "העברת משימה קיימת לסוכן אחר במשרד.",
    examples: [
      "תעביר את המשימה של ההתקשרות לדוד לדנה",
      "תטיל את הסיור בהרב שך על אבי",
      "המשימה הזאת של יוסי",
    ],
    capability: "tasks.assign",
    risk: "update",
    fields: [
      F_TASK_PHRASE,
      F_ASSIGNEE_PHRASE,
    ],
  },
  /*
   * מייל מהתיבה הפנימית — אותו נתיב בדיוק כמו תשובה מהמסך: יוצא
   * מכתובת המשרד (אם חובר דומיין), נושא Reply-To שמחזיר את תשובת
   * הלקוח לתיבה, ונרשם בשיחה ובציר. `outbound` — הודעה יוצאת
   * ללקוח מקבלת אישור לפני שליחה, כמו הצעה והסכם.
   */
  {
    id: "send_email",
    title: "שליחת מייל ללקוח",
    when: "שליחת הודעת אימייל חופשית ללקוח מכתובת המשרד. בחר בפעולה הזו כשמבקשים „שלח מייל”, „תכתוב לו במייל” או „תענה לו במייל”. לא להצעת נכס (send_offer) ולא להסכם (send_agreement).",
    examples: [
      "שלח מייל לדנה שהחוזה מוכן ואפשר לתאם חתימה",
      "תכתוב למשה כהן במייל שחוזרים אליו מחר עם תשובה",
      "תענה לה במייל שקיבלנו את המסמכים ותודה",
    ],
    capability: "buyers.view_own",
    risk: "outbound",
    fields: [F_BUYER_PHRASE, F_EMAIL_BODY],
  },
  {
    /*
     * ‎**וואטסאפ ללקוח — באותו ערוץ שהמערכת כבר שולחת בו הצעות.**
     *
     * ‎`walink`: ההודעה מנוסחת, נרשמת ב-Hub ובציר הלקוח, והקישור
     * שחוזר פותח את הצ'אט עם הטקסט מוכן — המתווך רק לוחץ שלח.
     * שום הודעה אינה יוצאת מעצמה, ולכן אין כאן תלות בחלון 24
     * השעות של Meta. `outbound` = אישור + בחירת נמען מפורשת,
     * בדיוק כמו מייל והצעה.
     */
    id: "send_message",
    title: "הודעת וואטסאפ ללקוח",
    when: "הכנת הודעת וואטסאפ ללקוח בנוסח שנאמר — „תשלח לו ש…”, „תכתוב לה בוואטסאפ”. לא להצעת נכס (send_offer) ולא למייל (send_email).",
    examples: [
      "תשלח למשה כהן שהסיור מחר בעשר",
      "תכתוב לדנה בוואטסאפ שהמסמכים התקבלו",
      "שלח למשפחת לוי שאחזור אליהם הערב",
    ],
    capability: "buyers.view_own",
    capabilityAlts: ["leads.view_own"],
    risk: "outbound",
    fields: [F_BUYER_PHRASE, F_MESSAGE_BODY],
  },
  {
    /*
     * ‎**נוסח שהמערכת כותבת, לא המתווך.** בשונה מ„הודעת וואטסאפ
     * לבעל נכס” שנושאת טקסט חופשי, כאן התוכן נבנה מהנתונים —
     * צפיות, הצעות, סיורים — וזה בדיוק מה שבעל נכס בבלעדיות מצפה
     * לקבל בלי לבקש.
     */
    id: "send_owner_update",
    title: "עדכון שיווקי לבעל נכס",
    feature: "whatsapp",
    when: "הכנת דיווח שיווק לבעל הנכס — מה נעשה עם הנכס בפועל. לנוסח חופשי יש „הודעת וואטסאפ לבעל נכס”.",
    examples: [
      "תשלח לבעלים של הדירה ברמת גן עדכון שיווקי",
      "תכין דיווח לבעל הנכס בהרב שך",
      "מגיע לבעלים של הפנטהאוז עדכון — תכין אותו",
    ],
    capability: "properties.edit",
    risk: "outbound",
    fields: [F_PROPERTY_PHRASE],
  },
  {
    /*
     * חיוג דרך מרכזיית המשרד — לא מספר חופשי: היעד הוא תמיד איש
     * הקשר של הכרטיס שנבחר, אותו שער בדיוק כמו כפתור החיוג במסך.
     */
    id: "call_contact",
    title: "חיוג ללקוח",
    feature: "telephony",
    when: "חיוג דרך מרכזיית המשרד — „תתקשר ל…”, „תחייג ל…”. המרכזייה מצלצלת קודם אצל המתווך ואז אצל הלקוח.",
    examples: ["תתקשר למשה כהן", "תחייג לדני מהליד החדש", "צלצל לשרה"],
    capability: "leads.edit",
    risk: "outbound",
    fields: [F_BUYER_PHRASE],
  },
  {
    id: "send_intake_form",
    title: "טופס פרטים ללקוח",
    when: "הכנת קישור לטופס מילוי-עצמי — „תשלח לו טופס פרטים”. הלקוח ממלא בעצמו והכרטיס מתעדכן מהתשובות.",
    examples: [
      "תשלח לשרה טופס למילוי פרטים",
      "תכין לדני קישור לטופס קליטה",
      "שלח למשפחת לוי טופס פרטים בוואטסאפ",
    ],
    capability: "buyers.edit",
    capabilityAlts: ["leads.edit"],
    risk: "outbound",
    fields: [F_BUYER_PHRASE],
  },
  {
    /*
     * ‎**הצד השני של אותו וואטסאפ** — בעל הנכס במקום הקונה. פעולה
     * נפרדת ולא שדה נוסף על `send_message`: נמען של פעולה יוצאת
     * נבחר במפורש, ופעולה אחת עם שני סוגי נמענים הייתה מטשטשת
     * בדיוק את הבחירה הזו.
     */
    id: "message_owner",
    title: "הודעת וואטסאפ לבעל נכס",
    when: "הכנת הודעת וואטסאפ לבעל הנכס — עדכון על סיור, התעניינות או התקדמות. ללקוח (קונה/ליד) יש „הודעת וואטסאפ ללקוח”.",
    examples: [
      "תשלח לבעלים של הדירה ברמת גן שהיה סיור היום",
      "תכתוב לבעל הנכס בהרב שך שיש התעניינות רצינית",
      "עדכן את הבעלים של הפנטהאוז שנקבע סיור למחר",
    ],
    capability: "properties.view",
    risk: "outbound",
    fields: [F_PROPERTY_PHRASE, F_MESSAGE_BODY],
  },
  {
    /*
     * ‎**היכולות כאן הן „כל משתמש מחובר”**, כמו כפתור התמיכה במסך:
     * נתיב הפניות אינו דורש יכולת, ומי שרואה כל דבר במערכת רשאי
     * לדווח עליו. הקטלוג מחייב יכולת אחת לפחות, ולכן ההצהרה היא
     * איחוד היכולות הבסיסיות — כל תפקיד מחזיק אחת מהן.
     */
    id: "open_support_ticket",
    title: "פנייה לתמיכה",
    when: "דיווח על תקלה, שאלה על המערכת עצמה, או הצעה לשיפור — „משהו לא עובד”, „תפתח פנייה לתמיכה”.",
    examples: [
      "תפתח פנייה לתמיכה שההקלטות לא נטענות",
      "משהו תקוע במסך ההצעות, תדווח לתמיכה",
      "יש לי הצעה לשיפור — שאפשר יהיה למיין לפי מחיר",
    ],
    capability: "leads.view_own",
    capabilityAlts: ["buyers.view_own", "properties.view", "calendar.manage"],
    risk: "create",
    fields: [F_SUPPORT_KIND, F_SUPPORT_MESSAGE],
  },
  {
    id: "show_support_tickets",
    title: "הפניות שלי לתמיכה",
    when: "שאלה על פניות תמיכה שנפתחו — מה מצבן ומה נענה.",
    examples: [
      "מה קורה עם הפנייה שפתחתי לתמיכה",
      "יש תשובה מהתמיכה?",
      "תראה לי את הפניות שלי לתמיכה",
    ],
    capability: "leads.view_own",
    capabilityAlts: ["buyers.view_own", "properties.view", "calendar.manage"],
    risk: "read",
    fields: [],
  },
  {
    /*
     * ‎**„תמיד” הוא הוראת קבע — והסוכן זוכר אותה.**
     *
     * העדפה נשמרת בפרופיל המשתמש (`preferences.agent`) וחלה מכאן
     * והלאה בשני הערוצים, כי הביצוע אחד. `update` ולא `read`:
     * שינוי העדפה הוא כתיבה, והמתווך רואה בכרטיס בדיוק מה ישתנה
     * לפני שהוא מאשר.
     */
    id: "set_preference",
    title: "העדפה קבועה",
    when: "בקשת „תמיד” על התנהגות הסוכן — סדר הצגת נכסים, או תשובות בקול בוואטסאפ. לא לבקשה חד-פעמית על תשובה אחת.",
    examples: [
      "תמיד תציג לי נכסים מהזול ליקר",
      "תמיד תראה את הנכסים החדשים קודם",
      "תמיד תענה לי בהודעה קולית",
    ],
    capability: "properties.view",
    risk: "update",
    fields: [F_PROPERTIES_ORDER, F_VOICE_REPLIES],
  },
];

/**
 * מזהי הרשומות שהקוד פותר — **לא שדות של המודל, ובכל זאת פרמטרים.**
 *
 * המודל מוסר ביטוי („שרה”, „הליד מהעדכון”) והקוד פותר אותו למזהה.
 * המזהה אינו מופיע בקטלוג השדות, ולכן כל צמצום פרמטרים שמסתמך על
 * הקטלוג בלבד היה מוחק אותו בדרך לביצוע.
 *
 * הרשימה יושבת כאן ולא בכל ערוץ בנפרד: היו שני עותקים — אחד בבקר
 * המסך ואחד בסוכן הוואטסאפ — ומזהה חדש שנוסף לאחד מהם היה נעלם
 * בשקט בערוץ השני. שני הערוצים הם אותו סוכן ולא שני מוצרים.
 */
export const AGENT_ID_KEYS = [
  "buyerId",
  "propertyId",
  "taskId",
  "cardId",
  "leadId",
  /** הכרטיס שתזכורת נקשרת אליו (`create_task`) */
  "relatedId",
  /** הסוכן שמשימה מוטלת עליו, או שמסננים לפיו (`assign_task`, `show_tasks`) */
  "assigneeId",
  /** הפנייה מהרשת שנבחרה לאישור (`open_deal_room`) */
  "approachId",
  /** הביקוש ברשת שמציעים לו נכס (`offer_to_demand`) */
  "demandId",
  /** המודעה ברשת שמתעניינים בה (`express_interest`) */
  "listingId",
  /** חדר העסקה שמדברים בו (`post_deal_message`, `move_deal_stage`) */
  "dealId",
] as const;

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
  return (action.capabilityAlts ?? []).some((alt) => capabilities.has(alt));
}
