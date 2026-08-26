import { describe, expect, it } from "vitest";
import { MATCH_CRITERIA } from "../schemas/match.js";
import type { ScoreComponent } from "../schemas/match.js";
import { matchChips } from "./match-chips.js";

function part(
  criterion: ScoreComponent["criterion"],
  score: number,
  note?: string,
): ScoreComponent {
  return { criterion, score, weight: 0.1, ...(note === undefined ? {} : { note }) };
}

describe("matchChips", () => {
  it("קריטריון שנבדק ועבר הוא צ'יפ תואם, בתווית שלו", () => {
    const chips = matchChips([part("rooms", 1)]);
    const rooms = chips.find((c) => c.criterion === "rooms")!;
    expect(rooms.tone).toBe("matched");
    expect(rooms.label).toBe("מספר חדרים");
  });

  /*
   * ‎**ההבחנה שכל הקובץ קיים בשבילה.**
   *
   * קריטריון שנבדק ונכשל וקריטריון שלא נבדק כלל נראו זהים על המסך —
   * שניהם „לא ירוק”. ההבדל הוא בין „הקונה לא מתאים” לבין „לא מילאנו
   * שדה”, ושתי המסקנות הפוכות.
   */
  it("„נבדק ונכשל” ו„לא נבדק” הם שני מצבים שונים", () => {
    const failed = matchChips([part("budget", 0, "תקציב נמוך ב-5%")]);
    expect(failed.find((c) => c.criterion === "budget")).toEqual({
      tone: "partial",
      label: "תקציב נמוך ב-5%",
      criterion: "budget",
    });

    const never = matchChips([]);
    expect(never.find((c) => c.criterion === "budget")).toEqual({
      tone: "missing",
      label: "לא נבדק: תקציב",
      criterion: "budget",
    });
  });

  it("ציון חלקי אינו „תואם”", () => {
    const chips = matchChips([part("area", 0.5, "שטח קטן מהמבוקש")]);
    expect(chips.find((c) => c.criterion === "area")?.tone).toBe("partial");
  });

  /*
   * הניקוד מגיע ל-1 דרך כפל שברים, ולכן `0.9999` הוא „תואם” ולא
   * „חלקי”. השוואה ל-1 מדויק הייתה צובעת התאמה מלאה בענבר.
   */
  it("ציון שנבנה מכפל שברים ומגיע כמעט ל-1 נחשב תואם", () => {
    expect(matchChips([part("location", 0.9999)])[0]?.tone).toBe("matched");
  });

  it("כשאין הערה מוצגת התווית, ולא סיבה מומצאת", () => {
    const chips = matchChips([part("rooms", 0)]);
    expect(chips.find((c) => c.criterion === "rooms")?.label).toBe("מספר חדרים");
  });

  /*
   * הרשימה נבנית מ-`MATCH_CRITERIA` ולא ממה שהגיע, ולכן קריטריון
   * אינו נשמט משום שהמנוע לא דחף אותו — וגם אינו מופיע פעמיים אם
   * דחף אותו כפול.
   */
  it("כל קריטריון מופיע בדיוק פעם אחת, גם על פירוט כפול או ריק", () => {
    for (const breakdown of [[], [part("rooms", 1), part("rooms", 0)]]) {
      const chips = matchChips(breakdown);
      expect(chips).toHaveLength(MATCH_CRITERIA.length);
      expect(new Set(chips.map((c) => c.criterion)).size).toBe(MATCH_CRITERIA.length);
    }
  });

  /*
   * הסדר הוא מה שהמתווך קורא: קודם למה כן, אחר כך מה מפריע, ולבסוף
   * מה אפשר להשלים — ובתוך כל קבוצה לפי כובד הקריטריון.
   */
  it("תואם קודם, אחריו חלקי, אחריו לא-נבדק", () => {
    const chips = matchChips([part("rooms", 1), part("budget", 0)]);
    const tones = chips.map((c) => c.tone);
    expect(tones.indexOf("matched")).toBeLessThan(tones.indexOf("partial"));
    expect(tones.indexOf("partial")).toBeLessThan(tones.indexOf("missing"));
  });

  it("בתוך אותה קבוצה — הכבד קודם", () => {
    // מיקום .25 כבד מחדרים .15, ושניהם תואמים
    const chips = matchChips([part("rooms", 1), part("location", 1)]);
    expect(chips[0]?.criterion).toBe("location");
    expect(chips[1]?.criterion).toBe("rooms");
  });
});
