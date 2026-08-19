import { describe, expect, it } from "vitest";
import {
  canonicalVirtualNumber,
  leadSourceFor,
  matchVirtualNumber,
  virtualNumberRejection,
  type VirtualNumberRule,
} from "./virtual-numbers.js";

const rule = (over: Partial<VirtualNumberRule> = {}): VirtualNumberRule => ({
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  phone: "+97231234567",
  label: "קמפיין פייסבוק",
  leadSource: "פייסבוק",
  assignedToUserId: null,
  propertyId: null,
  isActive: true,
  ...over,
});

describe("canonicalVirtualNumber", () => {
  /*
   * הצורה שבה מנהל משרד מקליד מספר אינה הצורה שבה המרכזייה שולחת
   * אותו. בלי נרמול משותף ההתאמה נכשלת בשקט, והליד נפתח בלי מקור
   * בלי שאיש ידע למה.
   */
  it("צורות כתיבה שונות מתכנסות לאותו מספר", () => {
    const canonical = canonicalVirtualNumber("03-1234567");
    expect(canonicalVirtualNumber("+972-3-123-4567")).toBe(canonical);
    expect(canonicalVirtualNumber("0031234567".replace("00", "0"))).toBe(canonical);
  });

  it("מה שאינו מספר ישראלי מוחזר ריק", () => {
    expect(canonicalVirtualNumber("203")).toBe("");
    expect(canonicalVirtualNumber("")).toBe("");
    expect(canonicalVirtualNumber("שלוחה")).toBe("");
  });
});

describe("matchVirtualNumber", () => {
  it("מתאים לפי הצורה הקנונית ולא לפי המחרוזת", () => {
    const rules = [rule({ phone: "03-1234567" })];
    expect(matchVirtualNumber("+97231234567", rules)?.label).toBe("קמפיין פייסבוק");
  });

  it("מספר שאינו מוגדר אינו מותאם", () => {
    expect(matchVirtualNumber("+97239999999", [rule()])).toBeNull();
  });

  /*
   * כיבוי ולא מחיקה: קמפיין שהסתיים צריך להפסיק לנתב, אבל
   * ההיסטוריה שלפיה מודדים אותו בדיעבד חייבת להישאר.
   */
  it("מספר מושבת אינו מותאם", () => {
    expect(matchVirtualNumber("+97231234567", [rule({ isActive: false })])).toBeNull();
  });

  it("בלי מספר שאליו התקשרו — אין התאמה", () => {
    expect(matchVirtualNumber(undefined, [rule()])).toBeNull();
  });

  it("בוחר את ההגדרה הנכונה מתוך כמה", () => {
    const rules = [
      rule({ id: "a", phone: "+97231111111", label: "יד2" }),
      rule({ id: "b", phone: "+97232222222", label: "שלט" }),
    ];
    expect(matchVirtualNumber("+97232222222", rules)?.label).toBe("שלט");
  });
});

describe("virtualNumberRejection", () => {
  it("הגדרה תקינה עוברת", () => {
    expect(virtualNumberRejection({ phone: "03-1234567", label: "קמפיין" })).toBeNull();
  });

  it("מספר לא תקין נדחה", () => {
    expect(virtualNumberRejection({ phone: "203", label: "קמפיין" })).toContain("תקין");
  });

  it("בלי שם נדחה", () => {
    expect(virtualNumberRejection({ phone: "03-1234567", label: " " })).toContain("שם");
  });
});

describe("leadSourceFor", () => {
  it("המקור המפורש מנצח", () => {
    expect(leadSourceFor(rule())).toBe("פייסבוק");
  });

  it("בלי מקור — התווית משמשת כמקור", () => {
    expect(leadSourceFor(rule({ leadSource: "" }))).toBe("קמפיין פייסבוק");
  });

  /*
   * עמודת `source` מוגבלת ל-20 תווים. תווית ארוכה יותר הייתה מפילה
   * את כתיבת הליד — כלומר שיחה שנכנסה ולא נפתח ממנה כלום.
   */
  it("תווית ארוכה נחתכת ואינה מפילה", () => {
    const long = leadSourceFor(rule({ leadSource: "", label: "א".repeat(60) }));
    expect(long).toHaveLength(20);
  });

  it("הגדרה בלי מקור ובלי תווית נופלת ל-phone", () => {
    expect(leadSourceFor(rule({ leadSource: "", label: "" }))).toBe("phone");
  });
});
