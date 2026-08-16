import { describe, expect, it } from "vitest";
import {
  DISMISS_REASONS,
  DISMISS_REASON_CRITERION,
  DISMISS_REASON_LABEL,
  MIN_DISMISSALS_FOR_INSIGHT,
  summarizeDismissals,
  type DismissReason,
} from "./match-feedback.js";
import { DEFAULT_MATCH_WEIGHTS } from "./matching.js";

const repeat = (reason: DismissReason, times: number): DismissReason[] =>
  Array.from({ length: times }, () => reason);

describe("קטלוג הסיבות", () => {
  it("לכל סיבה יש תווית", () => {
    for (const reason of DISMISS_REASONS) {
      expect(DISMISS_REASON_LABEL[reason]).toBeTruthy();
    }
  });

  it("כל קריטריון שסיבה מצביעה עליו קיים באמת במנוע", () => {
    // אחרת הדוח ימליץ לשנות משקל של קריטריון שאינו קיים
    for (const reason of DISMISS_REASONS) {
      const criterion = DISMISS_REASON_CRITERION[reason];
      if (criterion !== null) expect(DEFAULT_MATCH_WEIGHTS).toHaveProperty(criterion);
    }
  });
});

describe("summarizeDismissals", () => {
  it("סופר, ממיין ומחשב אחוזים", () => {
    const out = summarizeDismissals([...repeat("price", 3), ...repeat("location", 1)]);
    expect(out.total).toBe(4);
    expect(out.tallies[0]!.reason).toBe("price");
    expect(out.tallies[0]!.percent).toBe(75);
  });

  it("מעט מדי דחיות — בלי מסקנה, כי אחוז מתוך שלוש הוא רעש", () => {
    const out = summarizeDismissals(repeat("price", 3));
    expect(out.insight).toBeNull();
    expect(out.tallies[0]!.count).toBe(3);
  });

  it("סיבה שולטת ⇒ המלצה על הקריטריון המתאים", () => {
    const out = summarizeDismissals(repeat("price", MIN_DISMISSALS_FOR_INSIGHT));
    expect(out.insight).toContain("budget");
    expect(out.insight).toContain("100%");
  });

  it("פיזור על כמה סיבות ⇒ נאמר במפורש שאין מה לשנות", () => {
    const out = summarizeDismissals([
      ...repeat("price", 4),
      ...repeat("location", 4),
      ...repeat("rooms", 4),
    ]);
    expect(out.insight).toContain("מתפזרות");
  });

  it("\"הלקוח לא מחפש\" אינו מאשים את המנוע", () => {
    const out = summarizeDismissals(repeat("not_interested", 20));
    expect(out.insight).toContain("בשלות");
    expect(out.insight).not.toContain("משקל");
  });

  it("מצב הנכס ⇒ נאמר שזה שדה חסר ולא משקל שגוי", () => {
    const out = summarizeDismissals(repeat("condition", 20));
    expect(out.insight).toContain("אין לו שדה");
  });

  it("רשימה ריקה", () => {
    expect(summarizeDismissals([])).toEqual({ total: 0, tallies: [], insight: null });
  });

  it("מיון יציב כששתי סיבות שוות — אותו פלט בכל ריצה", () => {
    const input: DismissReason[] = [...repeat("rooms", 2), ...repeat("area", 2)];
    const first = summarizeDismissals(input).tallies.map((t) => t.reason);
    const second = summarizeDismissals([...input].reverse()).tallies.map((t) => t.reason);
    expect(first).toEqual(second);
  });
});
