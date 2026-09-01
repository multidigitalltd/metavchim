/**
 * ‎**אוצר שמות השכונות של המשרד — ולמה הוא צריך קיפול ולא רק רשימה.**
 *
 * ## הבעיה
 *
 * שם שכונה הוא טקסט חופשי, ובכוונה: שמות שכונות אינם רשומים בשום
 * מרשם, ורשימה סגורה הייתה מכריחה „אחר” על כל שכונה שלא חשבנו
 * עליה. המחיר הוא שכל מתווך מקליד את אותה שכונה אחרת —
 * ‎`שיכון ג` ,`שיכון ג'` ,`שיכון ג׳` ,`שכונת שיכון ג` — וארבע
 * הצורות האלה הן ארבע שכונות שונות בכל חיפוש, סינון ודוח.
 *
 * ## למה קיפול ולא נרמול
 *
 * ‎**מה שהמתווך הקליד נשמר כמו שהוא.** הקיפול משמש רק להשוואה:
 * לזהות ששתי צורות הן אותה שכונה, ולהציע את הצורה שכבר נהוגה
 * במשרד. נרמול אגרסיבי שהיה כותב לתוך הרשומה היה הופך „רמת אהרון”
 * ל„רמת אהרן” אצל מי שלא ביקש, ואת השם שהלקוח אמר לשם שהמערכת
 * העדיפה.
 *
 * ## מה מקופל, ומה לא
 *
 * מקופל: רווחים כפולים, גרש וגרשיים על כל צורותיהם (`'` ,`׳` ,`"`
 * ,`״`), מקף רגיל ומקף עברי, והקידומת „שכונת ”.
 *
 * ‎**לא** מקופל: אותיות סופיות, כתיב מלא מול חסר, וה"א הידיעה.
 * ‏„רמת גן” ו„רמות גן” הן שתי שכונות שונות, ו„בית הכרם” אינו
 * „בית כרם” בהכרח. קיפול-יתר מאחד שכונות אמיתיות — וזה נזק גרוע
 * יותר מכפילות, כי הוא בלתי הפיך מבחינת המשתמש.
 */

/** גרסאות הגרש והגרשיים שמקלדת עברית מייצרת. */
const QUOTES = /['"׳״‘’“”]/gu;
/** מקף רגיל, מקף עברי (מקף), ומקפים טיפוגרפיים. */
const DASHES = /[-־‐-―]/gu;
/** „שכונת רמת אהרון” ו„רמת אהרון” הן אותה שכונה. */
const PREFIX = /^שכונת\s+/u;

/**
 * מה שנשמר — ניקוי שמרני בלבד.
 *
 * רווחים בקצוות ורווחים כפולים אינם מידע, והם המקור הכי שכיח
 * לכפילות שנראית זהה על המסך. שום דבר אחר לא נגוע.
 */
export function normalizeNeighborhood(raw: string): string {
  return raw.replace(/\s+/gu, " ").trim();
}

/**
 * המפתח להשוואה. שתי צורות של אותה שכונה מחזירות אותו מפתח.
 *
 * ריק = אין כאן שם. מחרוזת של סימני פיסוק בלבד אינה שכונה, והחזרת
 * מפתח ריק מונעת ממנה להפוך לערך באוצר.
 */
export function neighborhoodKey(raw: string): string {
  return normalizeNeighborhood(raw)
    .replace(PREFIX, "")
    .replace(QUOTES, "")
    .replace(DASHES, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * האם המועמד מתאים למה שהוקלד עד כה.
 *
 * ‎**תחילית של מילה, לא תת-מחרוזת.** „אהרון” ימצא „רמת אהרון”, כי
 * מתווך זוכר את החלק המזהה ולא תמיד את הפתיח. אבל „מת” לא ימצא
 * אותה: תת-מחרוזת חופשית מחזירה רשימה שאי אפשר לסרוק, וזה בדיוק
 * מה שגורם לאנשים להתעלם מההצעות ולהקליד מחדש — כלומר להחזיר את
 * הכפילות שהפיצ'ר בא למנוע.
 */
export function neighborhoodMatches(candidate: string, query: string): boolean {
  const q = neighborhoodKey(query);
  if (q === "") return true;
  const key = neighborhoodKey(candidate);
  return key === q || key.split(" ").some((word) => word.startsWith(q));
}

/** שכונה אחת באוצר: הצורה שתוצג, וכמה פעמים היא כבר נכתבה. */
export interface NeighborhoodUse {
  name: string;
  count: number;
}

/**
 * ‎**איחוד הצורות — והצורה שתנצח היא הנפוצה במשרד.**
 *
 * לא הראשונה שנכתבה ולא הקצרה: אם עשרה כרטיסים אומרים „שיכון ג'”
 * ואחד אומר „שיכון ג”, ההצעה צריכה להיות זו שהמשרד כבר מדבר בה.
 * שוויון נשבר לפי סדר אלפביתי, כדי שהתוצאה לא תשתנה בין קריאות
 * על אותם נתונים.
 */
export function mergeNeighborhoodUses(
  uses: readonly NeighborhoodUse[],
): NeighborhoodUse[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const use of uses) {
    const name = normalizeNeighborhood(use.name);
    const key = neighborhoodKey(name);
    if (key === "" || use.count <= 0) continue;
    const forms = byKey.get(key) ?? new Map<string, number>();
    forms.set(name, (forms.get(name) ?? 0) + use.count);
    byKey.set(key, forms);
  }

  const out: NeighborhoodUse[] = [];
  for (const forms of byKey.values()) {
    let best = "";
    let bestCount = -1;
    let total = 0;
    for (const [name, count] of [...forms].sort((a, b) => a[0].localeCompare(b[0], "he"))) {
      total += count;
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    out.push({ name: best, count: total });
  }
  /* הנפוץ קודם — זו גם ההצעה שהכי סביר שהמתווך התכוון אליה. */
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "he"));
}

/** כמה הצעות מוצגות. מעבר לזה זו רשימה שסורקים במקום לבחור ממנה. */
export const NEIGHBORHOOD_SUGGESTION_LIMIT = 8;

/**
 * האוצר ⟵ ההצעות למה שהוקלד. מסונן, מאוחד, וחתוך לתקרה.
 *
 * ‎**מה שכבר הוקלד במלואו אינו מוצע.** הצעה שזהה בדיוק למה שבשדה
 * היא שורה שאי אפשר לעשות בה כלום, והיא דוחקת הצעה אמיתית מהרשימה.
 */
export function suggestNeighborhoods(
  vocabulary: readonly NeighborhoodUse[],
  query: string,
  limit = NEIGHBORHOOD_SUGGESTION_LIMIT,
): string[] {
  const typed = neighborhoodKey(query);
  return mergeNeighborhoodUses(vocabulary)
    .filter((use) => neighborhoodMatches(use.name, query) && neighborhoodKey(use.name) !== typed)
    .slice(0, Math.max(0, limit))
    .map((use) => use.name);
}
