import { describe, expect, it } from "vitest";
import { jerusalemWallParts } from "./israel-time.js";
import { quickDueOptions } from "./quick-due.js";
import { openTasksSummary, snoozeTaskDue } from "./task-scheduling.js";

/** מה שהמתווך יראה — שעת קיר ישראלית, לא שעת התהליך. */
const wall = (at: Date): string => {
  const { date, time } = jerusalemWallParts(at);
  return `${date} ${time}`;
};

describe("דחיית משימה", () => {
  it("נוחתת מחר ב-09:00 בשעון ישראל", () => {
    expect(wall(snoozeTaskDue(new Date("2026-03-10T12:00:00Z"))!)).toBe("2026-03-11 09:00");
  });

  /*
   * ‎**„דחה” ו„מחר בבוקר” הם אותו רגע, ולא במקרה.** הדחייה נשענת על
   * הצ׳יפ עצמו; אילו חישבה בעצמה, שינוי בשעת הבוקר היה מפריד ביניהם
   * בשקט. הבדיקה נועלת את הקשר ולא רק את הערך.
   */
  it("זהה בדיוק לצ׳יפ „מחר בבוקר”", () => {
    for (const iso of [
      "2026-03-10T12:00:00Z",
      "2026-03-26T22:30:00Z" /* ליל המעבר לשעון קיץ */,
      "2026-10-24T23:10:00Z" /* ליל החזרה לשעון חורף */,
      "2026-07-02T05:00:00Z",
    ]) {
      const now = new Date(iso);
      const chip = quickDueOptions(now).find((o) => o.key === "tomorrow");
      expect(chip, iso).toBeDefined();
      expect(wall(snoozeTaskDue(now)!), iso).toBe(chip!.value.replace("T", " "));
    }
  });

  /*
   * ‎**דחייה חייבת להיות בעתיד.** „עוד יום מהמועד הקיים” על משימה
   * שאיחרה בשבוע היה דוחה אותה אל אתמול — כפתור שנלחץ ולא עושה דבר.
   */
  it("תמיד בעתיד, גם בשעה מאוחרת", () => {
    for (const iso of ["2026-03-10T12:00:00Z", "2026-03-10T21:40:00Z", "2026-03-10T23:50:00Z"]) {
      const now = new Date(iso);
      expect(snoozeTaskDue(now)!.getTime(), iso).toBeGreaterThan(now.getTime());
    }
  });

  /* מעבר שעון אינו מזיז את השעה — זו הסיבה שהחישוב אינו „ועוד 24 שעות” */
  it("מעבר לשעון קיץ אינו מזיז את שעת הבוקר", () => {
    expect(wall(snoozeTaskDue(new Date("2026-03-26T12:00:00Z"))!)).toBe("2026-03-27 09:00");
  });
});

describe("שורת המצב", () => {
  it("מספר פתוחות בלשון שקוראים אותה", () => {
    expect(openTasksSummary(0, 0)).toBe("אין משימות פתוחות");
    expect(openTasksSummary(1, 0)).toBe("משימה פתוחה אחת");
    expect(openTasksSummary(4, 0)).toBe("4 משימות פתוחות");
  });

  /*
   * ‎**„0 באיחור” מלמד את העין להתעלם מהשורה** — וביום שבו האיחור
   * קיים היא כבר בלתי נראית. לכן הוא מופיע רק כשיש מה לומר.
   */
  it("איחור מופיע רק כשהוא קיים", () => {
    expect(openTasksSummary(4, 0)).not.toContain("באיחור");
    expect(openTasksSummary(4, 1)).toBe("4 משימות פתוחות · אחת באיחור");
    expect(openTasksSummary(4, 2)).toBe("4 משימות פתוחות · 2 באיחור");
  });
});
