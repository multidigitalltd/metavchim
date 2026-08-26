/**
 * ‎**„משימות מוצעות לנכס הזה” (SPEC-4c §6).**
 *
 * האפיון נוקב בכלל אחד, והוא כל מה שמעניין כאן:
 *
 * &gt; Only ever suggest something the record actually lacks. If the
 * &gt; price exists, never suggest completing the price.
 *
 * הצעה להשלים שדה שכבר מלא היא גרועה משתיקה: היא שולחת את המתווך
 * לפתוח כרטיס, למצוא שם את מה שהמערכת אמרה שחסר, ולהפסיק להאמין
 * לרשימה. אחרי פעם אחת כזו כל ההצעות הבאות נקראות כרעש.
 *
 * ## איך זה מובטח — ולא נבדק ידנית
 *
 * המקור הוא `missingFields` שהשרת מחשב, **אותו שדה בדיוק** שמניע
 * את ציון המוכנות בכרטיס. אין כאן רשימה שנייה שמנחשת מה חסר, ולכן
 * אי אפשר שההצעה תסתור את הכרטיס: היא נגזרת ממנו.
 *
 * הכותרות יושבות ב-`Record<PropertyReadinessField, …>`, כך ששדה
 * מוכנות עשירי לא יעבור קומפילציה עד שיקבל ניסוח משלו — במקום
 * להישמט בשקט מההצעות ולהיראות כאילו הוא אף פעם לא חסר.
 */

import {
  PROPERTY_READINESS_FIELDS,
  type PropertyReadinessField,
} from "../schemas/property.js";

export interface SuggestedTask {
  field: PropertyReadinessField;
  /** מה שייכתב במשימה עצמה — פעולה, ולא שם שדה. */
  title: string;
  /** למה זה כדאי. מוצג לצד הכותרת, ואינו נשמר במשימה. */
  reason: string;
}

/**
 * הניסוח לכל שדה חסר.
 *
 * ‎**פעולה ולא תווית.** „מחיר” הוא שם שדה; „לקבוע מחיר מבוקש מול
 * הבעלים” הוא מה שהמתווך צריך לעשות, וזה ההבדל בין רשימת חוסרים
 * לרשימת משימות. הסיבה נוקבת במה שהחוסר **עולה** — כי „כדאי
 * להשלים” אינו נימוק.
 */
const SUGGESTIONS: Record<PropertyReadinessField, { title: string; reason: string }> = {
  priceAgorot: {
    title: "לקבוע מחיר מבוקש מול הבעלים",
    reason: "בלי מחיר הנכס אינו מחפש קונים מיוזמתו",
  },
  areaSqm: {
    title: 'להשלים שטח במ"ר',
    reason: "קונים מסננים לפי שטח, ונכס בלעדיו נופל מהרשימות שלהם",
  },
  rooms: {
    title: "להשלים מספר חדרים",
    reason: "מספר החדרים פוסל או מאשר התאמה — בלעדיו היא לא נבחנת",
  },
  floor: {
    title: "להשלים קומה",
    reason: "השאלה הראשונה בטלפון, ותשובה „אני אבדוק” עולה שיחה",
  },
  hasElevator: {
    title: "לציין אם יש מעלית",
    reason: "דרישת חובה נפוצה; „לא ידוע” מוריד ניקוד לכל קונה שביקש",
  },
  hasParking: {
    title: "לציין אם יש חניה",
    reason: "דרישת חובה נפוצה; „לא ידוע” מוריד ניקוד לכל קונה שביקש",
  },
  images: {
    title: "להעלות תמונות לנכס",
    reason: "נכס בלי תמונות כמעט אינו נפתח בהצעה שנשלחת",
  },
  marketingDescription: {
    title: "לכתוב תיאור שיווקי",
    reason: "התיאור הוא מה שנשלח לקונה; בלעדיו ההצעה יוצאת חלקית",
  },
  owner: {
    title: "להוסיף את בעל הנכס",
    reason: "בלעדיו אי אפשר לשלוח עדכון שיווק ולא להחתים על בלעדיות",
  },
};

/**
 * ההצעות לנכס — לפי מה שחסר בו **בפועל**, ובלי לחזור על מה שכבר פתוח.
 *
 * ‎`openTitles` אינו קישוט: מתווך שלחץ „הוסף” על הצעה רואה אותה
 * נכנסת לרשימת המשימות, ואם היא נשארת גם ברשימת ההצעות הוא ילחץ
 * שוב — ויקבל שתי משימות זהות. ההשוואה על הכותרת, כי זה מה
 * שנשמר.
 *
 * הסדר הוא של `PROPERTY_READINESS_FIELDS` ולא של מה שהשרת החזיר:
 * אותו נכס מציג את אותן הצעות באותו סדר בכל טעינה.
 */
export function suggestedPropertyTasks(
  missingFields: readonly string[],
  openTitles: readonly string[] = [],
): SuggestedTask[] {
  const missing = new Set(missingFields);
  const taken = new Set(openTitles.map((t) => t.trim()));
  const out: SuggestedTask[] = [];
  for (const field of PROPERTY_READINESS_FIELDS) {
    if (!missing.has(field)) continue;
    const suggestion = SUGGESTIONS[field];
    if (taken.has(suggestion.title)) continue;
    out.push({ field, ...suggestion });
  }
  return out;
}
