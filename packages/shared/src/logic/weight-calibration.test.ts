import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_WEIGHTS, MAX_MATCH_WEIGHT, type MatchWeights } from "./matching.js";
import type { DismissReason } from "./match-feedback.js";
import {
  CALIBRATION_STEP,
  calibrateMatchWeights,
} from "./weight-calibration.js";

const base = (): MatchWeights => ({ ...DEFAULT_MATCH_WEIGHTS });

const times = (reason: DismissReason, n: number): DismissReason[] =>
  Array.from({ length: n }, () => reason);

describe("calibrateMatchWeights", () => {
  it("מעט מדי ראיות — אין כיול", () => {
    expect(calibrateMatchWeights(base(), times("price", 5))).toBeNull();
  });

  it("דחיות שאינן מעידות על קריטריון אינן נספרות בבסיס", () => {
    // 20 "לא מחפש כרגע" + 5 מחיר: הממופות הן 5 בלבד — מתחת לסף
    const reasons = [...times("not_interested", 20), ...times("price", 5)];
    expect(calibrateMatchWeights(base(), reasons)).toBeNull();
  });

  it("סיבה דומיננטית מעלה את משקל הקריטריון שלה בצעד אחד", () => {
    const result = calibrateMatchWeights(base(), times("price", 12));
    expect(result).not.toBeNull();
    expect(result!.adjusted).toHaveLength(1);
    expect(result!.adjusted[0]).toMatchObject({
      criterion: "budget",
      from: DEFAULT_MATCH_WEIGHTS.budget,
      to: DEFAULT_MATCH_WEIGHTS.budget + CALIBRATION_STEP,
    });
    expect(result!.weights.budget).toBe(DEFAULT_MATCH_WEIGHTS.budget + CALIBRATION_STEP);
    // שאר המשקלים לא זזים — הכיול מעלה בלבד, ורק את מה שיש עליו ראיות
    expect(result!.weights.rooms).toBe(DEFAULT_MATCH_WEIGHTS.rooms);
  });

  it("לכל היותר שני קריטריונים בקריאה אחת", () => {
    const reasons = [
      ...times("price", 10),
      ...times("location", 10),
      ...times("rooms", 10),
    ];
    const result = calibrateMatchWeights(base(), reasons);
    expect(result).not.toBeNull();
    expect(result!.adjusted).toHaveLength(2);
  });

  it("סיבה מתחת לרבע מהדחיות אינה ראיה", () => {
    // 12 ממופות: 9 מחיר (75%) + 3 חדרים (25% בדיוק — עובר) — נבדוק 2/12
    const reasons = [...times("price", 10), ...times("rooms", 2)];
    const result = calibrateMatchWeights(base(), reasons);
    expect(result).not.toBeNull();
    expect(result!.adjusted.map((a) => a.criterion)).toEqual(["budget"]);
  });

  it("קריטריון שכבר בתקרה אינו משתנה — ובלי שינוי אין תוצאה", () => {
    const weights = { ...base(), budget: MAX_MATCH_WEIGHT };
    expect(calibrateMatchWeights(weights, times("price", 12))).toBeNull();
  });

  it("צעד שחוצה את התקרה נחתך אליה — התקרה של המחוון במסך", () => {
    const weights = { ...base(), budget: MAX_MATCH_WEIGHT - 0.02 };
    const result = calibrateMatchWeights(weights, times("price", 12));
    expect(result!.weights.budget).toBe(MAX_MATCH_WEIGHT);
  });

  it("התוצאה מעוגלת לשתי ספרות", () => {
    const weights = { ...base(), budget: 0.33 };
    const result = calibrateMatchWeights(weights, times("price", 12));
    expect(result!.weights.budget).toBe(0.38);
  });
});
