/**
 * „יש לי נכס” — הצד השני של אותו טופס.
 *
 * ## מה זה פותר
 *
 * הטופס נשלח אחרי **שיחה נכנסת שלא נענתה**, ומי שהתקשר לא בהכרח
 * מחפש דירה. חצי מהשיחות למשרד תיווך הן של מי שיש לו נכס למכור או
 * להשכיר — והם קיבלו „כדי שנוכל להציע לכם בדיוק את מה שאתם מחפשים,
 * מלאו טופס”. במקרה הטוב הם התעלמו; במקרה הרע הבינו שהמשרד לא הקשיב.
 *
 * ## למה זה לא „עוד שדות” באותו טופס
 *
 * התוצר שונה. קונה מייצר **דרישות** שממוזגות לכרטיס קונה ונסרקות מול
 * המאגר; מוכר מייצר **נכס**. שני מסלולים שנראים דומים בטופס ואינם
 * דומים בכלום מאחוריו — ולכן ההפרדה כאן ולא ב-`if` בתוך המיזוג.
 *
 * ## למה הכול רשות מלבד שלושה
 *
 * אותו נימוק כמו בצד הקונה: מי שאינו יודע את השטח המדויק ימציא
 * מספר, ומספר שהומצא גרוע משדה ריק — הוא נראה כמו עובדה. הנדרשים
 * הם רק אלה שבלעדיהם לסוכן אין למה לחזור: סוג העסקה והעיר. (ובקישור
 * פתוח גם שם וטלפון, שבלעדיהם אין את מי לשייך.)
 */

import { normalizePhone } from "./contact-people.js";

/**
 * לאיזה צד של העסקה הטופס נענה.
 *
 * נשמר על שורת הבקשה ולא נגזר מהתשובות: הקישור נפתח שוב אחרי
 * השליחה — הלקוח מתקן משהו — והעמוד חייב לדעת לאיזה מסלול לחזור
 * בלי לנחש לפי אילו שדות מלאים.
 */
export const INTAKE_SIDES = ["buyer", "seller"] as const;
export type IntakeSide = (typeof INTAKE_SIDES)[number];

export function isIntakeSide(value: unknown): value is IntakeSide {
  return (INTAKE_SIDES as readonly unknown[]).includes(value);
}

/** אורך ההערה החופשית של המוכר. */
export const INTAKE_SELLER_NOTES_MAX = 1000;

/** מאפיין שהמוכר מסמן — אותם חמישה של צד הקונה, אבל כן/לא ולא „חובה”. */
export const INTAKE_SELLER_FEATURES = [
  "hasElevator",
  "hasParking",
  "hasBalcony",
  "hasSafeRoom",
  "hasStorage",
] as const;
export type IntakeSellerFeature = (typeof INTAKE_SELLER_FEATURES)[number];

export const INTAKE_SELLER_FEATURE_LABEL: Record<IntakeSellerFeature, string> = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: "ממ״ד",
  hasStorage: "מחסן",
};

/**
 * מה המוכר שלח.
 *
 * `dealType` כאן הוא „מוכר או משכיר”, בדיוק אותם שני ערכים של הנכס
 * עצמו — ולכן הוא עובר לטיוטה כמו שהוא ולא דרך תרגום.
 */
export interface IntakeSellerAnswers {
  /** בקישור פתוח בלבד — כמו בצד הקונה. */
  fullName?: string;
  phone?: string;
  dealType?: "sale" | "rent";
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  priceAgorot?: number;
  /** „המחיר גמיש” — מה שהמוכר עצמו אמר, ולא הערכה של הסוכן. */
  priceFlexible?: boolean;
  features?: Partial<Record<IntakeSellerFeature, boolean>>;
  entryType?: "immediate" | "from_date" | "flexible";
  /** ‏`YYYY-MM-DD`, ורלוונטי ל-`from_date` בלבד. */
  entryDate?: string;
  notes?: string;
}

/** מה שנדרש כדי לפתוח כרטיס לאדם שאינו במאגר. */
export const INTAKE_SELLER_NAME_MIN = 2;
export const INTAKE_SELLER_NAME_MAX = 80;

/**
 * מה חסר — או `null` כשאפשר לשמור.
 *
 * מחזירה **משפט ולא `false`**: את הטופס קורא אדם שאינו מתווך,
 * ו„שגיאה” בלי הסבר היא סיבה לסגור את העמוד.
 *
 * `needsIdentity` נקבע בשרת ולא בטופס: הוא זה שיודע אם לבקשה כבר יש
 * איש קשר. טופס שמבקש שם ומספר מלקוח שהמשרד כבר מכיר מזמין גרסה
 * שנייה של אותו אדם.
 */
export function intakeSellerRejectionReason(
  answers: IntakeSellerAnswers,
  options: { needsIdentity: boolean },
): string | null {
  if (options.needsIdentity) {
    const name = (answers.fullName ?? "").trim();
    if (name.length < INTAKE_SELLER_NAME_MIN) return "נא למלא שם מלא";
    if (name.length > INTAKE_SELLER_NAME_MAX) return "השם ארוך מדי";
    /*
     * הבדיקה על הצורה המנורמלת ולא על מה שהוקלד: ‎050-123-4567‎
     * ו-‎+972 50 123 4567‎ הם אותו מספר, ודחייה של אחד מהם נראית
     * ללקוח כתקלה במערכת.
     */
    const phone = normalizePhone(answers.phone ?? "");
    if (phone === "") return "נא למלא מספר טלפון";
    if (!/^\+972[2-9]\d{7,8}$/u.test(phone)) return "מספר הטלפון אינו תקין";
  }

  if (answers.dealType === undefined) return "נא לבחור מכירה או השכרה";
  if ((answers.city ?? "").trim() === "") return "נא למלא את העיר";

  /*
   * „מ-תאריך” בלי תאריך אינו מועד כניסה אלא שדה חצי-מלא, והוא היה
   * נשמר על הנכס כאילו הוא תשובה. שאר המצבים אינם נושאים תאריך
   * מלכתחילה.
   */
  if (answers.entryType === "from_date" && (answers.entryDate ?? "") === "") {
    return "נא למלא מתי הנכס יהיה פנוי";
  }

  const notes = answers.notes ?? "";
  if (notes.length > INTAKE_SELLER_NOTES_MAX) return "ההערה ארוכה מדי";
  return null;
}

/** צורת השדות שכרטיס הנכס מקבל. רופף בכוונה — הסכימה נאכפת בשרת. */
export type PropertyFieldsLike = Record<string, unknown>;

/**
 * התשובות → שדות הנכס.
 *
 * **מה שלא נענה אינו נכתב.** שדה שנשלח ריק אינו „אפס” ואינו „לא”:
 * מוכר שלא ידע באיזו קומה הדירה משאיר את השדה חסר, והסוכן רואה
 * „חסר” ולא „קומה 0”. זו גם הסיבה שהמאפיינים נכתבים רק כשסומנו
 * במפורש — `false` כאן פירושו „אין”, ו-`undefined` פירושו „לא נשאל”.
 *
 * הסטטוס אינו נקבע כאן: **טיוטה** הוא ברירת המחדל של הטבלה, וזה מה
 * שנכון — נכס שהגיע מטופס של לקוח לא נבדק על ידי איש, ופרסום שלו
 * כפעיל היה הופך טעות הקלדה של לקוח למודעה חיה.
 */
export function sellerPropertyFields(
  answers: IntakeSellerAnswers,
): PropertyFieldsLike {
  const fields: PropertyFieldsLike = {};

  const text = (value: string | undefined): string | undefined => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? undefined : trimmed;
  };
  const put = (key: string, value: unknown): void => {
    if (value !== undefined) fields[key] = value;
  };

  put("dealType", answers.dealType);
  put("city", text(answers.city));
  put("neighborhood", text(answers.neighborhood));
  put("street", text(answers.street));
  put("houseNumber", text(answers.houseNumber));
  put("propertyType", text(answers.propertyType));
  put("rooms", finite(answers.rooms));
  put("areaSqm", finite(answers.areaSqm));
  put("floor", finite(answers.floor));
  put("totalFloors", finite(answers.totalFloors));
  put("priceAgorot", finite(answers.priceAgorot));
  put("priceFlexible", answers.priceFlexible);

  for (const key of INTAKE_SELLER_FEATURES) {
    const value = answers.features?.[key];
    if (value !== undefined) fields[key] = value;
  }

  if (answers.entryType !== undefined) {
    fields["entryType"] = answers.entryType;
    /*
     * תאריך נלווה ל-`from_date` בלבד. „מיידי” ו„גמיש” שנושאים
     * תאריך מבחירה קודמת היו ממשיכים להשתתף בהתאמה בשם המוכר —
     * אחרי שהוא עצמו אמר שאין מועד.
     */
    if (answers.entryType === "from_date" && text(answers.entryDate) !== undefined) {
      fields["entryDate"] = answers.entryDate;
    }
  }

  return fields;
}

function finite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * אגורות → שקלים עם מפריד אלפים.
 *
 * ההפרדה נעשית ביד ולא ב-`toLocaleString`: הכלל `israel-time/device-clock`
 * פוסל את שם המתודה בלי חריג לטיפוס הנמען (ראו התיעוד שלו), והמחיר
 * הזה נקרא בגוף משימה — הוא לא צריך לוקאל, הוא צריך פסיקים.
 */
function shekels(agorot: number): string {
  const whole = String(Math.round(agorot / 100));
  return whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

/**
 * מה המוכר אמר, בשורות שאדם קורא — לגוף המשימה ולהתראה.
 *
 * הסוכן צריך לדעת **על מה מדובר** לפני שהוא פותח את הכרטיס: „לקוח
 * מילא טופס” שולח אותו לחפש, ושתי שורות של כתובת ומחיר עונות לו
 * מיד אם זה דחוף.
 *
 * מה שלא נענה אינו מופיע כ„לא ידוע”: רשימה שחציה „—” קשה לקריאה
 * יותר מרשימה קצרה.
 */
export function sellerSummaryLines(answers: IntakeSellerAnswers): string[] {
  const out: string[] = [];

  out.push(answers.dealType === "rent" ? "להשכרה" : "למכירה");

  const address = [
    (answers.street ?? "").trim(),
    (answers.houseNumber ?? "").trim(),
  ]
    .filter((part) => part !== "")
    .join(" ");
  const place = [address, (answers.neighborhood ?? "").trim(), (answers.city ?? "").trim()]
    .filter((part) => part !== "")
    .join(", ");
  if (place !== "") out.push(place);

  const spec: string[] = [];
  if (answers.rooms !== undefined) spec.push(`${answers.rooms} חדרים`);
  if (answers.areaSqm !== undefined) spec.push(`${answers.areaSqm} מ״ר`);
  if (answers.floor !== undefined) spec.push(`קומה ${answers.floor}`);
  if (spec.length > 0) out.push(spec.join(" · "));

  if (answers.priceAgorot !== undefined) {
    out.push(
      `מחיר מבוקש: ${shekels(answers.priceAgorot)} ₪${
        answers.priceFlexible === true ? " (גמיש)" : ""
      }`,
    );
  }

  const marked = INTAKE_SELLER_FEATURES.filter(
    (key) => answers.features?.[key] === true,
  ).map((key) => INTAKE_SELLER_FEATURE_LABEL[key]);
  if (marked.length > 0) out.push(marked.join(", "));

  if (answers.entryType !== undefined) {
    const label =
      answers.entryType === "immediate"
        ? "כניסה מיידית"
        : answers.entryType === "from_date"
          ? `פנוי מ-${answers.entryDate ?? ""}`
          : "מועד כניסה גמיש";
    out.push(label);
  }

  const notes = (answers.notes ?? "").trim();
  if (notes !== "") out.push(notes);

  return out;
}
