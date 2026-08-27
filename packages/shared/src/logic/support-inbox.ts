/**
 * תיבת התמיכה של הפלטפורמה — **כתובת שהיא חלק מהמערכת.**
 *
 * שתי תיבות דואר קיימות במערכת הזו, והן פותרות בעיות הפוכות:
 *
 * - **תיבת המשרד** (`email-inbound.ts`) — תשובות של לקוחות למיילים
 *   שהמשרד שלח. כל הודעה נכנסת נושאת טוקן שאנחנו שתלנו בעצמנו,
 *   ולכן תמיד ידוע למי היא שייכת. מי שכותב בלי טוקן פשוט אינו
 *   מוכר, וההודעה נבלעת.
 * - **תיבת התמיכה** (כאן) — פנייה של **מישהו**. הוא יכול להיות
 *   משרד מחובר, מתווך ששוקל להצטרף, או ספק. אין טוקן בפנייה
 *   הראשונה, ואי אפשר לבלוע אותה: זו כל מהותה של כתובת תמיכה.
 *
 * ההבדל הזה קובע את כל השאר: השרשור נקבע לפי הטוקן **אם יש**, ואם
 * אין — לפי כתובת השולח.
 */

/** אורך מרבי לנושא שנשמר. נושא ארוך מזה הוא ספאם או תקלה. */
export const SUPPORT_SUBJECT_MAX = 200;

/**
 * ניקוי הנושא — הסרת קידומות המענה שהדפדפנים מוסיפים.
 *
 * "Re: Re: תשובה: לא עובד לי" הוא אותו שרשור כמו "לא עובד לי", ובלי
 * הניקוי הרשימה נראית כמו שלוש פניות שונות של אותו אדם. הקידומות
 * העבריות והאנגליות גם יחד — לקוח ישראלי מקבל את שתיהן, תלוי בתוכנת
 * הדואר שלו.
 */
export function normalizeSupportSubject(raw: string): string {
  let subject = raw.trim();
  const prefix = /^(?:re|fw|fwd|תשובה|הועבר)\s*(?:\[\d+\])?\s*:\s*/iu;
  // בלולאה: "Re: Fwd: Re:" הוא שרשור אמיתי שראינו בפועל
  while (prefix.test(subject)) subject = subject.replace(prefix, "").trim();
  return subject.slice(0, SUPPORT_SUBJECT_MAX);
}

/**
 * הנושא שיוצג לשרשור שאין בו נושא.
 *
 * מייל בלי נושא הוא מצב נורמלי לגמרי (במיוחד מהנייד), ורשומה עם
 * מחרוזת ריקה נראית ברשימה כמו תקלה.
 */
export function supportSubjectOrDefault(raw: string | undefined): string {
  const subject = normalizeSupportSubject(raw ?? "");
  return subject === "" ? "פנייה ללא נושא" : subject;
}

/**
 * כתובת דואר תקינה מתוך שדה `From` — **השדה הזה הוא קלט עוין.**
 *
 * הוא מגיע בשתי צורות (`"שם" <a@b.c>` או `a@b.c` חשוף), וכל מי
 * שבעולם יכול לכתוב בו מה שירצה. הכתובת משמשת כמפתח שרשור ולכן
 * מנורמלת לאותיות קטנות; כתובת שאינה עוברת את הצורה הבסיסית
 * מוחזרת כ-`null`, ואז הפנייה נפתחת בלי שרשור לפי שולח.
 */
export function parseSenderEmail(from: string): string | null {
  const angled = /<([^<>]+)>/u.exec(from);
  const candidate = (angled?.[1] ?? from).trim().toLowerCase();
  if (candidate.length < 6 || candidate.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/u.test(candidate) ? candidate : null;
}

/**
 * השם שמוצג לפונה — מתוך `From`, ואם אין, החלק שלפני ה-@.
 *
 * "dana" עדיף על "dana@example.com" ברשימה, ושניהם עדיפים על ריק.
 */
export function parseSenderName(from: string, email: string | null): string {
  const named = /^\s*"?([^"<]+?)"?\s*</u.exec(from);
  const name = named?.[1]?.trim();
  if (name !== undefined && name !== "" && !name.includes("@")) return name.slice(0, 120);
  const local = (email ?? "").split("@")[0] ?? "";
  return local === "" ? "פונה לא מזוהה" : local.slice(0, 120);
}

/** מצבי שרשור: פתוח עד שסוגרים אותו במפורש. */
export type SupportThreadStatus = "open" | "closed";

/**
 * מה חוסם שליחת תשובה — הודעה בעברית, או `null`.
 *
 * שרשור שאין לו כתובת שולח תקינה אינו בר-מענה: אין למי לשלוח.
 * הוא עדיין מוצג — הפנייה עצמה כן הגיעה, ומי שקורא אותה יכול
 * לפעול לפיה בדרך אחרת.
 */
export function supportReplyRejectionReason(thread: {
  contactEmail: string | null;
}): string | null {
  if (thread.contactEmail === null || thread.contactEmail === "") {
    return "לפנייה הזו אין כתובת שולח תקינה — אי אפשר להשיב אליה במייל";
  }
  return null;
}
