/**
 * אנשי הקשר של לקוח אחד.
 *
 * בעסקת נדל"ן ישראלית ממוצעת יש יותר מאדם אחד בצד הלקוח: בעל ואישה
 * שקונים יחד, בן שמטפל עבור ההורים, מיופה כוח. עד כה כרטיס הצביע על
 * איש קשר יחיד, ולכן המתווך רשם את השני בשדה הערות — ומהודעת וואטסאפ
 * שהגיעה מהנייד של האישה נפתח ליד חדש כאילו היא זרה.
 *
 * המבנה: הכרטיס ממשיך להצביע על **איש קשר ראשי אחד**, ולצידו אנשים
 * מקושרים עם תפקיד, וטלפונים נוספים לכל אדם. הבחירה הזו מכוונת —
 * הפיכת הקשר לרב-ערכי בכל מודול הייתה נוגעת בכל המערכת בבת אחת,
 * כולל בזיהוי הכפילויות ובהצפנת ה-PII.
 */

/** תפקיד האדם המקושר ביחס לאיש הקשר הראשי בכרטיס. */
export const CONTACT_ROLES = [
  "spouse",
  "partner",
  "parent",
  "child",
  "attorney",
  "other",
] as const;

export type ContactRole = (typeof CONTACT_ROLES)[number];

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  spouse: "בן/בת זוג",
  partner: "שותף",
  parent: "הורה",
  child: "בן/בת",
  attorney: "מיופה כוח",
  other: "איש קשר נוסף",
};

export function isContactRole(value: string): value is ContactRole {
  return (CONTACT_ROLES as readonly string[]).includes(value);
}

/** תווית לטלפון — מתווך רוצה לדעת לאן הוא מתקשר. */
export const PHONE_LABELS = ["mobile", "home", "work", "other"] as const;
export type PhoneLabel = (typeof PHONE_LABELS)[number];

export const PHONE_LABEL_TEXT: Record<PhoneLabel, string> = {
  mobile: "נייד",
  home: "בית",
  work: "עבודה",
  other: "נוסף",
};

export function isPhoneLabel(value: string): value is PhoneLabel {
  return (PHONE_LABELS as readonly string[]).includes(value);
}

/**
 * נרמול טלפון ל-E.164 ישראלי.
 *
 * ישב עד כה בשני עותקים זהים בשני בקרים שונים. עכשיו יש לו שימוש
 * שלישי (הוספת טלפון לאיש קשר), והעתק שלישי היה מבטיח שיום אחד אחד
 * מהם יתוקן והשניים האחרים לא — כשהתוצאה היא ששני מספרים של אותו
 * אדם מקבלים hash שונה והוא נספר כשני לקוחות.
 *
 * הפונקציה מנרמלת בלבד ואינה מאמתת: הוולידציה נשארת ב-PhoneSchema,
 * כדי שקלט פגום ייפסל בהודעה ברורה ולא יהפוך בשקט למחרוזת אחרת.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/gu, "");
  if (digits.startsWith("+972")) return digits;
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return digits;
}

export interface ContactPerson {
  contactId: string;
  name: string;
  phone: string;
  /**
   * אימייל של האדם הזה, לא של הכרטיס.
   *
   * לבן/בת זוג יש תיבה משלהם, ולעיתים קרובות דווקא היא זו שקוראת את
   * ההצעות. כל אדם מקושר הוא רשומת contact בזכות עצמו, ולכן האימייל
   * יושב עליו — וסנכרון ה-Gmail מתאים הודעה נכנסת ממנו לכרטיס הנכון
   * דרך אותה חתימת emailHash.
   */
  email?: string;
  /** null = איש הקשר הראשי של הכרטיס. */
  role: ContactRole | null;
}

/**
 * נרמול אימייל לפני השוואה וחתימה.
 *
 * רווח נגרר וכתיב באותיות גדולות הם אותה תיבה לכל דבר; בלי נרמול
 * אחיד, אותו אדם היה מקבל שתי חתימות שונות ונספר כשני לקוחות —
 * בדיוק התקלה שהטלפונים כבר פתרו.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * סדר התצוגה: הראשי תמיד ראשון, והשאר לפי סדר ההוספה.
 *
 * זה לא קישוט — המתווך מתקשר לראשון ברשימה. אם הסדר משתנה בין
 * טעינות, הוא יתקשר לאדם אחר ממה שהתכוון.
 */
export function orderPeople(people: readonly ContactPerson[]): ContactPerson[] {
  const primary = people.filter((p) => p.role === null);
  const rest = people.filter((p) => p.role !== null);
  return [...primary, ...rest];
}

