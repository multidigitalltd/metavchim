import { describe, expect, it } from "vitest";
import { MATURITY_LABELS_HE } from "../logic/csv-export.js";
import { MATURITY_MAP } from "../logic/csv-import-buyers.js";
import { BuyerMaturitySchema, MATURITY_LABELS } from "./buyer.js";

/**
 * ‎**כל דרגה — בכל מקום שהמערכת כותבת או קוראת אותה.**
 *
 * ‏דרגה שנוספה לסכימה ונשכחה באחד הקצוות נראית תקינה על הכרטיס,
 * ‏ונשברת בייצוא (ערך גולמי בקובץ) או בייבוא חוזר של אותו קובץ.
 * ‏הסוכן ומסכי ה-web גוזרים את הרשימה מהסכימה עצמה.
 */
describe("דרגות הבשלות", () => {
  it("„לא רלוונטי” היא דרגה", () => {
    expect(BuyerMaturitySchema.parse("not_relevant")).toBe("not_relevant");
    expect(MATURITY_LABELS.not_relevant).toBe("לא רלוונטי");
  });

  it.each(BuyerMaturitySchema.options)("%s — ייצוא ואז ייבוא מחזירים את אותה דרגה", (maturity) => {
    const exported = MATURITY_LABELS_HE[maturity];
    expect(exported).toBeDefined();
    expect(MATURITY_MAP[exported]).toBe(maturity);
  });
});
