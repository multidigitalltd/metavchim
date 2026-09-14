import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ‎**סוג מדיה שהסוכן יודע לטפל בו והוובהוק אינו מעביר — התקלה
 * ‏ששום בדיקה לא תפסה.**
 *
 * ## ‏מה קרה
 *
 * ‏„מודעה מצולמת ⟵ נכס לגיוס” נכתבה במלואה: שירות, פרומפט, סכימה,
 * ‏פענוח, בדיקות, תיעוד. הכול עבר. היא פשוט לא עבדה — אף פעם.
 *
 * ‏סכימת ה-zod של הוובהוק הכריזה על `audio` בלבד. zod **משמיט
 * ‏בשקט** מפתח שלא הוכרז, ולכן `message.image` נעלם לפני שמישהו
 * ‏הסתכל עליו, `mediaId` הגיע `undefined`, וכל תמונה נענתה „לא
 * ‏הצלחתי לקרוא את התמונה — נסו לשלוח אותה שוב”.
 *
 * ‎**זה הכישלון הגרוע מכולם**: תשובה סבירה, שגורמת למתווך לנסות
 * ‏שוב ולהאשים את עצמו או את הצילום. תקלה שנראית כמו תקלה נמצאת
 * ‏ביום; תקלה שנראית כמו „התמונה לא יצאה טוב” חיה חודשים.
 *
 * ## ‏מה הבדיקה הזו שומרת
 *
 * ‏שני הקבצים מסכימים: כל סוג הודעה שהסוכן קורא ממנו מדיה מוכרז
 * ‏בסכימה של הוובהוק **ומועבר** ממנה. הקשר בין השניים אינו נראה
 * ‏בשום מקום בקוד — הם שני קבצים, שתי הפשטות — ולכן הוא צריך
 * ‏להיאמר כאן.
 */

const dir = new URL(".", import.meta.url).pathname;
const assistant = readFileSync(`${dir}whatsapp-assistant.service.ts`, "utf8");
const inbound = readFileSync(`${dir}whatsapp-inbound.service.ts`, "utf8");

/**
 * ‏סוגי ההודעות שהסוכן מתנה בהם טיפול ב-`mediaId`.
 *
 * ‏נקרא מה-AST ולא ברג'קס: `msg.type === "image"` יכול להופיע
 * ‏בהערה, ומחרוזת בהערה אינה ענף.
 */
function mediaTypesConsumed(): string[] {
  const file = ts.createSourceFile("a.ts", assistant, ts.ScriptTarget.ES2023, true);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      node.left.getText(file) === "msg.type" &&
      ts.isStringLiteral(node.right)
    ) {
      /*
       * ‏הענף עצמו הוא ה-`if` שהתנאי הזה יושב בו. הוא זה שקובע
       * ‏אם הסוג הזה צורך מדיה — לא הקובץ כולו.
       */
      let branch: ts.Node = node;
      while (branch.parent !== undefined && !ts.isIfStatement(branch.parent)) {
        branch = branch.parent;
      }
      const statement = branch.parent;
      const body = statement === undefined ? "" : statement.getText(file);
      if (body.includes("mediaId") || body.includes("fromImage") || body.includes("downloadMedia")) {
        found.add(node.right.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return [...found];
}

describe("מדיה נכנסת — הוובהוק והסוכן מסכימים", () => {
  it("יש סוגי מדיה שהסוכן צורך — אחרת הבדיקה ריקה", () => {
    expect(mediaTypesConsumed().length).toBeGreaterThan(0);
  });

  /*
   * ‎**ההכרזה.** zod משמיט מפתח שאינו מוכרז, בלי אזהרה ובלי שגיאה.
   */
  it.each(mediaTypesConsumed())("%s מוכרז בסכימת הוובהוק", (type) => {
    expect(inbound, `הסכימה אינה מכריזה על ${type} — zod ישמיט אותו בשקט`).toMatch(
      new RegExp(`\\b${type}:\\s*z\\s*\\n?\\s*\\.object\\(|\\b${type}:\\s*z\\.object\\(`, "u"),
    );
  });

  /*
   * ‏הכרזה בלבד אינה מספיקה: השדה יכול להיות מפוענח ואז לא
   * ‏להיות מועבר ל-`assistant.handle`. שם הוא הופך ל-`mediaId`.
   */
  it.each(mediaTypesConsumed())("%s מועבר כ-mediaId לסוכן", (type) => {
    expect(inbound, `${type} מפוענח אך אינו מגיע לסוכן`).toContain(`message.${type}.id`);
  });
});
