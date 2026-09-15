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

  /*
   * ‎**דחייה שמקדימה היא ההפך ממה שכתוב על הכפתור** (ביקורת Codex).
   *
   * ‎„דחה” מוצג על כל משימה פתוחה, כולל כאלה שמועדן בשבוע הבא.
   * כתיבה עיוורת של „מחר ב-9” הייתה **מקרבת** אותן.
   */
  describe("אינה מקדימה משימה עתידית", () => {
    const now = new Date("2026-03-10T12:00:00Z");

    it("משימה בשבוע הבא נדחקת יום קדימה ושומרת את שעתה", () => {
      const due = new Date("2026-03-17T14:30:00Z"); // 16:30 בישראל
      expect(wall(snoozeTaskDue(now, due)!)).toBe("2026-03-18 16:30");
    });

    it("משימה באיחור, בלי מועד, או להיום — נוחתות על מחר בבוקר", () => {
      const overdue = new Date("2026-03-01T09:00:00Z");
      expect(wall(snoozeTaskDue(now, overdue)!)).toBe("2026-03-11 09:00");
      expect(wall(snoozeTaskDue(now, null)!)).toBe("2026-03-11 09:00");
      expect(wall(snoozeTaskDue(now)!)).toBe("2026-03-11 09:00");
    });

    /*
     * ‎**התכונה שמחזיקה את כל השאר** — ונסרקת ולא נדגמת.
     *
     * הגרסה הראשונה בדקה ארבעה תאריכים נבחרים, וכולם עברו. מה
     * שנפל מביניהם הוא בדיוק המקרה שבו השעה **אינה קיימת למחרת**:
     * משימה ל-02:30 בליל המעבר לשעון קיץ נדחתה חמישה-עשר יום
     * אחורה (ביקורת Codex). דגימה אינה תופסת חור ברוחב שעה; סריקה
     * של כל השעות סביב שני המעברים כן.
     */
    it("לעולם אינה מוקדמת מהמועד הקיים — בכל שעה סביב שני המעברים", () => {
      const spans = [
        "2026-03-25", "2026-03-26", "2026-03-27" /* מעבר לשעון קיץ */,
        "2026-10-24", "2026-10-25", "2026-10-26" /* חזרה לשעון חורף */,
      ];
      for (const day of spans) {
        for (let hour = 0; hour < 24; hour += 1) {
          const due = new Date(`${day}T${String(hour).padStart(2, "0")}:30:00Z`);
          const at = snoozeTaskDue(now, due);
          const where = `${day} ${hour}:30Z`;
          expect(at, where).not.toBeNull();
          expect(at!.getTime(), where).toBeGreaterThan(due.getTime());
          expect(at!.getTime(), where).toBeGreaterThan(now.getTime());
        }
      }
    });

    /* המקרה המדויק שנפל: 02:30 בערב המעבר — שעה שאינה קיימת למחרת */
    it("שעה שאינה קיימת למחרת נופלת לתחילת אותו יום, לא אחורה", () => {
      const due = new Date("2026-03-26T00:30:00Z"); // 02:30 בישראל
      const at = snoozeTaskDue(now, due)!;
      expect(at.getTime()).toBeGreaterThan(due.getTime());
      expect(wall(at).slice(0, 10)).toBe("2026-03-27");
    });

    /* יום לוח ולא 24 שעות — אחרת שעת המשימה נודדת בליל המעבר */
    it("מעבר שעון אינו מזיז את שעת המשימה הנדחית", () => {
      const due = new Date("2026-03-26T12:00:00Z"); // 14:00 בישראל
      expect(wall(due)).toBe("2026-03-26 14:00");
      expect(wall(snoozeTaskDue(now, due)!)).toBe("2026-03-27 14:00");
    });
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
