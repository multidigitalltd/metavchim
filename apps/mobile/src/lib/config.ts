import * as SecureStore from "expo-secure-store";

/**
 * ‏כתובת ה-API.
 *
 * ‏`EXPO_PUBLIC_*` נצרב בזמן הבנייה, כמו `NEXT_PUBLIC_*` ב-web: בפיתוח
 * ‏כתובת המחשב ברשת המקומית (ראו `.env.example`), בבנייה לחנויות —
 * ‏כתובת הייצור (`eas.json`). אין ברירת מחדל ל-localhost: על מכשיר
 * ‏אמיתי היא מצביעה על המכשיר עצמו.
 *
 * ‏**ומעל הצרוב — דריסה שנשמרת במכשיר.** APK אחד לבדיקות ידניות
 * ‏צריך לדבר פעם עם שרת מקומי ופעם עם הייצור, ובנייה מחדש לכל
 * ‏החלפה היא מחסום. הכתובת מוגדרת ב„הגדרות מתקדמות” במסך ההתחברות
 * ‏ונשמרת באחסון המאובטח; ריקון חוזר לצרוב.
 */
const BUILT_IN = (process.env["EXPO_PUBLIC_API_URL"] ?? "").replace(/\/+$/u, "");
const OVERRIDE_KEY = "mv_api_origin";

let origin = BUILT_IN;

export const BUILT_IN_API_ORIGIN = BUILT_IN;

/** ‏נקרא פעם אחת בעלייה, לפני הבקשה הראשונה. */
export async function loadApiOrigin(): Promise<string> {
  try {
    const saved = await SecureStore.getItemAsync(OVERRIDE_KEY);
    if (saved) origin = saved;
  } catch {
    // אחסון לא זמין — נשארים עם הצרוב
  }
  return origin;
}

export function apiOrigin(): string {
  return origin;
}

export function apiBase(): string {
  return `${origin}/api/v1`;
}

export function apiConfigured(): boolean {
  return origin !== "";
}

/** ‏`""` מסיר את הדריסה וחוזר לכתובת הצרובה. */
export async function setApiOrigin(value: string): Promise<string> {
  const cleaned = value.trim().replace(/\/+$/u, "");
  try {
    if (cleaned === "") await SecureStore.deleteItemAsync(OVERRIDE_KEY);
    else await SecureStore.setItemAsync(OVERRIDE_KEY, cleaned);
  } catch {
    // בלי אחסון הדריסה חיה עד ההפעלה הבאה בלבד
  }
  origin = cleaned === "" ? BUILT_IN : cleaned;
  return origin;
}

/** ‏כתובת תקינה: http(s) ומארח. בפיתוח http מותר — הרשת המקומית אינה מוצפנת. */
export function isValidApiOrigin(value: string): boolean {
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d{2,5})?$/u.test(value.trim().replace(/\/+$/u, ""));
}
