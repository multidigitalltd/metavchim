"use client";

/**
 * העדפות תצוגה ונגישות — **אישיות למשתמש**, ולא הגדרת מערכת ולא
 * הגדרת מכשיר. הן מיושמות כ-data-attributes על <html>
 * (ה-CSS ב-globals.css).
 *
 * מקור האמת הוא השרת, ו-localStorage הוא מטמון בלבד.
 *
 * ההנחה הקודמת הייתה שההעדפות תלויות מכשיר (גודל מסך, עכבר), ולכן
 * הן ישבו ב-localStorage בלבד. בפועל מתווך שמגדיל פונט או מדליק
 * ניגודיות עושה זאת בגלל *העיניים שלו*, ומצא את עצמו מגדיר מחדש
 * בכל מכשיר. המטמון נשאר כדי שההעדפה תוחל מיד בטעינה ולא אחרי
 * שהשרת עונה — בלעדיו המסך היה מהבהב מברירת מחדל להעדפה.
 *
 * ## שני מקומות, מקור אחד
 *
 * ההתאמות זמינות משני מקומות: עמוד הפרופיל — למשתמש מחובר, בתוך
 * המערכת — ו**כפתור הנגישות** הצף (`a11y-toolbar.tsx`) במסכים
 * הציבוריים בלבד: דף ההצעה, דף החתימה ומסך ההתחברות, שאין בהם
 * פרופיל בכלל, ושת"י 5568 דורש שההתאמות יהיו זמינות בהם מכל עמוד.
 *
 * שני המקומות כותבים דרך `commitA11y` בלבד, ולכן אין להם דרך
 * להיפרד זה מזה: הפאנל הצף ועמוד הפרופיל מאזינים לאותו אירוע
 * ומציגים תמיד את אותו מצב.
 */

export interface A11yPrefs {
  fontScale: number; // 100 = רגיל
  contrast: boolean;
  grayscale: boolean;
  underlineLinks: boolean;
  highlightHeadings: boolean;
  readableFont: boolean;
  stopAnimations: boolean;
  readingGuide: boolean;
}

/**
 * הסקלה אינה יורדת מתחת ל-100%.
 *
 * הסקלה פועלת על גודל הבסיס של השורש, ולכן היא מכפילה גם את
 * מחלקות ה-rem של Tailwind: ‎`text-sm`‎ הוא ‎0.875rem‎, ובסקלה 90%
 * הוא נופל ל-12.6px — מתחת לרצפת ה-14px של המערכת. כלומר כפתור
 * „הקטן טקסט” היה מבטל את הרצפה בלחיצה אחת, ושער הטיפוגרפיה היה
 * ממשיך לדווח „תקין” כי הוא בודק את הקוד ולא את הריצה (ביקורת
 * Codex, PR #163).
 *
 * ההקטנה גם אינה נדרשת: ת"י 5568 ו-WCAG 1.4.4 דורשים יכולת
 * **הגדלה** עד 200%, ולא הקטנה. מי שרוצה יותר טקסט על המסך עושה
 * זאת בזום של הדפדפן, שמקטין גם את הפריסה ולא רק את האותיות.
 */
export const A11Y_MIN_SCALE = 100;
export const A11Y_MAX_SCALE = 200;

/** קיצוץ לטווח המותר — נקודה אחת, כדי שלא תישאר דרך לעקוף אותה */
export function clampFontScale(value: number): number {
  // ‎NaN‎ מ-JSON פגום היה עובר את ‎Math.max‎ ומגיע ל-CSS כערך לא חוקי
  if (!Number.isFinite(value)) return A11Y_MIN_SCALE;
  return Math.min(A11Y_MAX_SCALE, Math.max(A11Y_MIN_SCALE, Math.round(value)));
}

export const A11Y_DEFAULTS: A11yPrefs = {
  fontScale: 100,
  contrast: false,
  grayscale: false,
  underlineLinks: false,
  highlightHeadings: false,
  readableFont: false,
  stopAnimations: false,
  readingGuide: false,
};

const A11Y_STORAGE_KEY = "mv-a11y";

export function applyA11y(prefs: A11yPrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // קיצוץ גם כאן ולא רק במסך: זו הנקודה היחידה שכותבת את המשתנה
  // ל-CSS, ולכן זה המקום היחיד שבו אפשר להבטיח את הרצפה בפועל.
  root.style.setProperty("--a11y-font-scale", String(clampFontScale(prefs.fontScale) / 100));
  const flags: [keyof A11yPrefs, string][] = [
    ["contrast", "a11yContrast"],
    ["grayscale", "a11yGrayscale"],
    ["underlineLinks", "a11yUnderline"],
    ["highlightHeadings", "a11yHeadings"],
    ["readableFont", "a11yReadable"],
    ["stopAnimations", "a11yNoMotion"],
  ];
  for (const [key, dataAttr] of flags) {
    if (prefs[key]) root.dataset[dataAttr] = "on";
    else delete root.dataset[dataAttr];
  }
}

export function loadA11y(): A11yPrefs {
  if (typeof window === "undefined") return A11Y_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(A11Y_STORAGE_KEY);
    if (!raw) return A11Y_DEFAULTS;
    const stored = { ...A11Y_DEFAULTS, ...(JSON.parse(raw) as Partial<A11yPrefs>) };
    /*
     * משתמש שכבר בחר 90% לפני שהרצפה נקבעה נושא את הערך במטמון,
     * וטעינה בלעדית של מה שנשמר הייתה מחזירה אותו מתחת לרצפה
     * בכל רענון — כלומר תיקון שאינו מגיע דווקא למי שנפגע ממנו.
     */
    return { ...stored, fontScale: clampFontScale(stored.fontScale) };
  } catch {
    return A11Y_DEFAULTS; // localStorage חסום — נופל בחן לברירות המחדל
  }
}

export function saveA11y(prefs: A11yPrefs): void {
  try {
    window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function clearA11y(): void {
  try {
    window.localStorage.removeItem(A11Y_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * שם האירוע שמודיע לכל המסך על שינוי בהעדפות.
 *
 * הפאנל הצף, עמוד הפרופיל וקו הקריאה שב-layout מאזינים לו, כך
 * ששינוי במקום אחד מופיע מיד בכולם — בלי רענון ובלי מצב כפול.
 */
export const A11Y_CHANGE_EVENT = "mv-a11y-change";

/**
 * החלת העדפות **בפועל** — המסך, המטמון וההודעה לכל המאזינים.
 *
 * זו הנקודה היחידה שכותבת העדפה. הפאנל הצף ועמוד הפרופיל קוראים
 * לה במקום לחזור על שלושת הצעדים בעצמם; מי שחוזר עליהם ידנית
 * הוא מי ששוכח את השלישי, ואז קו הקריאה נשאר דלוק אחרי שכיבו אותו.
 *
 * השמירה בשרת אינה כאן — היא ב-`a11y-sync.ts`, שיודע לדבר עם
 * ה-API. הקובץ הזה נשאר טהור: DOM ו-localStorage בלבד.
 */
export function commitA11y(next: A11yPrefs): A11yPrefs {
  const safe = { ...next, fontScale: clampFontScale(next.fontScale) };
  applyA11y(safe);
  saveA11y(safe);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(A11Y_CHANGE_EVENT, { detail: safe }));
  }
  return safe;
}

/** חזרה לברירות המחדל — מנקה גם את המטמון, לא רק את המסך. */
export function resetA11y(): A11yPrefs {
  applyA11y(A11Y_DEFAULTS);
  clearA11y();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(A11Y_CHANGE_EVENT, { detail: A11Y_DEFAULTS }));
  }
  return A11Y_DEFAULTS;
}

/** כמה מההתאמות פעילות — למונה שעל כפתור הנגישות. */
export function activeA11yCount(prefs: A11yPrefs): number {
  let count = prefs.fontScale !== A11Y_DEFAULTS.fontScale ? 1 : 0;
  for (const toggle of A11Y_TOGGLES) if (prefs[toggle.key]) count += 1;
  return count;
}

/**
 * המתגים, בסדר שבו הם מוצגים — הנפוצים קודם.
 *
 * ‎`key` היא הצורה שבה המתג נשמר, ‎`label` היא שמו, ו-‎`hint` אומר
 * במילה מה יקרה — כדי שאיש לא יצטרך להדליק כדי לגלות.
 */
export const A11Y_TOGGLES: {
  key: Exclude<keyof A11yPrefs, "fontScale">;
  label: string;
  hint: string;
}[] = [
  { key: "contrast", label: "ניגודיות גבוהה", hint: "שחור על לבן, בלי צללים וגוונים" },
  { key: "readableFont", label: "גופן קריא", hint: "גופן פשוט, אותיות מרווחות ושורות אווריריות" },
  { key: "underlineLinks", label: "הדגשת קישורים", hint: "קו תחתון בכל קישור, לא רק בריחוף" },
  { key: "highlightHeadings", label: "הדגשת כותרות", hint: "מסגרת סביב כל כותרת — קל לסרוק עמוד" },
  { key: "stopAnimations", label: "עצירת תנועה", hint: "בלי אנימציות ובלי מעברים" },
  { key: "readingGuide", label: "קו קריאה", hint: "פס מודגש שעוקב אחרי הסמן" },
  { key: "grayscale", label: "גווני אפור", hint: "מבטל צבעים לגמרי" },
];
