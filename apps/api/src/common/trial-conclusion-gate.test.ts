import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**כל מי שמוחק את תאריך הניסיון רושם גם למה.**
 *
 * ## ‏למה שער ולא בדיקה
 *
 * ‏`trialEndsAt` ריק הוא דו-משמעי: „הניסיון נגמר” ו„הערך אופס
 * ‏זמנית”. משפך ההמרה מכריע **הפוך** בין השניים — הראשון סוגר את
 * ‏הרישום, השני מחייב להשאיר אותו פתוח — ולכן מוחק שאינו רושם את
 * ‏הסיבה יוצר רישום שנשאר פתוח לנצח וכל סבב סורק אותו מחדש.
 *
 * ‏מניתי את המוחקים פעמיים, ופעמיים פספסתי אחד. בפעם הראשונה את
 * ‏„פתח ללא תפוגה”, ובשנייה את הפעלת המנוי בקופון של 100% — ששם
 * ‏גם אין כרטיס, ולכן „הרישום ייסגר כ„שילם”” אינו נכון (ביקורת
 * ‏Codex, שתי פעמים). ספירה ידנית אינה מחזיקה; שער כן.
 *
 * ## ‏מה השער אינו יכול לראות
 *
 * ‏הוא קורא כתיבה מפורשת של `trialEndsAt: null`. השמה דרך משתנה —
 * ‏כמו ב-`billing-override`, שם `null` הוא **בכוונה** האיפוס הזמני
 * ‏שאין לרשום עליו סיבה — אינה נתפסת, וזה הנכון: שם היעדר הרישום
 * ‏הוא ההחלטה עצמה.
 */

const API_SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): { name: string; code: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name));
    if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) return [];
    const full = join(dir, entry.name);
    return [{ name: full.slice(API_SRC.length + 1), code: readFileSync(full, "utf8") }];
  });
}

/**
 * ‎**הערות מוחלפות בשורות ריקות, ולא נמחקות.**
 *
 * ‏החלון אמור למדוד מרחק ב**קוד**: הקובץ הזה נושא הסברים בני עשר
 * ‏שורות בין שדה לשדה, וחלון על הטקסט הגולמי היה מכריז „לא נרשם”
 * ‏על כתיבה שרושמת יפה מאוד. שמירת מספר השורות משאירה את המיקום
 * ‏בדיווח נכון.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (block) => "\n".repeat((block.match(/\n/gu) ?? []).length))
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

/** ‏כל כתיבה מפורשת של „אין תאריך ניסיון”, עם ההקשר שסביבה. */
function clearingSites(): { file: string; line: number; window: string }[] {
  const sites: { file: string; line: number; window: string }[] = [];
  for (const file of sourceFiles(API_SRC)) {
    /*
     * ‎**שורות קוד בלבד, ועם מספר השורה המקורי.**
     *
     * ‏הסרת ההערות משאירה שורות ריקות במקומן, וחלון שסופר שורות
     * ‏גולמיות היה מתמלא בהן ומחמיץ את השדה שנמצא שבע שורות למטה.
     * ‏הספירה היא על מה שנכתב, והמספר נשמר כדי שהדיווח יצביע על
     * ‏המקום הנכון בקובץ.
     */
    const code = codeOnly(file.code)
      .split("\n")
      .map((text, index) => ({ line: index + 1, text }))
      .filter((row) => row.text.trim() !== "");
    for (const [index, row] of code.entries()) {
      if (!/\btrialEndsAt:\s*null\b/u.test(row.text)) continue;
      /*
       * ‏חלון ולא השורה עצמה: הסיבה נרשמת בשדה שכן באותו אובייקט,
       * ‏ולא בהכרח בשורה שאחריה. ארבע שורות קוד לכל צד מכסות
       * ‏אובייקט אחד בלי לבלוע את שכנו.
       */
      sites.push({
        file: file.name,
        line: row.line,
        window: code
          .slice(Math.max(0, index - 4), index + 5)
          .map((entry) => entry.text)
          .join("\n"),
      });
    }
  }
  return sites;
}

describe("שער: מחיקת תאריך ניסיון רושמת את הסיבה", () => {
  const sites = clearingSites();

  /*
   * ‏בלי זה השער ירוק על כלום: ביטוי שנשבר או תיקיה שזזה היו
   * ‏הופכים אותו לבדיקה שעוברת תמיד. שני המוחקים המוכרים רשומים
   * ‏בשמם — לא כרשימה שנייה לתחזק, אלא כדי שנפילת הסריקה תיראה.
   */
  it("יש מה לבדוק", () => {
    expect(sites.length).toBeGreaterThanOrEqual(3);
    const files = new Set(sites.map((site) => site.file));
    expect(files).toContain("modules/billing/billing.service.ts");
    expect(files).toContain("modules/platform/platform.controller.ts");
  });

  it("כל מחיקה רושמת `trialConcludedAt` באותה כתיבה", () => {
    const silent = sites.filter((site) => !site.window.includes("trialConcludedAt"));
    expect(
      silent.map((site) => `${site.file}:${site.line}`),
      "מחקו את תאריך הניסיון בלי לרשום שהוא נגמר",
    ).toEqual([]);
  });
});
