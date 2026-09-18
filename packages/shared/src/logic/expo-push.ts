/**
 * התראות פוש לאפליקציה לנייד דרך Expo Push — ההחלטות שאסור שיתפזרו.
 *
 * אותו עיקרון כמו ב-`web-push.ts`: הכללים טהורים ונבדקים, כי טעות
 * בהם שקטה. טוקן מת שלא נמחק נכשל לנצח; טוקן חי שנמחק בגלל תקלה
 * רגעית של Expo משתיק מכשיר שלם עד ההתחברות הבאה.
 */

/**
 * צורת הטוקן ש-Expo מנפיק. נבדקת גם בשרת (קלט מהלקוח) וגם
 * באפליקציה (מה שחזר מהספרייה) — מחרוזת אחרת אינה נרשמת ואינה נשלחת.
 */
const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,120}\]$/u;

export function isExpoPushToken(value: string): boolean {
  return EXPO_PUSH_TOKEN.test(value);
}

/** ‏גודל האצווה המרבי שה-API של Expo מקבל בבקשה אחת. */
export const EXPO_PUSH_BATCH = 100;

export type ExpoPushPlatform = "ios" | "android";

/** ‏כרטיס תשובה על הודעה אחת, כפי ש-Expo מחזיר אותו — רק מה שנקרא. */
export interface ExpoPushTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export type ExpoPushOutcome = "delivered" | "retry" | "retire";

/**
 * מה לעשות עם הטוקן אחרי ניסיון שליחה.
 *
 * - `DeviceNotRegistered` — האפליקציה הוסרה, או שהמשתמש כיבה את
 *   ההתראות ברמת המערכת. הטוקן לא יחזור לחיים; משאירים אותו והוא
 *   נכשל לנצח.
 * - כל שגיאה אחרת (`MessageTooBig`, `MessageRateExceeded`,
 *   `InvalidCredentials`, תקלה רגעית) — **לא** מוחקים: זו בעיה
 *   בהודעה או בתצורה, והטוקן תקין. התקרה על כישלונות רצופים
 *   (`shouldRetireAfterFailure` ב-`web-push.ts`) עוצרת את מי שנתקע.
 */
export function expoPushOutcome(ticket: ExpoPushTicket): ExpoPushOutcome {
  if (ticket.status === "ok") return "delivered";
  return ticket.details?.error === "DeviceNotRegistered" ? "retire" : "retry";
}

/** ההודעה כפי שהיא נשלחת ל-Expo — הצורה שהשירות מצפה לה. */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  /** נתיב יחסי לפתיחה בלחיצה + מזהה קיבוץ — אותו מטען כמו בדפדפן */
  data: { url: string; tag: string };
  sound: "default";
  /** ערוץ ההתראות באנדרואיד; בלעדיו ההתראה אינה מוצגת מ-Android 8 */
  channelId: "default";
  priority: "high";
}

export function expoPushMessage(
  token: string,
  payload: { title: string; body: string; url: string; tag: string },
): ExpoPushMessage {
  return {
    to: token,
    title: payload.title,
    body: payload.body,
    data: { url: payload.url, tag: payload.tag },
    sound: "default",
    channelId: "default",
    priority: "high",
  };
}

/** חלוקה לאצוות בגודל ש-Expo מקבל. */
export function chunkExpoPush<T>(items: readonly T[], size: number = EXPO_PUSH_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
