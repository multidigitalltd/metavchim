import { describe, expect, it } from "vitest";

import {
  COMMERCIAL_PROPERTY_TYPES,
  COMMERCIAL_TYPES_FROM_SCHEMA,
  isCommercialType,
  propertyTypeMatches,
} from "./commercial-types.js";
import { PropertyTypeSchema } from "../schemas/property.js";

describe("נכס מסחרי — תשעה ענפים ומטרייה אחת", () => {
  /*
   * ‎**זו הבדיקה שכל הפיצול תלוי בה.**
   *
   * מנוע ההתאמות **פוסל** סוג שאינו ברשימת הקונה — לא גורע ניקוד.
   * כלומר בלי הכלל הזה, הוספת „חנות” הייתה מנתקת כל קונה קיים
   * שסימן „מסחרי” מכל נכס מסחרי חדש. לא בגלל שהוא שינה דרישה, אלא
   * בגלל שהמתווך נעשה מדויק יותר.
   */
  describe("„מסחרי” הוא „לא נאמר איזה”, ולכן מתאים לשני הכיוונים", () => {
    it.each(COMMERCIAL_PROPERTY_TYPES)("קונה שביקש „מסחרי” מתאים ל-%s", (branch) => {
      expect(propertyTypeMatches(["commercial"], branch)).toBe(true);
    });

    it.each(COMMERCIAL_PROPERTY_TYPES)("ונכס „מסחרי” מתאים לקונה שביקש %s", (branch) => {
      expect(propertyTypeMatches([branch], "commercial")).toBe(true);
    });
  });

  /*
   * ‎**וזה מה שהפיצול קיים בשבילו.** לפניו כל השלושה היו „מסחרי”,
   * וקונה שחיפש משרד קיבל גם את החנות וגם את תחנת הדלק.
   */
  it("אבל שני ענפים שונים אינם מתאימים זה לזה", () => {
    expect(propertyTypeMatches(["commercial_office"], "commercial_shop")).toBe(false);
    expect(propertyTypeMatches(["commercial_shop"], "commercial_gas_station")).toBe(false);
  });

  it("ובחירה מפורשת בענף מתאימה לו", () => {
    expect(propertyTypeMatches(["commercial_shop"], "commercial_shop")).toBe(true);
    expect(propertyTypeMatches(["commercial_shop", "commercial_office"], "commercial_office")).toBe(
      true,
    );
  });

  /*
   * ‎**„מסחרי” אינו דלת אחורית למגורים.** הכלל חל בתוך המשפחה
   * בלבד — אחרת הוא היה הופך את קריטריון סוג הנכס לחסר משמעות.
   */
  it("והמטרייה אינה פותחת נכסים שאינם מסחריים", () => {
    expect(propertyTypeMatches(["commercial"], "apartment")).toBe(false);
    expect(propertyTypeMatches(["apartment"], "commercial")).toBe(false);
    expect(propertyTypeMatches(["apartment"], "commercial_shop")).toBe(false);
    expect(propertyTypeMatches(["commercial_shop"], "apartment")).toBe(false);
  });

  it("וסוגי המגורים ממשיכים להתנהג בדיוק כמו קודם", () => {
    expect(propertyTypeMatches(["apartment"], "apartment")).toBe(true);
    expect(propertyTypeMatches(["apartment", "penthouse"], "penthouse")).toBe(true);
    expect(propertyTypeMatches(["apartment"], "penthouse")).toBe(false);
  });

  describe("הרשימה עצמה", () => {
    /*
     * ‎**נגזרת מהסכימה ולא נכתבת פעמיים.** ענף שיתווסף לסכימה ולא
     * לרשימה כאן ייראה כסוג עצמאי: קונה שביקש „מסחרי” לא היה מקבל
     * אותו, וההשמטה הייתה שקטה — בדיוק הכשל שהבדיקה הזו קיימת
     * כדי למנוע.
     */
    it("מכסה כל ענף שבסכימה, ולא יותר", () => {
      expect([...COMMERCIAL_PROPERTY_TYPES].sort()).toEqual(
        [...COMMERCIAL_TYPES_FROM_SCHEMA].sort(),
      );
    });

    it("ותשעת הענפים אכן קיימים בסכימה", () => {
      expect(COMMERCIAL_PROPERTY_TYPES).toHaveLength(9);
      for (const branch of COMMERCIAL_PROPERTY_TYPES) {
        expect(PropertyTypeSchema.safeParse(branch).success, branch).toBe(true);
      }
    });

    it("‎`isCommercialType` מכיר את המטרייה ואת הענפים בלבד", () => {
      expect(isCommercialType("commercial")).toBe(true);
      expect(isCommercialType("commercial_shop")).toBe(true);
      expect(isCommercialType("apartment")).toBe(false);
      expect(isCommercialType("plot")).toBe(false);
    });
  });

  /* רשימה ריקה = „לא ביקש”. הקורא מחליט אם לבחון; כאן רק הצורה. */
  it("רשימה ריקה אינה מתאימה לדבר — הקורא הוא שמדלג", () => {
    expect(propertyTypeMatches([], "commercial_shop")).toBe(false);
  });
});
