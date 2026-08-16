/**
 * מאפיינים שהמשרד מוסיף בעצמו — **מה שחמשת הקבועים לא מכסים.**
 *
 * המנוע הכיר חמישה מאפיינים: מעלית, חניה, מרפסת, ממ"ד, מחסן. הם
 * נכונים לרוב הדירות ולא מספיקים לאף שוק אמיתי — מיזוג מרכזי,
 * סורגים, מטבח כשר, גישה לנכים, מרפסת שמש, יחידת דיור. סוכן שנתקל
 * במאפיין שאין לו שדה כתב אותו בהערות, ושם הוא לא השתתף בשום
 * התאמה.
 *
 * ## למה מפתח ולא הטקסט עצמו
 *
 * "מיזוג", "מיזוג מרכזי", "מיזוג-מרכזי" ו"מיזוג  מרכזי" הם אותו
 * מאפיין לאדם ושלושה מאפיינים שונים למחשב. קונה שדורש את אחד מהם
 * לא ימצא נכס שסומן באחר — כלומר תכונה שנראית עובדת ומייצרת בשקט
 * התאמות חסרות. הנרמול הוא מה שהופך אותה לאמינה.
 *
 * ## למה קידומת
 *
 * מאפיין מותאם חי באותה מפת דרישות של הקונה כמו הקבועים
 * (`{ hasElevator: "must" }`), והמנוע חייב לדעת מאיפה לקרוא את
 * הערך: קבוע יושב כשדה על הנכס, ומותאם יושב בתוך `customFeatures`.
 * הקידומת היא ההבחנה, והיא גם מונעת התנגשות אם משרד יקרא למאפיין
 * שלו "hasElevator".
 */

/** מפריד בין מאפיין מותאם לקבוע. ראו ההסבר למעלה. */
export const CUSTOM_FEATURE_PREFIX = "custom:";

/**
 * תקרה לכל נכס.
 *
 * לא מגבלה טכנית אלא הגנה על המסך: עשרים תגיות בשורה אחת הן קיר,
 * והמאפיין החשוב נבלע בהן. משרד שצריך יותר מזה מתאר נכס בהערות,
 * לא ברשימת תגיות.
 */
export const MAX_CUSTOM_FEATURES = 12;

/** אורך התווית שהמשתמש מקליד. */
export const MAX_FEATURE_LABEL = 24;

/**
 * טקסט → מפתח יציב.
 *
 * מחזיר מחרוזת ריקה כשאין תוכן ממשי, כדי שהקורא יוכל לדחות בלי
 * לנחש. **לא** חותך תווים לא-עבריים: משרד שכותב "Smart Home" יקבל
 * מפתח משלו, וזו בחירה מכוונת — הנרמול מאחד כתיבים, לא שפות.
 */
export function normalizeFeatureKey(raw: string): string {
  let text = raw.normalize("NFC").trim().toLowerCase();
  // גרשיים — קישוט ולא תוכן, בדיוק כמו בשמות מקומות
  text = text.replace(/[׳״'"`]/gu, "");
  // מקפים וסימני פיסוק הופכים לרווח ולא נעלמים, אחרת "מיזוג-מרכזי"
  // ו"מיזוג מרכזי" מתלכדים עם "מיזוגמרכזי" ולא זה עם זה
  text = text.replace(/[־\-–—.,/\\|]/gu, " ");
  text = text.replace(/\s+/gu, " ").trim();
  return text;
}

/** המפתח המלא כפי שהוא נשמר בדרישות הקונה ובנכס. */
export function customFeatureKey(label: string): string {
  const normalized = normalizeFeatureKey(label);
  return normalized === "" ? "" : `${CUSTOM_FEATURE_PREFIX}${normalized}`;
}

/** האם מפתח שייך למאפיין מותאם (ולא לאחד מחמשת הקבועים). */
export function isCustomFeature(key: string): boolean {
  return key.startsWith(CUSTOM_FEATURE_PREFIX);
}

/** מאפיין מותאם כפי שהוא נשמר על הנכס ומוצג במסך. */
export interface CustomFeature {
  /** כולל קידומת — `custom:מיזוג מרכזי`. */
  key: string;
  /** מה שהמשתמש הקליד, כולל רישיות ופיסוק. זה מה שמוצג. */
  label: string;
  /** `true` = יש · `false` = אין. חסר מהרשימה = לא ידוע. */
  value: boolean;
}

/**
 * ניקוי רשימה שהגיעה מהטופס או מהמסד.
 *
 * שלושה דברים בבת אחת, ובסדר הזה: זריקת שורות בלי תוכן, **איחוד
 * כפילויות לפי מפתח** (השורה האחרונה גוברת — היא מה שהמשתמש סימן
 * לאחרונה), וקיצוץ לתקרה. הכפילויות הן העיקר: בלעדיהן אותו נכס היה
 * יכול לשאת גם "מיזוג" וגם "מיזוג-מרכזי" עם ערכים סותרים.
 */
export function normalizeCustomFeatures(
  raw: readonly { label: string; value: boolean }[],
): CustomFeature[] {
  const byKey = new Map<string, CustomFeature>();
  for (const item of raw) {
    const label = item.label.trim().slice(0, MAX_FEATURE_LABEL);
    const key = customFeatureKey(label);
    if (key === "") continue;
    byKey.set(key, { key, label, value: item.value });
  }
  return [...byKey.values()].slice(0, MAX_CUSTOM_FEATURES);
}

/**
 * הרשימה כפי שהמנוע קורא אותה: מפתח → יש/אין.
 *
 * מפתח שאינו ברשימה נשאר "לא ידוע", וזו הבחנה שהמנוע כבר מכיר —
 * "אין מיזוג" פוסל נכס אצל מי שדורש מיזוג, ו"לא ידוע" רק מוריד
 * ניקוד.
 */
export function customFeatureMap(
  features: readonly CustomFeature[],
): Record<string, boolean> {
  return Object.fromEntries(features.map((f) => [f.key, f.value]));
}

/**
 * קטלוג המשרד — כל המאפיינים המותאמים שכבר בשימוש, לפי שכיחות.
 *
 * זה מה שהופך "כל סוכן מוסיף בעצמו" לשמיש: הטופס מציע קודם את מה
 * שכבר קיים, ולכן השני שנתקל במיזוג בוחר את התווית של הראשון במקום
 * להמציא אותה מחדש. בלי זה, החופש להוסיף היה מייצר בדיוק את פיצול
 * המפתחות שהנרמול נלחם בו.
 */
export function featureCatalogue(
  properties: readonly { customFeatures: readonly CustomFeature[] }[],
): { key: string; label: string; count: number }[] {
  const seen = new Map<string, { key: string; label: string; count: number }>();
  for (const property of properties) {
    for (const feature of property.customFeatures) {
      const entry = seen.get(feature.key);
      if (entry) entry.count += 1;
      else seen.set(feature.key, { key: feature.key, label: feature.label, count: 1 });
    }
  }
  return [...seen.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "he"),
  );
}
