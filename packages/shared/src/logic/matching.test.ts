import { describe, expect, it } from "vitest";
import { scoreMatch } from "./matching.js";
import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";

const baseProperty: PropertyFields = {
  city: "בני ברק",
  neighborhood: "פרדס כץ",
  propertyType: "apartment",
  dealType: "sale",
  rooms: 4,
  areaSqm: 95,
  floor: 2,
  hasElevator: true,
  hasParking: true,
  hasBalcony: true,
  priceAgorot: 265_000_000, // 2.65M ₪
};

const baseBuyer: BuyerRequirements = {
  cities: ["בני ברק"],
  neighborhoods: [],
  dealType: "sale",
  propertyTypes: ["apartment"],
  budgetMaxAgorot: 280_000_000,
  roomsMin: 3.5,
  roomsMax: 4.5,
  features: {},
};

describe("scoreMatch — מנוע ההתאמות", () => {
  it("התאמה מלאה מקבלת ציון גבוה", () => {
    const result = scoreMatch(baseProperty, baseBuyer);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("עיר לא מבוקשת ⇒ מוחרג לחלוטין", () => {
    const result = scoreMatch({ ...baseProperty, city: "חיפה" }, baseBuyer);
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(0);
  });

  it("מעל התקציב ביותר מ-7% ⇒ מוחרג", () => {
    const result = scoreMatch({ ...baseProperty, priceAgorot: 350_000_000 }, baseBuyer);
    expect(result.excluded).toBe(true);
  });

  it("עד 7% מעל התקציב ⇒ נשאר עם ניקוד חלקי (גמישות שוק)", () => {
    const result = scoreMatch({ ...baseProperty, priceAgorot: 295_000_000 }, baseBuyer);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeLessThan(95);
    expect(result.score).toBeGreaterThan(50);
  });

  it("דרישת חובה שמופרת במפורש ⇒ מוחרג עם הסבר", () => {
    const buyer: BuyerRequirements = { ...baseBuyer, features: { hasElevator: "must" } };
    const result = scoreMatch({ ...baseProperty, hasElevator: false }, buyer);
    expect(result.excluded).toBe(true);
    expect(result.explanation).toContain("מעלית");
    expect(result.explanation).toContain("חובה");
  });

  it("דרישת חובה על שדה לא-ידוע ⇒ ניקוד חלקי, לא פסילה", () => {
    const buyer: BuyerRequirements = { ...baseBuyer, features: { hasSafeRoom: "must" } };
    const withoutSafeRoom = { ...baseProperty };
    delete withoutSafeRoom.hasSafeRoom;
    const result = scoreMatch(withoutSafeRoom, buyer);
    expect(result.excluded).toBe(false);
    expect(result.explanation).toContain("להשלים בנכס");
  });

  it("העדפה (nice) חסרה מורידה ניקוד אך לא פוסלת — עם ההסבר מהאפיון", () => {
    const buyer: BuyerRequirements = { ...baseBuyer, features: { hasSafeRoom: "nice" } };
    const result = scoreMatch({ ...baseProperty, hasSafeRoom: false }, buyer);
    expect(result.excluded).toBe(false);
    expect(result.explanation).toContain("עדיפות ולא כחובה");
  });

  it("חדרים חצי-חדר מחוץ לטווח ⇒ ניקוד חלקי (near miss)", () => {
    const result = scoreMatch({ ...baseProperty, rooms: 5 }, baseBuyer);
    expect(result.excluded).toBe(false);
    const roomsPart = result.breakdown.find((p) => p.criterion === "rooms");
    expect(roomsPart?.score).toBe(0.5);
  });

  it("הפירוט (breakdown) מסביר כל קריטריון שנבחן", () => {
    const result = scoreMatch(baseProperty, baseBuyer);
    const criteria = result.breakdown.map((p) => p.criterion);
    expect(criteria).toContain("location");
    expect(criteria).toContain("budget");
    expect(criteria).toContain("rooms");
  });
});
