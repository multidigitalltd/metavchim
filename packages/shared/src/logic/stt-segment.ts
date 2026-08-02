/**
 * אורך קטע ההקלטה בתמלול רציף ("הטקסט מופיע תוך כדי הדיבור").
 *
 * העובדה שקובעת הכול: Whisper מקודד תמיד חלון של 30 שניות — גם עבור
 * קטע של 3 שניות. לכן עלות התמלול לבקשה כמעט קבועה ואינה תלויה באורך
 * הקטע. המסקנה המעשית הפוכה מהאינטואיציה: קטעים קצרים *לא* מזרזים את
 * התמלול החי אלא שוברים אותו — כל קטע עולה כמעט אותו זמן, וקטע קצר
 * מזמן העיבוד שלו מייצר פיגור שהולך וגדל עד שהטקסט מגיע אחרי שהדובר
 * כבר סיים.
 *
 * לכן הקטע נגזר מזמן העיבוד שנמדד בשרת בפועל, עם מרווח ביטחון —
 * וכשמשדרגים את החומרה התמלול מתהדק לבד בלי לגעת בקוד.
 */

/** מרווח ביטחון: הקטע ארוך ב-25% מזמן העיבוד הצפוי שלו. */
const HEADROOM = 1.25;
/** גבול תחתון — מתחתיו הדיוק בעברית יורד וגם התקורה מתבזבזת. */
export const SEGMENT_MIN_SECONDS = 8;
/** גבול עליון — מעליו הטקסט כבר לא מרגיש "חי". */
export const SEGMENT_MAX_SECONDS = 25;
/** לפני שנמדד משהו — הנחה שמרנית שלא תיצור פיגור. */
export const SEGMENT_DEFAULT_SECONDS = 20;

/**
 * @param avgSeconds ממוצע זמן העיבוד לבקשה בשרת התמלול, בשניות.
 */
export function recommendSegmentSeconds(avgSeconds: number | undefined | null): number {
  if (
    avgSeconds === undefined ||
    avgSeconds === null ||
    !Number.isFinite(avgSeconds) ||
    avgSeconds <= 0
  ) {
    return SEGMENT_DEFAULT_SECONDS;
  }
  const target = Math.ceil(avgSeconds * HEADROOM);
  return Math.min(SEGMENT_MAX_SECONDS, Math.max(SEGMENT_MIN_SECONDS, target));
}
