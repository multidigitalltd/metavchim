import { formatCallbacksForWhatsApp, type CallbackRow } from "@metavchim/shared";

/**
 * רשימת „למי לחזור” כפי שהיא נקראת בוואטסאפ.
 *
 * ## למה מנסח שלישי
 *
 * `summarizeData` עונה על „כמה יש ומי הם”: הוא אוסף תוויות, חותך
 * בחמש שורות, ומוותר על כל השאר. `formatCard` עונה על רשומה אחת.
 * רשימת החזרות היא שאלה שלישית — **מטלות מדורגות** — ובה כל
 * מה שהסיכום הכללי מוותר עליו הוא כל התוכן: הסיבה, כמה זמן הלקוח
 * ממתין, וכמה נחתכו.
 *
 * בלי הניתוב הזה מתווך שביקש בוואטסאפ „מספרים שצריך לחזור אליהם”
 * היה מקבל חמישה שמות בלי סיבה ובלי זמן — כלומר בדיוק את התלונה
 * שהפעולה נבנתה כדי לתקן, רק בערוץ אחר (ביקורת Codex).
 *
 * ## למה הזיהוי לפי מפתח ולא לפי הפעולה
 *
 * המנסח אינו יודע איזו פעולה רצה — הוא מקבל `data`. `callbacks`
 * הוא מפתח שרק הפעולה הזו מייצרת, ולכן הוא הסימן. פעולה עתידית
 * שתחזיר רשימת חזרות תקבל את אותו ניסוח בלי לגעת כאן.
 */

/** תקרה שמרנית להודעת וואטסאפ אחת — מעבר לזה הנמען מקבל טקסט קטוע. */
const WHATSAPP_ROWS = 10;

function isCallbackRow(value: unknown): value is CallbackRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row["name"] === "string" &&
    typeof row["reasonText"] === "string" &&
    typeof row["waitedText"] === "string"
  );
}

/** `null` = אלה אינן תוצאות של רשימת חזרות, והקורא ימשיך למנסח הבא. */
export function formatCallbacks(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const rows = (data as Record<string, unknown>)["callbacks"];
  if (!Array.isArray(rows)) return null;
  /*
   * רשימה ריקה היא עדיין רשימת חזרות, ויש לה ניסוח משלה („אין
   * כרגע אף אחד שממתין”). נפילה למנסח הכללי כאן הייתה מחזירה
   * מחרוזת ריקה, כלומר הודעה בלי שורת תוכן.
   */
  if (rows.length > 0 && !rows.every(isCallbackRow)) return null;
  return formatCallbacksForWhatsApp(rows as CallbackRow[], { limit: WHATSAPP_ROWS });
}
