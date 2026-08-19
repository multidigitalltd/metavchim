/**
 * התראות פוש בדפדפן — ההחלטות שאסור שיתפזרו.
 *
 * הפוש נשען על אותן שורות `notifications` שכבר נכתבות במערכת, ולכן
 * שלוש שאלות חוזרות בכל התראה: האם בכלל דוחפים אותה, לאן היא מקשרת,
 * ומה עושים כשהדפדפן עונה בשגיאה. שלושתן פונקציות טהורות כאן — לא
 * כי זה יפה יותר, אלא כי טעות בהן שקטה: פוש שלא נשלח לא מתלונן,
 * ומנוי מת שלא נמחק ממשיך להיכשל לנצח.
 */

/** התראה כפי שהיא נשמרת — רק השדות שהפוש צריך. */
export interface PushableNotification {
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** נתיב יחסי לפתיחה בלחיצה. */
  url: string;
  /**
   * מזהה קיבוץ. שתי התראות עם אותו tag מחליפות זו את זו בשורת
   * ההתראות במקום להיערם — סוכן שקיבל שבע התראות "ליד חדש" בזמן
   * שהיה בפגישה צריך לראות אחת, לא שבע.
   */
  tag: string;
}

/**
 * התראות שאין טעם לדחוף.
 *
 * דו"ח הבוקר והסיכום השבועי נשלחים בשעה קבועה לכל המשתמשים והם
 * סיכום, לא אירוע — פוש עליהם הוא בדיוק סוג הרעש שגורם למשתמש
 * לכבות את ההרשאה, ואז גם ההתראות שכן דחופות לא מגיעות.
 */
const NO_PUSH_TYPES = new Set(["daily_brief", "weekly_summary"]);

export function shouldPush(notification: PushableNotification): boolean {
  return !NO_PUSH_TYPES.has(notification.type);
}

/**
 * לאן מקשרת התראה — לפי הישות שאליה היא מצביעה.
 *
 * פונקציה לכל ישות ולא תבנית ‎`base/id`‎ אחידה: לא כל מסך מציג
 * פריט בנתיב משלו. שיחה נבחרת בתוך רשימת השיחות ולכן היא פרמטר
 * בכתובת, ותבנית אחידה הייתה מייצרת `/calls/<id>` — נתיב שאינו
 * קיים, כלומר בדיוק הכתובת השבורה שהפונקציה למטה מבטיחה למנוע.
 */
const ENTITY_ROUTES: Record<string, (id?: string) => string> = {
  lead: (id) => (id ? `/leads/${id}` : "/leads"),
  buyer: (id) => (id ? `/buyers/${id}` : "/buyers"),
  property: (id) => (id ? `/properties/${id}` : "/properties"),
  offer: (id) => (id ? `/offers/${id}` : "/offers"),
  appointment: () => "/calendar",
  task: () => "/tasks",
  match: (id) => (id ? `/matches/${id}` : "/matches"),
  coop_offer: (id) => (id ? `/collaboration/${id}` : "/collaboration"),
  call: (id) => (id ? `/calls?call=${id}` : "/calls"),
};

/**
 * נתיב היעד. ישות מוכרת עם מזהה → הכרטיס עצמו; ישות מוכרת בלי מזהה →
 * הרשימה; לא מוכרת → הדשבורד. אף פעם לא כתובת שבורה: לחיצה על התראה
 * שנוחתת על 404 גרועה מהתראה שלא נשלחה.
 */
export function notificationUrl(notification: PushableNotification): string {
  const route = notification.entityType
    ? ENTITY_ROUTES[notification.entityType]
    : undefined;
  if (!route) return "/";
  return route(notification.entityId ?? undefined);
}

export function pushPayload(notification: PushableNotification): PushPayload {
  return {
    title: notification.title,
    body: notification.body ?? "",
    url: notificationUrl(notification),
    // קיבוץ לפי סוג *וישות*: שתי התראות על אותו ליד מתמזגות, אבל
    // "ליד חדש" משני לידים שונים נשארות שתיים
    tag: notification.entityId
      ? `${notification.type}:${notification.entityId}`
      : notification.type,
  };
}

/* ---------- טיפול בתשובת שרת הפוש ---------- */

export type PushOutcome = "delivered" | "retry" | "retire";

/**
 * מה לעשות עם המנוי אחרי ניסיון שליחה.
 *
 * ההבחנה הקריטית היא בין "המנוי מת" ל"עכשיו לא הצליח":
 * - 404/410 — הדפדפן ביטל את המנוי (המשתמש ניקה נתונים, הסיר את
 *   האפליקציה). המנוי לא יחזור לחיים; משאירים אותו והוא נכשל לנצח.
 * - 401/403 — מפתחות VAPID לא תואמים. **לא** מוחקים: זו תקלת
 *   תצורה בשרת, והמנויים תקינים. מחיקה כאן הייתה מוחקת את כל
 *   המנויים במערכת בגלל מפתח שהוחלף בטעות.
 * - 429 ו-5xx — עומס או תקלה זמנית אצל ספק הפוש; מנסים שוב.
 */
export function pushOutcome(statusCode: number): PushOutcome {
  if (statusCode >= 200 && statusCode < 300) return "delivered";
  if (statusCode === 404 || statusCode === 410) return "retire";
  if (statusCode === 429 || statusCode >= 500) return "retry";
  // 400 ושאר שגיאות הלקוח: בקשה פגומה. לא מוחקים מנוי בגלל באג שלנו.
  return "retry";
}

/**
 * כמה כישלונות רצופים לפני שמוותרים על מנוי שממשיך להחזיר שגיאה
 * זמנית. בלי תקרה, מנוי שנתקע מייצר ניסיון חוזר בכל סריקה לתמיד.
 */
export const MAX_PUSH_FAILURES = 10;

export function shouldRetireAfterFailure(failureCount: number): boolean {
  return failureCount >= MAX_PUSH_FAILURES;
}
