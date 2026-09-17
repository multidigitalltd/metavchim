/**
 * ‏כתובת ה-API.
 *
 * ‏`EXPO_PUBLIC_*` נצרב בזמן הבנייה, כמו `NEXT_PUBLIC_*` ב-web. בפיתוח
 * ‏הוא כתובת המחשב ברשת המקומית (ראו `.env.example`); בבנייה לחנויות
 * ‏— כתובת הייצור. אין ברירת מחדל ל-localhost: על מכשיר אמיתי היא
 * ‏מצביעה על המכשיר עצמו, ומסך ההתחברות היה נכשל בלי להסביר למה.
 */
const configured = process.env["EXPO_PUBLIC_API_URL"];

export const API_ORIGIN = (configured ?? "").replace(/\/+$/u, "");
export const API_BASE = `${API_ORIGIN}/api/v1`;
export const API_CONFIGURED = API_ORIGIN !== "";
