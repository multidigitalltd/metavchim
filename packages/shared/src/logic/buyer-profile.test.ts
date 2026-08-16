import { describe, expect, it } from "vitest";
import { buyerProfileCompleteness } from "./buyer-profile.js";
import type { BuyerRequirements } from "../schemas/buyer.js";

const bare = (over: Partial<BuyerRequirements> = {}): BuyerRequirements =>
  ({
    cities: [],
    neighborhoods: [],
    dealType: "sale",
    propertyTypes: [],
    budgetMaxAgorot: 200_000_000,
    features: {},
    ...over,
  }) as BuyerRequirements;

describe("buyerProfileCompleteness", () => {
  it("פרופיל ריק — הכול חסר, והתקציב המרבי אינו נספר כי הוא חובה ממילא", () => {
    const out = buyerProfileCompleteness(bare());
    expect(out.filled).toBe(0);
    expect(out.missing.map((f) => f.key)).toEqual([
      "cities",
      "rooms",
      "propertyTypes",
      "budgetMin",
      "areaSqmMin",
      "features",
      "entryType",
    ]);
  });

  it("אזור על המפה נחשב אזור, גם בלי רשימת ערים", () => {
    const out = buyerProfileCompleteness(bare({ searchAreas: [{ lat: 32, lon: 34.8, radiusKm: 2 }] }));
    expect(out.missing.some((f) => f.key === "cities")).toBe(false);
  });

  it("חדרים נחשבים גם כשהוזן רק גבול אחד", () => {
    expect(buyerProfileCompleteness(bare({ roomsMin: 3 })).missing.some((f) => f.key === "rooms")).toBe(false);
    expect(buyerProfileCompleteness(bare({ roomsMax: 5 })).missing.some((f) => f.key === "rooms")).toBe(false);
  });

  it("מאפיין אחד מספיק כדי שהקטגוריה תיחשב מולאה", () => {
    const out = buyerProfileCompleteness(bare({ features: { hasElevator: "must" } }));
    expect(out.missing.some((f) => f.key === "features")).toBe(false);
  });

  it("פרופיל מלא — אין חוסרים", () => {
    const out = buyerProfileCompleteness(
      bare({
        cities: ["רמת גן"],
        roomsMin: 3,
        propertyTypes: ["apartment"],
        budgetMinAgorot: 150_000_000,
        areaSqmMin: 80,
        features: { hasParking: "nice" },
        entryType: "flexible",
      }),
    );
    expect(out.filled).toBe(out.total);
    expect(out.missing).toEqual([]);
  });

  it("הסדר הוא סדר השיחה — אזור לפני מועד כניסה", () => {
    const keys = buyerProfileCompleteness(bare()).fields.map((f) => f.key);
    expect(keys.indexOf("cities")).toBeLessThan(keys.indexOf("entryType"));
  });
});
