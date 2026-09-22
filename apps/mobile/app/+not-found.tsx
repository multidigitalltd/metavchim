import { Redirect, useGlobalSearchParams, usePathname } from "expo-router";
import { routeFor } from "@/lib/nav";

/**
 * ‏נתיב בלי מסך נייטיבי — קישור ישן, ניווט מהקוד, או כתובת שהוקלדה.
 * ‏במקום „Unmatched Route” של הנווט: אותה מפה כמו כל השאר (`routeFor`),
 * ‏שמובילה ל-web המוטמע. מסך שלא קיים גם ב-web מציג שם את „לא נמצא”
 * ‏של המערכת — הודעה בעברית, לא מסך של ספרייה.
 */
export default function NotFoundScreen() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  const query = Object.entries(params)
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
    .join("&");
  const target = routeFor(`${pathname}${query ? `?${query}` : ""}`);
  // ‏לולאה היא בלתי אפשרית: `/web/…` נתפס ב-`web/[...path]` ולא מגיע לכאן
  return <Redirect href={target} />;
}
