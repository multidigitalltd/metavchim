import { describe, expect, it } from "vitest";
import { computeReadiness } from "./readiness.js";
import { PROPERTY_READINESS_FIELDS, type PropertyFields } from "../schemas/property.js";

/**
 * שישה משדות המוכנות הם שדות תוכן; השלושה האחרים — תמונות, תיאור
 * ובעל הנכס — נמסרים בנפרד. העיר, סוג הנכס וסוג העסקה נשארים כאן
 * בכוונה: הם נכס אמיתי לגמרי ואינם נספרים במוכנות, וכך הבדיקה
 * מוודאת שהם אכן אינם משפיעים.
 */
const fullFields: PropertyFields = {
  city: "בני ברק",
  propertyType: "apartment",
  dealType: "sale",
  rooms: 3,
  areaSqm: 68,
  priceAgorot: 215_000_000,
  floor: 2,
  hasElevator: false,
  hasParking: false,
  entryType: "on_date" as const,
  entryDate: new Date("2026-12-01"),
};

const complete = { hasImages: true, hasDescription: true, hasOwner: true };
const bare = { hasImages: false, hasDescription: false, hasOwner: false };

describe("computeReadiness — ציון מוכנות נכס", () => {
  it("תשעת השדות מלאים = 100", () => {
    const result = computeReadiness(fullFields, complete);
    expect(result.score).toBe(100);
    expect(result.missingFields).toHaveLength(0);
  });

  /*
   * „אין מעלית” הוא מידע מלא בדיוק כמו „יש מעלית”. ספירת `false`
   * כחוסר הייתה מורידה ציון לנכס שמולא במלואו.
   */
  it("false הוא ערך לגיטימי (אין מעלית) — לא נחשב חוסר", () => {
    expect(computeReadiness(fullFields, bare).missingFields).not.toContain("hasElevator");
  });

  it("שדות חסרים מוחזרים בשמם — לרשת שבכרטיס ולספירה", () => {
    const partial = { ...fullFields };
    delete partial.priceAgorot;
    const result = computeReadiness(partial, { ...complete, hasOwner: false });
    expect(result.missingFields).toContain("priceAgorot");
    expect(result.missingFields).toContain("owner");
    expect(result.missingFields).toHaveLength(2);
  });

  /*
   * **האחוז הוא בדיוק הספירה.**
   *
   * זה מה שהחליף את הציון המשוקלל, וזו הסיבה שהמסך יכול להדפיס
   * אחוז, „N מתוך 9” ורשת גלולות בלי שיסתרו זה את זה (SPEC-3b §4).
   */
  it("והאחוז הוא בדיוק המנה — לא ניקוד משוקלל", () => {
    const total = PROPERTY_READINESS_FIELDS.length;
    for (const extras of [complete, bare]) {
      const result = computeReadiness(fullFields, extras);
      const filled = total - result.missingFields.length;
      expect(result.score).toBe(Math.round((filled / total) * 100));
    }
  });

  /*
   * עיר, סוג נכס וסוג עסקה אינם בתשעה — נכס שיש לו רק אותם עדיין
   * ריק מבחינת המוכנות, וזו ההחלטה שהמסמך קבע.
   */
  it("נכס ריק = ציון 0", () => {
    expect(computeReadiness({}, bare).score).toBe(0);
    expect(
      computeReadiness({ city: "בני ברק", propertyType: "apartment", dealType: "sale" }, bare)
        .score,
    ).toBe(0);
  });
});
