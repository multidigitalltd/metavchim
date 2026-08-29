/**
 * מה שנכתב בטופס הפגישה, בזמן שיוצאים ממנו לרגע.
 *
 * ## למה לא בכתובת
 *
 * הקישור חזרה נושא את המזהים (הנכס, הקונה, הליד) — הם קצרים,
 * קבועים באורכם, וחייבים להיות בכתובת ממילא כדי שהמסך יידע מה
 * לטעון. הטקסט החופשי הוא סיפור אחר: „הערות” מגיע עד 2000 תווים,
 * ובעברית כל תו הוא תשעה בתים בכתובת מקודדת. כתובת כזאת עוברת את
 * הגבול של רשימת ההיתר, ואז נתיב החזרה נדחה **בשקט** — כלומר מי
 * שכתב הערה ארוכה הוא בדיוק מי שלא יחזור לטופס.
 *
 * ‎`sessionStorage` הוא בדיוק המידה הזאת: הטיוטה שייכת ללשונית
 * הזאת, נמחקת כשהיא נסגרת, ואינה מגיעה לשרת. היא גם אינה נשמרת
 * בהיסטוריית הדפדפן — הערה על לקוח אינה דבר שצריך להישאר בכתובת.
 *
 * ## למה „לקחת” ולא „לקרוא”
 *
 * הקריאה מוחקת. טיוטה שנשארת הייתה צפה שוב בפעם הבאה שנפתח טופס
 * פגישה — עם הערות על לקוח אחר, ובלי שאיש ביקש.
 */

const KEY = "mv:appointment-draft";

/** שמות השדות בטופס — בדיוק כפי שהם ב-`name`. */
export type DraftFields = Record<string, string>;

/**
 * שומר את הטיוטה. כישלון אינו נאמר: אחסון חסום (גלישה פרטית,
 * מכסה מלאה) פירושו שהטיוטה לא תחזור, וזו אי-נוחות — לא שגיאה
 * שצריך לעצור בשבילה את המעבר לטופס הנכס.
 */
export function saveDraft(fields: DraftFields): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(fields));
  } catch {
    // אין אחסון — ממשיכים בלי הטיוטה
  }
}

/** מחזיר את הטיוטה **ומוחק אותה**, או `null` כשאין. */
export function takeDraft(): DraftFields | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    /*
     * רק מחרוזות. הערך נכתב על שדות טופס, ו-`el.value = {}` היה
     * מייצר "[object Object]" בתוך ההערות — טיוטה פגומה שנשמרת
     * כאילו הלקוח כתב אותה.
     */
    const fields: DraftFields = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") fields[key] = value;
    }
    return Object.keys(fields).length === 0 ? null : fields;
  } catch {
    return null;
  }
}
