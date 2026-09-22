import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
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
   *
   * ## ‏למה AST ולא רגקס
   *
   * ‏הגרסה הראשונה של הבדיקה הזו שאלה שתי שאלות על **הקובץ**:
   * ‏„יש בו קריאה גולמית?” ו„יש בו `webOriginFromEnv`?”. שתי
   * ‏הטעויות שנבעו מכך אמיתיות (ביקורת Codex):
   *
   * ‏ברגע ש-`main.ts` קורא נכון **פעם אחת**, הקובץ כולו קיבל פטור —
   * ‏וקריאה גולמית שנייה בתוכו הייתה עוברת בשקט. זה בדיוק הקובץ
   * ‏שבו הבאג הזה חי.
   *
   * ‏והרגקס דרש מרכאות, ולכן `process.env.WEB_ORIGIN` — הצורה
   * ‏השכיחה יותר — לא נתפסה **בכלל**.
   *
   * ‏שתיהן נעלמות כששואלים על כל **גישה** בנפרד: האם היא הארגומנט
   * ‏של `webOriginFromEnv`, כן או לא.
   */
  it("‏אף תהליך אינו קורא את WEB_ORIGIN גולמי", () => {
    const offenders: string[] = [];

    /** ‎`process.env.WEB_ORIGIN` או `process.env["WEB_ORIGIN"]` — שתי הצורות. */
    const readsWebOrigin = (node: ts.Node): boolean => {
      const isProcessEnv = (expr: ts.Node): boolean =>
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "process" &&
        expr.name.text === "env";
      if (ts.isPropertyAccessExpression(node)) {
        return isProcessEnv(node.expression) && node.name.text === "WEB_ORIGIN";
      }
      if (ts.isElementAccessExpression(node)) {
        return (
          isProcessEnv(node.expression) &&
          ts.isStringLiteralLike(node.argumentExpression) &&
          node.argumentExpression.text === "WEB_ORIGIN"
        );
      }
      return false;
    };

    /** ‏הגישה הזו היא הארגומנט של הכלל המשותף — ולא סתם באותו קובץ. */
    const wrapped = (node: ts.Node): boolean => {
      const call = node.parent;
      return (
        call !== undefined &&
        ts.isCallExpression(call) &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === "webOriginFromEnv" &&
        call.arguments.includes(node as ts.Expression)
      );
    };

    for (const base of [join(root, "src"), join(workers, "src")]) {
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!/\.ts$/u.test(entry.name) || /\.test\.ts$/u.test(entry.name)) continue;
          /* ‏`env.ts` הוא הגבול עצמו, ושם הקריאה הגולמית נכונה. */
          if (full.endsWith(join("config", "env.ts"))) continue;

          const text = readFileSync(full, "utf8");
          if (!text.includes("WEB_ORIGIN")) continue;
          const source = ts.createSourceFile(full, text, ts.ScriptTarget.ES2023, true);
          const visit = (node: ts.Node): void => {
            if (readsWebOrigin(node) && !wrapped(node)) {
              const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
              offenders.push(`${full}:${line + 1}`);
            }
            ts.forEachChild(node, visit);
          };
          ts.forEachChild(source, visit);
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
   * ‏בדיקה מבנית שלא נבדקה היא בדיקה שאולי אינה בודקת כלום — ושתי
   * ‏הצורות שנפלו קודם הן בדיוק מה שנבדק כאן.
   */
  it("‏הבדיקה תופסת את שתי הצורות, וגם קריאה שנייה באותו קובץ", () => {
    const cases: [string, number][] = [
      [`const a = process.env.WEB_ORIGIN;`, 1],
      [`const a = process.env["WEB_ORIGIN"];`, 1],
      [`const a = webOriginFromEnv(process.env["WEB_ORIGIN"]);`, 0],
      /* ‏הקובץ קורא נכון פעם אחת — והשנייה עדיין חייבת להיתפס */
      [
        `const a = webOriginFromEnv(process.env["WEB_ORIGIN"]);
const b = process.env.WEB_ORIGIN;`,
        1,
      ],
    ];
    for (const [code, expected] of cases) {
      const source = ts.createSourceFile("probe.ts", code, ts.ScriptTarget.ES2023, true);
      let hits = 0;
      const visit = (node: ts.Node): void => {
        const isEnv =
          (ts.isPropertyAccessExpression(node) && node.name.text === "WEB_ORIGIN") ||
          (ts.isElementAccessExpression(node) &&
            ts.isStringLiteralLike(node.argumentExpression) &&
            node.argumentExpression.text === "WEB_ORIGIN");
        if (isEnv) {
          const call = node.parent;
          const ok =
            call !== undefined &&
            ts.isCallExpression(call) &&
            ts.isIdentifier(call.expression) &&
            call.expression.text === "webOriginFromEnv";
          if (!ok) hits += 1;
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
      expect(hits, code).toBe(expected);
    }
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
