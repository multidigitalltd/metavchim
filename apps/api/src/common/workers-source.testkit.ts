import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ‎**קוד המקור של תהליך ה-Workers — לבדיקות מבניות שקוראות אותו כטקסט.**
 *
 * ‏עם שמות קבצים — הקבצים האלה בלבד, כשהבדיקה נוגעת במשימה מסוימת.
 * ‏בלי — כל התהליך יחד, לבדיקות של „אין בשום מקום”: איסור שנבדק בקובץ
 * ‏אחד מפסיק לשמור ברגע שהקוד עובר לקובץ אחר.
 */
const ROOT = fileURLToPath(new URL("../../../workers/src/", import.meta.url));

export function workersSource(...files: string[]): string {
  const names =
    files.length > 0
      ? files
      : readdirSync(ROOT, { recursive: true, encoding: "utf8" })
          .filter((name) => name.endsWith(".ts"))
          .sort();
  return names.map((name) => readFileSync(join(ROOT, name), "utf8")).join("\n");
}
