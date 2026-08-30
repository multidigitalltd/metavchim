/**
 * ‎**שמות המשתנים בתבניות המאושרות של Meta — במקום אחד.**
 *
 * ## למה זה קיים
 *
 * Meta עברה ל**משתנים בעלי שם**: עורך התבניות דוחה `{{1}}` בהודעה
 * „פרמטרים של משתנים חייבים להיות אותיות קטנות, קווים תחתונים
 * ומספרים”. בצד השליחה זה אינו שינוי קוסמטי — תבנית עם משתנים
 * בעלי שם דורשת ש**כל ערך יישא את שם המשתנה שלו** (`parameter_name`),
 * ומשלוח מיקומי אליה נדחה. כלומר השם שנרשם ב-WhatsApp Manager והשם
 * שבקוד הם אותו דבר, וסטייה ביניהם משביתה את השליחה בשקט.
 *
 * ולכן הם יושבים כאן, ליד עצמם, ולא מפוזרים בארבעה שירותים.
 *
 * ## הכללים של Meta ששני הצדדים כפופים להם
 *
 * - שם משתנה: אותיות קטנות באנגלית, ספרות וקו תחתון בלבד.
 * - ערך משתנה **אינו יכול להכיל ירידת שורה, טאב או רצף רווחים** —
 *   הודעה כזו נדחית כולה. לכן `flatten` כאן, ולא באחד הקוראים:
 *   נוסח התזכורת לסיור נכתב על ידי המשרד בתיבת טקסט רב-שורתית.
 */

/** ערך אחד לשליחה, כפי ש-Meta מצפה לו בגוף התבנית. */
export interface WhatsAppTemplateParam {
  readonly type: "text";
  readonly parameter_name: string;
  readonly text: string;
}

/**
 * רכיב הכפתור, כשהתבנית מוגדרת עם **כתובת דינמית**.
 *
 * ‎`index: "0"` — הכפתור הראשון והיחיד. שלא כמו גוף ההודעה, ערך של
 * כפתור כתובת נשאר **מיקומי** גם בתבנית עם משתנים בעלי שם, ואינו
 * נושא `parameter_name`.
 */
export interface WhatsAppTemplateButton {
  readonly type: "button";
  readonly sub_type: "url";
  readonly index: "0";
  readonly parameters: readonly [{ readonly type: "text"; readonly text: string }];
}

/**
 * ‎**התבניות שהמערכת שולחת, ושמות המשתנים של כל אחת.**
 *
 * הסדר כאן הוא הסדר שבו הקוראים מעבירים ערכים, והטיפוס למטה כופה
 * שהכמות תתאים. שינוי שם כאן מחייב שינוי מקביל ב-WhatsApp Manager —
 * אין דרך שהקוד יגלה זאת לבדו, ולכן העורך במסך הפלטפורמה מציג את
 * אותם שמות בדיוק.
 */
export const WHATSAPP_TEMPLATE_PARAMS = {
  /** התראה יזומה למתווך: כותרת ופירוט */
  notify: ["update_title", "update_details"],
  /*
   * ‎**ללקוח שהתקשר ולא נענה: שם המשרד, ואז הקישור.**
   *
   * שם המשרד ראשון כי הוא מה שפותח את ההודעה. הנמען התקשר למשרד
   * **מסוים** וההודעה מגיעה אליו ממספר שאינו מוכר לו — בלי השם הוא
   * אינו יודע למי הוא עונה, ואין בהודעה שום סימן לעסקה שהוא צד לה.
   * זה גם מה שדוחף את Meta לסווג אותה כדיוור.
   *
   * ‎**צורה אחת ולא שתיים, בניגוד לתזכורת לסיור.** שם נשמר גם החוזה
   * הישן, כי מאחורי השם השמור עמדה תבנית שכבר אושרה. כאן בעל המוצר
   * מסר שהתבנית **טרם הוגשה** — אין מה לשמר, והוספת מתג הייתה
   * מוסיפה דבר להגדיר לא נכון. וגם אילו הייתה תבנית ישנה: הכישלון
   * כאן רך — ההודעה המוכנה חוזרת בגוף ההתראה לסוכן, שישלח בעצמו.
   */
  intake: ["office_name", "form_link"],
  /**
   * תזכורת לפני סיור, **בנוסח אחד** — כפי שנרשמה עד היום.
   *
   * זה החוזה של תבנית שכבר אושרה ב-Meta, ולכן הוא נשאר. ראו
   * ‎`viewingReminderFields` מתחת: השדות הם ההמשך, לא ההחלפה.
   */
  viewingReminder: ["reminder_text"],
  /*
   * ‎**אותה תזכורת, בשדות — וזו תבנית אחרת אצל Meta.**
   *
   * ‎`reminder_text` הוא כל טקסט התזכורת שהמשרד ניסח, ושתי בעיות
   * נובעות מזה — שתיהן אצל Meta ולא אצלנו:
   *
   * 1. ‎**סיווג.** תבנית שגופה משתנה יחיד אינה ניתנת לקריאה, ו-Meta
   *    מסווגת מה שהיא אינה מבינה כ-Marketing. תזכורת לפגישה היא
   *    ‎Utility מובהקת — אבל רק אם רואים שזו תזכורת לפגישה.
   * 2. ‎**מדיניות.** נוסח חופשי שנכתב במסך ההגדרות עובר דרך תבנית
   *    שאושרה כשירותית, כלומר מה שאושר אינו מה שנשלח.
   *
   * ‎**ולמה לא פשוט להחליף.** שם התבנית שמור בהגדרות, ומאחוריו
   * תבנית שכבר אושרה עם משתנה אחד. שליחת חמישה שמות אחרים לאותה
   * תבנית נדחית אצל Meta — ובערוץ „שניהם” המייל מצליח, `deliver`
   * מחזיר `true`, ולא נפתחת משימה לסוכן. כלומר התזכורת בוואטסאפ
   * מפסיקה לצאת **בלי שאיש יידע** (ביקורת Codex, P1). לכן זו
   * הגדרה מפורשת שאומרת איזו תבנית נרשמה, וברירת המחדל היא הישנה.
   *
   * המחיר במעבר: הנוסח שהמשרד ניסח נשלח **במייל** כלשונו,
   * ובוואטסאפ יוצאים השדות.
   */
  viewingReminderFields: [
    "customer_name",
    "visit_date",
    "visit_time",
    "visit_address",
    "office_name",
  ],
  /** לסוכן, „לקוח ענה במייל”: שם הלקוח בלבד */
  emailReply: ["customer_name"],
} as const satisfies Record<string, readonly string[]>;

export type WhatsAppTemplateRole = keyof typeof WHATSAPP_TEMPLATE_PARAMS;

/**
 * ‏`readonly ["a", "b"]` ⟵ `readonly [string, string]` — הכמות נכפית בהידור.
 *
 * דרך פרמטר טיפוס חשוף ולא דרך `keyof MAP[R]` ישירות: רק כך המיפוי
 * הומומורפי ושומר על צורת הטופל. הכתיבה הישירה מייצרת אובייקט עם
 * ‎`length: string`, כלומר טיפוס שאף מערך אינו עומד בו.
 */
type SameLength<T extends readonly unknown[]> = { readonly [K in keyof T]: string };
type Values<R extends WhatsAppTemplateRole> = SameLength<(typeof WHATSAPP_TEMPLATE_PARAMS)[R]>;

/**
 * ‎**גבול שמרני לערך יחיד.**
 *
 * גוף תבנית מוגבל ל-1024 תווים, וחריגה פוסלת את ההודעה **כולה** —
 * לא מקצרת אותה. תזכורת ארוכה שנחתכה מגיעה; תזכורת שנדחתה אינה.
 */
const MAX_PARAM = 900;

/**
 * ‏ניקוי שערך יחיד חייב לעבור: שורה אחת, בלי רצף רווחים, ובאורך
 * שאינו פוסל את ההודעה. ריק הופך לרווח יחיד — Meta דוחה ערך ריק.
 */
function flatten(text: string): string {
  const cleaned = text.replace(/\s+/gu, " ").trim();
  if (cleaned === "") return " ";
  return cleaned.length > MAX_PARAM ? `${cleaned.slice(0, MAX_PARAM - 1)}…` : cleaned;
}

/**
 * הערכים של תבנית אחת, כשכל אחד נושא את שם המשתנה שלו.
 *
 * הטיפוס דורש בדיוק את מספר הערכים של אותה תבנית — ערך שנשכח הוא
 * שגיאת הידור ולא הודעה שנדחית אצל הלקוח.
 */
export function whatsappTemplateParams<R extends WhatsAppTemplateRole>(
  role: R,
  values: Values<R>,
): readonly WhatsAppTemplateParam[] {
  const names: readonly string[] = WHATSAPP_TEMPLATE_PARAMS[role];
  return names.map((name, index) => ({
    type: "text" as const,
    parameter_name: name,
    text: flatten((values as readonly string[])[index] ?? ""),
  }));
}

/* ==================== כפתור „פתח במערכת” ==================== */

/**
 * ‎**היעד כשאין יעד יחיד.** הודעה שמאגדת שלושה עדכונים אינה מצביעה
 * על כרטיס אחד, וכתובת ריקה פוסלת את ההודעה. מסך ההתראות מציג את
 * כולם, ולכן הוא הנחיתה הנכונה — לא הדשבורד ולא הראשון מבין השלושה.
 */
const FALLBACK_SUFFIX = "notifications";

/**
 * הסיפא שנדבקת לכתובת הבסיס של כפתור דינמי.
 *
 * ## מה נשאר בחוץ, ולמה
 *
 * ‎**מחרוזת שאילתה נגזרת.** `/calls?call=<id>` היא כתובת תקינה
 * לחלוטין בדפדפן, אבל כאן היא נמסרת ל-Meta כערך שנדבק לבסיס, ואין
 * לנו דרך לאמת מראש שהיא תתקבל שם. הודעת תבנית שנדחית **אינה
 * נמסרת כלל** — כלומר התראת השיחה, השכיחה מכולן, הייתה נעלמת
 * בשקט. הנחיתה על רשימת השיחות פחות מדויקת בקליק אחד, ותמיד
 * מגיעה. ‎`#` יורד מאותה סיבה.
 *
 * הכתובת המלאה מתקבלת גם היא: מה שנשאר אחרי המקור הוא הנתיב.
 */
export function whatsappDeepLinkSuffix(urlOrPath: string, origin?: string): string {
  let rest = urlOrPath.trim();
  if (origin !== undefined && origin !== "" && rest.startsWith(origin)) {
    rest = rest.slice(origin.length);
  }
  // כתובת מלאה ממקור אחר — לא נוגעים בה כסיפא; אין לה מקום מתחת לבסיס שלנו
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(rest)) return FALLBACK_SUFFIX;
  const path = rest.split(/[?#]/u)[0] ?? "";
  const trimmed = path.replace(/^\/+/u, "").replace(/\s+/gu, "");
  return trimmed === "" ? FALLBACK_SUFFIX : trimmed;
}

/**
 * הכפתור עצמו. `null` כשאין מה לפתוח — כפתור אינו נשלח ריק, וקורא
 * שמצרף אותו בכל זאת שולח הודעה שתידחה.
 */
export function whatsappTemplateButton(suffix: string): WhatsAppTemplateButton | null {
  const text = suffix.trim();
  if (text === "") return null;
  return {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text }],
  };
}

/* ============ תשובה מהירה בתזכורת לסיור ============ */

/**
 * רכיב כפתור „תשובה מהירה” בתבנית.
 *
 * ‎**המטען נקבע לכל הודעה בנפרד**, ולא בהגדרת התבנית — וזה מה
 * שמאפשר לדעת על **איזה** סיור נלחץ. בלעדיו הלחיצה חוזרת בלי
 * הקשר, ותזכורת לשני סיורים באותו יום אינה ניתנת להבחנה.
 */
export interface WhatsAppTemplateQuickReply {
  readonly type: "button";
  readonly sub_type: "quick_reply";
  readonly index: string;
  readonly parameters: readonly [{ readonly type: "payload"; readonly payload: string }];
}

/** מה הלקוח אמר בלחיצה. סגור בכוונה — מטען חופשי אינו תשובה. */
export type ViewingReminderReply = "confirmed" | "reschedule";

const REPLY_PREFIX = "vr";

/**
 * ‎**סדר הכפתורים אצל Meta הוא חלק מהחוזה, ואין דרך שהקוד יאמת
 * אותו.**
 *
 * ‏המטען נשלח לפי **אינדקס**: מה שנשלח באינדקס 0 חוזר כשנלחץ
 * הכפתור הראשון שנרשם. אם בעל הפלטפורמה ירשום את „צריך לשנות
 * מועד” ראשון, לחיצה עליו תחזיר „אישר” — היפוך שקט של המשמעות,
 * ושום בדיקה כאן אינה יכולה לתפוס אותו.
 *
 * לכן הסדר מוצהר כאן במפורש, והוא מה שמסך ההגדרות ומסמך הרישום
 * חייבים לשקף: **ראשון אישור, שני שינוי מועד.**
 */
export const VIEWING_REMINDER_REPLY_ORDER: readonly ViewingReminderReply[] = [
  "confirmed",
  "reschedule",
];

/** ‎`vr:<מזהה הסיור>:<תשובה>` — התחילית מוודאת שאנחנו מפענחים רק שלנו. */
export function viewingReminderReplyPayload(
  appointmentId: string,
  reply: ViewingReminderReply,
): string {
  return [REPLY_PREFIX, appointmentId, reply].join(":");
}

/**
 * רכיבי שני הכפתורים לסיור אחד, לפי הסדר המוצהר למעלה.
 *
 * ‎`index` הוא מחרוזת ולא מספר — כך Meta מצפה לו.
 */
export function viewingReminderQuickReplies(
  appointmentId: string,
): readonly WhatsAppTemplateQuickReply[] {
  return VIEWING_REMINDER_REPLY_ORDER.map((reply, index) => ({
    type: "button" as const,
    sub_type: "quick_reply" as const,
    index: String(index),
    parameters: [
      { type: "payload" as const, payload: viewingReminderReplyPayload(appointmentId, reply) },
    ] as readonly [{ readonly type: "payload"; readonly payload: string }],
  }));
}

/**
 * ‎`null` = לא מטען שלנו, או תשובה שאיננו מכירים.
 *
 * מזהה הסיור אינו מפוענח כאן מעבר לצורתו: מי שקורא בודק אותו מול
 * הדייר שלו ממילא, ומטען שהומצא לא ימצא סיור.
 */
export function parseViewingReminderReply(
  payload: string,
): { appointmentId: string; reply: ViewingReminderReply } | null {
  const parts = payload.trim().split(":");
  if (parts.length !== 3 || parts[0] !== REPLY_PREFIX) return null;
  const [, appointmentId, reply] = parts;
  if (appointmentId === undefined || appointmentId === "") return null;
  if (reply !== "confirmed" && reply !== "reschedule") return null;
  return { appointmentId, reply };
}
