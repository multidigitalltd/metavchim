import { describe, expect, it } from "vitest";
import {
  PENDING_AGREEMENT_LABEL,
  PENDING_AGREEMENT_MEANING,
  PENDING_AGREEMENT_STATES,
  pendingAgreementRank,
  pendingAgreementState,
} from "./agreement-pending.js";

const NOW = new Date("2026-03-10T12:00:00.000Z");
const LIVE = new Date("2026-04-01T00:00:00.000Z");
const DEAD = new Date("2026-02-01T00:00:00.000Z");

describe("pendingAgreementState", () => {
  it("נשלח וממתין", () => {
    expect(pendingAgreementState("pending", LIVE, NOW)).toBe("sent");
  });

  it("נפתח ולא נחתם", () => {
    expect(pendingAgreementState("viewed", LIVE, NOW)).toBe("opened");
  });

  it("קישור שפג", () => {
    expect(pendingAgreementState("pending", DEAD, NOW)).toBe("expired");
  });

  /*
   * ‎**זה הצירוף שהסדר קיים בשבילו.** הסכם שנפתח ואז פג נראה כמו
   * לקוח מתלבט, ובפועל אי אפשר לחתום עליו יותר — המתווך היה מתקשר
   * לבקש חתימה על קישור מת.
   */
  it("נפתח ואז פג — פקיעה גוברת", () => {
    expect(pendingAgreementState("viewed", DEAD, NOW)).toBe("expired");
  });

  /*
   * ‎**וסירוב גובר גם על פקיעה.** „סירב” הוא הכרעה של הלקוח; טוקן
   * שפג אחריה אינו הופך אותה ל„שלחו שוב”.
   */
  it("סירוב גובר על פקיעה", () => {
    expect(pendingAgreementState("declined", DEAD, NOW)).toBe("declined");
    expect(pendingAgreementState("declined", LIVE, NOW)).toBe("declined");
  });

  /*
   * הגבול עצמו: תוקף הוא „עד”, ורגע הפקיעה כבר פג. שנייה לפניו —
   * עדיין חי.
   */
  it("רגע הפקיעה עצמו כבר פג", () => {
    expect(pendingAgreementState("pending", NOW, NOW)).toBe("expired");
    expect(pendingAgreementState("pending", new Date(NOW.getTime() + 1), NOW)).toBe("sent");
  });

  /*
   * ‎**מחרוזת לא מוכרת נופלת ל„ממתין”, ולא ל„נפתח”.** סטטוס שלא
   * זוהה אינו ראיה שהלקוח פתח את המסמך, וטענה כזו הייתה שולחת
   * לשיחת „ראיתי שפתחת” על מי שלא פתח.
   */
  it("סטטוס לא מוכר אינו נטען כנפתח", () => {
    expect(pendingAgreementState("whatever", LIVE, NOW)).toBe("sent");
  });
});

describe("דירוג", () => {
  it("הסדר הוא לפי דחיפות הפעולה", () => {
    const sorted = [...PENDING_AGREEMENT_STATES].sort(
      (a, b) => pendingAgreementRank(a) - pendingAgreementRank(b),
    );
    expect(sorted).toEqual(["opened", "expired", "sent", "declined"]);
  });

  it("„סירב” אחרון — אינו ממתין לדבר", () => {
    for (const state of PENDING_AGREEMENT_STATES) {
      if (state === "declined") continue;
      expect(pendingAgreementRank(state)).toBeLessThan(pendingAgreementRank("declined"));
    }
  });
});

describe("שלמות התוויות", () => {
  /*
   * שער על השלמות: מצב חמישי שיתווסף בלי ניסוח היה מוצג כמחרוזת
   * ריקה. הטיפוס מפיל את הקומפילציה, וזו מוודאת בזמן ריצה.
   */
  it("לכל מצב יש תווית ומשמעות, והמשמעות אינה חוזרת על התווית", () => {
    for (const state of PENDING_AGREEMENT_STATES) {
      expect(PENDING_AGREEMENT_LABEL[state].trim()).not.toBe("");
      expect(PENDING_AGREEMENT_MEANING[state].trim()).not.toBe("");
      expect(PENDING_AGREEMENT_MEANING[state]).not.toBe(PENDING_AGREEMENT_LABEL[state]);
    }
  });

  it("אין שתי תוויות זהות", () => {
    const labels = PENDING_AGREEMENT_STATES.map((s) => PENDING_AGREEMENT_LABEL[s]);
    expect(labels).toEqual([...new Set(labels)]);
  });

  /*
   * ‎**המשמעות נוקבת בפעולה ולא רק בבעיה** — אותו כלל כמו בכל הודעת
   * מצב במערכת הזו. „הקישור פג” הוא עובדה; „יש לשלוח קישור חדש”
   * אפשר לבצע.
   */
  it("המשמעות אומרת מה לעשות", () => {
    expect(PENDING_AGREEMENT_MEANING.expired).toContain("לשלוח");
    expect(PENDING_AGREEMENT_MEANING.opened).toContain("שיחה");
  });
});
