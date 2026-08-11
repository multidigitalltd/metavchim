import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_WEIGHTS, resolveMatchWeights, type MatchWeights } from "./matching.js";

describe("resolveMatchWeights", () => {
  it("ריק = ברירת המחדל", () => {
    expect(resolveMatchWeights(null)).toEqual(DEFAULT_MATCH_WEIGHTS);
    expect(resolveMatchWeights({})).toEqual(DEFAULT_MATCH_WEIGHTS);
  });

  it("ערך שמור גובר, והשאר נשאר ברירת מחדל", () => {
    const out = resolveMatchWeights({ budget: 0.5 });
    expect(out.budget).toBe(0.5);
    expect(out.location).toBe(DEFAULT_MATCH_WEIGHTS.location);
  });

  it("ערך פסול נופל לברירת המחדל של אותו קריטריון בלבד", () => {
    const out = resolveMatchWeights({
      budget: -1,
      rooms: "הרבה",
      area: Number.NaN,
      location: 0.4,
    });
    expect(out.budget).toBe(DEFAULT_MATCH_WEIGHTS.budget);
    expect(out.rooms).toBe(DEFAULT_MATCH_WEIGHTS.rooms);
    expect(out.area).toBe(DEFAULT_MATCH_WEIGHTS.area);
    expect(out.location).toBe(0.4);
  });

  it("אפס לקריטריון מסוים מותר — כיבוי מכוון", () => {
    expect(resolveMatchWeights({ entry_date: 0 }).entry_date).toBe(0);
  });

  it("סכום אפס חוזר לברירת המחדל — אחרת כל נכס מקבל 0", () => {
    const zeros = Object.fromEntries(
      Object.keys(DEFAULT_MATCH_WEIGHTS).map((key) => [key, 0]),
    ) as MatchWeights;
    expect(resolveMatchWeights(zeros)).toEqual(DEFAULT_MATCH_WEIGHTS);
  });
});
