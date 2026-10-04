import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ‎**הבקרים של `/platform` — לבדיקות מבניות שסורקות את כולם.**
 *
 * ‏הבקר פוצל לפי תחום (משרדים, כסף, הגדרות, מערכת). בדיקה שסורקת „את
 * ‏הבקר” סורקת את כולם יחד: איסור שנבדק בקובץ אחד מפסיק לשמור ברגע
 * ‏שהקוד עובר לקובץ השכן. הרשימה נגזרת מהתיקייה ולא נכתבת ביד.
 */
export const PLATFORM_CONTROLLERS: readonly string[] = readdirSync(import.meta.dirname)
  .filter((name) => /^platform-[a-z]+\.controller\.ts$/u.test(name))
  .sort();

export function platformControllersSource(): string {
  return PLATFORM_CONTROLLERS.map((name) => readFileSync(join(import.meta.dirname, name), "utf8")).join("\n");
}
