import { describe, expect, it } from "vitest";
import {
  applyIntakeAnswers,
  describeIntakeChanges,
  INTAKE_TTL_DAYS,
  intakeExpiryFrom,
  intakeInactiveReason,
  intakeInviteMessage,
} from "./intake";

const NOW = new Date("2026-08-23T10:00:00Z");

describe("intakeInactiveReason", () => {
  it("קישור פעיל — null", () => {
    expect(
      intakeInactiveReason("sent", new Date("2026-08-30T10:00:00Z"), NOW),
    ).toBeNull();
  });

  it("„בוטל” גובר על התאריך", () => {
    /* קישור שבוטל אינו „פג” — ללקוח אין מה לבקש שיחדשו. */
    expect(
      intakeInactiveReason("revoked", new Date("2026-08-30T10:00:00Z"), NOW),
    ).toBe("revoked");
  });

  it("תפוגה מזוהה ברגע שהיא עוברת", () => {
    expect(intakeInactiveReason("sent", NOW, NOW)).toBe("expired");
  });

  it("קישור שכבר מולא נשאר פעיל — הלקוח יכול לתקן", () => {
    expect(
      intakeInactiveReason("submitted", new Date("2026-08-30T10:00:00Z"), NOW),
    ).toBeNull();
  });
});

describe("intakeExpiryFrom", () => {
  it("מוסיפה את ימי התוקף", () => {
    const expiry = intakeExpiryFrom(NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(
      INTAKE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
  });
});

describe("applyIntakeAnswers", () => {
  it("שדות שהטופס אינו שואל עליהם נשמרים", () => {
    /*
     * זו כל הבטיחות של התכונה. אזורי המפה והשכונות נאספו בעבודה של
     * המתווך, הלקוח מעולם לא ראה אותם, ומחיקתם בשקט הייתה מתגלה רק
     * כשמישהו ישאל למה הקונה הפסיק להתאים.
     */
    const before = {
      cities: ["רמת גן"],
      neighborhoods: ["מרכז"],
      searchAreas: [{ lat: 32, lon: 34.8, radiusKm: 1 }],
      dealType: "sale",
    };
    const after = applyIntakeAnswers(before, { cities: ["גבעתיים"] });

    expect(after["cities"]).toEqual(["גבעתיים"]);
    expect(after["neighborhoods"]).toEqual(["מרכז"]);
    expect(after["searchAreas"]).toEqual([{ lat: 32, lon: 34.8, radiusKm: 1 }]);
    expect(after["dealType"]).toBe("sale");
  });

  it("אינה משנה את המקור", () => {
    const before = { cities: ["רמת גן"] };
    applyIntakeAnswers(before, { cities: ["חולון"] });
    expect(before.cities).toEqual(["רמת גן"]);
  });

  it("ערים ריקות ורווחים נופלים", () => {
    const after = applyIntakeAnswers({}, { cities: ["  חולון ", "", "   "] });
    expect(after["cities"]).toEqual(["חולון"]);
  });

  it("מאפיין מותאם של המשרד שורד את המיזוג", () => {
    const before = { features: { "custom:נוף לים": "nice", hasElevator: "must" } };
    const after = applyIntakeAnswers(before, {
      features: { hasParking: "must" },
    });
    expect(after["features"]).toEqual({
      "custom:נוף לים": "nice",
      hasParking: "must",
    });
  });

  it("מאפיין קבוע שהלקוח לא סימן — נמחק", () => {
    /* הוא ראה את המעלית והחליט שאינה נדרשת. זו תשובה, לא חוסר מידע. */
    const before = { features: { hasElevator: "must" } };
    const after = applyIntakeAnswers(before, { features: {} });
    expect(after["features"]).toEqual({});
  });

  it("מאפיינים שלא נשלחו כלל — המפה נשארת שלמה", () => {
    const before = { features: { hasElevator: "must" } };
    const after = applyIntakeAnswers(before, { cities: ["חיפה"] });
    expect(after["features"]).toEqual({ hasElevator: "must" });
  });

  it("„מיידי” מוחק תאריך כניסה שנשאר מבחירה קודמת", () => {
    /*
     * אחרת תאריך שהלקוח עצמו ביטל ממשיך להשתתף בהתאמה בשמו.
     */
    const before = { entryType: "by_date", entryBy: "2026-10-01" };
    const after = applyIntakeAnswers(before, { entryType: "immediate" });
    expect(after["entryType"]).toBe("immediate");
    expect(after["entryBy"]).toBeUndefined();
  });

  it("„עד תאריך” שומר את התאריך", () => {
    const after = applyIntakeAnswers(
      {},
      { entryType: "by_date", entryBy: "2026-12-01" },
    );
    expect(after["entryBy"]).toBe("2026-12-01");
  });

  it("הערה ריקה מוחקת הערה קודמת", () => {
    const after = applyIntakeAnswers({ flexibilityNotes: "ישן" }, { notes: "  " });
    expect(after["flexibilityNotes"]).toBeUndefined();
  });

  it("מספרים נשמרים, ולא-מספר נמחק", () => {
    const after = applyIntakeAnswers(
      { budgetMaxAgorot: 100 },
      { budgetMaxAgorot: Number.NaN, roomsMin: 3 },
    );
    expect(after["budgetMaxAgorot"]).toBeUndefined();
    expect(after["roomsMin"]).toBe(3);
  });

  it("טופס ריק אינו משנה דבר", () => {
    const before = { cities: ["חיפה"], budgetMaxAgorot: 250_000_000 };
    expect(applyIntakeAnswers(before, {})).toEqual(before);
  });
});

describe("describeIntakeChanges", () => {
  it("מונה רק את מה שבאמת השתנה", () => {
    const before = { cities: ["חיפה"], budgetMaxAgorot: 100 };
    const after = { cities: ["חיפה"], budgetMaxAgorot: 200 };
    expect(describeIntakeChanges(before, after)).toEqual(["תקציב מקסימלי"]);
  });

  it("אין שינוי — רשימה ריקה", () => {
    const same = { cities: ["חיפה"] };
    expect(describeIntakeChanges(same, { ...same })).toEqual([]);
  });

  it("שדה שנמחק נספר כשינוי", () => {
    expect(describeIntakeChanges({ entryBy: "2026-01-01" }, {})).toEqual([
      "תאריך כניסה",
    ]);
  });

  it("מזהה שינוי במאפיינים", () => {
    expect(
      describeIntakeChanges(
        { features: { hasElevator: "must" } },
        { features: { hasElevator: "nice" } },
      ),
    ).toEqual(["מאפיינים"]);
  });
});

describe("intakeInviteMessage", () => {
  it("כוללת את הקישור ואת שם המשרד", () => {
    const text = intakeInviteMessage({
      officeName: "נדל״ן ירוק",
      agentName: "דנה",
      url: "https://app.metavchim.co.il/intake/abc",
    });
    expect(text).toContain("דנה מנדל״ן ירוק");
    expect(text).toContain("https://app.metavchim.co.il/intake/abc");
  });

  it("בלי שם סוכן — רק המשרד, בלי „מ” מיותם", () => {
    const text = intakeInviteMessage({
      officeName: "נדל״ן ירוק",
      url: "https://x/y",
    });
    expect(text).toContain("כאן נדל״ן ירוק");
    expect(text).not.toContain("undefined");
  });

  it("שיחה שלא נענתה — הפתיחה מסבירה למה הגיעה ההודעה", () => {
    /* בלי ההסבר, הודעה דקה אחרי שיחה שלא נענתה נקראת כספאם. */
    const text = intakeInviteMessage({
      officeName: "נדל״ן ירוק",
      url: "https://x/y",
      missedCall: true,
    });
    expect(text).toContain("ניסינו להשיג אתכם");
  });
});
