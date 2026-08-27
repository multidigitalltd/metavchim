import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**„לא הצלחנו לחפש” אינו „אין מסמך”.**
 *
 * ‎`issueOne` מפיק חשבונית מס חדשה כש-`findDocumentByExternalRef`
 * מחזיר `null`. החיפוש הזה קיים בדיוק בשביל התרחיש הדו-משמעי —
 * יצירה שהצליחה בלינט ושהתשובה עליה אבדה — ולכן בליעת פסק זמן או
 * ‎5xx והחזרת `null` היא **אישור להפקה כפולה** על אותו תשלום
 * ‎(ביקורת Codex). חשבונית כפולה מתגלה אצל רואה החשבון ואי אפשר
 * לבטל אותה בשקט.
 *
 * אותו כלל שכבר חל בשליחת המייל בתיבה: „לא ידוע” אינו „לא”. כאן
 * הוא חל על מסמך חשבונאי.
 */

const LINET = readFileSync(new URL("../../core/linet.service.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^[ \t]*\/\/.*$/gmu, "");

const INVOICE = readFileSync(new URL("./invoice.service.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^[ \t]*\/\/.*$/gmu, "");

/** גוף המתודה: מהחתימה ועד הסוגר הסוגר בהזחה של שתי רווחים. */
function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} לא נמצאה`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  expect(end, `סוף ${signature} לא נמצא`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("ההגנה מפני חשבונית כפולה", () => {
  const lookup = method(LINET, "  async findDocumentByExternalRef(");

  it("כישלון בחיפוש נזרק ואינו מוחזר כ-null", () => {
    expect(lookup).toContain("throw error;");
    expect(lookup).not.toMatch(/catch \([\s\S]{0,200}return null;/u);
  });

  /*
   * בלי אישורים אי אפשר לבדוק, וזו אינה עדות לכך שאין מסמך.
   */
  it("גם היעדר אישורים אינו נחשב „אין מסמך”", () => {
    expect(lookup).toMatch(/if \(!credentials\) throw new Error\(/u);
    expect(lookup).not.toMatch(/if \(!credentials\) return null;/u);
  });

  /*
   * ‎`null` נשאר המשמעות היחידה שמותרת: חיפוש שהצליח והחזיר כלום.
   * זה מה שמתיר ל-`issueOne` להפיק.
   */
  it("‏null נשאר „חיפשנו ולא קיים” בלבד", () => {
    const issue = method(INVOICE, "  async issueOne(");
    expect(issue).toContain("findDocumentByExternalRef(invoice.paymentId)");
    expect(issue).toContain("if (documentId === null) {");
  });

  /*
   * הכישלון נתפס במעלה הזרם ומסמן את החשבונית לניסיון חוזר — לא
   * מפיל את הסבב ולא מפיק מסמך.
   */
  it("הכישלון מסמן את החשבונית ולא מפיק", () => {
    const issue = method(INVOICE, "  async issueOne(");
    const lookupAt = issue.indexOf("findDocumentByExternalRef");
    const caught = issue.indexOf("} catch (error) {");
    expect(caught, "התפיסה לא נמצאה").toBeGreaterThan(lookupAt);
    expect(issue.slice(caught)).toContain('status: "failed"');
  });
});

/**
 * ‎**תיקון ידני מדווח מה קרה באמת.**
 *
 * ‎`queueForPayment` בולעת כשלים **בכוונה** — היא נקראת גם מהוובהוק,
 * ושם הסורק ידווח שוב — אבל הנתיב הידני הוא פעולת תיקון מפורשת:
 * המסך אמר „נרשמה חשבונית” גם כשלא נרשם דבר, והתשלום נשאר בלי
 * מסמך (ביקורת Codex).
 */
describe("רישום חשבונית ידני", () => {
  const CONTROLLER = readFileSync(
    new URL("../platform/platform.controller.ts", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

  const WEB = readFileSync(
    new URL("../../../../web/src/app/platform/invoices-section.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

  it("הנתיב מחזיר את התוצאה ולא ok קבוע", () => {
    const route = method(CONTROLLER, "  async invoiceForPayment(");
    expect(route).toContain("return this.invoices.queueForPayment(id);");
    expect(route).not.toMatch(/return \{ ok: true \};/u);
  });

  it("והמסך קורא אותה", () => {
    expect(WEB).toMatch(/result\.ok\n?\s*\?/u);
    expect(WEB).not.toMatch(/await apiPost\(`\/platform\/payments\/\$\{paymentId\}\/invoice`, \{\}\);/u);
  });

  /*
   * שורה שכבר קיימת היא המצב התקין בוובהוק שחוזר — הצלחה, לא כשל.
   */
  it("כפילות נחשבת הצלחה", () => {
    const queue = method(INVOICE, "  async queueForPayment(");
    expect(queue).toMatch(/if \(code === "P2002"\) return \{ ok: true \};/u);
    expect(queue).toContain('return { ok: false, error: "רישום החשבונית נכשל" };');
  });
});
