import { describe, expect, it } from "vitest";
import { comparisonMessage, comparisonRows, fitLabels, type ComparisonProperty } from "./comparison.js";

const p = (over: Partial<ComparisonProperty>): ComparisonProperty => ({
  propertyId: "01P", title: "נכס", features: [], media: [], ...over,
});

describe("דף השוואה — שורות וסימון הטוב ביותר", () => {
  it("מחיר ולמ״ר — הנמוך מנצח; חדרים ושטח — הגבוה; מאפיין ייחודי מסומן", () => {
    const rows = comparisonRows([
      p({ priceAgorot: 250_000_000, areaSqm: 100, rooms: 4, features: ["חניה"] }),
      p({ priceAgorot: 240_000_000, areaSqm: 80, rooms: 3, features: ["חניה", "מעלית"] }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.price!.best).toBe(1);
    expect(by.perSqm!.best).toBe(0);
    expect(by.perSqm!.values).toEqual(["25,000 ₪", "30,000 ₪"]);
    expect(by.rooms!.best).toBe(0);
    expect(by.area!.best).toBe(0);
    expect(by["feature:מעלית"]!.values).toEqual(["—", "✓"]);
    expect(by["feature:מעלית"]!.best).toBe(1);
    expect(by["feature:חניה"]!.best).toBeNull();
    expect(by["feature:מרפסת"]).toBeUndefined();
  });

  it("תיקו או ערך חסר — בלי סימון", () => {
    const rows = comparisonRows([p({ priceAgorot: 100 }), p({ priceAgorot: 100 }), p({})]);
    expect(rows.find((r) => r.key === "price")!.best).toBeNull();
    expect(rows.find((r) => r.key === "price")!.values[2]).toBe("—");
  });

  it("התאמה למבוקש", () => {
    expect(fitLabels(p({ priceAgorot: 270_000_000, rooms: 3 }), { budgetMaxAgorot: 250_000_000, roomsMin: 3, roomsMax: 4, cities: [] })).toEqual(["מעל התקציב ב-8%", "חדרים כמבוקש"]);
    expect(fitLabels(p({ priceAgorot: 200_000_000, rooms: 5 }), { budgetMaxAgorot: 250_000_000, roomsMax: 4, cities: [] })).toEqual(["בתקציב", "יותר חדרים מהמבוקש"]);
    expect(fitLabels(p({}), { cities: [] })).toEqual([]);
  });

  it("הודעת השליחה", () => {
    expect(comparisonMessage({ count: 3, url: "https://x/compare/t", agencyName: "משרד" })).toContain("3 הנכסים");
    expect(comparisonMessage({ count: 2, url: "https://x/compare/t", agencyName: "משרד" })).toContain("שני הנכסים");
  });
});
