import { type SupportStatus } from "./support.js";

/**
 * תור אחד לשני מקורות הפניות.
 *
 * ## למה מאוחד
 *
 * פנייה שנפתחה מכפתור התמיכה שבמערכת ופנייה שהגיעה במייל הן **אותה
 * עבודה**: מישהו מחכה לתשובה. שני מסכים נפרדים פירושם שני תורים
 * לבדוק, שתי ספירות "כמה פתוחות", ושתי פניות שיכולות להיות של אותו
 * אדם על אותו דבר בלי שאיש ישים לב.
 *
 * המקור נשאר מסומן — הוא משנה **איך** עונים (מייל חוזר בשרשור;
 * פנייה מהכפתור מקבלת תשובה בכרטיס ובמייל) — אבל הוא אינו מפצל את
 * הרשימה.
 */

/** מאיפה הפנייה הגיעה. משנה איך עונים, לא היכן היא מופיעה. */
export type SupportSource = "app" | "email";

export interface SupportQueueRow {
  source: SupportSource;
  id: string;
  reference: number;
  /** שורת הכותרת בתור — נושא המייל, או תחילת ההודעה מהכפתור. */
  title: string;
  /** מי פנה. */
  who: string;
  tenantName: string | null;
  status: SupportStatus;
  /** טרם נקראה/נענתה — מה שמסמן „מחכה לך”. */
  unread: boolean;
  lastActivityAt: string;
}

/**
 * הסדר: **מה שפתוח קודם, והחדש שבו בראש.**
 *
 * ‎`status` אינו שדה מיון. מיון לפי הערך עצמו הוא לקסיקוגרפי, ושם
 * `closed` קטן מ-`in_progress` שקטן מ-`open` — כלומר הסגורות היו
 * עולות לראש והתור הפתוח נדחק מתחתן. זו בדיוק תקלה שכבר קרתה כאן
 * פעם (ביקורת Codex, על רשימת השרשורים), ולכן הכלל יושב בפונקציה
 * אחת עם בדיקה במקום להיכתב מחדש בכל קורא.
 *
 * ‎`in_progress` נחשב פתוח: מישהו מטפל, אבל הפונה עדיין מחכה.
 */
export function orderSupportQueue(rows: readonly SupportQueueRow[]): SupportQueueRow[] {
  return [...rows].sort((a, b) => {
    const openA = a.status === "closed" ? 1 : 0;
    const openB = b.status === "closed" ? 1 : 0;
    if (openA !== openB) return openA - openB;
    // חדש בראש; שוויון מוכרע במספר הפנייה כדי שהסדר יהיה יציב
    const byTime = b.lastActivityAt.localeCompare(a.lastActivityAt);
    return byTime !== 0 ? byTime : b.reference - a.reference;
  });
}

/** כמה ממתינות באמת — המונה שמוצג לצד השולחן. */
export function openSupportCount(rows: readonly SupportQueueRow[]): number {
  return rows.filter((row) => row.status !== "closed").length;
}

/** תווית המקור, לעברית. */
export const SUPPORT_SOURCE_LABEL: Record<SupportSource, string> = {
  app: "מהמערכת",
  email: "במייל",
};

/**
 * שורת הכותרת של פנייה מהכפתור.
 *
 * להודעה מהכפתור אין נושא — היא טקסט חופשי — ולכן התור מציג את
 * תחילתה. בלי החיתוך שורה אחת בתור הייתה בגובה פסקה.
 */
export function ticketTitle(message: string, max = 80): string {
  const line = message.trim().split("\n")[0]?.trim() ?? "";
  if (line === "") return "(פנייה ללא טקסט)";
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
