import type { BuyerRequirements } from "../schemas/buyer.js";

/**
 * ‎**„באיזו קומה?” — השאלה שכל קונה נשאל, ולא היה לה שדה.**
 *
 * ## למה שני מצבים ולא אחד
 *
 * שתי הדרישות שמתווכים משמיעים אינן אותה דרישה:
 *
 * ‎**„משלוש ומעלה”** היא טווח פתוח. רשימה סגורה לא יכולה לבטא אותה
 * בלי למנות עשרות קומות, ומי שימנה יטעה בקצה.
 *
 * ‎**„קרקע או ראשונה”** היא רשימה. טווח לא יכול לבטא אותה בלי לכלול
 * את מה שביניהן — וכאן אין „ביניהן”: אלה שתי קומות שנבחרו בנפרד,
 * מסיבות שונות (גינה מול מדרגות).
 *
 * ## ולמה לא שניהם יחד
 *
 * שדה שמאפשר גם טווח וגם רשימה הוא שדה שיישאל עליו „מה גובר”, ולכל
 * תשובה יהיה מקרה שבו היא מפתיעה. הצורה כאן **מונעת את השאלה**: זהו
 * ‎`union` מתויג, ולכן שני המצבים אינם יכולים להתקיים יחד — לא
 * במסד, לא בזיכרון ולא במסך.
 *
 * ## „לא נאמר” אינו „לא מתאים”
 *
 * קונה בלי העדפת קומה מתאים לכל קומה, בדיוק כמו שקונה בלי תקציב
 * אינו נפסל על מחיר. הקריטריון פשוט אינו נספר.
 */

/** גבולות הקומה — זהים לאלה של הנכס, אחרת נוצרות העדפות בלתי-ניתנות-למילוי. */
export const FLOOR_MIN = -2;
export const FLOOR_MAX = 60;

/**
 * הקומות שמוצעות בצ׳קליסט.
 *
 * ‎**עד 20 ולא עד 60.** מי שמחפש קומה 34 מחפש טווח („גבוה”), ולא
 * מסמן קומה בודדת ברשימה של שישים תיבות. הטווח מכסה בדיוק את מה
 * שהרשימה לא אמורה לכסות.
 */
export const FLOOR_CHOICES: readonly number[] = [
  -1,
  ...Array.from({ length: 21 }, (_, index) => index),
];

/** „קרקע” ולא „0”, „מרתף” ולא „‎-1” — כך זה נאמר בטלפון. */
export function floorLabel(floor: number): string {
  if (floor <= -1) return floor === -1 ? "מרתף" : `מרתף ${Math.abs(floor)}`;
  if (floor === 0) return "קרקע";
  return `קומה ${floor}`;
}

type FloorPreference = NonNullable<BuyerRequirements["floorPreference"]>;

/**
 * האם הקומה של הנכס עונה על ההעדפה.
 *
 * ‎**נכס בלי קומה מוגדרת — `undefined` — אינו נפסל.** חוסר מידע על
 * הנכס אינו אי-התאמה, וזה הכלל שכבר נכון בכל שאר הקריטריונים.
 * במקרה כזה הפונקציה מחזירה `null`: „אין מה לבדוק”, שאינו „לא
 * מתאים” ואינו „מתאים”.
 */
export function floorMatches(
  preference: FloorPreference | undefined,
  propertyFloor: number | undefined,
): boolean | null {
  if (preference === undefined) return null;
  if (propertyFloor === undefined) return null;
  if (preference.mode === "list") {
    return preference.floors.includes(propertyFloor);
  }
  /*
   * טווח פתוח משני הצדדים הוא „כל קומה”, וזה אינו מצב שראוי לפסול
   * עליו — הוא בדיוק כמו שלא נאמר דבר.
   */
  if (preference.min === undefined && preference.max === undefined) return null;
  if (preference.min !== undefined && propertyFloor < preference.min) return false;
  if (preference.max !== undefined && propertyFloor > preference.max) return false;
  return true;
}

/** ניסוח ההעדפה למסך ולהסבר ההתאמה. `undefined` = לא נאמר. */
export function floorPreferenceText(preference: FloorPreference | undefined): string | undefined {
  if (preference === undefined) return undefined;
  if (preference.mode === "list") {
    if (preference.floors.length === 0) return undefined;
    /*
     * ממוין, כי הסדר שבו סומנו התיבות אינו סדר שמישהו רוצה לקרוא —
     * ‎„קרקע, 5, 1” הוא אותה דרישה בדיוק ונראה כמו טעות.
     */
    return [...preference.floors].sort((a, b) => a - b).map(floorLabel).join(", ");
  }
  const { min, max } = preference;
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined) {
    return min === max ? floorLabel(min) : `${floorLabel(min)} עד ${floorLabel(max)}`;
  }
  return min === undefined ? `עד ${floorLabel(max!)}` : `${floorLabel(min)} ומעלה`;
}
