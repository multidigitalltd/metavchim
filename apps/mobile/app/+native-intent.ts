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
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path, "https://app.metavchim.co.il");
    // ‏סכימה של האפליקציה: `metavchim://auth/google` — המארח הוא המקטע הראשון
    const pathname = url.protocol === "https:" || url.protocol === "http:"
      ? url.pathname
      : `/${url.host}${url.pathname}`;
    const rest = `${url.search}${url.hash}`;
    if (pathname.startsWith("/auth/")) return `${pathname}${rest}`;
    if (pathname === "/" || pathname === "") return "/web/home";
    return routeFor(`${pathname}${rest}`);
  } catch {
    return "/web/home";
  }
}
