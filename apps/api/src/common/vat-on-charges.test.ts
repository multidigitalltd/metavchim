import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ‎**כל סכום שנשלח לסולק חייב לעבור דרך `VatService`.**
 *
 * ## למה זו בדיקה ולא כלל בראש
 *
 * המחירון של הפלטפורמה נקוב **לפני מע"מ**. כלומר בין המספר ששמור
 * במסלול (`monthlyPriceAgorot`) לבין הסכום שקארדקום גובה יש שלב
 * חובה, והוא נראה כמו שורה אחת שקל לשכוח:
 *
 * ```ts
 * const amountAgorot = await this.vat.gross(netAgorot);
 * ```
 *
 * מה קורה כששוכחים אותה? **שום דבר גלוי.** הקוד מתקמפל, הבדיקות
 * עוברות, דף התשלום נפתח, והלקוח משלם — 18% פחות ממה שהיה אמור.
 * החשבונית שנבנית מהסכום שנגבה תהיה עקבית עם עצמה ולא עם המחירון,
 * ולכן גם היא לא תצעק. את הפער מגלים בהתאמת ספרים, חודשים אחרי,
 * על כל הלקוחות שנרשמו בינתיים — ואי אפשר לגבות רטרואקטיבית.
 *
 * זו בדיוק אותה משפחה כמו `platform-settings-coverage`: תכונה
 * שנשברת **בשקט** מקבלת שער מבני, לא הערה.
 *
 * ## מה נבדק בדיוק
 *
 * לכל קריאה ל-`createPaymentPage` או ל-`chargeToken`, הערך שנשלח
 * ב-`amountAgorot` חייב להיות משתנה שהושם באותה מתודה מ-
 * `await this.vat.…`. הבדיקה עוקבת אחרי המשתנה ולא מסתפקת ב"הקובץ
 * מזכיר vat איפשהו" — מסלול גבייה שני באותו קובץ ששכח את ההמרה הוא
 * בדיוק המקרה שיקרה.
 *
 * ## מה **לא** נבדק, ובכוונה
 *
 * ‎`payment.create` אינו נסרק. הוא מקבל את אותו משתנה, אבל הוא גם
 * נכתב בעשרות מקומות שאינם גבייה (זיכוי, קופון מלא, תיקון סטטוס),
 * ושער שמפיל אותם היה נפתר בהוספת חריגים עד שהוא מפסיק להעיד.
 * הפנייה לסולק היא הרגע שבו הכסף באמת זז, והיא הצומת הצר.
 */

const ROOT = join(import.meta.dirname, "..");

/** קריאות שמזיזות כסף אצל הסולק. */
const CHARGE_CALLS = new Set(["createPaymentPage", "chargeToken"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, out);
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
    if (entry.includes(".test.") || entry.includes(".int.test.")) continue;
    out.push(path);
  }
  return out;
}

/** המתודה/פונקציה שבתוכה יושב הצומת — גבול החיפוש אחרי ההשמה. */
function enclosingBody(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (
      ts.isMethodDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

/** שמות המשתנים שהושמו מ-`await this.vat.…` בתוך הגוף הזה. */
function vatDerivedNames(body: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      fromVat(node.initializer)
    ) {
      names.add(node.name.text);
    }
    node.forEachChild(visit);
  };
  visit(body);
  return names;
}

/**
 * שמות המשתנים שהושמו מפירוק של `await this.vat.charge(…)` — כלומר
 * אתרי גבייה שקיבלו גם את השיעור, ולא רק את הסכום.
 */
function chargeDestructured(body: ts.Node): { amount: Set<string>; hasRate: boolean } {
  const amount = new Set<string>();
  let hasRate = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      fromVat(node.initializer)
    ) {
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const source = element.propertyName ?? element.name;
        if (!ts.isIdentifier(source)) continue;
        if (source.text === "amountAgorot") amount.add(element.name.text);
        if (source.text === "vatPercent") hasRate = true;
      }
    }
    node.forEachChild(visit);
  };
  visit(body);
  return { amount, hasRate };
}

/** האם הביטוי מגיע מ-`this.vat.<משהו>(…)` — עם או בלי `await`. */
function fromVat(expression: ts.Node): boolean {
  let node = expression;
  if (ts.isAwaitExpression(node)) node = node.expression;
  /*
   * גם `(await this.vat.split(x)).grossAgorot` נחשב: זו אותה המרה,
   * רק כשצריך גם את רכיב המע"מ בנפרד.
   */
  while (ts.isPropertyAccessExpression(node) || ts.isParenthesizedExpression(node)) {
    node = ts.isParenthesizedExpression(node) ? node.expression : node.expression;
    if (ts.isAwaitExpression(node)) node = node.expression;
  }
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const target = callee.expression;
  return (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "vat" &&
    target.expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

interface Finding {
  file: string;
  line: number;
  method: string;
  detail: string;
}

function scan(): { charges: number; findings: Finding[] } {
  const findings: Finding[] = [];
  let charges = 0;

  for (const file of sources(ROOT)) {
    const text = readFileSync(file, "utf8");
    if (!CHARGE_CALLS.values().some((name) => text.includes(name))) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.ES2023,
      /* setParentNodes */ true,
    );

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        const arg = node.arguments[0];
        if (CHARGE_CALLS.has(name) && arg !== undefined && ts.isObjectLiteralExpression(arg)) {
          charges += 1;
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          const body = enclosingBody(node);
          const destructured = chargeDestructured(body);
          const allowed = new Set([...vatDerivedNames(body), ...destructured.amount]);
          const amount = arg.properties.find(
            (property) =>
              (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
              ts.isIdentifier(property.name) &&
              property.name.text === "amountAgorot",
          );

          if (amount === undefined) {
            findings.push({
              file,
              line,
              method: name,
              detail: "אין כלל `amountAgorot` בקריאה — מה נגבה?",
            });
          } else {
            const value = ts.isShorthandPropertyAssignment(amount)
              ? amount.name
              : ts.isPropertyAssignment(amount)
                ? amount.initializer
                : undefined;
            const ok =
              value !== undefined &&
              ((ts.isIdentifier(value) && allowed.has(value.text)) || fromVat(value));
            if (!ok) {
              findings.push({
                file,
                line,
                method: name,
                detail: `הסכום אינו מגיע מ-\`this.vat\` (נמצא: ${value?.getText(source) ?? "—"})`,
              });
            } else if (!destructured.hasRate) {
              /*
               * הסכום נכון, אבל השיעור שלפיו נבנה אינו נשמר — ולכן
               * המסמך יפרק אותו לפי השיעור שיהיה בעת ההפקה. זהה כל
               * עוד הוא לא השתנה, ושגוי בדיוק ביום שהוא משתנה.
               */
              findings.push({
                file,
                line,
                method: name,
                detail:
                  "הסכום מגיע מ-`this.vat` אבל השיעור אינו נשמר — " +
                  "השתמשו ב-`this.vat.charge()` וכתבו גם `vatPercent` על שורת התשלום",
              });
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(source);
  }

  return { charges, findings };
}

describe("מע\"מ על כל גבייה", () => {
  const { charges, findings } = scan();

  it("נמצאו אתרי גבייה לסריקה", () => {
    /*
     * רשת ביטחון לבדיקה עצמה. שינוי שם המתודה אצל הסולק, או מעבר
     * לספק אחר, היה מאפס את הסריקה והופך אותה ל"עוברת תמיד" —
     * כלומר לשער שנשאר בקובץ ואינו שומר על דבר.
     */
    expect(charges).toBeGreaterThanOrEqual(4);
  });

  it("כל סכום שנשלח לסולק עבר דרך VatService", () => {
    const lines = findings.map(
      (f) => `${f.file.replace(ROOT, "src")}:${f.line} (${f.method}) — ${f.detail}`,
    );
    expect(
      lines,
      "המחירון נקוב לפני מע\"מ, ולכן הסכום שנשלח לסולק חייב להיות " +
        "`await this.vat.gross(<המחיר>)`. סכום שנשלח כמות שהוא גובה 18% " +
        "פחות מהמחיר שהובטח — בשקט, בלי שבדיקה או מסמך יצעקו, ועל כל " +
        "לקוח שנרשם עד שמישהו יבחין:\n" +
        lines.join("\n"),
    ).toEqual([]);
  });
});
