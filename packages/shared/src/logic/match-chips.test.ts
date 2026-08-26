import { describe, expect, it } from "vitest";
import { MATCH_CRITERIA } from "../schemas/match.js";
import type { MatchCriterion, ScoreComponent } from "../schemas/match.js";
import { matchChips } from "./match-chips.js";

function part(
  criterion: ScoreComponent["criterion"],
  score: number,
  note?: string,
): ScoreComponent {
  return { criterion, score, weight: 0.1, ...(note === undefined ? {} : { note }) };
}

/**
 * נכס ריק — אינו מסוגל לאף קריטריון, ולכן כל קריטריון שנעדר הוא
 * „חסר בנכס”. זו ברירת המחדל ברוב הבדיקות כאן, כי היא זו שמייצרת
 * צ'יפים אפורים לבדוק אותם.
 */
const NOTHING: ReadonlySet<MatchCriterion> = new Set();
/** נכס מלא — כל קריטריון שנעדר נעדר משום שהקונה לא ביקש. */
const EVERYTHING: ReadonlySet<MatchCriterion> = new Set(MATCH_CRITERIA);

describe("matchChips", () => {
  it("קריטריון שנבדק ועבר הוא צ'יפ תואם, בתווית שלו", () => {
    const chips = matchChips([part("rooms", 1)], NOTHING);
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
  it("„נבדק ונכשל” ו„חסר בנכס” הם שני מצבים שונים", () => {
    const failed = matchChips([part("budget", 0, "תקציב נמוך ב-5%")], NOTHING);
    expect(failed.find((c) => c.criterion === "budget")).toEqual({
      tone: "partial",
      label: "תקציב נמוך ב-5%",
      criterion: "budget",
      weight: 0.1,
    });

    const never = matchChips([], NOTHING);
    expect(never.find((c) => c.criterion === "budget")).toEqual({
      tone: "missing",
      label: "חסר בנכס: תקציב",
      criterion: "budget",
      // קריטריון שלא נבחן — ברירת המחדל, כי לא היה לו משקל אפקטיבי
      weight: 0.25,
    });
  });

  /*
   * ‎**המצב הרביעי, וזה שנשמט.**
   *
   * קריטריון יכול להיעדר גם משום שהקונה לא ביקש אותו — לא הגדיר
   * תקציב, לא סימן ולו מאפיין אחד כ„נחמד שיהיה”. הנכס מלא, אין מה
   * להשלים, וההתאמה מלאה כפי שהיא.
   *
   * הגרסה הקודמת צבעה גם אותו באפור „לא נבדק”, ולכן התאמה תקינה
   * לחלוטין נראתה כמלאה בשדות פתוחים והמתווך נשלח לחפש מה למלא
   * (ביקורת Codex).
   */
  it("קריטריון שהנכס מסוגל לו ולא נבחן — הקונה לא ביקש, ואין צ'יפ", () => {
    const chips = matchChips([part("rooms", 1)], EVERYTHING);
    expect(chips.map((c) => c.criterion)).toEqual(["rooms"]);
  });

  /*
   * אותו פירוט בדיוק, ושתי תשובות הפוכות — ההפרש הוא **הנכס**
   * ולא ההתאמה. זה מה שהפרמטר השני קיים בשבילו.
   */
  it("אותו פירוט: נכס ריק מייצר צ'יפים אפורים, נכס מלא לא", () => {
    const breakdown = [part("location", 1)];
    expect(matchChips(breakdown, NOTHING).filter((c) => c.tone === "missing")).toHaveLength(
      MATCH_CRITERIA.length - 1,
    );
    expect(matchChips(breakdown, EVERYTHING).filter((c) => c.tone === "missing")).toHaveLength(0);
  });

  it("ציון חלקי אינו „תואם”", () => {
    const chips = matchChips([part("area", 0.5, "שטח קטן מהמבוקש")], NOTHING);
    expect(chips.find((c) => c.criterion === "area")?.tone).toBe("partial");
  });

  /*
   * הניקוד מגיע ל-1 דרך כפל שברים, ולכן `0.9999` הוא „תואם” ולא
   * „חלקי”. השוואה ל-1 מדויק הייתה צובעת התאמה מלאה בענבר.
   */
  it("ציון שנבנה מכפל שברים ומגיע כמעט ל-1 נחשב תואם", () => {
    expect(matchChips([part("location", 0.9999)], EVERYTHING)[0]?.tone).toBe("matched");
  });

  it("כשאין הערה מוצגת התווית, ולא סיבה מומצאת", () => {
    const chips = matchChips([part("rooms", 0)], NOTHING);
    expect(chips.find((c) => c.criterion === "rooms")?.label).toBe("מספר חדרים");
  });

  /*
   * הרשימה נבנית מ-`MATCH_CRITERIA` ולא ממה שהגיע, ולכן קריטריון
   * אינו נשמט משום שהמנוע לא דחף אותו — וגם אינו מופיע פעמיים אם
   * דחף אותו כפול.
   */
  it("כל קריטריון מופיע לכל היותר פעם אחת, גם על פירוט כפול או ריק", () => {
    for (const breakdown of [[], [part("rooms", 1), part("rooms", 0)]]) {
      const chips = matchChips(breakdown, NOTHING);
      expect(chips).toHaveLength(MATCH_CRITERIA.length);
      expect(new Set(chips.map((c) => c.criterion)).size).toBe(MATCH_CRITERIA.length);
    }
  });

  /*
   * הסדר הוא מה שהמתווך קורא: קודם למה כן, אחר כך מה מפריע, ולבסוף
   * מה אפשר להשלים — ובתוך כל קבוצה לפי כובד הקריטריון.
   */
  it("תואם קודם, אחריו חלקי, אחריו חסר-בנכס", () => {
    const chips = matchChips([part("rooms", 1), part("budget", 0)], NOTHING);
    const tones = chips.map((c) => c.tone);
    expect(tones.indexOf("matched")).toBeLessThan(tones.indexOf("partial"));
    expect(tones.indexOf("partial")).toBeLessThan(tones.indexOf("missing"));
  });

  it("בתוך אותה קבוצה — הכבד קודם", () => {
    // מיקום .25 כבד מחדרים .15, ושניהם תואמים
    const chips = matchChips(
      [
        { criterion: "rooms", score: 1, weight: 0.15 },
        { criterion: "location", score: 1, weight: 0.25 },
      ],
      EVERYTHING,
    );
    expect(chips[0]?.criterion).toBe("location");
    expect(chips[1]?.criterion).toBe("rooms");
  });

  /*
   * ‎**המשקל של המשרד, לא של המערכת.**
   *
   * משרד יכול לכייל משקלים בהגדרות, והרכיב שחזר נושא את המשקל
   * שבפועל שימש. מיון לפי ברירת המחדל היה דוחף לסוף השורה דווקא את
   * הקריטריון שהמשרד הכריז עליו כחשוב.
   *
   * כאן חדרים מכוילים ל-.5 ומיקום ל-.1 — ההפך מברירת המחדל — ולכן
   * חדרים חייבים להופיע ראשונים.
   */
  it("המיון לפי המשקל שההתאמה חושבה בו, ולא לפי ברירת המחדל", () => {
    const chips = matchChips(
      [
        { criterion: "location", score: 1, weight: 0.1 },
        { criterion: "rooms", score: 1, weight: 0.5 },
      ],
      EVERYTHING,
    );
    expect(chips[0]?.criterion).toBe("rooms");
    expect(chips[1]?.criterion).toBe("location");
  });
});
