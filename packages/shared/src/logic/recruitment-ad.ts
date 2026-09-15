/**
 * ‎**צילום מודעה ⟵ נכס לגיוס.**
 *
 * ## מה זה פותר
 *
 * המתווך הולך ברחוב ורואה שלט „למכירה”, או עובר על לוח מודעות
 * ומוצא דירה. עד עכשיו הוא היה מצלם, ואז — אם זכר — יושב מול מחשב
 * וממלא טופס. הפער בין השניים הוא המקום שבו נכסים לגיוס הולכים
 * לאיבוד, וזה הפער היקר ביותר במקצוע.
 *
 * עכשיו הוא שולח את התמונה לסוכן בוואטסאפ, והיא נשמרת כנכס לגיוס
 * עם מה שהמודל הצליח לקרוא ממנה.
 *
 * ## הכלל: חילוץ, לא ניחוש
 *
 * ‎**כל שדה שאינו כתוב בתמונה חוזר `null`.** זה לא סגנון אלא
 * דרישה: נכס לגיוס עם מחיר שהמודל „העריך” הוא שיחה עם בעלים
 * שמתחילה במספר שגוי, ועיר שנוחשה מהרקע שולחת את המתווך לכתובת
 * שאינה קיימת. הפרומפט אומר זאת, והפענוח כאן **אוכף** זאת: ערך
 * לא סביר יורד, ולא „מתוקן”.
 *
 * ## ומה שנקרא ולא נכנס לשדה
 *
 * נשמר כטקסט ב-`notes`. שלט אמיתי נושא דברים שאין להם שדה —
 * „גמיש במחיר”, „כניסה מיידית”, „ללא תיווך” — והם בדיוק מה
 * שהמתווך צריך לפני שהוא מרים טלפון. שדה שלא נקלט אינו סיבה
 * לאבד את מה שכן נכתב.
 */

import { formatIsraeliNumber } from "./israel-time.js";
import { normalizePhone } from "./contact-people.js";
import { DEAL_TYPE_LABELS, PROPERTY_TYPE_LABELS } from "../agent/vocabulary.js";
import type { RecruitmentSource } from "./recruitment.js";

/**
 * ‏המקורות שמודעה מצולמת יכולה להיות. תת-קבוצה של
 * ‎`RECRUITMENT_SOURCES` — „המלצה” ו„שיחה יזומה” אינם דברים
 * ‏שמצלמים.
 */
export const AD_SOURCES = [
  "sign",
  "yad2",
  "madlan",
  "facebook",
  "other",
] as const satisfies readonly RecruitmentSource[];
export type AdSource = (typeof AD_SOURCES)[number];

/** ‏מה שנקרא מהתמונה, אחרי שכל ערך לא סביר ירד. */
export interface RecruitmentAdRead {
  source: AdSource;
  city: string | null;
  neighborhood: string | null;
  street: string | null;
  houseNumber: string | null;
  propertyType: string | null;
  dealType: string | null;
  rooms: number | null;
  areaSqm: number | null;
  floor: number | null;
  totalFloors: number | null;
  priceAgorot: number | null;
  ownerName: string | null;
  ownerPhone: string | null;
  /** ‏מה שנקרא ולא נכנס לשדה — ובכלל, הטקסט שעל השלט. */
  notes: string;
}

/**
 * ‎**גבולות הסבירות.**
 *
 * ‏לא ולידציה של המשתמש אלא הגנה מפני קריאה שגויה של המודל: „3”
 * ‏על שלט יכול להיות חדרים, קומה או מספר בית, ומספר שנקרא מהמקום
 * ‏הלא נכון נכנס לשדה הלא נכון. מה שמחוץ לתחום יורד ל-`null` —
 * ‏המתווך ימלא, ולא יתקן.
 */
const LIMITS = {
  rooms: { min: 1, max: 20 },
  areaSqm: { min: 5, max: 2_000 },
  floor: { min: -2, max: 80 },
  totalFloors: { min: 1, max: 100 },
  /** ‏שקלים. מתחת לזה זה לא מחיר נכס, ומעליו זו קריאה שגויה. */
  priceShekels: { min: 50_000, max: 200_000_000 },
} as const;

/** ‏תקרת האורך של הטקסט החופשי — שלט אינו ספר. */
export const AD_NOTES_MAX = 600;

export const RECRUITMENT_AD_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    source: { type: "string", enum: [...AD_SOURCES] },
    city: { type: "string", nullable: true },
    neighborhood: { type: "string", nullable: true },
    street: { type: "string", nullable: true },
    houseNumber: { type: "string", nullable: true },
    propertyType: {
      type: "string",
      nullable: true,
      enum: Object.keys(PROPERTY_TYPE_LABELS),
    },
    dealType: { type: "string", nullable: true, enum: Object.keys(DEAL_TYPE_LABELS) },
    rooms: { type: "number", nullable: true },
    areaSqm: { type: "number", nullable: true },
    floor: { type: "number", nullable: true },
    totalFloors: { type: "number", nullable: true },
    /** ‏בשקלים — המרה לאגורות נעשית בפענוח, אחרי בדיקת הסבירות. */
    priceShekels: { type: "number", nullable: true },
    ownerName: { type: "string", nullable: true },
    ownerPhone: { type: "string", nullable: true },
    notes: { type: "string" },
  },
  required: ["source", "notes"],
};

/**
 * ‎**ההוראה למודל.**
 *
 * ‏אוצר המונחים נגזר מהקטלוג ולא נכתב כאן מחדש: סוג נכס שקיים
 * ‏במערכת ואינו ברשימה שהמודל רואה פשוט לא ייבחר לעולם, וסוג
 * ‏שנכתב כאן ואינו במערכת ייפסל בפענוח. שתי רשימות היו מסכימות
 * ‏רק ביום שנכתבו.
 */
export function buildRecruitmentAdPrompt(): string {
  const types = Object.entries(PROPERTY_TYPE_LABELS)
    .map(([key, label]) => `${key} (${label})`)
    .join(", ");
  return [
    "אתה קורא תמונה של מודעת נדל\"ן — שלט „למכירה/להשכרה” על בניין, צילום מסך של",
    "מודעה מיד2/מדלן/פייסבוק, או דף מודעות. חלץ אך ורק מה שכתוב בתמונה.",
    "",
    "**כלל ברזל: מה שאינו כתוב בתמונה — החזר null.** אל תשלים, אל תנחש ואל תסיק.",
    "אם המחיר לא מופיע — null. אם העיר לא מופיעה — null, גם אם אתה מזהה את המקום",
    "מהרקע. עדיף שדה ריק על פני שדה שגוי: המתווך מתקשר לבעלים עם מה שכתוב כאן.",
    "",
    `source: מאיזה סוג מודעה זה — sign (שלט פיזי על הנכס), yad2, madlan, facebook, other.`,
    `propertyType: אחד מ: ${types}. אם לא ברור — null.`,
    `dealType: sale (מכירה) או rent (השכרה/להשכיר). אם לא ברור — null.`,
    "priceShekels: המספר בשקלים בלבד. „2.4 מיליון” ⇒ 2400000. אין מחיר ⇒ null.",
    "ownerPhone: מספר הטלפון שעל המודעה, כפי שהוא. אם יש כמה — הראשון.",
    "ownerName: שם שמופיע על המודעה. אם זה שם של משרד תיווך — החזר null.",
    "",
    `notes: כל הטקסט שקראת מהמודעה, בעברית, עד ${AD_NOTES_MAX} תווים. כולל מה שאין לו`,
    "שדה — „גמיש במחיר”, „כניסה מיידית”, „ללא תיווך”, „משופצת”. זה מה שהמתווך קורא",
    "לפני שהוא מרים טלפון.",
  ].join("\n");
}

/** ‏מספר בתוך תחום, או `null`. שבר יורד בשדה שלם. */
function bounded(
  value: unknown,
  range: { min: number; max: number },
  whole: boolean,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = whole ? Math.round(value) : value;
  if (rounded < range.min || rounded > range.max) return null;
  return rounded;
}

/** ‏מחרוזת קצרה ונקייה, או `null` על ריק. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}

/**
 * ‎**פענוח התשובה — והאכיפה של „מה שלא כתוב, לא נכנס”.**
 *
 * ‏מחזירה `null` כשלא נקרא שום דבר בעל ערך: בלי כתובת, בלי טלפון
 * ‏ובלי מחיר, „נכס לגיוס” שנוצר הוא שורה ריקה שמישהו יצטרך למחוק.
 * ‏עדיף לומר למתווך שהתמונה לא נקראה מאשר להעמיס עליו ניקוי.
 */
export function parseRecruitmentAd(raw: unknown): RecruitmentAdRead | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;

  const source = (AD_SOURCES as readonly string[]).includes(String(row["source"]))
    ? (row["source"] as AdSource)
    : "other";
  const propertyType = text(row["propertyType"], 40);
  const dealType = text(row["dealType"], 10);
  const priceShekels = bounded(row["priceShekels"], LIMITS.priceShekels, true);
  const phoneRaw = text(row["ownerPhone"], 30);

  const read: RecruitmentAdRead = {
    source,
    city: text(row["city"], 80),
    neighborhood: text(row["neighborhood"], 80),
    street: text(row["street"], 120),
    houseNumber: text(row["houseNumber"], 12),
    /*
     * ‏הערך נבדק מול הקטלוג ולא מתקבל כלשונו: מודל שמחזיר
     * ‎`"דירה"` במקום `"apartment"` היה כותב למסד ערך שאף מסך
     * ‏אינו יודע להציג.
     */
    propertyType:
      propertyType !== null && propertyType in PROPERTY_TYPE_LABELS ? propertyType : null,
    dealType: dealType !== null && dealType in DEAL_TYPE_LABELS ? dealType : null,
    rooms: bounded(row["rooms"], LIMITS.rooms, false),
    areaSqm: bounded(row["areaSqm"], LIMITS.areaSqm, true),
    floor: bounded(row["floor"], LIMITS.floor, true),
    totalFloors: bounded(row["totalFloors"], LIMITS.totalFloors, true),
    priceAgorot: priceShekels === null ? null : priceShekels * 100,
    ownerName: text(row["ownerName"], 80),
    /*
     * ‎`normalizePhone` ולא אימות: הצורה הישראלית האחידה היא מה
     * ‏שמאפשר לזהות אחר כך שהבעלים הזה כבר קיים אצלנו. מחרוזת
     * ‏שאינה מספר כלל יורדת — „טלפון: ראה מודעה” אינו טלפון.
     */
    ownerPhone: phoneRaw === null ? null : plausiblePhone(phoneRaw),
    notes: text(row["notes"], AD_NOTES_MAX) ?? "",
  };

  return hasSubstance(read) ? read : null;
}

/** ‏מספר ישראלי מנורמל, או `null` כשזה בכלל לא מספר. */
function plausiblePhone(raw: string): string | null {
  const normalized = normalizePhone(raw);
  return /^\+972\d{8,9}$/u.test(normalized) ? normalized : null;
}

/**
 * ‏האם נקרא משהו שאפשר לעבוד איתו.
 *
 * ‏כתובת, טלפון או מחיר — אחד מהשלושה מספיק. בלעדיהם השורה היא
 * ‏„משהו צולם”, וזו אינה משימה אלא רעש.
 */
function hasSubstance(read: RecruitmentAdRead): boolean {
  return (
    read.ownerPhone !== null ||
    read.priceAgorot !== null ||
    read.city !== null ||
    read.street !== null
  );
}

/**
 * ‎**מה שהסוכן עונה אחרי שהתמונה נקראה.**
 *
 * ‏אומר מה **נקלט** ולא „נשמר בהצלחה”: המתווך צריך לדעת בשנייה
 * ‏אחת אם המחיר נקרא נכון, כי הוא זה שיתקשר. רשימה של מה שנכנס
 * ‏עושה את זה; „✓ נשמר” לא.
 */
export function recruitmentAdSummary(read: RecruitmentAdRead, address: string): string {
  const lines: string[] = [`📸 נשמר לנכסים לגיוס: ${address}`];
  const facts: string[] = [];
  if (read.propertyType !== null) {
    facts.push(PROPERTY_TYPE_LABELS[read.propertyType as keyof typeof PROPERTY_TYPE_LABELS]);
  }
  if (read.rooms !== null) facts.push(`${read.rooms} חדרים`);
  if (read.areaSqm !== null) facts.push(`${read.areaSqm} מ"ר`);
  if (read.floor !== null) facts.push(`קומה ${read.floor}`);
  if (facts.length > 0) lines.push(facts.join(" · "));
  if (read.priceAgorot !== null) {
    /*
     * ‎`formatIsraeliNumber` ולא `toLocaleString`: אותו מעצב
     * ‏מספרים של כל המערכת, ובלי תלות באזור הזמן של המכונה.
     */
    lines.push(`מחיר על המודעה: ${formatIsraeliNumber(read.priceAgorot / 100)} ₪`);
  }
  if (read.ownerPhone !== null) {
    lines.push(`טלפון: ${read.ownerPhone}${read.ownerName === null ? "" : ` (${read.ownerName})`}`);
  }
  /*
   * ‎**מה שלא נקרא נאמר במפורש.** „נשמר” בלי הסתייגות על מודעה
   * ‏שהמחיר שלה לא נקרא שולח את המתווך להתקשר בלי המספר שהוא
   * ‏הכי צריך — והוא יגלה את זה רק על הקו.
   */
  const missing = [
    read.ownerPhone === null ? "טלפון" : null,
    read.priceAgorot === null ? "מחיר" : null,
    read.city === null && read.street === null ? "כתובת" : null,
  ].filter((item): item is string => item !== null);
  if (missing.length > 0) lines.push(`לא הצלחתי לקרוא: ${missing.join(", ")} — אפשר להשלים בכרטיס.`);
  return lines.join("\n");
}

/** ‏מה שנאמר כשלא נקרא דבר שאפשר לעבוד איתו. */
export const AD_UNREADABLE_TEXT =
  "קיבלתי את התמונה, אבל לא הצלחתי לקרוא ממנה פרטים של נכס.\n" +
  "אם זו מודעה — כדאי לצלם מקרוב יותר, שהכתובת והטלפון יהיו ברורים. " +
  "אפשר גם פשוט לכתוב לי את הפרטים ואפתח נכס לגיוס.";
