import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ‎**נתוני משרד נקראים משולחן הפלטפורמה רק דרך `withExplicitTenant`.**
 *
 * ‏מסך המשרדים מציג עכשיו גם ספירות מתוך המשרד — נכסים, קונים,
 * ‏לידים, שיחות. הדרך הקלה לכתוב את זה היא
 * ‏`this.prisma.property.count({ where: { tenantId } })`, והיא
 * ‏**עוקפת את RLS**: התנאי הוא מה שמפריד, והוא נשען על כך שמי
 * ‏שכותב את השאילתה הבאה יזכור אותו.
 *
 * ‎`withExplicitTenant` פותח טרנזקציה עם הקשר דייר, ולכן ההפרדה
 * ‏נאכפת במסד — גם בשאילתה שתיכתב כאן בעוד שנה בלי לקרוא את
 * ‏ההערה הזו. זה מה שהופך „בעל הפלטפורמה רואה משרד אחד שביקש”
 * ‏לתכונה של המנגנון ולא להבטחה.
 *
 * ‏הטבלאות שכן נקראות ישירות הן של הפלטפורמה עצמה — `tenant`,
 * ‏`user`, `integration`, `emailDomain`, החיבורים והתשלומים —
 * ‏ואין בהן תוכן של לקוחות.
 */
describe("שולחן המשרדים — תוכן של משרד עובר ב-RLS", () => {
  const file = join(import.meta.dirname, "platform.controller.ts");

  /** ‏טבלאות שיש בהן תוכן של הלקוחות של המשרד. */
  const CUSTOMER_TABLES = new Set([
    "property",
    "buyer",
    "lead",
    "call",
    "contact",
    "appointment",
    "offer",
    "task",
    "match",
    "agreement",
    "emailMessage",
    "recruitmentTarget",
  ]);

  it("‏אין קריאה ישירה ל-prisma על טבלה של לקוחות", () => {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true);
    const offenders: string[] = [];

    /* ‎`this.prisma.<model>` — הצורה שעוקפת את הקשר הדייר. */
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "prisma" &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        CUSTOMER_TABLES.has(node.name.text)
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        offenders.push(`${node.name.text} (platform.controller.ts:${line + 1})`);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);

    expect(
      offenders,
      `‏קריאה ישירה לטבלה של לקוחות — יש לעבור ב-withExplicitTenant:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  /*
   * ‏בדיקה מבנית שלא נבדקה היא בדיקה שאולי אינה בודקת כלום.
   */
  it("‏הבדיקה תופסת קריאה ישירה", () => {
    const probe = "const n = await this.prisma.property.count({ where: { tenantId } });";
    const source = ts.createSourceFile("probe.ts", probe, ts.ScriptTarget.ES2023, true);
    let hits = 0;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "prisma" &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        CUSTOMER_TABLES.has(node.name.text)
      ) {
        hits += 1;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    expect(hits).toBe(1);
  });

  /*
   * ‎**והמייל הולך לבעלים, לא למי שנמצא ראשון.**
   *
   * ‏`role: "owner"` ו-`isActive` הם שני חצאי אותה שאלה: מייל
   * ‏לבעלים שהושבת אינו מגיע לאיש, ומייל לסוכן אקראי מגיע לאדם
   * ‏הלא נכון.
   */
  it("‏נמען המייל הוא בעלים פעיל בלבד", () => {
    const text = readFileSync(file, "utf8");
    const owner = /agencyOwner\([\s\S]{0,600}?role: "owner"[\s\S]{0,200}?isActive: true/u;
    expect(owner.test(text)).toBe(true);
  });
});
