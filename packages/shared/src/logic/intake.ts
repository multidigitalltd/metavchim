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

/** אל מי הבקשה מצביעה. ליד וקונה — שני הכרטיסים שיש בהם דרישות. */
export type IntakeSubject = "lead" | "buyer";

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
    "כדי שנוכל להציע לכם בדיוק את מה שאתם מחפשים, מלאו בבקשה טופס קצר:",
    input.url,
    "",
    "לוקח דקה, והפרטים נשמרים אצלנו בלבד.",
  ].join("\n");
}
