import { describe, expect, it } from "vitest";
import { jerusalemWallIsoToUtc } from "./israel-time.js";
import {
  MAX_NOTICE_PERIOD_DAYS,
  NOTICE_WARNING_DAYS,
  OCCUPANCY_LABEL,
  OCCUPANCY_MEANING,
  OCCUPANCY_STATES,
  leaseNotice,
  noticePeriodRejectionReason,
  occupancyConflict,
  requiresTenant,
} from "./occupancy.js";

/** שעת קיר ישראלית → רגע. */
function at(wall: string): Date {
  return jerusalemWallIsoToUtc(wall);
}

describe("occupancyConflict", () => {
  /*
   * ‎**„מושכר” בלי שוכר הוא הצהרה ריקה.** המצב הזה קיים כדי שתיאום
   * ביקור יעבור דרך מישהו — ובלי טלפון הוא אומר „יש כאן אדם” ואינו
   * אומר מי.
   */
  it("„מושכר” דורש שוכר רשום", () => {
    expect(occupancyConflict("rented", false)).toContain("פרטי השוכר");
    expect(occupancyConflict("rented", true)).toBeNull();
  });

  /*
   * ‎**והכיוון ההפוך, שהוא המסוכן.** „אין דייר” בזמן ששוכר רשום
   * משאיר טלפון של אדם בכרטיס שמצהיר שאין שם אדם — כלומר מספר
   * שאיש כבר לא יודע למה הוא שם.
   */
  it("„אין דייר” ו„הבעלים גר” נחסמים כששוכר רשום", () => {
    for (const state of ["owner", "vacant"] as const) {
      expect(occupancyConflict(state, true)).toContain("הדירה התפנתה");
      expect(occupancyConflict(state, false)).toBeNull();
    }
  });

  /*
   * ההודעה נוקבת ב**פעולה**. „יש סתירה” שולח את המתווך לנחש; „סמנו
   * הדירה התפנתה” הוא משפט שאפשר לבצע.
   */
  it("ההודעה אומרת מה לעשות ולא רק מה שבור", () => {
    expect(occupancyConflict("owner", true)).toContain("הדירה התפנתה");
    expect(occupancyConflict("rented", false)).toContain("להוסיף");
  });

  it("רק „מושכר” מחייב שוכר", () => {
    expect(OCCUPANCY_STATES.filter(requiresTenant)).toEqual(["rented"]);
  });
});

describe("שלמות התוויות", () => {
  /*
   * שער על השלמות: מצב רביעי שיתווסף ולא יקבל ניסוח היה מוצג
   * כמחרוזת ריקה. הטיפוס מפיל את הקומפילציה, וזו מוודאת בזמן ריצה.
   */
  it("לכל מצב יש תווית ומשמעות, והמשמעות אינה חוזרת על התווית", () => {
    for (const state of OCCUPANCY_STATES) {
      expect(OCCUPANCY_LABEL[state].trim()).not.toBe("");
      expect(OCCUPANCY_MEANING[state].trim()).not.toBe("");
      expect(OCCUPANCY_MEANING[state]).not.toBe(OCCUPANCY_LABEL[state]);
    }
  });

  it("אין שתי תוויות זהות", () => {
    const labels = OCCUPANCY_STATES.map((s) => OCCUPANCY_LABEL[s]);
    expect(labels).toEqual([...new Set(labels)]);
  });
});

describe("noticePeriodRejectionReason", () => {
  it("מספר ימים תקין עובר", () => {
    expect(noticePeriodRejectionReason(0)).toBeNull();
    expect(noticePeriodRejectionReason(90)).toBeNull();
    expect(noticePeriodRejectionReason(MAX_NOTICE_PERIOD_DAYS)).toBeNull();
  });

  it("שבר, שלילי, וארוך מדי נדחים", () => {
    expect(noticePeriodRejectionReason(30.5)).not.toBeNull();
    expect(noticePeriodRejectionReason(-1)).not.toBeNull();
    expect(noticePeriodRejectionReason(MAX_NOTICE_PERIOD_DAYS + 1)).not.toBeNull();
  });
});

describe("leaseNotice", () => {
  it("המועד הוא תום החוזה פחות תקופת ההודעה", () => {
    const notice = leaseNotice(at("2026-09-01T00:00"), 90, at("2026-03-01T10:00"));
    expect(notice?.notifyBy).toBe("2026-06-03");
  });

  it("בלי תום חוזה אין מה לחשב", () => {
    expect(leaseNotice(null, 90, at("2026-03-01T10:00"))).toBeNull();
    expect(leaseNotice(undefined, 90, at("2026-03-01T10:00"))).toBeNull();
  });

  it("בלי תקופת הודעה המועד הוא תום החוזה עצמו", () => {
    expect(leaseNotice(at("2026-09-01T00:00"), null, at("2026-03-01T10:00"))?.notifyBy).toBe(
      "2026-09-01",
    );
  });

  /*
   * ‎**זה המצב שהחישוב כולו קיים בשבילו.** מתווך שאומר „הדירה
   * תתפנה בספטמבר” אחרי שהמועד להודיע חלף מוכר מועד כניסה שכבר
   * אינו קיים — והחוזה מתחדש לשנה.
   */
  it("מועד שחלף מסומן, וההודעה אומרת מה לבדוק", () => {
    const notice = leaseNotice(at("2026-09-01T00:00"), 90, at("2026-07-01T10:00"));
    expect(notice?.state).toBe("passed");
    expect(notice?.daysLeft).toBeLessThan(0);
    expect(notice?.message).toContain("חלף");
  });

  it("שלושים יום לפני — אזהרה, ולא רק מספר", () => {
    const notice = leaseNotice(at("2026-09-01T00:00"), 90, at("2026-05-20T10:00"));
    expect(notice?.state).toBe("soon");
    expect(notice?.daysLeft).toBeLessThanOrEqual(NOTICE_WARNING_DAYS);
    expect(notice?.message).toContain("נותרו");
  });

  it("רחוק מספיק — שקט", () => {
    expect(leaseNotice(at("2026-09-01T00:00"), 90, at("2026-01-01T10:00"))?.state).toBe("ok");
  });

  /*
   * ‎**הספירה בין ימים ולא בין רגעים.**
   *
   * הניסוח הראשון חילק הפרש רגעים ב-24 שעות, ואז אותו נתון בדיוק
   * החזיר „נותר יום” בבוקר ו„נותרו 0” בערב — מספר שמשתנה לפי מתי
   * המסך נטען. נמדד כאן בשתי שעות באותו יום, ולא משוער.
   */
  it("אותו יום מחזיר אותו מספר, בבוקר ובערב", () => {
    const lease = at("2026-09-01T00:00");
    const morning = leaseNotice(lease, 90, at("2026-06-01T07:00"));
    const evening = leaseNotice(lease, 90, at("2026-06-01T22:00"));
    expect(morning?.daysLeft).toBe(evening?.daysLeft);
    expect(morning?.daysLeft).toBe(2);
  });

  /*
   * ‎**מעבר שעון הקיץ.** היממה שבדרך אינה בת 24 שעות, וחישוב של
   * „עוד N פעמים 86,400 שניות” מחליק כאן יום. שעון הקיץ בישראל
   * נכנס בליל שישי האחרון של מרץ.
   */
  it("ספירת הימים אינה נשברת במעבר שעון הקיץ", () => {
    /* תום חוזה אחרי המעבר, „עכשיו” לפניו — הטווח חוצה אותו */
    const notice = leaseNotice(at("2026-04-10T00:00"), 0, at("2026-03-20T23:30"));
    expect(notice?.notifyBy).toBe("2026-04-10");
    expect(notice?.daysLeft).toBe(21);
  });
});
