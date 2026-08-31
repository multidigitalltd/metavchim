import { z } from "zod";

/**
 * דואר נכנס — תשובות של לקוחות למיילים שהמערכת שלחה.
 *
 * ## איך זה עובד, ולמה דווקא כך
 *
 * המערכת **אינה** משתלטת על הדואר של המשרד: רשומת MX על הדומיין
 * הייתה מנתבת אליה את *כל* הדואר של המשרד — כולל מה שמגיע לתיבות
 * Google/Outlook הקיימות שלו — ותקלה אחת הייתה משביתה משרד שלם.
 *
 * במקום זה, כל מייל שהמערכת שולחת ללקוח נושא כתובת Reply-To
 * ייחודית: `local+<token>@inbound...`. הלקוח לוחץ "השב" כרגיל,
 * התשובה מגיעה לספק, הספק דוחף אותה אלינו כ-Webhook, והטוקן —
 * חלק ה-Plus של הכתובת (MailboxHash אצל Postmark) — מזהה חד-ערכית
 * את המשרד ואת הלקוח. בלי DNS, בלי סיכון, עובד גם למשרד בלי דומיין.
 */

/**
 * שדות ה-Webhook הנכנס של Postmark שאנחנו צורכים — והם בלבד.
 *
 * ‏`.passthrough` אין כאן בכוונה הפוכה: הסכמה סובלנית לשדות נוספים
 * (הספק מוסיף שדות בלי גרסה), וקשוחה על מה שאנחנו קוראים.
 */
export const InboundEmailPayloadSchema = z
  .object({
    /** חלק ה-Plus של כתובת היעד — הטוקן שלנו. ריק = לא תשובה שלנו. */
    MailboxHash: z.string().max(200).default(""),
    From: z.string().max(320).default(""),
    FromName: z.string().max(200).default(""),
    Subject: z.string().max(1000).default(""),
    /** גוף ההודעה בלי הציטוט של ההודעה הקודמת — מה שהלקוח באמת כתב. */
    StrippedTextReply: z.string().default(""),
    TextBody: z.string().default(""),
    MessageID: z.string().max(200).default(""),
    /**
     * כותרות ההודעה כפי שהספק מסר אותן.
     *
     * נדרשות מרגע שיש **תיבה כללית**: דומיין שלם מקבל גם מענים
     * אוטומטיים והודעות אי-מסירה, ורק הכותרות מבדילות אותם ממייל
     * של אדם. בלעדיהן כל „מחוץ למשרד” היה פותח פנייה חדשה.
     */
    Headers: z
      .array(
        z
          .object({
            Name: z.string().max(200).default(""),
            Value: z.string().max(2000).default(""),
          })
          .passthrough(),
      )
      .default([]),
    /** קבצים מצורפים — Base64 מהספק. הסינון (סוג, גודל, כמות) בקליטה. */
    Attachments: z
      .array(
        z
          .object({
            Name: z.string().max(500).default(""),
            Content: z.string().default(""),
            ContentType: z.string().max(200).default(""),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export type InboundEmailPayload = z.infer<typeof InboundEmailPayloadSchema>;

/** אורך הגוף שנשמר. תשובת לקוח אמיתית קצרה; ההגנה היא מפני עותקי ענק. */
export const INBOUND_BODY_MAX = 5000;

/**
 * הגוף שנשמר ומוצג: קודם התשובה החשופה, ואם הספק לא הצליח להפריד —
 * הטקסט המלא. חיתוך קשיח בסוף: הודעה חריגה לא מפילה את הקליטה.
 */
export function inboundBody(
  payload: InboundEmailPayload,
  /*
   * ‎**התקרה כפרמטר, כי לא לכל תיבה יש אותה תקרה.**
   *
   * תיבת התמיכה הכריזה על תקרה משלה ואז חתכה **אחרי** הקריאה לכאן,
   * כלומר על טקסט שכבר קוצץ ל-5,000 — התקרה שלה לא התקיימה מעולם,
   * ודוח שגיאה או לוג ארוך איבד עד 15,000 תווים (ביקורת Codex).
   * מי שצריך תקרה אחרת מבקש אותה, ולא חותך פעמיים.
   */
  max: number = INBOUND_BODY_MAX,
): string {
  const preferred = payload.StrippedTextReply.trim();
  const body = preferred !== "" ? preferred : payload.TextBody.trim();
  /*
   * ‎**שלוש הנקודות נספרות בתוך התקרה, לא מעליה.**
   *
   * הניסוח הקודם החזיר `max + 1` תווים. אצל תיבת הלקוחות זה לא
   * התפוצץ במקרה — העמודה היא `VarChar(5100)` והתקרה 5,000, כלומר
   * מאה תווים של מרווח שהסתירו את ההפרש. בתמיכה העמודה היא בדיוק
   * ‎`VarChar(20000)`: פנייה ארוכה **נכשלת בכתיבה**, הוובהוק מחזיר
   * שגיאה, והספק מנסה שוב בלי סוף (ביקורת Codex).
   *
   * ‎`max` הוא הגודל המרבי של מה שנשמר, ולכן הוא כולל את הסימון
   * שהטקסט נחתך.
   */
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}

/**
 * מזהה ההודעה אצל הספק — או `null` כשאין.
 *
 * ‎**„אין מזהה” אינו מזהה.** העמודה ייחודית ומשמשת לדה-דופליקציה,
 * ולכן מחרוזת ריקה שנשמרת כערך אמיתי נתפסת על ידי ההודעה הראשונה
 * שאין לה מזהה — וכל הודעה נוספת בלי מזהה נדחית כ„כפילות”, גם
 * משולח אחר לגמרי. פניות שנעלמות בשקט (ביקורת Codex).
 *
 * הסכמה נותנת `""` כברירת מחדל, ולכן `?? null` **אינו** מספיק:
 * הוא תופס `undefined` ולא מחרוזת ריקה. זו בדיוק ההבחנה שתיבת
 * הלקוחות עושה נכון ותיבת התמיכה החמיצה, ולכן היא כאן — פעם אחת,
 * לשתיהן.
 */
export function inboundProviderMessageId(payload: InboundEmailPayload): string | null {
  const id = payload.MessageID.trim();
  return id === "" ? null : id;
}

/**
 * הרכבת כתובת ה-Reply-To ללקוח: `local+<token>@domain`.
 *
 * `null` כשכתובת הבסיס אינה תקינה — עדיף מייל בלי Reply-To (התשובה
 * תלך לכתובת השולח, כמו היום) מאשר כתובת שבורה שמפילה את השליחה.
 */
export function replyAddressFor(inboundAddress: string, token: string): string | null {
  const at = inboundAddress.indexOf("@");
  if (at <= 0 || at === inboundAddress.length - 1) return null;
  if (!/^[0-9A-Za-z]+$/u.test(token)) return null;
  const local = inboundAddress.slice(0, at);
  const domain = inboundAddress.slice(at + 1);
  // חלק מקומי מוגבל ל-64 תווים בתקן — כתובת ארוכה מזה נדחית אצל נמענים
  if (`${local}+${token}`.length > 64) return null;
  return `${local}+${token}@${domain}`;
}

/**
 * האם הכתובת היא **נתיב קליטה של הספק** ולא תיבה אמיתית.
 *
 * ‏Postmark מייצרת כתובת כמו `abc123@inbound.postmarkapp.com` לקליטה
 * בלבד. היא **אינה חתימת שולח מאומתת**, ולכן הודעה שיוצאת ממנה
 * כ-`From` נדחית על ידי הספק — ובשני הנתיבים שמשתמשים בה החריגה
 * נבלעת, כלומר ההתראה פשוט לא מגיעה ואיש אינו יודע (ביקורת Codex).
 *
 * מי שהגדיר דומיין משלו (`service@metavchim.co.il`) כן יכול לשלוח
 * ממנו, בהנחה שאימת אותו — ולכן הבדיקה היא על הדומיין של הספק ולא
 * על „יש כתובת קליטה”.
 *
 * לשלוח ממנה אי אפשר; **לחזור אליה כן** — וזה בדיוק מה ש-`Reply-To`
 * נועד לו.
 */
export function isProviderInboundRoute(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 0) return false;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return domain === "postmarkapp.com" || domain.endsWith(".postmarkapp.com");
}

/**
 * הטוקן מתוך ה-MailboxHash — עם סובלנות לקלט עוין: הערך מגיע
 * מכותרת שכל שולח בעולם יכול לזייף, ולכן הוא **רק** מפתח חיפוש,
 * לעולם לא תוכן. צורה לא-חוקית ⟵ null, וההודעה מדולגת בשקט.
 */
export function inboundToken(payload: InboundEmailPayload): string | null {
  const hash = payload.MailboxHash.trim();
  return /^[0-9A-Z]{26}$/u.test(hash) ? hash : null;
}

/** כותרות ההודעה בצורה שהלוגיקה המשותפת מצפה לה. */
export function inboundHeaders(
  payload: InboundEmailPayload,
): { name: string; value: string }[] {
  return payload.Headers.map((header) => ({ name: header.Name, value: header.Value }));
}

/**
 * מעטפת השולח (`Return-Path`) מתוך הכותרות, או `undefined`.
 *
 * ‎`undefined` ו-`<>` אינם אותו דבר: הראשון פירושו „הספק לא מסר”
 * והשני „הודעת מערכת”. ערבוב ביניהם היה זורק כל הודעה שהספק לא
 * צירף לה את הכותרת.
 */
export function inboundReturnPath(payload: InboundEmailPayload): string | undefined {
  const header = payload.Headers.find(
    (candidate) => candidate.Name.trim().toLowerCase() === "return-path",
  );
  return header === undefined ? undefined : header.Value;
}

/** כותרת ההודעה לתצוגה — "ללא נושא" במקום מחרוזת ריקה. */
export function inboundSubject(payload: InboundEmailPayload): string {
  const subject = payload.Subject.trim();
  return subject === "" ? "(ללא נושא)" : subject.slice(0, 200);
}

/*
 * ## קבצים מצורפים — הכללים
 *
 * רשימה סגורה של סוגי תוכן, לא רשימה שחורה: הקובץ מגיע מהאינטרנט
 * הפתוח (או מסוכן, שגם הוא אדם), והשרת יגיש אותו בחזרה לדפדפנים
 * של המשרד. מה שאינו ברשימה — מדולג ונרשם, לא נשמר. במפורש בחוץ:
 * HTML/SVG (סקריפטים שרצים בהגשה), וכל קובץ הרצה.
 */
export const EMAIL_ATTACHMENT_TYPES: Readonly<Record<string, "image" | "video" | "file">> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "application/pdf": "file",
  "application/msword": "file",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "file",
  "application/vnd.ms-excel": "file",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "file",
  "application/vnd.ms-powerpoint": "file",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "file",
  "text/plain": "file",
  "text/csv": "file",
};

/**
 * גודל מרבי לקובץ נכנס. תקרת ההודעה כולה אצל ספקי הדואר היא
 * ‎25–35MB ממילא — הגבול כאן שומר עלינו, לא על הלקוח.
 */
export const EMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** קבצים לכל הודעה — נכנסת ויוצאת. מעבר לזה נשמרים הראשונים. */
export const EMAIL_ATTACHMENT_MAX_COUNT = 10;

/**
 * סך הקבצים בתשובה **יוצאת**. Postmark מגביל הודעה יוצאת ל-10MB
 * כולל קידוד Base64 (שמנפח פי 4/3) — ‏7MB גולמי משאיר מקום לגוף.
 */
export const EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES = 7 * 1024 * 1024;

/** בייתים בפתיחת הקובץ תואמים לחתימה, החל מהיסט נתון. */
function bytesAt(content: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (content.length < offset + signature.length) return false;
  return signature.every((byte, i) => content[offset + i] === byte);
}

/**
 * האם התוכן עצמו פותח בחתימה (Magic Bytes) של הסוג המוצהר. מוגבל
 * במכוון לתמונות ווידאו — הסוגים שמרונדרים inline בדפדפן; מסמכים
 * מוגשים כהורדה ממילא ואין להם מה להרוויח כאן.
 */
function matchesMagicBytes(mime: string, content: Uint8Array): boolean {
  switch (mime) {
    case "image/jpeg":
      return bytesAt(content, 0, [0xff, 0xd8, 0xff]);
    case "image/png":
      return bytesAt(content, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      // RIFF....WEBP
      return bytesAt(content, 0, [0x52, 0x49, 0x46, 0x46]) &&
        bytesAt(content, 8, [0x57, 0x45, 0x42, 0x50]);
    case "image/gif":
      // GIF8
      return bytesAt(content, 0, [0x47, 0x49, 0x46, 0x38]);
    case "video/mp4":
    case "video/quicktime":
      // תיבת ftyp בהיסט 4 — משותפת ל-MP4 ול-MOV
      return bytesAt(content, 4, [0x66, 0x74, 0x79, 0x70]);
    case "video/webm":
      // כותרת EBML
      return bytesAt(content, 0, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return false;
  }
}

/**
 * נרמול סוג תוכן מוצהר אל הרשימה הסגורה. `null` = לא נשמר.
 * הפרמטרים שאחרי `;` (charset וכו') אינם חלק מההכרעה.
 *
 * כשהתוכן עצמו נמסר, ההצהרה נבדקת מולו: קובץ שמוצהר כתמונה או וידאו
 * אך אינו פותח בחתימה המתאימה יורד ל-`"file"` — נשמר ומוגש כהורדה
 * בלבד, לא מרונדר inline. ההצהרה מגיעה מהשולח והיא אינה גבול אמון;
 * זה אותו עיקרון שכבר חל על העלאות מאומתות (media/tenant-logo).
 */
export function emailAttachmentKind(
  contentType: string,
  content?: Uint8Array,
): "image" | "video" | "file" | null {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const kind = EMAIL_ATTACHMENT_TYPES[normalized] ?? null;
  if (kind === null || content === undefined) return kind;
  if ((kind === "image" || kind === "video") && !matchesMagicBytes(normalized, content)) {
    return "file";
  }
  return kind;
}

/**
 * שם קובץ בטוח לתצוגה ולכותרת ההורדה: בלי תווי שליטה, בלי מפרידי
 * נתיב, ובאורך שפוי. השם מגיע מהשולח — הוא תוכן, לא נתיב.
 */
export function safeAttachmentName(name: string): string {
  // בלי Regex של תווי בקרה — no-control-regex; סינון לפי קוד התו
  const cleaned = [...name]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c !== '"' && c !== "\\" && c !== "/")
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  const bounded = cleaned.length > 120 ? cleaned.slice(-120) : cleaned;
  return bounded === "" ? "קובץ" : bounded;
}
