import { describe, expect, it } from "vitest";
import {
  hebrewCount,
  HEBREW_DAYS,
  HEBREW_OFFERS,
  HEBREW_VIEWINGS,
} from "./hebrew-count.js";

describe("מספר ושם עצם בעברית", () => {
  it("אחד ושניים בצורתם, ומשלושה — מספר ורבים", () => {
    expect(hebrewCount(1, HEBREW_VIEWINGS)).toBe("סיור אחד");
    expect(hebrewCount(2, HEBREW_VIEWINGS)).toBe("שני סיורים");
    expect(hebrewCount(3, HEBREW_VIEWINGS)).toBe("3 סיורים");
  });

  it("המין הדקדוקי בא מהקורא ולא מהחישוב", () => {
    /* ‏„שני” מול „שתי” אינו נגזר משם העצם, ולכן הצורות נמסרות */
    expect(hebrewCount(2, HEBREW_OFFERS)).toBe("שתי הצעות");
    expect(hebrewCount(2, HEBREW_DAYS)).toBe("יומיים");
  });

  it("אפס נאמר כרבים, לא כיחיד", () => {
    expect(hebrewCount(0, HEBREW_DAYS)).toBe("0 ימים");
  });
});
