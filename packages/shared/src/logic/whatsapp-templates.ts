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
  /** ללקוח שהתקשר ולא נענה: הקישור לטופס הדרישות */
  intake: ["form_link"],
  /** תזכורת לפני סיור: נוסח התזכורת המלא שהמשרד ניסח */
  viewingReminder: ["reminder_text"],
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
