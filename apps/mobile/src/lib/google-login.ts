import * as WebBrowser from "expo-web-browser";
import {
  MOBILE_GOOGLE_RETURN_URL,
  parseMobileGoogleReturn,
  type MobileGoogleReturn,
} from "@metavchim/shared";
import { apiBase } from "./config";

/**
 * ‏התחברות עם Google מהאפליקציה.
 *
 * ‏הסבב עצמו רץ בדפדפן של המכשיר (Custom Tab / SFSafariViewController)
 * ‏מול אותם נתיבים כמו ב-web — `google/start` ו-`google/callback` —
 * ‏עם `client=mobile`, שמסיים בהפניה ל-`metavchim://auth/google` עם
 * ‏קוד חד-פעמי במקום עוגייה. הקוד מומר ל-Session ב-`google/exchange`
 * ‏(ראו `lib/auth`).
 *
 * ‏החזרה מגיעה לאפליקציה בשתי דרכים במקביל: הבטחת הדפדפן נפתרת עם
 * ‏הכתובת, וגם הניתוב של expo-router פותח את המסך `auth/google`.
 * ‏שניהם קוראים להמרה, והקוד הוא חד-פעמי — ולכן ההמרה נזכרת כאן לפי
 * ‏קוד, כדי שהשני יקבל את אותה תוצאה ולא „הקוד פג”.
 */

export type GoogleSignInOutcome = MobileGoogleReturn | { kind: "cancelled" };

export async function openGoogleSignIn(): Promise<GoogleSignInOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(
    `${apiBase()}/auth/google/start?client=mobile`,
    MOBILE_GOOGLE_RETURN_URL,
    // בחירת חשבון בכל כניסה — הסבב לא נשאר בשוליים של המכשיר
    { showInRecents: false, createTask: false },
  );
  if (result.type !== "success") return { kind: "cancelled" };
  return parseMobileGoogleReturn(result.url) ?? { kind: "error", error: "failed" };
}

const inFlight = new Map<string, Promise<unknown>>();

/** ‏פעם אחת לכל קוד: קריאה שנייה באותו קוד מקבלת את אותה הבטחה. */
export function redeemOnce<T>(code: string, redeem: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(code);
  if (existing) return existing as Promise<T>;
  const promise = redeem().finally(() => {
    // ‏הקוד מת בשרת אחרי דקה — אין טעם לזכור אותו יותר מזה
    setTimeout(() => inFlight.delete(code), 60_000);
  });
  inFlight.set(code, promise);
  return promise;
}
