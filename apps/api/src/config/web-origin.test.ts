import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { normalizeWebOrigin } from "@metavchim/shared";

/**
 * ‎**„העמוד לא נמצא” על כל קישור שהמערכת שולחת.**
 *
 * עשרות מקומות בונים כתובת כ-`${WEB_ORIGIN}${path}`. לוכסן אחד
 * בסוף הערך הופך את כולם ל-`https://host//path` — נתיב שאינו קיים.
 * זה אינו באג בקישור אחד אלא בכולם בבת אחת, והוא נראה בדיוק כמו
 * „הבוט מביא קישורים שבורים”.
 *
 * ‎**חמישה קוראים כבר גילו את זה וניקו בעצמם**, וזו בדיוק הצורה
 * שבה כלל אחד הופך לחמישה עותקים: מי שכותב את הקורא השישי לא יידע
 * שהוא צריך. הנרמול עבר לגבול הסביבה, והבדיקה כאן היא על שני
 * החלקים — שהוא שם, ושאיש אינו מנקה שוב.
 */

/* ‏אותה הצהרה כמו ב-`env.ts`; הטענה למטה מוודאת שהיא לא נפרדה ממנה. */
const WebOrigin = z.string().url().transform(normalizeWebOrigin);

describe("WEB_ORIGIN — בלי לוכסן בסוף", () => {
  it("לוכסן אחד נחתך", () => {
    expect(WebOrigin.parse("https://app.example.com/")).toBe("https://app.example.com");
  });

  it("כמה לוכסנים נחתכים יחד", () => {
    expect(WebOrigin.parse("https://app.example.com///")).toBe("https://app.example.com");
  });

  it("כתובת תקינה נשארת כפי שהיא", () => {
    expect(WebOrigin.parse("https://app.example.com")).toBe("https://app.example.com");
  });

  it("כתובת שאינה URL עדיין נדחית", () => {
    expect(WebOrigin.safeParse("app.example.com").success).toBe(false);
  });
});

/**
 * ‎**והנרמול יושב ב-`env.ts`, פעם אחת.**
 *
 * בלי הטענה הזו הבדיקה למעלה בודקת ביטוי שהיא עצמה כתבה — ירוקה
 * תמיד, גם ביום שבו `env.ts` יאבד את ה-`transform`.
 */
describe("מקום אחד לכלל", () => {
  const root = join(import.meta.dirname, "..", "..");
  /* ‏שורש ה-Workers — התהליך השני שקורא את אותו משתנה. */
  const workers = join(root, "..", "workers");

  it("‏`env.ts` מנרמל את WEB_ORIGIN דרך הכלל המשותף", () => {
    const env = readFileSync(join(root, "src/config/env.ts"), "utf8");
    expect(env).toMatch(/WEB_ORIGIN:[\s\S]{0,120}?normalizeWebOrigin/u);
  });

  /*
   * ‎**וגם ה-Workers — התהליך שהתיקון הקודם פספס.**
   *
   * ‏הבדיקה הזו נכתבה ב-#550 וסרקה את `apps/api/src` בלבד. ה-Workers
   * ‏בונים את ההודעות שהבוט שולח, אינם עוברים דרך `loadEnv()`,
   * ‏וקראו `process.env["WEB_ORIGIN"] ?? ""` גולמי — כלומר הכלל כוסה
   * ‏בתהליך אחד מתוך שניים, והתהליך שנשאר בחוץ הוא זה ששולח את
   * ‏הקישורים. הדיווח חזר (דיווח המשתמש, פעם שנייה).
   *
   * ‏שני שורשים ולא אחד, כי זו בדיוק ההנחה ששגתה.
   */
  it("‏אף תהליך אינו קורא את WEB_ORIGIN גולמי", () => {
    const offenders: string[] = [];
    for (const base of [join(root, "src"), join(workers, "src")]) {
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.ts$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name)) {
            const text = readFileSync(full, "utf8");
            /* ‏`env.ts` הוא הגבול עצמו, ושם הקריאה הגולמית נכונה. */
            if (full.endsWith(join("config", "env.ts"))) continue;
            if (/process\.env\[?["']WEB_ORIGIN["']\]?/u.test(text)) {
              /* ‏קריאה שעוברת דרך הכלל המשותף אינה גולמית */
              if (!/webOriginFromEnv\(/u.test(text)) offenders.push(full);
            }
          }
        }
      };
      walk(base);
    }
    expect(
      offenders,
      `‏קריאה גולמית ל-WEB_ORIGIN — יש להשתמש ב-webOriginFromEnv:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  /*
   * ‏ניקוי חוזר אצל קורא אינו שגוי — הוא פשוט הכלל במקום השני, ושני
   * עותקים של כלל אחד נפרדים ביום מן הימים. כאן הם נספרים.
   */
  it("אף קורא אינו מנקה בעצמו", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name)) {
          const text = readFileSync(full, "utf8");
          if (/(?:WEB_ORIGIN|webOrigin|origin)\.replace\(\/\\\/\+\$\/u/u.test(text)) {
            offenders.push(full.slice(root.length + 1));
          }
        }
      }
    };
    walk(join(root, "src"));
    expect(offenders).toEqual([]);
  });
});
