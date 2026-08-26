import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_WEIGHTS,
  HARD_MATCH_CRITERIA,
  MIN_HARD_WEIGHT,
  resolveMatchWeights,
  type MatchWeights,
} from "./matching.js";

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

  it("אפס מותר לקריטריון רך — כיבוי מכוון", () => {
    expect(resolveMatchWeights({ entry_date: 0 }).entry_date).toBe(0);
    expect(resolveMatchWeights({ area: 0 }).area).toBe(0);
  });

  /*
   * הקלט נגזר מ-`HARD_MATCH_CRITERIA` ולא נכתב ידנית: רשימה מועתקת
   * אינה מתעדכנת כשקריטריון מצטרף, והבדיקה ממשיכה לעבור על מה
   * שנשאר. כך קרה כשסוג הנכס הפך לפוסל.
   */
  it("קריטריון פוסל אינו יורד מתחת לרצפה", () => {
    const allZero = Object.fromEntries(
      HARD_MATCH_CRITERIA.map((key) => [key, 0]),
    ) as Partial<MatchWeights>;
    const out = resolveMatchWeights(allZero);
    for (const key of HARD_MATCH_CRITERIA) {
      expect(out[key]).toBe(MIN_HARD_WEIGHT);
    }
  });

  it("איפוס הכול משאיר את הפוסלים ברצפה — לא ציון 0 לכל נכס", () => {
    const zeros = Object.fromEntries(
      Object.keys(DEFAULT_MATCH_WEIGHTS).map((key) => [key, 0]),
    ) as MatchWeights;
    const out = resolveMatchWeights(zeros);
    expect(out.location).toBe(MIN_HARD_WEIGHT);
    expect(out.entry_date).toBe(0);
    // הסכום חיובי, ולכן הניקוד נשאר בעל משמעות
    expect(Object.values(out).reduce((sum, v) => sum + v, 0)).toBeGreaterThan(0);
  });
});
