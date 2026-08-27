/**
 * „מלאו לי מה אתם מחפשים” — טופס שהלקוח ממלא בעצמו.
 *
 * ## מה זה פותר
 *
 * הדרישות של קונה נאספות היום בשיחה, והמתווך מקליד אותן תוך כדי.
 * מה שנופל בין הכיסאות נופל שם לתמיד: תקציב שנאמר ולא נרשם, שכונה
 * שנשכחה, „חייב ממ״ד” שהפך ל„נחמד שיהיה”. הקישור הזה מעביר את
 * ההקלדה ללקוח — שגם יודע את התשובות טוב יותר, וגם ממלא אותן כשנוח
 * לו ולא בזמן שהמתווך על הקו.
 *
 * ## למה הטופס מגיע מלא מראש
 *
 * טופס ריק מבקש מהלקוח להתחיל מאפס, וכל מה שהמתווך כבר רשם הולך
 * לאיבוד ברגע שהלקוח שולח. טופס שמגיע עם מה שידוע הופך את הפעולה
 * ל**תיקון** במקום להזנה, וזה גם מה שמאפשר לצרף אותו לכרטיס בלי
 * לדרוס: הלקוח ראה את מה שהיה, ומה שהוא שלח הוא מה שהוא מתכוון
 * שיהיה.
 *
 * ## מה הטופס **לא** נוגע בו
 *
 * אזורי החיפוש על המפה, השכונות והמאפיינים המותאמים של המשרד אינם
 * בטופס — הם דורשים מפה ומינוח פנימי שאין ללקוח. לכן המיזוג משמר
 * אותם במפורש; ראו `applyIntakeAnswers`. „לא נשאל” אינו „נמחק”,
 * וזה בדיוק ההבדל שהופך את הטופס לבטוח לשליחה.
 */

import { normalizePhone } from "./contact-people.js";

/** ימי תוקף לקישור. אחריהם הוא מפסיק לעבוד. */
export const INTAKE_TTL_DAYS = 14;

/** אורך ההערה החופשית שהלקוח כותב. */
export const INTAKE_NOTES_MAX = 1000;

/** מצב הבקשה, כפי שהוא נשמר וכפי שהכרטיס מציג אותו. */
export type IntakeStatus = "sent" | "opened" | "submitted" | "revoked";

export const INTAKE_STATUS_LABEL: Record<IntakeStatus, string> = {
  sent: "נשלח — ממתין למילוי",
  opened: "הלקוח פתח — טרם שלח",
  submitted: "✓ הלקוח מילא",
  revoked: "הקישור בוטל",
};

/**
 * אל מי הבקשה מצביעה.
 *
 * `lead` ו-`buyer` הם שני הכרטיסים שיש בהם דרישות. `open` הוא
 * הקישור שנוצר **לפני שיש כרטיס בכלל**: המתווך פגש לקוח בטלפון או
 * ברחוב, ורוצה לשלוח לו טופס בלי לפתוח לו קודם כרטיס ידני. הכרטיס
 * נוצר בשליחה, מהפרטים שהלקוח עצמו מילא.
 *
 * הערך נשאר `open` גם אחרי שהכרטיס נוצר, והכרטיס נרשם ב-`subjectId`.
 * מפתה להחליף אותו אז ל-`buyer`, וזה היה מוחק את התשובה לשאלה „מאיפה
 * הלקוח הזה הגיע” — בדיוק מה שהמתווך שואל כשהוא רואה כרטיס שהוא לא
 * זוכר שפתח.
 */
export type IntakeSubject = "lead" | "buyer" | "open";

/** האורך שהמערכת מקבלת לשם שהלקוח מקליד על עצמו. */
export const INTAKE_NAME_MIN = 2;
export const INTAKE_NAME_MAX = 80;

/**
 * מה חסר בזיהוי שהלקוח מסר — או `null` כשהכול תקין.
 *
 * רלוונטי לקישור פתוח בלבד: שם ומספר הם מה שהופך תשובות לכרטיס,
 * ובלעדיהם אין את מי ליצור. בשאר הקישורים הכרטיס כבר קיים והשדות
 * האלה אינם נשאלים כלל.
 *
 * הפונקציה מחזירה **מה חסר ולמה**, ולא `false`: הטופס מוצג ללקוח
 * שאינו מתווך, ו„שגיאה” בלי הסבר היא סיבה לסגור את העמוד.
 */
export function intakeIdentityRejectionReason(input: {
  fullName?: string;
  phone?: string;
}): string | null {
  const name = (input.fullName ?? "").trim();
  if (name.length < INTAKE_NAME_MIN) return "נא למלא שם מלא";
  if (name.length > INTAKE_NAME_MAX) return "השם ארוך מדי";
  /*
   * המספר נבדק כאן על הצורה המנורמלת ולא על מה שהוקלד: לקוח מקליד
   * ‎050-123-4567‎ ו-‎+972 50 123 4567‎ באותה מידה, ודחייה של הראשון
   * הייתה נראית לו כמו תקלה במערכת.
   */
  const phone = normalizePhone(input.phone ?? "");
  if (phone === "") return "נא למלא מספר טלפון";
  if (!/^\+972[2-9]\d{7,8}$/u.test(phone)) return "מספר הטלפון אינו תקין";
  return null;
}

/**
 * מה חסר כדי **לפתוח כרטיס** מקישור פתוח — או `null` כשאפשר.
 *
 * מעבר לזהות יש שדה אחד שהוא מבני ולא „נחמד שיהיה”: סוג העסקה.
 * כרטיס קונה אינו יכול להתקיים בלעדיו — מנוע ההתאמות מסנן עליו
 * ראשון, וקונה בלי סוג עסקה אינו מותאם לשום נכס. ברירת מחדל שקטה
 * („קנייה”) הייתה גרועה יותר מהשאלה: היא נראית כמו תשובה, ומי
 * שחיפש שכירות מקבל כרטיס שמציע לו נכסים למכירה.
 *
 * זהו **ההבדל היחיד** בין הטופס הפתוח לטופס של כרטיס קיים: שם
 * הכרטיס כבר נושא סוג עסקה, ולכן שדה שלא נענה אינו מוחק אותו.
 */
export function intakeOpenRejectionReason(input: {
  fullName?: string;
  phone?: string;
  dealType?: "sale" | "rent";
}): string | null {
  const identity = intakeIdentityRejectionReason(input);
  if (identity !== null) return identity;
  if (input.dealType === undefined) return "נא לבחור קנייה או שכירות";
  return null;
}

/**
 * מדוע הקישור אינו פעיל, או `null` כשהוא פעיל.
 *
 * הפרדה מפורשת בין „פג” ל„בוטל”: ללקוח שמגיע לקישור שפג צריך לומר
 * לבקש חדש, ולמי שהקישור שלו בוטל אין מה לבקש. הודעה אחת לשניהם
 * הייתה שולחת חצי מהם לפנות שוב לחינם.
 */
export function intakeInactiveReason(
  status: IntakeStatus,
  expiresAt: Date,
  now: Date,
): "revoked" | "expired" | null {
  if (status === "revoked") return "revoked";
  if (expiresAt.getTime() <= now.getTime()) return "expired";
  return null;
}

/** מועד התפוגה של קישור שנוצר עכשיו. */
export function intakeExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + INTAKE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/* ============================================================
   התשובות
   ============================================================
   תת-קבוצה של דרישות הקונה — רק מה שאדם שאינו מתווך יכול לענות
   עליו בלי מפה ובלי מינוח פנימי.
   ============================================================ */

/** מאפיין שהלקוח יכול לסמן. חמשת הקבועים בלבד — ראו ההסבר למעלה. */
export const INTAKE_FEATURES = [
  "hasElevator",
  "hasParking",
  "hasBalcony",
  "hasSafeRoom",
  "hasStorage",
] as const;
export type IntakeFeature = (typeof INTAKE_FEATURES)[number];

export const INTAKE_FEATURE_LABEL: Record<IntakeFeature, string> = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: "ממ״ד",
  hasStorage: "מחסן",
};

/**
 * מה הלקוח שלח.
 *
 * **כל שדה הוא רשות.** לקוח שאינו יודע את התקציב עדיין הוא לקוח
 * אמיתי, וטופס שדורש ממנו מספר יקבל מספר שהומצא — וזה גרוע משדה
 * ריק, כי מנוע ההתאמות מתייחס למספר שהומצא כאילו הוא נכון.
 */
export interface IntakeAnswers {
  /**
   * מי הלקוח — **בקישור פתוח בלבד.**
   *
   * בקישור לכרטיס קיים השדות האלה אינם נשאלים ואינם נשלחים: הכרטיס
   * כבר יודע מי הלקוח, וטופס שמבקש ממנו למלא את שמו מחדש מזמין
   * גרסה שנייה של אותו אדם. `intakeIdentityRejectionReason` היא
   * מה שמכריע אם מה שנמסר מספיק כדי לפתוח כרטיס.
   */
  fullName?: string;
  phone?: string;
  dealType?: "sale" | "rent";
  cities?: string[];
  propertyTypes?: string[];
  roomsMin?: number;
  roomsMax?: number;
  budgetMinAgorot?: number;
  budgetMaxAgorot?: number;
  areaSqmMin?: number;
  /** מאפיין → „חובה” או „נחמד שיהיה”. מה שלא נשלח — לא נדרש. */
  features?: Partial<Record<IntakeFeature, "must" | "nice">>;
  entryType?: "immediate" | "by_date" | "flexible";
  entryBy?: string;
  notes?: string;
}

/** צורת הדרישות שהמיזוג מקבל ומחזיר. רופף בכוונה — ראו `applyIntakeAnswers`. */
export type RequirementsLike = Record<string, unknown>;

/**
 * מיזוג התשובות לתוך דרישות הקונה.
 *
 * ## הכלל
 *
 * **מה שהטופס שואל — התשובה קובעת. מה שהטופס אינו שואל — נשאר.**
 *
 * זה לא ניואנס אלא כל הבטיחות של התכונה. אזורי החיפוש על המפה,
 * השכונות והמאפיינים המותאמים של המשרד נאספו בעבודה של המתווך,
 * והלקוח מעולם לא ראה אותם; החזרת אובייקט דרישות „נקי” מהטופס
 * הייתה מוחקת אותם בשקט — בדיוק סוג התקלה שמתגלה שבוע אחר כך,
 * כשמישהו שואל למה הקונה הפסיק להתאים.
 *
 * המאפיינים ממוזגים ולא מוחלפים מאותה סיבה: מאפיין מותאם
 * (`custom:`) אינו בטופס, והחלפת המפה כולה הייתה מוחקת אותו.
 * מאפיין קבוע שהלקוח **לא** סימן כן נמחק — הוא ראה אותו והחליט
 * שאינו נדרש, וזו תשובה.
 */
export function applyIntakeAnswers(
  current: RequirementsLike,
  answers: IntakeAnswers,
): RequirementsLike {
  const next: RequirementsLike = { ...current };

  if (answers.dealType !== undefined) next["dealType"] = answers.dealType;
  if (answers.cities !== undefined) {
    next["cities"] = answers.cities.map((c) => c.trim()).filter((c) => c !== "");
  }
  if (answers.propertyTypes !== undefined) {
    next["propertyTypes"] = answers.propertyTypes;
  }

  /*
   * `null` מהלקוח = „אין לי מגבלה”, ולכן השדה נמחק ולא נשמר כאפס.
   * `undefined` = הטופס לא שלח את השדה כלל, ואז לא נוגעים בו.
   */
  assignOptional(next, "roomsMin", answers.roomsMin);
  assignOptional(next, "roomsMax", answers.roomsMax);
  assignOptional(next, "budgetMinAgorot", answers.budgetMinAgorot);
  assignOptional(next, "budgetMaxAgorot", answers.budgetMaxAgorot);
  assignOptional(next, "areaSqmMin", answers.areaSqmMin);

  if (answers.features !== undefined) {
    const before = isRecord(current["features"]) ? current["features"] : {};
    const merged: Record<string, unknown> = {};
    // מאפיינים שאינם בטופס (המותאמים של המשרד) עוברים כמות שהם
    for (const [key, value] of Object.entries(before)) {
      if (!(INTAKE_FEATURES as readonly string[]).includes(key)) {
        merged[key] = value;
      }
    }
    for (const key of INTAKE_FEATURES) {
      const level = answers.features[key];
      if (level !== undefined) merged[key] = level;
    }
    next["features"] = merged;
  }

  if (answers.entryType !== undefined) {
    next["entryType"] = answers.entryType;
    /*
     * „מיידי” ו„גמיש” אינם נושאים תאריך, ותאריך שנשאר מבחירה קודמת
     * היה ממשיך להשתתף בהתאמה בשם הלקוח — אחרי שהלקוח עצמו אמר
     * שאין לו מועד.
     */
    if (answers.entryType === "by_date") {
      if (answers.entryBy !== undefined && answers.entryBy !== "") {
        next["entryBy"] = answers.entryBy;
      }
    } else {
      delete next["entryBy"];
    }
  }

  if (answers.notes !== undefined) {
    const trimmed = answers.notes.trim();
    if (trimmed === "") delete next["flexibilityNotes"];
    else next["flexibilityNotes"] = trimmed;
  }

  return next;
}

function assignOptional(
  target: RequirementsLike,
  key: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (Number.isFinite(value)) target[key] = value;
  else delete target[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * רק מה שהטופס באמת שואל עליו.
 *
 * הדרישות השמורות של קונה עשירות מהטופס: מאפיינים מותאמים של
 * המשרד (`custom:`), שכונות, אזורי מפה. כשהן נשלחות לעמוד הציבורי
 * כערכי פתיחה הן חוזרות משם כמות שהן — והסכימה של הנתיב הציבורי
 * מכירה חמישה מאפיינים בלבד, ולכן **כל** שליחה של קונה כזה נדחית.
 * הלקוח רואה שגיאה על שדה שהעמוד אינו מציג לו בכלל.
 *
 * הסינון כאן ולא בעמוד: מה שלא יצא מהשרת אינו יכול לחזור אליו.
 */
export function pickIntakeFeatures(
  features: unknown,
): Partial<Record<IntakeFeature, "must" | "nice">> {
  if (!isRecord(features)) return {};
  const out: Partial<Record<IntakeFeature, "must" | "nice">> = {};
  for (const key of INTAKE_FEATURES) {
    const value = features[key];
    if (value === "must" || value === "nice") out[key] = value;
  }
  return out;
}

/**
 * המרת ליד לקונה — מה שהלקוח כבר מילא אינו הולך לאיבוד.
 *
 * ## מה זה פותר
 *
 * לליד אין שדה דרישות; התשובות של הלקוח נשמרות על הבקשה עד
 * שהמתווך ימיר. ההתראה אומרת לו „המירו את הליד לקונה כדי שייכנסו
 * לכרטיס” — וטופס ההמרה שואל ערים, סוג עסקה ותקציב בלבד. בלי
 * המיזוג הזה החדרים, סוגי הנכס, המאפיינים ומועד הכניסה שהלקוח
 * טרח למלא נמחקים ברגע ההמרה, וההתראה מתגלה כהבטחה שלא קוימה.
 *
 * ## מי גובר
 *
 * **מה שהמתווך הקליד בטופס ההמרה.** הוא ראה את הליד, אולי דיבר עם
 * הלקוח מאז, והוא האחרון שהחליט. השדות שהוא **השאיר ריקים** הם
 * אלה שנשאבים מהטופס — „ריק” כאן פירושו „לא הביע דעה”, ולא
 * „מחק”. סוג העסקה תמיד שלו: הוא שדה חובה בטופס ההמרה, ולכן
 * הערך שבו הוא בחירה מפורשת גם כשהיא ברירת המחדל.
 */
export function mergeIntakeSeed(
  seed: RequirementsLike,
  chosen: RequirementsLike,
): RequirementsLike {
  const out: RequirementsLike = { ...seed, ...chosen };
  /* מערך ריק בטופס ההמרה = „לא נשאלתי”, ולכן אינו מוחק את מה שנאסף */
  for (const key of ["cities", "propertyTypes"] as const) {
    const picked = chosen[key];
    if (!Array.isArray(picked) || picked.length === 0) {
      const fromSeed = seed[key];
      if (Array.isArray(fromSeed) && fromSeed.length > 0) out[key] = fromSeed;
      else delete out[key];
    }
  }
  const chosenFeatures = chosen["features"];
  if (!isRecord(chosenFeatures) || Object.keys(chosenFeatures).length === 0) {
    const fromSeed = seed["features"];
    if (isRecord(fromSeed) && Object.keys(fromSeed).length > 0) {
      out["features"] = fromSeed;
    }
  }
  for (const key of [
    "roomsMin",
    "roomsMax",
    "budgetMinAgorot",
    "budgetMaxAgorot",
    "areaSqmMin",
    "entryType",
    "entryBy",
    "flexibilityNotes",
  ]) {
    if (chosen[key] === undefined && seed[key] !== undefined) {
      out[key] = seed[key];
    }
  }
  return out;
}

/**
 * מה השתנה בפועל — לשורת ציר הזמן בכרטיס.
 *
 * המתווך צריך לדעת **מה** הלקוח שינה, לא רק ש„הלקוח מילא טופס”.
 * שינוי בתקציב הוא פעולה אחרת לגמרי משינוי בהערה חופשית, והכרטיס
 * שאומר „עודכן” בלי לומר מה מחייב אותו לפתוח ולהשוות ידנית.
 */
export function describeIntakeChanges(
  before: RequirementsLike,
  after: RequirementsLike,
): string[] {
  const out: string[] = [];
  const watched: [string, string][] = [
    ["dealType", "סוג עסקה"],
    ["cities", "ערים"],
    ["propertyTypes", "סוגי נכס"],
    ["roomsMin", "מינימום חדרים"],
    ["roomsMax", "מקסימום חדרים"],
    ["budgetMinAgorot", "תקציב מינימלי"],
    ["budgetMaxAgorot", "תקציב מקסימלי"],
    ["areaSqmMin", "שטח מינימלי"],
    ["features", "מאפיינים"],
    ["entryType", "מועד כניסה"],
    ["entryBy", "תאריך כניסה"],
    ["flexibilityNotes", "הערות הלקוח"],
  ];
  for (const [key, label] of watched) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      out.push(label);
    }
  }
  return out;
}

/* ============================================================
   ההודעה ללקוח
   ============================================================ */

/**
 * נוסח ההודעה שנשלחת עם הקישור.
 *
 * `missedCall` משנה את הפתיחה ולא רק מוסיף לה: „ניסיתי להשיג אותך”
 * מסביר ללקוח למה קיבל הודעה שלא ביקש, ובלעדיו הודעה שמגיעה דקה
 * אחרי שיחה שלא נענתה נקראת כספאם.
 *
 * ‎**הנוסח אינו מניח שהנמען קונה.** מי שהתקשר למשרד תיווך ולא נענה
 * יכול באותה מידה להיות מי שיש לו נכס למכור או להשכיר, ו„כדי שנוכל
 * להציע לכם בדיוק את מה שאתם מחפשים” אמר לו שלא הקשיבו לו — עוד
 * לפני שפתח את הקישור. הטופס עצמו שואל ראשון לאיזה צד הוא שייך,
 * ולכן ההזמנה נשארת פתוחה לשניהם.
 */
export function intakeInviteMessage(input: {
  officeName: string;
  agentName?: string;
  url: string;
  missedCall?: boolean;
}): string {
  const from =
    input.agentName !== undefined && input.agentName !== ""
      ? `${input.agentName} מ${input.officeName}`
      : input.officeName;
  const opening = input.missedCall
    ? `שלום, כאן ${from}. ניסינו להשיג אתכם ולא הצלחנו.`
    : `שלום, כאן ${from}.`;
  return [
    opening,
    "",
    "כדי שנדע איך לעזור — מחפשים נכס או שיש לכם נכס — מלאו בבקשה טופס קצר:",
    input.url,
    "",
    "לוקח דקה, והפרטים נשמרים אצלנו בלבד.",
  ].join("\n");
}
