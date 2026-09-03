import { describe, expect, it } from "vitest";
import {
  DEFAULT_SNOOZE_MINUTES,
  MAX_SNOOZE_MINUTES,
  parseSnoozeRequest,
  snoozeDurationLabel,
  snoozeReply,
} from "./assistant-lang";

/**
 * ‎**„שקט לשעתיים” כמשפט, ולא ככפתור.**
 *
 * ההשתקה הייתה פקד כפתור בלבד, ולכן כל הודעת התראה נשאה אותו —
 * גם כשלא היה קשור למה שכתוב מעליה. הבדיקות כאן הן מה שמאפשר
 * להוריד אותו: כל עוד המשפטים נתפסים, אין למה להיצמד לכפתור.
 *
 * הכישלון שהן מקבעות **שקט בהגדרה**: פענוח שגוי משתיק את הסוכן
 * לשעות, והמתווך מגלה זאת רק ממה שלא הגיע.
 */

/** שעון ישראל: 21:00 ב-2 בספטמבר (UTC+3 בקיץ). */
const EVENING = new Date(Date.UTC(2026, 8, 2, 18, 0, 0));

describe("parseSnoozeRequest — המשך", () => {
  it("„שקט לשעתיים” — בדיוק מה שהכפתור נתן", () => {
    expect(parseSnoozeRequest("שקט לשעתיים", EVENING)?.minutes).toBe(120);
  });

  it("פחות משעתיים", () => {
    expect(parseSnoozeRequest("שקט לחצי שעה", EVENING)?.minutes).toBe(30);
    expect(parseSnoozeRequest("שקט לרבע שעה", EVENING)?.minutes).toBe(15);
    expect(parseSnoozeRequest("אל תפריע לי ל-20 דקות", EVENING)?.minutes).toBe(20);
    expect(parseSnoozeRequest("תשתוק לשעה", EVENING)?.minutes).toBe(60);
  });

  it("יותר משעתיים, בספרות ובמילים", () => {
    expect(parseSnoozeRequest("שקט ל-3 שעות", EVENING)?.minutes).toBe(180);
    expect(parseSnoozeRequest("שקט ל4 שעות", EVENING)?.minutes).toBe(240);
    expect(parseSnoozeRequest("תשתוק חמש שעות", EVENING)?.minutes).toBe(300);
    expect(parseSnoozeRequest("שקט לשעה וחצי", EVENING)?.minutes).toBe(90);
  });

  it("„עד מחר” נמדד בשעון ישראל ולא בשעון המכונה", () => {
    // 21:00 בישראל → 07:00 למחרת = עשר שעות
    expect(parseSnoozeRequest("אל תפריע לי עד מחר", EVENING)?.minutes).toBe(10 * 60);
  });

  it("אחרי חצות „עד הבוקר” הוא היום הזה ולא מחר", () => {
    // 02:00 בישראל → 07:00 באותו יום = חמש שעות
    const night = new Date(Date.UTC(2026, 8, 2, 23, 0, 0));
    expect(parseSnoozeRequest("שקט עד הבוקר", night)?.minutes).toBe(5 * 60);
  });

  it("בלי משך — ברירת המחדל, אותן שעתיים", () => {
    expect(parseSnoozeRequest("שקט", EVENING)?.minutes).toBe(DEFAULT_SNOOZE_MINUTES);
    expect(parseSnoozeRequest("תשתוק", EVENING)?.minutes).toBe(DEFAULT_SNOOZE_MINUTES);
    expect(parseSnoozeRequest("אל תפריע לי", EVENING)?.minutes).toBe(DEFAULT_SNOOZE_MINUTES);
  });

  /*
   * הסבב סורק התראות מ-24 השעות האחרונות בלבד. השתקה ארוכה יותר
   * אינה שקט אלא מחיקה שקטה — ההתראה מתיישנת בזמן שהיא ממתינה.
   */
  it("בקשה ארוכה מדי נחתכת, ומסומנת ככזו", () => {
    const request = parseSnoozeRequest("שקט ל-30 שעות", EVENING);
    expect(request?.minutes).toBe(MAX_SNOOZE_MINUTES);
    expect(request?.clamped).toBe(true);
    expect(parseSnoozeRequest("שקט לשבוע", EVENING)?.clamped).toBe(true);
  });
});

describe("parseSnoozeRequest — הביטול", () => {
  /*
   * „תבטל את השקט” מכיל „שקט”. סדר בדיקה הפוך היה הופך כל בקשת
   * ביטול להשתקה נוספת — המתווך מבקש לחזור ומקבל עוד שעתיים.
   */
  it("„מספיק שקט” מבטל, ואינו משתיק שוב", () => {
    expect(parseSnoozeRequest("מספיק שקט", EVENING)).toEqual({ minutes: 0, clamped: false });
    expect(parseSnoozeRequest("תבטל את השקט", EVENING)?.minutes).toBe(0);
    expect(parseSnoozeRequest("אפשר להתריע", EVENING)?.minutes).toBe(0);
    expect(parseSnoozeRequest("חזרתי", EVENING)?.minutes).toBe(0);
  });
});

describe("parseSnoozeRequest — מה שאינו בקשת שקט", () => {
  it("משפט רגיל אינו משתיק את הסוכן", () => {
    expect(parseSnoozeRequest("מה יש לי היום?", EVENING)).toBeNull();
    expect(parseSnoozeRequest("תוסיף קונה חדש", EVENING)).toBeNull();
    expect(parseSnoozeRequest("", EVENING)).toBeNull();
  });

  /*
   * „הלקוח ביקש שקט” הוא תיאור ולא פקודה. משפט ארוך נשלח למנוע,
   * שם הוא ייקרא בהקשר — השתקה בטעות עולה שעות של עדכונים.
   */
  it("משפט ארוך שמזכיר שקט אינו פקודה", () => {
    expect(
      parseSnoozeRequest(
        "תרשום לי בהערות שהלקוח ביקש שקט בבניין ושהוא לא רוצה דירה מול הכביש",
        EVENING,
      ),
    ).toBeNull();
  });
});

describe("התשובה שהסוכן מחזיר", () => {
  it("אומרת את המשך בפועל ואת הדרך חזרה", () => {
    const reply = snoozeReply({ minutes: 30, clamped: false });
    expect(reply).toContain("30 דקות");
    expect(reply).toContain("מספיק שקט");
  });

  it("בקשה שנחתכה אומרת זאת במקום לאשר מה שלא בוצע", () => {
    expect(snoozeReply({ minutes: MAX_SNOOZE_MINUTES, clamped: true })).toContain("התקרה");
  });

  it("ביטול נשמע כמו חזרה, לא כמו שקט", () => {
    const reply = snoozeReply({ minutes: 0, clamped: false });
    expect(reply).toContain("🔔");
    expect(reply).not.toContain("שקט ל");
  });

  it("המשך נאמר כמו שאומרים אותו", () => {
    expect(snoozeDurationLabel(45)).toBe("45 דקות");
    expect(snoozeDurationLabel(60)).toBe("שעה");
    expect(snoozeDurationLabel(90)).toBe("שעה וחצי");
    expect(snoozeDurationLabel(120)).toBe("שעתיים");
    expect(snoozeDurationLabel(240)).toBe("4 שעות");
  });
});
