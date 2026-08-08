"use client";

/**
 * העדפות תצוגה ונגישות — **אישיות למשתמש הזה במכשיר הזה**, ולא הגדרת
 * מערכת. הן נשמרות ב-localStorage ומיושמות כ-data-attributes על
 * <html> (ה-CSS ב-globals.css).
 *
 * ההעדפות עברו לעמוד הפרופיל: כפתור צף בפינת כל מסך הוא בדיוק הדבר
 * שמפריע לעבודה יומיומית של מתווך, ומי שצריך את ההגדרות האלה מגדיר
 * אותן פעם אחת ולא חוזר אליהן.
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

export const A11Y_STORAGE_KEY = "mv-a11y";

export function applyA11y(prefs: A11yPrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--a11y-font-scale", String(prefs.fontScale / 100));
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
    return { ...A11Y_DEFAULTS, ...(JSON.parse(raw) as Partial<A11yPrefs>) };
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

export const A11Y_TOGGLES: { key: keyof A11yPrefs; label: string; hint: string }[] = [
  { key: "contrast", label: "ניגודיות גבוהה", hint: "שחור על לבן, בלי צללים" },
  { key: "grayscale", label: "גווני אפור", hint: "מבטל צבע לגמרי" },
  { key: "underlineLinks", label: "הדגשת קישורים", hint: "קו תחתון בכל קישור" },
  { key: "highlightHeadings", label: "הדגשת כותרות", hint: "מסגרת מקווקוות סביב כותרות" },
  { key: "readableFont", label: "פונט קריא", hint: "מחליף את פונט המותג ומרווח שורות" },
  { key: "stopAnimations", label: "עצירת אנימציות", hint: "בלי תנועה על המסך" },
  { key: "readingGuide", label: "קו קריאה", hint: "פס אופקי שעוקב אחרי העכבר" },
];
