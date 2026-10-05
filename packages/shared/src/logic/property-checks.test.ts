import { describe, expect, it } from "vitest";
import {
  PROPERTY_CHECK_BY_KEY,
  PROPERTY_CHECK_KEYS,
  PROPERTY_CHECKS,
  propertyCheckTaskSourceKey,
  propertyCheckTaskTitle,
  propertyChecksProgress,
} from "./property-checks.js";

describe("תיק הבדיקות — הרשימה הסגורה", () => {
  it("לכל מפתח יש הגדרה אחת, ולכל הגדרה מפתח מהרשימה", () => {
    expect(PROPERTY_CHECKS.map((c) => c.key)).toEqual([...PROPERTY_CHECK_KEYS]);
    for (const key of PROPERTY_CHECK_KEYS) {
      expect(PROPERTY_CHECK_BY_KEY[key].title.length).toBeGreaterThan(3);
      expect(PROPERTY_CHECK_BY_KEY[key].why.length).toBeGreaterThan(10);
    }
  });
  it("קישור, כשיש, הוא שירות ממשלתי ב-https", () => {
    for (const check of PROPERTY_CHECKS) {
      if (check.href !== null) expect(check.href).toMatch(/^https:\/\/[a-z.]+gov\.il\//u);
    }
  });
});

describe("ההתקדמות", () => {
  it("„לא רלוונטי” נספר כנבדק; „בעיה” נספרת כנבדק ומונעת „מוכן”", () => {
    const p = propertyChecksProgress([
      { status: "ok" },
      { status: "na" },
      { status: "issue" },
      { status: "unchecked" },
    ]);
    expect(p).toEqual({ total: 4, checked: 3, remaining: 1, issues: 1, percent: 75, allClear: false });
  });
  it("הכול תקין או לא רלוונטי — מוכן להחתמה", () => {
    expect(propertyChecksProgress([{ status: "ok" }, { status: "na" }]).allClear).toBe(true);
  });
  it("רשימה ריקה אינה „מוכנה” ואינה מחלקת באפס", () => {
    expect(propertyChecksProgress([])).toEqual({ total: 0, checked: 0, remaining: 0, issues: 0, percent: 0, allClear: false });
  });
});

describe("המשימה שנולדת מבדיקה", () => {
  it("כותרת מהרשימה ומפתח אידמפוטנטי לפי הבדיקה", () => {
    expect(propertyCheckTaskTitle("tabu")).toBe("לבדוק: נסח טאבו עדכני");
    expect(propertyCheckTaskSourceKey("tabu")).toBe("property-check:tabu");
  });
});
