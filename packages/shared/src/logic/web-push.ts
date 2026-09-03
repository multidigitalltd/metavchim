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
 *
 * ## הכלל שנשבר כאן שלוש פעמים, ומה שומר עליו עכשיו
 *
 * ‎**נתיב שנכתב כאן חייב להתקיים ב-`apps/web/src/app`.** שלוש
 * מהשורות ייצרו 404: `/offers/<id>`, `/matches/<id>` ו-
 * ‎`/collaboration/<id>` — לשלושתם יש מסך רשימה בלבד, ואין
 * ‎`[id]` מתחתיו. שום בדיקה לא ראתה את זה: הטיפוס מסתפק
 * במחרוזת, והפונקציה מחזירה אותה בהצלחה.
 *
 * ‎`scripts/verify-notification-routes.mjs` בודק כל נתיב שהטבלה
 * יכולה לייצר מול עץ הנתיבים של Next, וזה מה שמחליף את ההבטחה
 * שבתיעוד בבדיקה שנכשלת.
 */
const ENTITY_ROUTES: Record<string, (id?: string) => string> = {
  lead: (id) => (id ? `/leads/${id}` : "/leads"),
  buyer: (id) => (id ? `/buyers/${id}` : "/buyers"),
  property: (id) => (id ? `/properties/${id}` : "/properties"),
  // אין `/offers/<id>` — ההצעות מוצגות ברשימה אחת
  offer: () => "/offers",
  appointment: () => "/calendar",
  task: () => "/tasks",
  // אין `/matches/<id>` — ההתאמות מוצגות ברשימה אחת
  match: () => "/matches",
  /*
   * ‎**הצעה שהתקבלה נמצאת בלשונית „הצעות שקיבלתי”, לא בנתיב משלה.**
   * הלשונית נבחרת ב-`?tab=`, וזה מה ש-`TabFromQuery` קורא.
   */
  coop_offer: () => "/collaboration?tab=incoming",
  /*
   * ‎**חדר העסקה — הנתיב שהיה חסר לגמרי.**
   *
   * ‏שלוש התראות נכתבות עם `entityType: "coop_deal"`, ובראשן זו
   * שנשלחת למתווך שהציע ברגע שהצד השני אישר. בלי שורה כאן
   * ‎`notificationUrl` החזירה `"/"`, ו-`formatNotifyMessage`
   * מדלגת על שורת הקישור בדיוק כשהיא `"/"` — כלומר ההודעה
   * בוואטסאפ בישרה שנפתח חדר ולא אמרה איפה הוא (בקשת המשתמש).
   */
  coop_deal: (id) =>
    id ? `/collaboration/deals/${id}` : "/collaboration?tab=deals",
  /*
   * ‎**ביקוש ברשת — אין לו מסך משלו, ולא צריך.**
   *
   * ‏ההתראה היחידה שנושאת אותו היא „נכנס נכס שמתאים לביקוש שאתה
   * עוקב אחריו”, והפעולה שהיא מזמינה — „הצע נכס זה” — יושבת על
   * הכרטיס בלשונית הקונים. לכן היעד הוא הלשונית ולא נתיב לביקוש
   * בודד, שאינו קיים.
   */
  coop_demand: () => "/collaboration?tab=demands",
  /*
   * ‎**הפניית לקוח בין משרדים.** „ההפניה נקלטה” נכתבת עם
   * ‎`shared_lead`, והייתה מסלול במסך ולא כאן — כלומר הלחיצה
   * בפעמון עבדה וההודעה בוואטסאפ נחתה בדשבורד. שתי המפות היו
   * מפוצלות בשני הכיוונים בבת אחת.
   */
  shared_lead: () => "/collaboration?tab=market",
  /*
   * ‎**הישג שבועי — מכוון ‏לא‎ מנותב, כל עוד מסך המנטור מוסתר.**
   *
   * ‏שתי ההתראות שנושאות אותו הובילו ל-`/mentor`, ובנתיב הזה יושב
   * היום „בקרוב” בלבד: המסך הבנוי הועבר ל-`mentor-screen.tsx` ואינו
   * מנותב עד שנסיים לפתח אותו. כלומר המנהל שקיבל „הצוות שלך סגר את
   * השבוע” היה נשלח לעמוד שאין בו ההישג שההתראה מדברת עליו, ואין בו
   * מה לעשות (ביקורת Codex).
   *
   * ‏בלי שורה כאן `notificationUrl` מחזירה `"/"`,
   * ‎`formatNotifyMessage` משמיטה את שורת הקישור, והפעמון נופל למסך
   * ההתראות — היעד היחיד שבו גוף ההתראה כן מוצג במלואו.
   *
   * ‏ביום שמסך המנטור ייחשף צריך להחזיר את שלושתם יחד:
   * ‎`mentor_achievement: () => "/mentor"` כאן,
   * ‎`case "mentor_achievement"` ב-`notification-links.ts`, והסרה
   * מ-`FALLBACK_BY_DESIGN` ב-`scripts/verify-notification-routes.mjs`.
   */
  /*
   * ‎**חיבור המרכזייה — מסך ההגדרות שלו.** המזהה הוא של המשרד ולא
   * של החיבור, ולכן אין כאן פריט בודד לפתוח; מסך החיבורים הוא
   * המקום שבו באמת עושים משהו עם „המרכזייה השתתקה”.
   */
  integration: () => "/settings/integrations",
  /*
   * ‎**שיוך מספרים וירטואליים משולחן הפלטפורמה.** המזהה הוא של
   * המשרד ולא של מספר בודד, ולכן היעד הוא סעיף המספרים במסך
   * ההגדרות — שם מנהל המשרד רואה מה השתנה ויכול לתקן.
   */
  virtual_number: () => "/settings#virtual-numbers",
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
