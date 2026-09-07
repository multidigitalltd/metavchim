import { describe, expect, it } from "vitest";
import {
  dailyEmailIdempotencyKey,
  EMAIL_ATTEMPT_STALE_MS,
  EMAIL_IDEMPOTENCY_KEY_MAX,
  emailAttemptDecision,
  isValidEmailIdempotencyKey,
} from "./email-send-attempt.js";

const NOW = new Date("2026-09-07T10:00:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

describe("‏ניסיון חוזר על אותה שליחה", () => {
  it("‏אין ניסיון קודם — שולחים", () => {
    expect(emailAttemptDecision(null, NOW)).toBe("send");
  });

  it("‏כבר יצא — לא שולחים שוב", () => {
    expect(emailAttemptDecision({ status: "sent", updatedAt: ago(1) }, NOW)).toBe("resolved");
  });

  /*
   * ‏הספק בדק ופסל, ולכן ידוע שההודעה **לא** יצאה: ניסיון חוזר כאן
   * ‏אינו כפילות. אילו הוא היה נחסם, תיקון של כתובת שגויה לא היה
   * ‏יכול לצאת לעולם.
   */
  it("‏נדחה — שולחים שוב", () => {
    expect(emailAttemptDecision({ status: "rejected", updatedAt: ago(1) }, NOW)).toBe("send");
  });

  it("‏עמום — שואלים את הספק לפני שמחליטים", () => {
    expect(emailAttemptDecision({ status: "unknown", updatedAt: ago(1) }, NOW)).toBe("probe");
  });

  it("‏שליחה זהה ממש עכשיו — לא שולחים במקביל", () => {
    expect(emailAttemptDecision({ status: "sending", updatedAt: ago(1_000) }, NOW)).toBe(
      "inFlight",
    );
  });

  /*
   * ‎**והחצי שבלעדיו הזיכרון הופך לחסם.** תהליך שקרס בין הכתיבה
   * ‏לשליחה משאיר שורה תקועה ב-`sending`; בלי תקרה, אותה שליחה
   * ‏הייתה נחסמת לנצח — כלומר המנגנון שנועד למנוע מייל כפול היה
   * ‏מונע את המייל עצמו.
   */
  it("‏שליחה תקועה מזמן — חוזרת להיות עמומה", () => {
    expect(
      emailAttemptDecision({ status: "sending", updatedAt: ago(EMAIL_ATTEMPT_STALE_MS) }, NOW),
    ).toBe("probe");
  });

  it("‏והגבול עצמו נמדד ולא מנוחש", () => {
    const justBefore = { status: "sending", updatedAt: ago(EMAIL_ATTEMPT_STALE_MS - 1) } as const;
    expect(emailAttemptDecision(justBefore, NOW)).toBe("inFlight");
  });

  /* ‏שעון שנסוג (NTP) אינו הופך שורה טרייה לישנה */
  it("‏חותמת מהעתיד אינה מזדקנת", () => {
    expect(
      emailAttemptDecision({ status: "sending", updatedAt: new Date(NOW.getTime() + 5_000) }, NOW),
    ).toBe("inFlight");
  });
});

describe("‏מפתח האידמפוטנטיות", () => {
  it("‏מזהה עסקי רגיל תקין", () => {
    expect(isValidEmailIdempotencyKey("agreement:01JABCDEFGHJKMNPQRSTVWXYZ0")).toBe(true);
  });

  it("‏ריק אינו מפתח", () => {
    expect(isValidEmailIdempotencyKey("")).toBe(false);
  });

  /*
   * ‏Postmark חותך ערך מטא-דאטה ב-80 תווים. מפתח ארוך היה נשלח
   * ‏קטוע, והחיפוש בדיעבד היה מחפש מחרוזת שאינה קיימת — כלומר
   * ‏ההגנה נשברת בדיוק כשנזקקים לה.
   */
  it("‏ארוך מהגבול של הספק נפסל", () => {
    expect(isValidEmailIdempotencyKey("a".repeat(EMAIL_IDEMPOTENCY_KEY_MAX))).toBe(true);
    expect(isValidEmailIdempotencyKey("a".repeat(EMAIL_IDEMPOTENCY_KEY_MAX + 1))).toBe(false);
  });

  /* ‏המפתח נכנס למחרוזת שאילתה — תו ששובר אותה שובר את החיפוש */
  it("‏תווים ששוברים מחרוזת שאילתה נפסלים", () => {
    for (const key of ["a b", "a&b", "a=b", "a?b", "a#b", "a/b", "שלום"]) {
      expect(isValidEmailIdempotencyKey(key), key).toBe(false);
    }
  });
});

describe("‏מפתח לאירוע חוזר", () => {
  const SEAT = "01SEATAAAAAAAAAAAAAAAAAAAA";

  it("‏אותו אירוע באותו יום — אותו מפתח", () => {
    expect(dailyEmailIdempotencyKey("seatpastdue", SEAT, new Date("2026-09-07T05:00:00Z"))).toBe(
      dailyEmailIdempotencyKey("seatpastdue", SEAT, new Date("2026-09-07T23:00:00Z")),
    );
  });

  /*
   * ‎**והחצי שבלעדיו זו הייתה חסימה ולא הגנה:** מקום שנכנס לחוב,
   * ‏הוסדר, ושב לחוב הוא אירוע חדש והודעה חדשה.
   */
  it("‏אותו אירוע ביום אחר — מפתח אחר", () => {
    expect(dailyEmailIdempotencyKey("seatpastdue", SEAT, new Date("2026-09-07T23:00:00Z"))).not.toBe(
      dailyEmailIdempotencyKey("seatpastdue", SEAT, new Date("2026-09-08T01:00:00Z")),
    );
  });

  it("‏שתי ישויות באותו יום — מפתחות שונים", () => {
    const other = "01SEATBBBBBBBBBBBBBBBBBBBB";
    const now = new Date("2026-09-07T05:00:00Z");
    expect(dailyEmailIdempotencyKey("seatpastdue", SEAT, now)).not.toBe(
      dailyEmailIdempotencyKey("seatpastdue", other, now),
    );
  });

  /* ‏וכל מה שנוצר כך חייב להיות מפתח תקין אצל הספק */
  it("‏המפתח שנוצר עובר את הכללים", () => {
    const key = dailyEmailIdempotencyKey("seatpastdue", SEAT, new Date("2026-09-07T05:00:00Z"));
    expect(isValidEmailIdempotencyKey(key)).toBe(true);
  });
});
