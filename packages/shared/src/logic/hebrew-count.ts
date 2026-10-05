/**
 * ‎**מספר ושם עצם בעברית — צורה אחת, לא שכפול בכל קורא.**
 *
 * ‏לעברית יש זוגי, ולכן „2 סיורים” נקרא כמו תרגום מכונה במקום
 * ‏„שני סיורים”. הכלל הזה נכתב עד כה בכל מקום מחדש — `viewingsWord`
 * ‏ב-`mentor-deal` היה הראשון — וכל העתק שלו היה מקום שבו הזוגי
 * ‏נשכח.
 *
 * ‏הצורות נמסרות על ידי הקורא ולא נגזרות: „שני סיורים” מול „שתי
 * ‏הצעות” הוא מין דקדוקי, ולא משהו שאפשר לחשב משם העצם.
 */
export interface HebrewCountForms {
  /** ‏„סיור אחד” / „הצעה אחת” / „יום אחד” */
  one: string;
  /** ‏„שני סיורים” / „שתי הצעות” / „יומיים” */
  two: string;
  /** ‏שם העצם ברבים בלבד — המספר נוסף לפניו: „סיורים” → „5 סיורים” */
  many: string;
}

export function hebrewCount(n: number, forms: HebrewCountForms): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  return `${n} ${forms.many}`;
}

/** ‏הצורות שחוזרות בכל המנטור, כדי שלא ייכתבו פעמיים. */
export const HEBREW_VIEWINGS: HebrewCountForms = {
  one: "סיור אחד",
  two: "שני סיורים",
  many: "סיורים",
};

export const HEBREW_OFFERS: HebrewCountForms = {
  one: "הצעה אחת",
  two: "שתי הצעות",
  many: "הצעות",
};

export const HEBREW_DAYS: HebrewCountForms = {
  one: "יום אחד",
  two: "יומיים",
  many: "ימים",
};
