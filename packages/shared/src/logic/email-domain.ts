/* ============================================================
   דומיין אימייל של המשרד
   ============================================================
   כל משרד יכול לחבר את הדומיין שלו ולשלוח מהמערכת אימיילים
   מהכתובת שלו (info@office.co.il) במקום מכתובת הפלטפורמה. האימות
   (DKIM + Return-Path) והשליחה בפועל מנוהלים אצל ספק האימייל
   (Postmark) — המשרד רק מוסיף שתי רשומות DNS אצל ספק הדומיין שלו.

   הלוגיקה כאן ולא בשרת בלבד: המסך צריך את אותן בדיקות בדיוק כדי
   לפסול קלט לפני שליחה, ואת אותם טיפוסים כדי להציג את הרשומות.
   ============================================================ */

/**
 * נרמול דומיין שהוקלד — מה שנשמר ומה שנבדק.
 *
 * המנהל מדביק מה שיש לו ביד: לפעמים כתובת אתר שלמה, לפעמים עם
 * נקודה בסוף (כך DNS מציג), לפעמים באותיות גדולות. הנרמול סולח
 * לכל אלה כדי שהבדיקה שאחריו תיכשל רק על מה שבאמת פסול.
 */
export function normalizeEmailDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//u, "");
  domain = domain.replace(/^www\./u, "");
  // "office.co.il/about" או "info@office.co.il" — נלקח רק הדומיין
  domain = domain.split("/")[0] ?? "";
  const at = domain.lastIndexOf("@");
  if (at >= 0) domain = domain.slice(at + 1);
  domain = domain.replace(/\.$/u, "");
  return domain;
}

/**
 * ספקי תיבות ציבוריים — דומיין שאי אפשר "להביא" כי הוא לא של אף
 * משרד. הרשימה חוסמת גם תתי-דומיין (mail.walla.co.il).
 *
 * החסימה אינה קוסמטית: DKIM על gmail.com לעולם לא יאומת (אין למשרד
 * גישה ל-DNS של Google), והמסך היה נתקע על "ממתין לאימות" לנצח.
 * עדיף לומר את זה ברגע ההקלדה.
 */
export const PUBLIC_MAILBOX_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.co.il",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "walla.co.il",
  "walla.com",
  "nana10.co.il",
  "netvision.net.il",
  "012.net.il",
  "013.net",
  "014.net.il",
  "bezeqint.net",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "mail.ru",
  "yandex.com",
  "yandex.ru",
  "gmx.com",
  "gmx.net",
  "zoho.com",
];

/**
 * הדומיין של המערכת עצמה.
 *
 * חסום לחיבור, אבל **מסיבה אחרת לגמרי** מזו של ספק דואר ציבורי:
 * אין כאן בעיה טכנית אלא בעיה של זהות — משרד אינו שולח בשם
 * המערכת. הפרדה מהרשימה שמעל אינה קוסמטית: מי שהקליד אותו קיבל
 * "זהו דומיין של ספק דואר ציבורי", והמשפט הזה פשוט אינו נכון.
 * מנהל שרואה הודעה שגויה מחפש את התקלה במקום הלא נכון.
 */
export const PLATFORM_DOMAIN = "metavchim.co.il";

function isPublicMailboxDomain(domain: string): boolean {
  return PUBLIC_MAILBOX_DOMAINS.some(
    (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
  );
}

/**
 * תווית DNS תקינה: אותיות לטיניות קטנות, ספרות ומקף, לא בקצוות.
 * ‎xn--‎ (Punycode) עובר מעצמו — דומיין עברי מגיע לכאן אחרי ההמרה
 * שהדפדפן או הרשם כבר עשו.
 */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/**
 * תקינות דומיין **מנורמל** — הודעה בעברית או `null`.
 *
 * הבדיקות מדורגות מהצורה אל המהות: קודם "זה בכלל דומיין", ורק אז
 * "זה דומיין שמותר לחבר". הסדר קובע איזו הודעה המנהל רואה, והודעת
 * "דומיין ציבורי" על קלט שהוא סתם ג'יבריש הייתה מבלבלת.
 */
export function emailDomainRejectionReason(domain: string): string | null {
  if (domain.length < 4 || domain.length > 253) {
    return "כתובת הדומיין אינה תקינה — למשל: office.co.il";
  }
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) {
    return "כתובת הדומיין אינה תקינה — למשל: office.co.il";
  }
  // סיומת של אותיות בלבד פוסלת גם כתובות IP (הסגמנט האחרון מספרי)
  if (!/^[a-z]{2,}$/u.test(labels[labels.length - 1] ?? "")) {
    return "כתובת הדומיין אינה תקינה — למשל: office.co.il";
  }
  if (domain === PLATFORM_DOMAIN || domain.endsWith(`.${PLATFORM_DOMAIN}`)) {
    /*
     * לא "אסור" סתם: מיילים מהכתובת הזו כבר יוצאים ממילא — היא
     * ברירת המחדל של המערכת לכל משרד שלא חיבר דומיין. חיבור שלה
     * כאן אינו מוסיף דבר, ולכן ההודעה אומרת גם מה כן לעשות.
     */
    return "זהו הדומיין של המערכת — מיילים ממנו כבר נשלחים כברירת מחדל. חברו כאן את הדומיין של המשרד שלכם";
  }
  if (isPublicMailboxDomain(domain)) {
    return "זהו דומיין של ספק דואר ציבורי — חברו דומיין שבבעלות המשרד";
  }
  return null;
}

/**
 * כתובת השולח חייבת לשבת על הדומיין המאומת — **בדיוק** עליו.
 *
 * לא תת-דומיין ולא דומיין אחר: חתימת ה-DKIM שהספק מנפיק תקפה
 * לדומיין שאומת, וכתובת על תת-דומיין הייתה יוצאת לא חתומה ונוחתת
 * בספאם — בדיוק מה שהחיבור נועד למנוע.
 */
export function senderAddressRejectionReason(
  email: string,
  domain: string,
): string | null {
  if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+$/u.test(email)) {
    return "כתובת האימייל אינה תקינה";
  }
  const at = email.lastIndexOf("@");
  if (email.slice(at + 1) !== domain) {
    return `כתובת השולח חייבת להיות על הדומיין שחובר — משהו@${domain}`;
  }
  return null;
}

/**
 * שם התצוגה של השולח ("משרד כהן נדל\"ן <info@...>").
 *
 * ירידת שורה או גרשיים בשם הם הדרך הקלאסית להזרקת כותרות מייל —
 * השם נכנס לכותרת From כלשונו. נפסלים כאן ולא מנוקים בשקט: שם
 * שהשתנה מאחורי הגב של מי שהקליד אותו מופיע אחרת אצל הלקוח.
 */
export function senderNameRejectionReason(name: string): string | null {
  if (name.trim().length < 2) return "שם השולח קצר מדי";
  if (name.length > 80) return "שם השולח ארוך מדי (עד 80 תווים)";
  if (/[\r\n"<>]/u.test(name)) {
    return "שם השולח אינו יכול להכיל גרשיים, סוגריים משולשים או ירידת שורה";
  }
  return null;
}

/** הכתובת המלאה כפי שתופיע אצל הנמען. השם כבר עבר את הבדיקה למעלה. */
export function formatSender(name: string, email: string): string {
  return `"${name.trim()}" <${email}>`;
}

/* ============================================================
   מצב האימות ורשומות ה-DNS — הצורה שהמסך מציג
   ============================================================ */

export interface EmailDomainVerification {
  dkimVerified: boolean;
  returnPathVerified: boolean;
}

/**
 * מאומת = **שתי** הרשומות. DKIM לבדו מספיק טכנית לשליחה אצל חלק
 * מהספקים, אבל Return-Path חסר מוריד את ציון המסירה — והמשרד חיבר
 * דומיין בדיוק בשביל המסירה. חצי חיבור אינו מצב שנרצה לברך עליו.
 */
export function emailDomainStatus(
  v: EmailDomainVerification,
): "verified" | "pending" {
  return v.dkimVerified && v.returnPathVerified ? "verified" : "pending";
}

export interface EmailDomainDnsRecord {
  /** dkim | return_path — לזיהוי במסך ובבדיקות, לא לתצוגה. */
  purpose: "dkim" | "return_path";
  type: "TXT" | "CNAME";
  host: string;
  value: string;
  verified: boolean;
}

export interface EmailDomainRecordValues {
  dkimHost: string;
  dkimValue: string;
  returnPathHost: string;
  returnPathValue: string;
}

/**
 * שתי הרשומות כרשימה אחת — שורת טבלה לכל רשומה, עם סטטוס.
 *
 * הסדר קבוע (DKIM ואז Return-Path) כדי שהמסך לא יקפוץ בין
 * רענונים כשאחת מאומתת והשנייה עוד לא.
 */
export function emailDomainDnsRecords(
  values: EmailDomainRecordValues,
  verification: EmailDomainVerification,
): EmailDomainDnsRecord[] {
  return [
    {
      purpose: "dkim",
      type: "TXT",
      host: values.dkimHost,
      value: values.dkimValue,
      verified: verification.dkimVerified,
    },
    {
      purpose: "return_path",
      type: "CNAME",
      host: values.returnPathHost,
      value: values.returnPathValue,
      verified: verification.returnPathVerified,
    },
  ];
}
