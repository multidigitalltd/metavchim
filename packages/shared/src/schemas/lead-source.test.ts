import { describe, expect, it } from "vitest";
import {
  LEAD_SOURCE_LABELS,
  LeadSourceSchema,
  leadSourceText,
  type LeadSource,
} from "./lead.js";

/**
 * ‎**מקור הליד — שמונה ערכים סגורים, ואחד שנושא טקסט.**
 *
 * ‏הבדיקה המרכזית כאן היא לא „האם `newspaper` קיים” אלא **שהרשימה
 * והתוויות אינן נפרדות**: ערך בלי תווית מוצג למשתמש כמחרוזת אנגלית
 * גולמית, וזה בדיוק סוג התקלה ש„עוברת” כל בדיקה שסופרת ערכים.
 */
describe("מקור הליד", () => {
  it("לכל ערך בסכימה יש תווית בעברית, ואין תווית יתומה", () => {
    const values = LeadSourceSchema.options;
    expect(values.length).toBeGreaterThan(5);
    expect([...values].sort()).toEqual(
      (Object.keys(LEAD_SOURCE_LABELS) as LeadSource[]).sort(),
    );
    for (const value of values) {
      const label = LEAD_SOURCE_LABELS[value];
      expect(label).toBeTruthy();
      // תווית שנשארה באנגלית היא תווית שלא נכתבה — למעט שם מותג
      expect(value === "kanko" || /[֐-׿]/u.test(label)).toBe(true);
    }
  });

  it("שני ערוצי הפרסום הלא-מקוונים קיימים בנפרד זה מזה", () => {
    expect(LeadSourceSchema.safeParse("newspaper").success).toBe(true);
    expect(LeadSourceSchema.safeParse("street_ad").success).toBe(true);
    expect(LEAD_SOURCE_LABELS.newspaper).not.toBe(LEAD_SOURCE_LABELS.street_ad);
  });

  it("„אחר” מציג את הטקסט שנכתב, ולא את המילה „אחר”", () => {
    expect(leadSourceText("other", "דוכן ביריד הנדל״ן")).toBe("דוכן ביריד הנדל״ן");
  });

  it("„אחר” בלי טקסט — וגם עם רווחים בלבד — נשאר „אחר”", () => {
    expect(leadSourceText("other")).toBe("אחר");
    expect(leadSourceText("other", "")).toBe("אחר");
    expect(leadSourceText("other", "   ")).toBe("אחר");
    expect(leadSourceText("other", null)).toBe("אחר");
  });

  it("הטקסט החופשי אינו דורס מקור מוכר", () => {
    /*
     * ‏שורה שנשמרה עם `sourceNote` ואז המקור שונה ל„עיתון” — התווית
     * הנכונה היא „עיתון”, לא ההערה שנשארה מאחור.
     */
    expect(leadSourceText("newspaper", "דוכן ביריד")).toBe("עיתון");
  });

  it("מקור חופשי שהטלפוניה כותבת מוצג כמות שהוא ולא נבלע", () => {
    // `leadSourceFor` שומר תוויות קמפיין חופשיות — הן אינן באנומרציה
    expect(leadSourceText("קמפיין קיץ")).toBe("קמפיין קיץ");
    expect(leadSourceText("outbound_call")).toBe("outbound_call");
  });
});
