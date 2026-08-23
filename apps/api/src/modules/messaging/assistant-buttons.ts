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

import type { WhatsAppButton, WhatsAppListRow } from "@metavchim/shared";

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
}

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

export const confirmButtons = (): WhatsAppButton[] => [
  { action: "confirm", title: "✅ אשר" },
  { action: "cancel", title: "❌ בטל" },
];

export const cancelButtons = (): WhatsAppButton[] => [
  { action: "cancel", title: "❌ בטל" },
];

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
