/**
 * ‎**נכסים לגיוס — מה שהמתווך רודף אחריו, ולא מה שיש לו.**
 *
 * ## ‏מה זה
 *
 * ‏מודעה שראה ביד2, שלט על מרפסת, טיפ משכן. הנכס **אינו שלו**: הוא
 * מתקשר לבעלים ומנסה לקבל את הייצוג. זה חצי מהעבודה של מתווך, ועד
 * היום הוא ניהל אותה באקסל או בראש.
 *
 * ## ‏למה טבלה נפרדת ולא „עוד סטטוס” על נכס
 *
 * ‏זו ההכרעה המרכזית כאן, והיא נלמדה מבאג שתוקן ממש לפני כן: נכס
 * שנמכר המשיך להופיע בהתאמות, כי הכלל „לא מציעים אותו” נאכף בכתיבה
 * והונח בקריאה. סטטוס חדש שחייב להיות מוחרג מ**כל** מסלול קריאה —
 * התאמות, רשת שיתופי הפעולה, הצעות לקונים, דפי הנחיתה, רשימת
 * הנכסים — יידלף באחד מהם ביום שייכתב מסלול חדש ששכח.
 *
 * ‏וכאן הדליפה חמורה יותר מ„נמכר”: הצעת נכס שהמשרד **אינו מייצג**
 * לקונה היא הבטחה שאין מאחוריה דבר, ומול בעלים שלא חתם — חשיפה של
 * ממש.
 *
 * ‏שורה בטבלה אחרת אינה יכולה לדלוף לשאילתה על טבלה אחרת. ההפרדה
 * היא מבנית, לא משמעתית.
 *
 * ## ‏מה כן משותף
 *
 * ‏שדות הנכס עצמם (`PropertyFieldsSchema`) — עיר, חדרים, מחיר, סוג.
 * הטופס נראה זהה כי הוא **אותם שדות**, וההמרה מעתיקה אותם אחד לאחד.
 */

/**
 * ‏משפך הגיוס — מהמודעה שנראתה ועד החתימה.
 *
 * ‏שלושת השלבים האמצעיים הם מה שהמתווך אמר בבקשה („קיבל שיחה”,
 * ‏„אמר שיחזיר תשובה”, „גויס”), והשאר משלים אותם למשפך שאפשר לעבוד
 * לפיו: אי אפשר לנהל רשימה שבה „לא גויס” ו„עוד לא ניסיתי” הם אותו
 * דבר.
 */
export const RECRUITMENT_STATUSES = [
  "new",
  "called",
  "awaiting_reply",
  "meeting_set",
  "recruited",
  "declined",
  "lost",
] as const;
export type RecruitmentStatus = (typeof RECRUITMENT_STATUSES)[number];

/** שמות השלבים בעברית — **המקור היחיד**, למסך ולסינון ולדוח. */
export const RECRUITMENT_STATUS_LABELS: Record<RecruitmentStatus, string> = {
  new: "חדש",
  called: "קיבל שיחה",
  awaiting_reply: "אמר שיחזיר תשובה",
  meeting_set: "נקבעה פגישה",
  recruited: "גויס",
  declined: "סירב",
  lost: "נסגר אצל אחר",
};

/**
 * ‏השלבים שעדיין דורשים עבודה.
 *
 * „גויס” יצא מכאן לא פחות מ„סירב”: אחרי הגיוס הנכס עובר להיות נכס
 * רגיל, והשורה כאן היא תיעוד של איך הוא הגיע — לא משימה פתוחה.
 */
export const OPEN_RECRUITMENT_STATUSES: readonly RecruitmentStatus[] = [
  "new",
  "called",
  "awaiting_reply",
  "meeting_set",
];

export function isOpenRecruitment(status: string): boolean {
  return (OPEN_RECRUITMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * ‎**רק „גויס” נהפך לנכס.**
 *
 * ‏הבדיקה חיה כאן ולא ב-API כדי שהמסך יסכים איתו: כפתור „המר לנכס
 * שלי” שמופיע על שורה שסורבה, ואז נדחה בשרת, הוא מסך ששיקר.
 */
export function canConvertToProperty(status: string): boolean {
  return status === "recruited";
}

/**
 * ‏מאיפה הנכס הגיע.
 *
 * ‏רשימה סגורה ולא טקסט חופשי: „יד2” ו„יד 2” ו-„yad2” הם אותו מקור,
 * ובטקסט חופשי הם שלוש שורות בכל דוח שיישאל „מאיפה מגיעים הגיוסים
 * שלנו”. זו השאלה שהרשימה הזאת קיימת כדי לענות עליה.
 */
export const RECRUITMENT_SOURCES = [
  "yad2",
  "madlan",
  "facebook",
  "sign",
  "referral",
  "cold_call",
  "other",
] as const;
export type RecruitmentSource = (typeof RECRUITMENT_SOURCES)[number];

export const RECRUITMENT_SOURCE_LABELS: Record<RecruitmentSource, string> = {
  yad2: "יד2",
  madlan: "מדלן",
  facebook: "פייסבוק",
  sign: "שלט על הנכס",
  referral: "המלצה",
  cold_call: "שיחה יזומה",
  other: "אחר",
};

/** תווית למקור שהגיע כמחרוזת — מה-DTO, שאינו נושא את הטיפוס. */
export function recruitmentSourceLabel(source: string): string {
  return RECRUITMENT_SOURCE_LABELS[source as RecruitmentSource] ?? source;
}

/** תווית לשלב שהגיע כמחרוזת. */
export function recruitmentStatusLabel(status: string): string {
  return RECRUITMENT_STATUS_LABELS[status as RecruitmentStatus] ?? status;
}

/*
 * ‏`URL` הוא גלובל גם ב-Node וגם בדפדפן — אבל ה-`lib` של החבילה הוא
 * ‎`ES2023` בלבד, **במכוון**: הוא הגדר שמונע מקוד משותף להגיע
 * ל-`document` או ל-`fs` ולהישבר בצד השני. הצהרה נקודתית על שתי
 * התכונות שנקראות כאן שומרת על הגדר, במקום לפתוח את DOM לכל הקובץ.
 */
declare const URL: {
  new (input: string): { protocol: string; hostname: string };
};

/**
 * ‎**קישור למודעה המקורית — http/https בלבד.**
 *
 * ## ‏למה זו בדיקה ולא שדה טקסט
 *
 * ‏הקישור נשמר כדי להיות **נלחץ** מתוך המערכת. `javascript:` שנשמר
 * בשדה כזה ונרנדר כ-`href` הוא הרצת קוד בדפדפן של כל מי שלוחץ —
 * והתוקף הוא כל מי שיכול להזין שורה. `data:` מגיש מסמך שנשלט על
 * ידי המזין תחת המקור של המערכת.
 *
 * ‏שתי הסכמות מותרות ותו לא. `mailto:` ו-`tel:` אינם מודעה, ולכן
 * גם הם יוצאים — לא מטעמי אבטחה אלא כי הם אינם מה שהשדה מתאר.
 */
export function isValidSourceUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  if (trimmed.length > 2000) return false;
  /*
   * ‎**רשימת היתר, ולא רשימת איסור.** הבדיקה דורשת שהמחרוזת *תתחיל*
   * ב-`http://` או `https://` — ולכן כל מה שאינו זה נדחה, בלי תלות
   * בפינות של מנתח כתובות. חסימה של `javascript:` לבדה הייתה משאירה
   * את `\njavascript:`, `java\tscript:` וכל וריאציה שדפדפן כלשהו
   * מנקה לפני שהוא מריץ.
   */
  const scheme = trimmed.slice(0, 8).toLowerCase();
  if (!scheme.startsWith("http://") && !scheme.startsWith("https://")) return false;
  try {
    new URL(trimmed);
  } catch {
    return false;
  }
  return true;
}

/**
 * ‏שם האתר להצגה לצד הקישור — „yad2.co.il”, לא הכתובת המלאה.
 *
 * ‏כתובת מודעה ביד2 היא מאה תווים של מזהים; שורה בטבלה שמציגה אותה
 * במלואה דוחקת את כל השאר. `null` כשהקישור אינו תקין — הקורא לא
 * יציג קישור שבור.
 */
export function sourceUrlHost(raw: string): string | null {
  if (!isValidSourceUrl(raw)) return null;
  const host = new URL(raw.trim()).hostname;
  return host.startsWith("www.") ? host.slice(4) : host;
}
