/**
 * דלת אחת לכל הדואר של הדומיין — והכרעה בקוד, לא בכתובת.
 *
 * ## מה השתנה
 *
 * עד כה היו שתי כתובות קליטה נפרדות, כל אחת עם שרת, סוד ו-Webhook
 * משלה: אחת לתשובות לקוחות של המשרדים, ואחת לתמיכה. הניתוב נעשה
 * **על ידי השולח** — לפי הכתובת שאליה כתב. זה עובד רק כל עוד
 * מכירים מראש את כל הכתובות.
 *
 * הדרישה היא הפוכה: *כל* כתובת בדומיין, גם כזו שלא קיימת ולא
 * הוגדרה מעולם (`info@`, `noa@`, שגיאת הקלדה של לקוח), צריכה להגיע
 * לתמיכה. כלומר אין יותר "רשימת כתובות", ולכן אין יותר מה שינתב —
 * וההכרעה עוברת לכאן.
 *
 * ## מה מכריע
 *
 * ‎**הטוקן, ולא הכתובת.** שני הזרמים כבר נוחתים על אותה כתובת
 * בסיס ונבדלים רק ב-`+token` שאנחנו עצמנו שתלנו ב-`Reply-To`:
 *
 * | מה הגיע | לאן |
 * |---|---|
 * | טוקן של שרשור תמיכה | המשך אותו שרשור |
 * | טוקן של תשובת לקוח | תיבת המשרד |
 * | כל השאר — בלי טוקן, טוקן לא מוכר, כתובת שלא קיימת | **פנייה חדשה לתמיכה** |
 *
 * השורה האחרונה היא כל העניין: מה שהיה נזרק כ"לא מוכר" הוא בדיוק
 * הפנייה הראשונה של מי שכותב אלינו בפעם הראשונה.
 */

/** לאן הודעה נכנסת הולכת. */
export type InboundDestination =
  | { kind: "support_thread" }
  | { kind: "tenant_reply" }
  | { kind: "support_new" }
  | { kind: "drop"; reason: string };

/**
 * ההכרעה עצמה, בהינתן מה שנמצא במסד.
 *
 * הפונקציה מקבלת את תוצאות החיפוש ולא מבצעת אותן — כך כלל
 * הקדימות נבדק בלי מסד, והוא **כלל אחד** ולא תנאי שנכתב מחדש בכל
 * קורא.
 */
export function inboundDestination(input: {
  /** נמצא שרשור תמיכה עם הטוקן הזה. */
  supportThread: boolean;
  /** נמצא טוקן תשובה של משרד. */
  tenantToken: boolean;
}): InboundDestination {
  /*
   * ‎**טוקן שנמצא בשני המקומות נזרק ואינו מנוחש.**
   *
   * שני מרחבי הטוקנים הם ULID מטבלאות נפרדות, ולכן התנגשות היא
   * כמעט בלתי אפשרית — אבל "כמעט" הוא לא "לא", והמחיר של ניחוש
   * אינו סימטרי: תשובה פרטית של לקוח שנוחתת על שולחן התמיכה היא
   * דליפה, והודעת תמיכה שנוחתת בתיבת משרד היא בלבול. אין כאן
   * ברירה נכונה, ולכן אין ניחוש — יש שורת יומן ואדם.
   */
  if (input.supportThread && input.tenantToken) {
    return { kind: "drop", reason: "טוקן שמוכר גם כשרשור תמיכה וגם כתשובת לקוח" };
  }
  if (input.supportThread) return { kind: "support_thread" };
  if (input.tenantToken) return { kind: "tenant_reply" };
  /*
   * ‎**וזו השורה שהופכת את התיבה לתיבה כללית.** קודם היא הייתה
   * `return` שקט: טוקן שלא נמצא פירושו "לא בשבילנו". עכשיו היא
   * ההפך — מי שכתב לכתובת כלשהי בדומיין ולא ענה לשום דבר הוא מי
   * שפונה אלינו לראשונה.
   */
  return { kind: "support_new" };
}

/**
 * כותרות שמסמנות הודעה שנוצרה **על ידי מכונה** ולא על ידי אדם.
 *
 * ‎`Auto-Submitted` הוא התקן (RFC 3834) ו-`X-Auto*` הם מה שמוצרים
 * ותיקים שולחים בפועל. `Precedence` נבדק על ערכיו החריגים בלבד —
 * ‎`bulk` לבדו הוא רשימת דיוור, וזו כן יכולה להיות פנייה.
 */
const AUTO_HEADERS: { name: string; matches: (value: string) => boolean }[] = [
  {
    name: "auto-submitted",
    // ‎`auto-generated` / `auto-replied`; `no` פירושו מפורשות "אדם"
    matches: (value) => value !== "" && value !== "no",
  },
  { name: "x-autoreply", matches: () => true },
  { name: "x-autorespond", matches: () => true },
  { name: "x-auto-response-suppress", matches: () => true },
  { name: "precedence", matches: (value) => value === "auto_reply" },
  { name: "x-failed-recipients", matches: () => true },
];

/** נושאים של הודעות מערכת — כשאין כותרת שתעיד. */
const AUTO_SUBJECTS =
  /^(?:automatic reply|out of office|autoreply|auto:|undeliverable|delivery status notification|mail delivery|returned mail|failure notice|הודעה אוטומטית|מחוץ למשרד)/iu;

/**
 * למה ההודעה הזאת **לא** תפתח פנייה — או `null` כשהיא כן.
 *
 * ## למה זה נדרש דווקא עכשיו
 *
 * תיבה כללית על דומיין שלם מקבלת הרבה יותר ממה שאדם שלח: תשובות
 * "מחוץ למשרד", הודעות אי-מסירה על מייל שאנחנו שלחנו, ואישורי
 * קריאה. כל אחת מהן הייתה פותחת פנייה חדשה עם מספר משלה, ומי
 * שפותח בבוקר את השולחן מוצא עשרות פניות שאיש לא כתב — ובתוכן
 * נבלעות האמיתיות.
 *
 * ‎**וגרוע מזה: לולאה.** מענה אוטומטי לתשובה שלנו, שפותח פנייה,
 * שמקבלת תשובה, שמפעילה מענה אוטומטי. הבדיקה הזאת היא מה שעוצר
 * אותה בצעד הראשון.
 *
 * ‎`Return-Path: <>` הוא הסימן החד-משמעי להודעת מערכת: התקן דורש
 * מעטפה ריקה בדיוק כדי שלא יהיה למי להשיב, ולכן הודעה כזו לעולם
 * אינה פנייה של אדם.
 */
export function autoReplyReason(input: {
  subject: string;
  /** כותרות ההודעה כפי שהספק מסר אותן. */
  headers: { name: string; value: string }[];
  /** מעטפת השולח. `<>` ריק = הודעת מערכת. */
  returnPath?: string | undefined;
  /** כתובת השולח לתצוגה. */
  fromEmail?: string | undefined;
}): string | null {
  // מעטפה ריקה בלבד. `undefined` פירושו "הספק לא מסר", לא "ריקה".
  if ((input.returnPath ?? "").trim() === "<>") {
    return "מעטפת שולח ריקה — הודעת מערכת";
  }

  for (const header of input.headers) {
    const name = header.name.trim().toLowerCase();
    const value = header.value.trim().toLowerCase();
    const rule = AUTO_HEADERS.find((candidate) => candidate.name === name);
    if (rule !== undefined && rule.matches(value)) {
      return `כותרת ${header.name} מסמנת הודעה אוטומטית`;
    }
  }

  if (AUTO_SUBJECTS.test(input.subject.trim())) {
    return "נושא של מענה אוטומטי או הודעת אי-מסירה";
  }

  /*
   * שולחים שהם תמיד מכונה. הרשימה קצרה ומכוונת: `noreply` הוא
   * המוסכמה, ו-`mailer-daemon`/`postmaster` הם הודעות המסירה של
   * שרתי הדואר עצמם.
   */
  const local = (input.fromEmail ?? "").split("@")[0]?.trim().toLowerCase() ?? "";
  if (local === "mailer-daemon" || local === "postmaster") {
    return "הודעת מסירה משרת דואר";
  }
  if (/^(?:no-?reply|do-?not-?reply)$/u.test(local)) {
    return "שולח שאינו מקבל תשובות";
  }

  return null;
}

/**
 * מספר הפנייה כפי שאדם קורא אותו.
 *
 * מספר רץ אחד לשני המקורות — הכפתור במערכת והדואר — כי מבחינת מי
 * שמטפל זו תור אחד. "פנייה 1042" נאמרת בטלפון, נדבקת בנושא של
 * המייל, ומחפשים אותה. ULID אינו נאמר בטלפון.
 */
export function formatSupportReference(reference: number | null | undefined): string {
  return typeof reference === "number" && Number.isInteger(reference) && reference > 0
    ? `#${reference}`
    : "—";
}

/**
 * המספר בתוך נושא ההודעה, כדי שתשובה תמצא את דרכה גם בלי הטוקן.
 *
 * לקוח שכותב מייל **חדש** במקום להשיב מאבד את ה-`+token`, ואז
 * הפנייה שלו נפתחת מחדש כפנייה נוספת. המספר בנושא הוא רשת הביטחון
 * לזה, והוא גם מה שהופך את המספר לשימושי — הוא חוזר אלינו מעצמו.
 */
export function subjectWithReference(subject: string, reference: number): string {
  const tag = `[${formatSupportReference(reference)}]`;
  return subject.includes(tag) ? subject : `${tag} ${subject}`.slice(0, 200);
}

/** המספר מתוך נושא, או `null` — הקלט הוא טקסט של שולח, ולכן רק רמז. */
export function referenceFromSubject(subject: string): number | null {
  const match = /\[#(\d{1,9})\]/u.exec(subject);
  if (match === null) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
