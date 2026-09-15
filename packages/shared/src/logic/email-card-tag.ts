/**
 * ‎**איזה כרטיס ההודעה עוסקת בו — כשזה ידוע, ורק אז.**
 *
 * ## ‏מה חסר בתיבה
 *
 * ‏התיבה מסודרת לפי **אדם**, וזה נכון: אותו לקוח שולח „אפשר לתאם
 * ‏ביקור?” אחרי הצעה, „יש טעות בסכום” אחרי הסכם, ו„מילאתי את
 * ‏הטופס” אחרי קישור קליטה. כולן שיחה אחת עם אדם אחד, וסידור לפי
 * ‏כרטיס היה מפצל אותה לשלושה חוטים שאיש לא קורא.
 *
 * ‏אבל **ההודעה הבודדת** כן שייכת למשהו. „יש טעות בסכום” בלי לדעת
 * ‏על איזה הסכם היא — או „אפשר לתאם ביקור” בלי לדעת על איזו הצעה —
 * ‏מחייבת את הסוכן לפתוח את הכרטיס ולנחש לפי תאריכים.
 *
 * ## ‏למה זה לא נגזר, אלא נשמר
 *
 * ‏הדרך המתבקשת היא לנחש: לחפש את ההצעה האחרונה של אותו לקוח,
 * ‏או את ההסכם הפתוח שלו. ניחוש כזה **נכון לרוב** — וזו בדיוק
 * ‏הבעיה: תיוג שגוי שנראה סמכותי גרוע מהיעדר תיוג, כי הסוכן פועל
 * ‏לפיו. לקוח עם שתי הצעות פתוחות היה מקבל את השגויה.
 *
 * ‏לכן התיוג נכתב **רק במקום שבו הוא עובדה**: השליחה שיצאה מכרטיס
 * ‏יודעת מאיזה, והתשובה עליה יורשת אותו דרך טוקן ה-Reply-To שהונפק
 * ‏עבורה. מייל נכנס שאינו תשובה לדבר — אין לו תג, וזו התשובה
 * ‏הנכונה עליו.
 */

/** ‏הכרטיסים שאליהם הודעה יכולה להיות משויכת. */
export const EMAIL_CARD_KINDS = ["buyer", "lead", "property"] as const;

export type EmailCardKind = (typeof EMAIL_CARD_KINDS)[number];

/** ‏תג ההודעה — סוג הכרטיס ומזההו. */
export interface EmailCardTag {
  kind: EmailCardKind;
  id: string;
}

const LABELS: Record<EmailCardKind, string> = {
  buyer: "קונה",
  lead: "ליד",
  property: "נכס",
};

const ROUTES: Record<EmailCardKind, string> = {
  buyer: "/buyers",
  lead: "/leads",
  property: "/properties",
};

/** ‏שם הכרטיס בעברית, לתג שנקרא בעין. */
export function emailCardLabel(kind: EmailCardKind): string {
  return LABELS[kind];
}

/**
 * ‏הנתיב לכרטיס.
 *
 * ‏התג הוא **קישור** ולא תווית: „ליד” לבדו אומר לסוכן שיש כרטיס
 * ‏ולא איך להגיע אליו, וחיפוש ידני הוא בדיוק העבודה שהתג נועד
 * ‏לחסוך.
 */
export function emailCardHref(tag: EmailCardTag): string {
  return `${ROUTES[tag.kind]}/${tag.id}`;
}

/** ‏האם המחרוזת היא סוג כרטיס מוכר — לקריאה משורה שנשמרה. */
export function isEmailCardKind(value: string | null | undefined): value is EmailCardKind {
  return typeof value === "string" && (EMAIL_CARD_KINDS as readonly string[]).includes(value);
}

/**
 * ‏התג מתוך זוג עמודות, או `null`.
 *
 * ‎**שתי העמודות הן עובדה אחת, ולכן חצי תג אינו תג.** שורה עם סוג
 * ‏בלי מזהה (או להפך) היא שורה פגומה — קישור אל `/buyers/null` הוא
 * ‏מסך שגיאה שהסוכן לוחץ עליו, וגרוע מתא ריק.
 */
export function emailCardTag(
  kind: string | null | undefined,
  id: string | null | undefined,
): EmailCardTag | null {
  if (!isEmailCardKind(kind)) return null;
  if (typeof id !== "string" || id === "") return null;
  return { kind, id };
}
