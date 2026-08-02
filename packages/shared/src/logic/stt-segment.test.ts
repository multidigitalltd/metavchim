import { describe, expect, it } from "vitest";
import {
  SEGMENT_DEFAULT_SECONDS,
  SEGMENT_MAX_SECONDS,
  SEGMENT_MIN_SECONDS,
  recommendSegmentSeconds,
} from "./stt-segment.js";

describe("recommendSegmentSeconds", () => {
  it("מחזיר ברירת מחדל שמרנית כשעדיין לא נמדד כלום", () => {
    expect(recommendSegmentSeconds(undefined)).toBe(SEGMENT_DEFAULT_SECONDS);
    expect(recommendSegmentSeconds(null)).toBe(SEGMENT_DEFAULT_SECONDS);
    expect(recommendSegmentSeconds(0)).toBe(SEGMENT_DEFAULT_SECONDS);
  });

  it("מתעלם מערכים לא תקינים במקום להחזיר NaN", () => {
    expect(recommendSegmentSeconds(Number.NaN)).toBe(SEGMENT_DEFAULT_SECONDS);
    expect(recommendSegmentSeconds(Number.POSITIVE_INFINITY)).toBe(SEGMENT_DEFAULT_SECONDS);
    expect(recommendSegmentSeconds(-3)).toBe(SEGMENT_DEFAULT_SECONDS);
  });

  it("הקטע תמיד ארוך מזמן העיבוד — אחרת הפיגור מצטבר", () => {
    for (const avg of [9, 10, 12, 15, 18]) {
      expect(recommendSegmentSeconds(avg)).toBeGreaterThan(avg);
    }
  });

  it("שרת מהיר מקבל קטעים קצרים — טקסט חי יותר", () => {
    expect(recommendSegmentSeconds(2)).toBe(SEGMENT_MIN_SECONDS);
    expect(recommendSegmentSeconds(9)).toBe(12);
  });

  it("שרת איטי לא מקבל קטעים אינסופיים", () => {
    expect(recommendSegmentSeconds(60)).toBe(SEGMENT_MAX_SECONDS);
    expect(recommendSegmentSeconds(1000)).toBe(SEGMENT_MAX_SECONDS);
  });
});
