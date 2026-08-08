/**
 * מי רשאי לראות הערה בחיפוש החופשי.
 *
 * הערות ותיעודי שיחה (interactions) אינן נושאות בעלים משלהן — הן
 * תלויות בליד או בקונה שאליו הן מקושרות. לכן הנראות שלהן נגזרת משם,
 * בדיוק כמו בשליפת ציר הזמן של הכרטיס (docs/04 §3).
 *
 * הכלל הזה יושב כפונקציה טהורה ולא בתוך השאילתה, כי הוא כלל הרשאה
 * שקל לשבור בשקט: חיפוש טקסט חופשי שמדלג עליו מחזיר לסוכן את ההערות
 * על הלקוחות של סוכן אחר — התוכן המסחרי הרגיש ביותר במערכת.
 */

export interface NoteScope {
  leadId: string | null;
  buyerId: string | null;
}

export interface VisibleEntities {
  /** מזהי הלידים שהמשתמש רשאי לראות. */
  leadIds: ReadonlySet<string>;
  /** מזהי הקונים שהמשתמש רשאי לראות. */
  buyerIds: ReadonlySet<string>;
}

/**
 * מסנן הערות לפי נראות הישות המקושרת, וחותך לתקרה.
 *
 * הערה שאינה מקושרת לא לליד ולא לקונה אינה מוצגת: אי אפשר לבסס עליה
 * הרשאה, ו"בררת מחדל פתוחה" בהרשאות היא בדיוק מה שגורם לדליפות.
 */
export function filterVisibleNotes<T extends NoteScope>(
  notes: readonly T[],
  visible: VisibleEntities,
  limit: number,
): T[] {
  const allowed = notes.filter(
    (note) =>
      (note.leadId !== null && visible.leadIds.has(note.leadId)) ||
      (note.buyerId !== null && visible.buyerIds.has(note.buyerId)),
  );
  return limit >= 0 ? allowed.slice(0, limit) : [];
}
