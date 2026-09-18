/**
 * ‏החזרה מ-Google אל האפליקציה לנייד.
 *
 * ‏בדפדפן סבב ה-OAuth נגמר בעוגיית Session והפניה למסך של האפליקציה.
 * ‏לאפליקציה לנייד אין עוגייה שאפשר לסמוך עליה, ולכן השרת מסיים את
 * ‏הסבב בהפניה לכתובת עם הסכימה של האפליקציה, ובה **קוד חד-פעמי**
 * ‏קצר-חיים — לא ה-Session עצמו. הקוד מומר ל-Session בקריאת API
 * ‏אחת מתוך האפליקציה (`POST /auth/google/exchange`), כך שה-Session
 * ‏נולד לבקשה של האפליקציה, ולא נוסע בכתובת שדפדפן שומר בהיסטוריה.
 *
 * ‏הכתובת והצורה של החזרה יושבות כאן — מקום אחד ששני הצדדים
 * ‏מייבאים: השרת מרכיב אותה, והאפליקציה מפרקת אותה.
 */

/** ‏הסכימה של האפליקציה (`scheme` ב-`app.json`). */
export const MOBILE_APP_SCHEME = "metavchim";

/** ‏לאן Google (דרך השרת) מחזיר את האפליקציה בסיום הסבב. */
export const MOBILE_GOOGLE_RETURN_URL = `${MOBILE_APP_SCHEME}://auth/google`;

/** ‏32 בתים ב-base64url — אותה צורה כמו טוקן ה-Session. */
export const MOBILE_HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * ‏למה הכניסה נכשלה — אותן סיבות כמו `googleError` במסך ההתחברות
 * ‏ב-web, כדי שההודעה למשתמש תהיה אחת.
 */
export const MOBILE_GOOGLE_ERRORS = ["unknown", "unverified", "busy", "failed"] as const;
export type MobileGoogleError = (typeof MOBILE_GOOGLE_ERRORS)[number];

/**
 * ‏מה אומרים למשתמש על כל סיבה — נוסח אחד למסך ההתחברות ב-web
 * ‏ולאפליקציה. מדויק בלי לחשוף פרטי מערכת.
 */
export const GOOGLE_LOGIN_ERROR_TEXT: Record<MobileGoogleError, string> = {
  unknown: "החשבון לא קיים במערכת — בקשו ממנהל המשרד להוסיף אתכם",
  unverified: "כתובת האימייל אינה מאומתת אצל Google",
  /* תקרת פתיחת החשבונות מהכתובת הזו — חסימה לזמן קצוב, לא תקלה */
  busy: "נפתחו כבר כמה חשבונות מהכתובת הזו — נסו שוב בעוד שעה או פנו אלינו",
  failed: "ההתחברות עם Google נכשלה — נסו שוב או התחברו עם סיסמה",
};

/** ‏הנוסח לסיבה שהגיעה מבחוץ (פרמטר בכתובת) — סיבה לא מוכרת היא כישלון כללי. */
export function googleLoginErrorText(reason: unknown): string {
  return typeof reason === "string" && (MOBILE_GOOGLE_ERRORS as readonly string[]).includes(reason)
    ? GOOGLE_LOGIN_ERROR_TEXT[reason as MobileGoogleError]
    : GOOGLE_LOGIN_ERROR_TEXT.failed;
}

export type MobileGoogleReturn = { kind: "code"; code: string } | { kind: "error"; error: MobileGoogleError };

/** ‏הכתובת שהשרת מפנה אליה בסיום — עם קוד, או עם סיבת הכישלון. */
export function mobileGoogleReturnUrl(outcome: MobileGoogleReturn): string {
  // ‏הערכים הם base64url ושמות מהרשימה — בלי תווים שדורשים קידוד
  return outcome.kind === "code"
    ? `${MOBILE_GOOGLE_RETURN_URL}?code=${outcome.code}`
    : `${MOBILE_GOOGLE_RETURN_URL}?error=${outcome.error}`;
}

/**
 * ‏פירוק הכתובת שהאפליקציה קיבלה חזרה מהדפדפן.
 *
 * ‏`null` לכל דבר שאינו החזרה שלנו: סכימה או נתיב אחרים, קוד בצורה
 * ‏לא נכונה, שגיאה שאינה ברשימה. האפליקציה מתייחסת ל-`null` ככישלון
 * ‏כללי — לא כקוד שאפשר לנסות להמיר.
 */
export function parseMobileGoogleReturn(url: string): MobileGoogleReturn | null {
  const [base, query = ""] = url.split("?", 2);
  if (base !== MOBILE_GOOGLE_RETURN_URL) return null;
  const params = queryParams(query);
  const code = params.get("code");
  if (code !== undefined) {
    return MOBILE_HANDOFF_CODE_PATTERN.test(code) ? { kind: "code", code } : null;
  }
  const error = params.get("error");
  if (error !== undefined && (MOBILE_GOOGLE_ERRORS as readonly string[]).includes(error)) {
    return { kind: "error", error: error as MobileGoogleError };
  }
  return null;
}

/** ‏פירוק מחרוזת שאילתה בלי `URLSearchParams` — החבילה נבנית בלי ספריית DOM. */
function queryParams(query: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const [rawKey, ...rest] = pair.split("=");
    try {
      map.set(decodeURIComponent(rawKey ?? ""), decodeURIComponent(rest.join("=")));
    } catch {
      // קידוד שבור — המפתח אינו נספר
    }
  }
  return map;
}
