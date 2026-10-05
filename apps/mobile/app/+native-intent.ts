import { routeFor } from "@/lib/nav";

/**
 * ‏קישור שנפתח באפליקציה מבחוץ — הודעת וואטסאפ עם קישור לליד, מייל
 * ‏עם קישור לנכס, או החזרה מ-Google. expo-router מנתב לפי הנתיב כמו
 * ‏שהוא, ולאפליקציה אין מסך נייטיבי לכל נתיב של המערכת; כאן הנתיב
 * ‏עובר את אותה מפה כמו התראה ופריט תפריט (`routeFor`): מסך נייטיבי
 * ‏כשיש, ואחרת ה-web המוטמע. כך אין „אין מסך כזה” לקישור שהגיע
 * ‏מבחוץ.
 *
 * ‏החזרה מ-Google (`metavchim://auth/google?code=…`) נשארת כמות שהיא:
 * ‏המסך `auth/google` הוא נייטיבי, ו-`routeFor` היה שולח אותו ל-web.
 *
 * ‏הפירוק הוא ביטוי רגולרי ולא `URL`: `URL` של הסביבה אינו מובטח
 * ‏לפרק סכימה מותאמת (`metavchim://`) כמו סכימת רשת — ופירוק שנכשל
 * ‏או מפרק אחרת היה שולח את החזרה מ-Google לעמוד web שאינו קיים.
 */

/** ‏`scheme://host/path?query#hash` — כל חלק רשות מלבד הסכימה והמארח. */
const WITH_SCHEME = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/iu;
/** ‏נתיב בלי סכימה — `/leads/…?x=1`. */
const BARE_PATH = /^([^?#]*)(\?[^#]*)?(#.*)?$/u;

export function systemPathToRoute(path: string): string {
  let pathname: string;
  let rest: string;
  const withScheme = WITH_SCHEME.exec(path);
  if (withScheme) {
    const [, scheme = "", host = "", p = "", search = "", hash = ""] = withScheme;
    const lower = scheme.toLowerCase();
    const web = lower === "https" || lower === "http";
    // ‏סכימה של האפליקציה: `metavchim://auth/google` — המארח הוא המקטע הראשון של הנתיב
    pathname = web ? p || "/" : `/${host}${p}`;
    rest = `${search}${hash}`;
  } else {
    const bare = BARE_PATH.exec(path);
    const [, p = "/", search = "", hash = ""] = bare ?? [];
    pathname = p.startsWith("/") ? p : `/${p}`;
    rest = `${search}${hash}`;
  }
  if (pathname.startsWith("/auth/")) return `${pathname}${rest}`;
  if (pathname === "/" || pathname === "") return "/web/home";
  return routeFor(`${pathname}${rest}`);
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return systemPathToRoute(path);
  } catch {
    return "/web/home";
  }
}
