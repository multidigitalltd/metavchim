import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * ‎**כפתור „פתח במערכת” שנוחת על „העמוד לא נמצא”.**
 *
 * ‏הכפתור אינו נושא כתובת מלאה אלא **סיפא**, ו-Meta מדביקה אותה
 * ‏לכתובת בסיס שנרשמה בעורך התבניות שלה. הסיפא חייבת להיות נתיב
 * ‏בלי לוכסן מוביל — בדיוק מה ש-`whatsappDeepLinkSuffix` מחזיר,
 * ‏והוא גם זה שמטפל בשלושת המקרים שאין להם צורה נכונה אחרת:
 *
 * ‏* ‏כתובת מלאה של המערכת — רק מה שאחרי המקור.
 * ‏* ‏כתובת ממקור זר — אינה נדבקת מתחת לבסיס שלנו.
 * ‏* ‏בלי יעד — מסך ההתראות, כי סיפא ריקה פוסלת את ההודעה כולה.
 *
 * ‏קורא שיבנה את הסיפא ביד יקבל את הצורה הנכונה ביום שנכתב, ואת
 * ‏השגויה ביום שמישהו יעביר לו כתובת מלאה. זה אינו חשש תיאורטי:
 * ‏זו בדיוק המחלקה שבה „הקישור שהבוט שולח” כבר נשבר פעמיים.
 *
 * ‏לכן הכלל מבני: כל סיפא שנשלחת לכפתור עוברת דרך אותה פונקציה.
 */
describe("כפתור „פתח במערכת” — סיפא אחת, ממקור אחד", () => {
  const roots = [
    join(import.meta.dirname, "..", ".."),
    join(import.meta.dirname, "..", "..", "..", "..", "workers", "src"),
  ];

  /** ‏הגבול עצמו: כאן הסיפא כבר התקבלה כארגומנט, ואין מה לעטוף. */
  const BOUNDARY = join("messaging", "whatsapp-send.service.ts");

  it("‏אף קורא אינו בונה סיפא בעצמו", () => {
    const offenders: string[] = [];

    /*
     * ‎**כל ענף בנפרד.**
     *
     * ‏אתר הקריאה האמיתי הוא שלשה: `hasButton ? suffix(...) : undefined`
     * ‏— התבנית נרשמה עם כפתור או בלעדיו, וזו תשובה תקינה לשני
     * ‏הכיוונים. גרסה ראשונה של הבדיקה הזו נפלה עליו, כלומר סימנה
     * ‏קוד תקין; בדיקה כזו אינה מחמירה אלא שקרית, ומי שייתקל בה
     * ‏ילמד לעקוף אותה. לכן השלשה נפתחת, וכל ענף נשאל בנפרד.
     */
    const ok = (node: ts.Expression | undefined): boolean => {
      if (node === undefined) return true;
      if (ts.isParenthesizedExpression(node)) return ok(node.expression);
      /* ‏שלשה ו-`??` — שני הענפים חייבים לעמוד בכלל, לא אחד מהם */
      if (ts.isConditionalExpression(node)) {
        return ok(node.whenTrue) && ok(node.whenFalse);
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return ok(node.left) && ok(node.right);
      }
      /* ‏`undefined` מפורש = „לתבנית הזו אין כפתור” */
      if (ts.isIdentifier(node) && node.text === "undefined") return true;
      return (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "whatsappDeepLinkSuffix"
      );
    };

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.ts$/u.test(entry.name) || /\.test\.ts$/u.test(entry.name)) continue;
        if (full.endsWith(BOUNDARY)) continue;

        const text = readFileSync(full, "utf8");
        if (!text.includes("sendTemplate") && !text.includes("whatsappTemplateButton")) continue;
        const source = ts.createSourceFile(full, text, ts.ScriptTarget.ES2023, true);

        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node)) {
            const name = ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name.text
              : ts.isIdentifier(node.expression)
                ? node.expression.text
                : "";
            /* ‏הסיפא היא הארגומנט החמישי של `sendTemplate`, והראשון של הכפתור. */
            const arg =
              name === "sendTemplate"
                ? node.arguments[4]
                : name === "whatsappTemplateButton"
                  ? node.arguments[0]
                  : undefined;
            const relevant = name === "sendTemplate" || name === "whatsappTemplateButton";
            if (relevant && !ok(arg)) {
              const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
              offenders.push(`${full}:${line + 1}`);
            }
          }
          ts.forEachChild(node, visit);
        };
        ts.forEachChild(source, visit);
      }
    };
    for (const root of roots) walk(root);

    expect(
      offenders,
      `‏סיפא שנבנתה ידנית — יש להעביר אותה דרך whatsappDeepLinkSuffix:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  /*
   * ‏בדיקה מבנית שלא נבדקה היא בדיקה שאולי אינה בודקת כלום.
   */
  it("‏הבדיקה תופסת סיפא שנבנתה ביד", () => {
    const cases: [string, number][] = [
      ['send.sendTemplate(a, b, c, d, whatsappDeepLinkSuffix(url));', 0],
      ['send.sendTemplate(a, b, c, d, `properties/${id}`);', 1],
      ['send.sendTemplate(a, b, c, d);', 0],
      /* ‏אתר הקריאה האמיתי: שלשה שבה שני הענפים תקינים */
      ["send.sendTemplate(a, b, c, d, has ? whatsappDeepLinkSuffix(u) : undefined);", 0],
      /* ‏ושלשה שבה ענף אחד בונה ביד — עדיין נתפסת */
      ['send.sendTemplate(a, b, c, d, has ? whatsappDeepLinkSuffix(u) : "x/y");', 1],
      ['whatsappTemplateButton("properties/" + id);', 1],
      ["whatsappTemplateButton(whatsappDeepLinkSuffix(url));", 0],
    ];
    for (const [code, expected] of cases) {
      const source = ts.createSourceFile("probe.ts", code, ts.ScriptTarget.ES2023, true);
      let hits = 0;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const name = ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : ts.isIdentifier(node.expression)
              ? node.expression.text
              : "";
          const arg =
            name === "sendTemplate"
              ? node.arguments[4]
              : name === "whatsappTemplateButton"
                ? node.arguments[0]
                : undefined;
          if (name === "sendTemplate" || name === "whatsappTemplateButton") {
            const fine = (n: ts.Expression | undefined): boolean => {
              if (n === undefined) return true;
              if (ts.isParenthesizedExpression(n)) return fine(n.expression);
              if (ts.isConditionalExpression(n)) return fine(n.whenTrue) && fine(n.whenFalse);
              if (ts.isIdentifier(n) && n.text === "undefined") return true;
              return (
                ts.isCallExpression(n) &&
                ts.isIdentifier(n.expression) &&
                n.expression.text === "whatsappDeepLinkSuffix"
              );
            };
            if (!fine(arg)) hits += 1;
          }
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
      expect(hits, code).toBe(expected);
    }
  });
});
