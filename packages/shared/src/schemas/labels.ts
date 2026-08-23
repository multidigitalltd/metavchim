/**
 * חיפוש בטוח בטבלת תוויות.
 *
 * טבלאות התוויות מוקלדות לפי הסכימה (`Record<LeadStatus, string>`
 * ולא `Record<string, string>`), כדי שערך שנוסף לסכימה ולא לטבלה
 * ישבור את הבנייה. טבלה רופפת היא בדיוק מה שהציג `very_hot` גולמי
 * למתווך, ואחר כך `in_progress` ו-`rent_in` באותה פונקציה (ביקורת
 * Codex).
 *
 * המחיר הוא שערך שהגיע מהמסד — `string` ולא הטיפוס הסגור — אינו
 * מפתח חוקי. הפונקציה הזו היא המקום היחיד שמגשר: היא מקבלת ערך
 * לא ידוע, מחזירה תווית אם יש, ואת הערך עצמו אם אין. שורה ישנה
 * במסד מוצגת כמות שהיא ולא נעלמת.
 */
export function labelOf<K extends string>(
  table: Record<K, string>,
  value: unknown,
): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return (table as Record<string, string | undefined>)[value] ?? value;
}
