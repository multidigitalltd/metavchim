import { describe, expect, it } from "vitest";
import { computeReadiness } from "./readiness.js";
import type { PropertyFields } from "../schemas/property.js";

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
  entryDate: new Date("2026-12-01"),
};

describe("computeReadiness — ציון מוכנות נכס", () => {
  it("כל שדות החובה + שיווק מלא = 100", () => {
    const result = computeReadiness(fullFields, { hasTitle: true, hasDescription: true });
    expect(result.score).toBe(100);
    expect(result.missingFields).toHaveLength(0);
  });

  it("false הוא ערך לגיטימי (אין מעלית) — לא נחשב חוסר", () => {
    const result = computeReadiness(fullFields, { hasTitle: false, hasDescription: false });
    expect(result.missingFields).not.toContain("hasElevator");
  });

  it("שדות חסרים מוחזרים בשמם — לתצוגת 'חסרים X פרטים'", () => {
    const partial = { ...fullFields };
    delete partial.priceAgorot;
    delete partial.entryDate;
    const result = computeReadiness(partial, { hasTitle: false, hasDescription: false });
    expect(result.missingFields).toContain("priceAgorot");
    expect(result.missingFields).toContain("entryDate");
    expect(result.score).toBeLessThan(80);
  });

  it("נכס ריק = ציון 0", () => {
    const result = computeReadiness({}, { hasTitle: false, hasDescription: false });
    expect(result.score).toBe(0);
  });
});
