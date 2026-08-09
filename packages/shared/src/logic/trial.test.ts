import { describe, expect, it } from "vitest";
import {
  TRIAL_WARN_WITHIN_DAYS,
  describeTrialLeft,
  isTrialExpired,
  shouldWarnAboutTrial,
  trialDaysLeft,
} from "./trial.js";

const NOW = new Date("2026-08-09T10:00:00Z");
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 86_400_000);

describe("trialDaysLeft", () => {
  it("ימים שלמים", () => {
    expect(trialDaysLeft(inDays(5), NOW)).toBe(5);
  });

  it("מעגל כלפי מעלה — שעתיים שנותרו הן עדיין יום", () => {
    // 0 ימים נקרא כאילו זה כבר נגמר, וזה לא נכון
    expect(trialDaysLeft(new Date(NOW.getTime() + 2 * 3_600_000), NOW)).toBe(1);
  });

  it("תקופה שחלפה מחזירה ערך שלילי או אפס", () => {
    expect(trialDaysLeft(inDays(-3), NOW)).toBe(-3);
  });

  it("null = אין תפוגה", () => {
    expect(trialDaysLeft(null, NOW)).toBeNull();
    expect(trialDaysLeft(undefined, NOW)).toBeNull();
  });

  it("מקבל גם מחרוזת ISO — זה מה שמגיע מהשרת", () => {
    expect(trialDaysLeft(inDays(4).toISOString(), NOW)).toBe(4);
  });

  it("תאריך לא תקין לא מתרסק ולא נועל", () => {
    expect(trialDaysLeft("מחר", NOW)).toBeNull();
  });
});

describe("isTrialExpired", () => {
  it("לפני התפוגה", () => {
    expect(isTrialExpired(inDays(1), NOW)).toBe(false);
  });

  it("אחרי התפוגה", () => {
    expect(isTrialExpired(inDays(-1), NOW)).toBe(true);
  });

  it("בדיוק ברגע התפוגה נחשב פג", () => {
    expect(isTrialExpired(NOW, NOW)).toBe(true);
  });

  it("בלי תפוגה לעולם לא פג", () => {
    expect(isTrialExpired(null, NOW)).toBe(false);
  });

  it("תאריך לא תקין לא נועל את המשרד — הכיוון הבטוח כאן הפוך", () => {
    // נעילת משרד עובד בגלל ערך פגום גרועה מהמשך עבודה של משרד שפג
    expect(isTrialExpired("---", NOW)).toBe(false);
  });
});

describe("shouldWarnAboutTrial", () => {
  it("בתוך החלון", () => {
    expect(shouldWarnAboutTrial(inDays(3), NOW)).toBe(true);
  });

  it("מחוץ לחלון — באנר קבוע הופך לרעש", () => {
    expect(shouldWarnAboutTrial(inDays(TRIAL_WARN_WITHIN_DAYS + 1), NOW)).toBe(false);
  });

  it("בדיוק על הגבול מזהיר", () => {
    expect(shouldWarnAboutTrial(inDays(TRIAL_WARN_WITHIN_DAYS), NOW)).toBe(true);
  });

  it("גם אחרי שפג — המצב עדיין דורש הודעה", () => {
    expect(shouldWarnAboutTrial(inDays(-2), NOW)).toBe(true);
  });

  it("בלי תפוגה אין אזהרה", () => {
    expect(shouldWarnAboutTrial(null, NOW)).toBe(false);
  });

  it("חלון מותאם", () => {
    expect(shouldWarnAboutTrial(inDays(10), NOW, 14)).toBe(true);
  });
});

describe("describeTrialLeft", () => {
  it("יום אחד בצורת יחיד", () => {
    expect(describeTrialLeft(1)).toBe("נשאר יום אחד לתקופת הניסיון");
  });

  it("כמה ימים", () => {
    expect(describeTrialLeft(5)).toContain("5");
  });

  it("שחלף", () => {
    expect(describeTrialLeft(0)).toBe("תקופת הניסיון הסתיימה");
    expect(describeTrialLeft(-4)).toBe("תקופת הניסיון הסתיימה");
  });
});
