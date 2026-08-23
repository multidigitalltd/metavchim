/**
 * הכפתורים של הסוכן — מה כתוב עליהם, ומה קורה בלחיצה.
 *
 * ## למה לחיצה מתורגמת למילה
 *
 * מכונת המצבים של השיחה כבר יודעת לטפל ב„אשר”, ב„בטל” ובמספר
 * סידורי — כולל התפיסה האטומית שמונעת ביצוע כפול. תרגום הלחיצה
 * למילה המקבילה מפעיל בדיוק את אותו מסלול, במקום מסלול שני שצריך
 * לזכור את אותם כללים. מסלול שני היה נשכח בדיוק ברגע שמישהו ישנה
 * את הראשון.
 */

import {
  buttonTitle,
  WA_MAX_REPLY_BUTTONS,
  type WhatsAppButton,
  type WhatsAppListRow,
} from "@metavchim/shared";

/** תשובת הסוכן: טקסט תמיד, וכפתורים כשיש מה ללחוץ. */
export interface AgentReply {
  /**
   * הנוסח המלא — כולל ההוראות בטקסט.
   *
   * הוא נשלח כשההודעה האינטראקטיבית אינה אפשרית (גוף ארוך מ-1024
   * תווים, או דחייה של Meta), ולכן הוא חייב לעמוד בפני עצמו.
   */
  text: string;
  /** גוף קצר יותר לגרסת הכפתורים — בלי „השיבו *אשר*” המיותר שם */
  buttonBody?: string;
  buttons?: WhatsAppButton[];
  list?: { label: string; rows: WhatsAppListRow[] };
  /**
   * הקלטה לשליחה כהודעת שמע — **כבר נשלפה**.
   *
   * השליפה דורשת הקשר דייר (בעלות על השיחה נבדקת בשירות), והמשלוח
   * קורה אחרי שההקשר נסגר. לכן הבייטים נוסעים כאן, ולא הפניה
   * שהיה צריך לפתוח הקשר שני כדי לממש.
   */
  audio?: { buffer: Buffer; mimeType: string; label: string };
}

/** תקרת הקלטה לשליחה. מעליה Meta דוחה, ואנחנו אומרים למה. */
export const WA_AUDIO_MAX_BYTES = 16 * 1024 * 1024;

/** תווית ההשתקה הרגעית — מוצגת גם בהודעת האישור שאחריה. */
export const SNOOZE_LABEL = "שקט לשעתיים";
/** משך ההשתקה בדקות. שעתיים: פגישה, נהיגה, ארוחת ערב. */
export const SNOOZE_MINUTES = 120;

/**
 * פקודות מוכנות שכפתור יכול לשגר.
 *
 * הן נשלחות למנוע כאילו הוקלדו — ולכן הן מנוסחות בדיוק כמו שמתווך
 * היה מנסח, ולא כמפתחות טכניים. כך אין מסלול ביצוע שני.
 */
export const BUTTON_COMMANDS: Record<string, string> = {
  urgent: "מה הכי דחוף לי היום?",
  today: "מה יש לי היום?",
};

/** החותם נשלח עם שני הכפתורים — גם ביטול של הצעה ישנה הוא טעות. */
export const confirmButtons = (token?: string): WhatsAppButton[] => [
  { action: "confirm", title: "✅ אשר", ...(token === undefined ? {} : { token }) },
  { action: "cancel", title: "❌ בטל", ...(token === undefined ? {} : { token }) },
];

/**
 * כפתורים או רשימה — ההכרעה שמונעת בחירה בניחוש.
 *
 * כפתור „תשובה מהירה” מציג כותרת בלבד; רשימה מציגה גם שורת תיאור.
 * לכן כשהכותרות אינן מבחינות זו מזו — שני קונים בשם „משה כהן” —
 * חייבים לרדת לרשימה, אחרת המתווך בוחר על כרטיס של מישהו אחר.
 *
 * ההשוואה היא על הכותרת **כפי שתוצג**: Meta מגבילה ל-20 תווים,
 * ולכן שתי כותרות שנבדלות רק אחרי החיתוך נראות זהות על המסך
 * (ביקורת Codex). השוואה על הטקסט הגולמי הייתה מפספסת בדיוק את
 * המקרה הזה.
 */
export function choiceVariant(
  rows: readonly WhatsAppListRow[],
): Pick<AgentReply, "buttons" | "list"> {
  const labels = rows.map((row) => buttonTitle(row.title));
  const distinct = new Set(labels).size === labels.length;
  if (rows.length <= WA_MAX_REPLY_BUTTONS && distinct) {
    return { buttons: rows.map(({ description: _ignored, ...button }) => button) };
  }
  /*
   * הרשימה נחתכת באותה תקרה, ולא לכל מקור מועמדים יש תיאור — ליד,
   * למשל, מוצע בשם בלבד. לכן כשהכותרות מתנגשות מוסיפים את המספר
   * הסידורי לכל אחת: הוא קצר, הוא ייחודי בהגדרה, והוא בדיוק אותו
   * מספר שאפשר גם להשיב בו בטקסט (ביקורת Codex).
   */
  const numbered = distinct
    ? [...rows]
    : rows.map((row, i) => ({ ...row, title: `${row.arg ?? String(i + 1)}. ${row.title}` }));
  return { list: { label: "בחירה", rows: numbered } };
}

/**
 * לחיצה ⟵ המילה שהשיחה כבר יודעת לפרש. `null` = הכפתור מטופל
 * בנפרד (השתקה), או שאיננו מכירים אותו.
 */
export function buttonAsText(action: string, arg?: string): string | null {
  if (action === "confirm") return "אשר";
  if (action === "cancel") return "בטל";
  if (action === "pick") return arg !== undefined && /^\d{1,2}$/u.test(arg) ? arg : null;
  if (action === "cmd") return arg === undefined ? null : (BUTTON_COMMANDS[arg] ?? null);
  return null;
}
