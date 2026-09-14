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
 * ‎**תחילית מגבול מילה, לא תת-מחרוזת.** „אהרון” ימצא „רמת אהרון”,
 * כי מתווך זוכר את החלק המזהה ולא תמיד את הפתיח. אבל „מת” לא ימצא
 * אותה: תת-מחרוזת חופשית מחזירה רשימה שאי אפשר לסרוק, וזה בדיוק
 * מה שגורם לאנשים להתעלם מההצעות ולהקליד מחדש — כלומר להחזיר את
 * הכפילות שהפיצ'ר בא למנוע.
 *
 * ‎**ההשוואה היא מהיסט של גבול מילה על המפתח המלא**, ולא של כל
 * מילה בנפרד. הצורה הראשונה השוותה `word.startsWith(q)`, וברגע
 * שהמתווך הקליד רווח ועבר למילה השנייה — „רמת א” — שום מילה בודדת
 * לא התחילה בה, וההצעה **נעלמה בדיוק כשהוא היה באמצע לכתוב אותה**
 * (ביקורת Codex). שאילתה רב-מילתית היא המקרה הנפוץ בשמות שכונות,
 * לא קצה.
 */
export function neighborhoodMatches(candidate: string, query: string): boolean {
  return neighborhoodKeyMatches(neighborhoodKey(candidate), neighborhoodKey(query));
}

/**
 * ‎**אותו כלל בדיוק, על שני מפתחות שכבר מקופלים.**
 *
 * ‏ההשלמה בטופס מקבלת שמות גולמיים; סינון הקונים מקבל מפתחות
 * ‏מקופלים ששמורים בעמודה. אילו כל צד היה מיישם את הכלל בעצמו,
 * ‏ההצעה והסינון היו נפרדים ביום שאחד מהם יתוקן — כלומר רשימה
 * ‏שמציעה שכונה, וסינון שעליה מחזיר „אין תוצאות”.
 *
 * ‎`neighborhoodMatches` הוא הקיפול ועוד הכלל; זה הכלל בלבד.
 */
export function neighborhoodKeyMatches(key: string, queryKey: string): boolean {
  if (queryKey === "") return true;
  if (key.startsWith(queryKey)) return true;
  /* כל היסט שאחרי רווח הוא גבול מילה — ומשם ההשוואה היא תחילית. */
  for (let i = key.indexOf(" "); i !== -1; i = key.indexOf(" ", i + 1)) {
    if (key.startsWith(queryKey, i + 1)) return true;
  }
  return false;
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

/**
 * ‎**כל השמות שקונה נמצא לפיהם — הגדרה אחת, ובה שני המקורות.**
 *
 * ## למה שני מקורות ולא רק „שכונות”
 *
 * ‏קונה מצהיר איפה הוא מחפש בשתי דרכים, ושתיהן שוות ערך: רשימת
 * ‏שכונות מוקלדת, ונעיצה על המפה שהשדה שלה נקרא „שם השכונה או
 * ‏האזור”. מי שסימן „רמת אהרון” על המפה ולא הקליד אותה אמר בדיוק
 * ‏את אותו דבר — וסינון שרואה רק את הרשימה המוקלדת היה מחזיר „אין
 * ‏קונים ברמת אהרון” דווקא על הקונים שהסוכן נעץ בעצמו.
 *
 * ## למה מפתחות מקופלים ולא השמות
 *
 * ‏השמות נשמרים כפי שהוקלדו (ראו למעלה), ולכן „שיכון ג'” ו„שיכון
 * ‏ג” הם שתי מחרוזות. המפתח הוא מה שמאחד אותן, והוא מה שנשמר
 * ‏בעמודה שהמסד מאנדקס — כך שהסינון אינו צריך לפתוח JSON בכל שורה
 * ‏ואינו תלוי בכתיב שמישהו בחר.
 *
 * ‏ממוין ומצומצם: שתי כתיבות של אותן דרישות מייצרות אותו מערך,
 * ‏ולכן השוואה או בדיקה עליו אינה תלויה בסדר שבו הוקלדו.
 */
export function buyerNeighborhoodKeys(requirements: {
  neighborhoods?: readonly string[] | undefined;
  searchAreas?: readonly { label?: string | undefined }[] | undefined;
}): string[] {
  const keys = new Set<string>();
  for (const raw of requirements.neighborhoods ?? []) {
    const key = neighborhoodKey(raw);
    if (key !== "") keys.add(key);
  }
  for (const area of requirements.searchAreas ?? []) {
    const key = neighborhoodKey(area.label ?? "");
    if (key !== "") keys.add(key);
  }
  return [...keys].sort();
}
