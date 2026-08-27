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
  })
  .passthrough();

export type InboundEmailPayload = z.infer<typeof InboundEmailPayloadSchema>;

/** אורך הגוף שנשמר. תשובת לקוח אמיתית קצרה; ההגנה היא מפני עותקי ענק. */
export const INBOUND_BODY_MAX = 5000;

/**
 * הגוף שנשמר ומוצג: קודם התשובה החשופה, ואם הספק לא הצליח להפריד —
 * הטקסט המלא. חיתוך קשיח בסוף: הודעה חריגה לא מפילה את הקליטה.
 */
export function inboundBody(payload: InboundEmailPayload): string {
  const preferred = payload.StrippedTextReply.trim();
  const body = preferred !== "" ? preferred : payload.TextBody.trim();
  return body.length > INBOUND_BODY_MAX ? `${body.slice(0, INBOUND_BODY_MAX)}…` : body;
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
 * הטוקן מתוך ה-MailboxHash — עם סובלנות לקלט עוין: הערך מגיע
 * מכותרת שכל שולח בעולם יכול לזייף, ולכן הוא **רק** מפתח חיפוש,
 * לעולם לא תוכן. צורה לא-חוקית ⟵ null, וההודעה מדולגת בשקט.
 */
export function inboundToken(payload: InboundEmailPayload): string | null {
  const hash = payload.MailboxHash.trim();
  return /^[0-9A-Z]{26}$/u.test(hash) ? hash : null;
}

/** כותרת ההודעה לתצוגה — "ללא נושא" במקום מחרוזת ריקה. */
export function inboundSubject(payload: InboundEmailPayload): string {
  const subject = payload.Subject.trim();
  return subject === "" ? "(ללא נושא)" : subject.slice(0, 200);
}
