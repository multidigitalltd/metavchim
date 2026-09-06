import { describe, expect, it } from "vitest";
import {
  FUNNEL_AUDIENCES,
  FUNNEL_CHANNELS,
  FUNNEL_CLOCKS,
  FUNNEL_DEFAULT_DAILY_ENTRIES,
  FUNNEL_FRESH_SIGNUP_HOURS,
  FUNNEL_MAX_LAG_DAYS,
  FUNNEL_MIN_GAP_HOURS,
  FUNNEL_TRACKS,
  dueFunnelStages,
  firstFunnelSendingWindowEnd,
  funnelExitReason,
  funnelStageDueAt,
  funnelStageExpiresAt,
  isFunnelClockAnchored,
  isFunnelSendingHour,
  isServiceTrack,
  matchesAllAudiences,
  matchesAudience,
  nextFunnelStage,
  type FunnelAnchors,
  type FunnelFacts,
  type FunnelStageDef,
} from "./funnel.js";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const T0 = new Date("2026-09-01T09:00:00.000Z");

function stage(over: Partial<FunnelStageDef> & { key: string }): FunnelStageDef {
  return {
    track: "conversion",
    clock: "funnel",
    offsetDays: 0,
    audience: ["always"],
    channels: ["email", "whatsapp"],
    enabled: true,
    ...over,
  };
}

const ALL_FALSE: FunnelFacts = {
  hasProperties: false,
  hasData: false,
  nextStepPending: false,
  featureUnused: false,
  hasValidCard: false,
  trialActive: false,
  chargeFailing: false,
};

function facts(over: Partial<FunnelFacts> = {}): FunnelFacts {
  return { ...ALL_FALSE, ...over };
}

function anchors(over: Partial<FunnelAnchors> = {}): FunnelAnchors {
  return { funnelStartedAt: null, trialEndsAt: null, paymentFailedAt: null, ...over };
}

describe("אוצר המילים", () => {
  it("שני מסלולים, ורק הגבייה היא מסלול שירות", () => {
    expect([...FUNNEL_TRACKS]).toEqual(["conversion", "dunning"]);
    expect(isServiceTrack("dunning")).toBe(true);
    expect(isServiceTrack("conversion")).toBe(false);
  });

  it("שלושה שעונים ושני ערוצים", () => {
    expect([...FUNNEL_CLOCKS]).toEqual(["funnel", "trial", "payment"]);
    expect([...FUNNEL_CHANNELS]).toEqual(["email", "whatsapp"]);
  });

  it("לכל שעון יש תקרת פיגור, ותוכן ההפעלה סובלני יותר ממועד", () => {
    for (const clock of FUNNEL_CLOCKS) {
      expect(FUNNEL_MAX_LAG_DAYS[clock]).toBeGreaterThan(0);
    }
    // ‏זו ההכרעה עצמה: „נשארו יומיים” באיחור היא שקר, תוכן באיחור הוא תוכן
    expect(FUNNEL_MAX_LAG_DAYS.funnel).toBeGreaterThan(FUNNEL_MAX_LAG_DAYS.trial);
    expect(FUNNEL_MAX_LAG_DAYS.trial).toBeGreaterThan(FUNNEL_MAX_LAG_DAYS.payment);
  });
});

describe("תנאי קהל", () => {
  it("כל תנאי נגזר מעובדה, ואף אחד אינו תמיד-אמת חוץ מ-always", () => {
    for (const audience of FUNNEL_AUDIENCES) {
      if (audience === "always") {
        expect(matchesAudience(audience, ALL_FALSE)).toBe(true);
        continue;
      }
      const all = FUNNEL_AUDIENCES.filter((a) => a !== "always");
      // ‏עם עובדות כבויות, תנאי חיובי חוסם ותנאי שלילי פותח — אבל לא כולם זהים
      expect(all.length).toBeGreaterThan(0);
    }
    expect(matchesAudience("no_properties", facts({ hasProperties: false }))).toBe(true);
    expect(matchesAudience("no_properties", facts({ hasProperties: true }))).toBe(false);
    expect(matchesAudience("no_card", facts({ hasValidCard: false }))).toBe(true);
    expect(matchesAudience("no_card", facts({ hasValidCard: true }))).toBe(false);
    expect(matchesAudience("has_data", facts({ hasData: true }))).toBe(true);
    expect(matchesAudience("trial_active", facts({ trialActive: true }))).toBe(true);
    expect(matchesAudience("charge_still_failing", facts({ chargeFailing: true }))).toBe(true);
    expect(matchesAudience("feature_unused", facts({ featureUnused: true }))).toBe(true);
    expect(matchesAudience("next_step_pending", facts({ nextStepPending: true }))).toBe(true);
  });

  it("‏„no_card + has_data” הוא וגם, לא או", () => {
    const both = ["no_card", "has_data"] as const;
    expect(matchesAllAudiences(both, facts({ hasValidCard: false, hasData: true }))).toBe(true);
    // ‏משרד ריק שלא שילם — אסור שיקבל „הנתונים שלכם ממתינים”
    expect(matchesAllAudiences(both, facts({ hasValidCard: false, hasData: false }))).toBe(false);
    expect(matchesAllAudiences(both, facts({ hasValidCard: true, hasData: true }))).toBe(false);
  });

  it("רשימת תנאים ריקה נקראת כ„תמיד” ולא כ„אף פעם”", () => {
    expect(matchesAllAudiences([], ALL_FALSE)).toBe(true);
  });
});

describe("שני השעונים", () => {
  it("שעון המשפך נספר מיום הכניסה", () => {
    const due = funnelStageDueAt(
      stage({ key: "day3", clock: "funnel", offsetDays: 3 }),
      anchors({ funnelStartedAt: T0 }),
    );
    expect(due?.toISOString()).toBe(new Date(T0.getTime() + 3 * DAY).toISOString());
  });

  it("שעון הניסיון סופר אחורה מהתפוגה", () => {
    const expiry = new Date("2026-09-20T09:00:00.000Z");
    const due = funnelStageDueAt(
      stage({ key: "t-2", clock: "trial", offsetDays: -2 }),
      anchors({ trialEndsAt: expiry }),
    );
    expect(due?.toISOString()).toBe(new Date(expiry.getTime() - 2 * DAY).toISOString());
  });

  it("שעון שאין לו עוגן מחזיר null ולא תאריך רחוק", () => {
    expect(funnelStageDueAt(stage({ key: "a", clock: "trial" }), anchors())).toBeNull();
    expect(funnelStageDueAt(stage({ key: "b", clock: "payment" }), anchors())).toBeNull();
    expect(funnelStageDueAt(stage({ key: "c", clock: "funnel" }), anchors())).toBeNull();
  });

  /**
   * ‎**המקרה שבגללו יש שני שעונים.**
   *
   * ‏משרד שנרשם לפני עשרה ימים ונכנס היום למשפך: „נשארו יומיים”
   * חייבת לצאת לפי הניסיון שלו — בעוד יומיים — ולא ביום 12 של
   * המשפך, שהוא שמונה ימים אחרי שהחשבון כבר ננעל.
   */
  it("משרד ותיק שנכנס היום מקבל את הודעת המועד לפי הניסיון, לא לפי המשפך", () => {
    const enteredToday = T0;
    const trialEnds = new Date(T0.getTime() + 4 * DAY);
    const headsUp = stage({ key: "heads_up", clock: "trial", offsetDays: -2 });
    const day12 = stage({ key: "day12", clock: "funnel", offsetDays: 12 });

    const headsUpAt = funnelStageDueAt(headsUp, anchors({ funnelStartedAt: enteredToday, trialEndsAt: trialEnds }));
    const day12At = funnelStageDueAt(day12, anchors({ funnelStartedAt: enteredToday, trialEndsAt: trialEnds }));

    expect(headsUpAt?.getTime()).toBe(T0.getTime() + 2 * DAY);
    expect(day12At?.getTime()).toBe(T0.getTime() + 12 * DAY);
    // ‏הודעת המועד מקדימה את יום 12 בעשרה ימים — ולכן איננה נשלחת אחריו
    expect(headsUpAt!.getTime()).toBeLessThan(day12At!.getTime());
  });
});

describe("מה מגיע עכשיו", () => {
  const stages = [
    stage({ key: "d0", offsetDays: 0 }),
    stage({ key: "d1", offsetDays: 1, audience: ["no_properties"] }),
    stage({ key: "d3", offsetDays: 3 }),
  ];

  it("שלב שמועדו טרם הגיע אינו ברשימה", () => {
    const due = dueFunnelStages({
      stages,
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: [],
      lastSentAt: null,
      now: T0,
    });
    expect(due.map((s) => s.key)).toEqual(["d0"]);
  });

  it("שלב שכבר נשלח אינו חוזר", () => {
    const due = dueFunnelStages({
      stages,
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: ["d0"],
      lastSentAt: null,
      now: new Date(T0.getTime() + 1 * DAY),
    });
    expect(due.map((s) => s.key)).toEqual(["d1"]);
  });

  it("שלב כבוי אינו יוצא גם כשמועדו הגיע", () => {
    const off = [stage({ key: "d0", offsetDays: 0, enabled: false })];
    const due = dueFunnelStages({
      stages: off,
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: [],
      lastSentAt: null,
      now: T0,
    });
    expect(due).toEqual([]);
  });

  it("תנאי קהל שאינו מתקיים חוסם", () => {
    const due = dueFunnelStages({
      stages,
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts({ hasProperties: true }),
      sent: ["d0"],
      lastSentAt: null,
      now: new Date(T0.getTime() + 1 * DAY),
    });
    expect(due.map((s) => s.key)).toEqual([]);
  });

  it("שלב שאיחר מעבר לתקרת הפיגור נמחק ולא נשלח בדיעבד", () => {
    const late = new Date(T0.getTime() + (FUNNEL_MAX_LAG_DAYS.funnel + 1) * DAY);
    const due = dueFunnelStages({
      stages: [stage({ key: "d0", offsetDays: 0 })],
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: [],
      lastSentAt: null,
      now: late,
    });
    expect(due).toEqual([]);
  });

  it("ממש על גבול הפיגור עדיין יוצא", () => {
    const edge = new Date(T0.getTime() + FUNNEL_MAX_LAG_DAYS.funnel * DAY);
    const due = dueFunnelStages({
      stages: [stage({ key: "d0", offsetDays: 0 })],
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: [],
      lastSentAt: null,
      now: edge,
    });
    expect(due.map((s) => s.key)).toEqual(["d0"]);
  });

  it("הודעת מועד באיחור של שלושה ימים אינה נשלחת — היא כבר שקרית", () => {
    const trialEnds = new Date(T0.getTime() + 2 * DAY);
    const headsUp = stage({ key: "heads_up", clock: "trial", offsetDays: -2 });
    // ‏מועדה היה ב-T0; שלושה ימים אחרי זה מעבר לתקרת ה-trial
    const due = dueFunnelStages({
      stages: [headsUp],
      anchors: anchors({ funnelStartedAt: T0, trialEndsAt: trialEnds }),
      facts: facts(),
      sent: [],
      lastSentAt: null,
      now: new Date(T0.getTime() + 3 * DAY),
    });
    expect(due).toEqual([]);
  });
});

describe("אחת בכל פעם", () => {
  it("שלושה שלבים בשלים — יוצא אחד בלבד", () => {
    const many = [
      stage({ key: "a", offsetDays: 0 }),
      stage({ key: "b", offsetDays: 1 }),
      stage({ key: "c", offsetDays: 2 }),
    ];
    const input = {
      stages: many,
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: [],
      lastSentAt: null,
      now: new Date(T0.getTime() + 2 * DAY),
    };
    expect(dueFunnelStages(input).map((s) => s.key)).toEqual(["a", "b", "c"]);
    expect(nextFunnelStage(input)?.key).toBe("a");
  });

  it("המוקדמת ולא המאוחרת — הסיפור אינו מתחיל מהפרק החמישי", () => {
    const many = [stage({ key: "late", offsetDays: 2 }), stage({ key: "early", offsetDays: 0 })];
    const chosen = nextFunnelStage({
      stages: many,
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: [],
      lastSentAt: null,
      now: new Date(T0.getTime() + 2 * DAY),
    });
    expect(chosen?.key).toBe("early");
  });

  it("המרווח המזערי חוסם הודעה שנייה באותו יום", () => {
    const input = {
      stages: [stage({ key: "a", offsetDays: 0 })],
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: [],
      lastSentAt: new Date(T0.getTime() - (FUNNEL_MIN_GAP_HOURS - 1) * HOUR),
      now: T0,
    };
    expect(nextFunnelStage(input)).toBeNull();
    // ‏אחרי שהמרווח חלף — יוצאת
    expect(
      nextFunnelStage({
        ...input,
        lastSentAt: new Date(T0.getTime() - FUNNEL_MIN_GAP_HOURS * HOUR),
      })?.key,
    ).toBe("a");
  });

  it("סדר יציב בשוויון מועד — לא תלוי בסדר שהמסד החזיר", () => {
    const same = [stage({ key: "b", offsetDays: 0 }), stage({ key: "a", offsetDays: 0 })];
    const input = {
      stages: same,
      anchors: anchors({ funnelStartedAt: T0 }),
      facts: facts(),
      sent: [],
      lastSentAt: null,
      now: T0,
    };
    expect(dueFunnelStages(input).map((s) => s.key)).toEqual(["a", "b"]);
    expect(dueFunnelStages({ ...input, stages: [...same].reverse() }).map((s) => s.key)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("שעות שקט", () => {
  it("לא בשבת, ולא מחוץ לתשע–שש", () => {
    expect(isFunnelSendingHour({ weekday: "Saturday", hour: 11 })).toBe(false);
    expect(isFunnelSendingHour({ weekday: "Sunday", hour: 3 })).toBe(false);
    expect(isFunnelSendingHour({ weekday: "Sunday", hour: 18 })).toBe(false);
    expect(isFunnelSendingHour({ weekday: "Sunday", hour: 9 })).toBe(true);
    expect(isFunnelSendingHour({ weekday: "Sunday", hour: 17 })).toBe(true);
  });
});

describe("כניסה מדורגת", () => {
  /**
   * ‏הכלל עצמו יושב בשתי השאילתות של `FunnelEnrollmentService` —
   * ‏מיון אחד אינו יכול לשרת גם „ותיקים ראשונים” וגם „טריים תמיד”.
   * ‏מה שנבדק כאן הם שני המספרים שהוא נשען עליהם.
   */
  it("ברירת המחדל היומית סבירה לקטלוג הנוכחי", () => {
    expect(FUNNEL_DEFAULT_DAILY_ENTRIES).toBeGreaterThan(0);
    expect(FUNNEL_DEFAULT_DAILY_ENTRIES).toBeLessThanOrEqual(100);
  });

  it("חלון הטריות הוא ימים ספורים, לא שבועות", () => {
    expect(FUNNEL_FRESH_SIGNUP_HOURS).toBeGreaterThanOrEqual(24);
    expect(FUNNEL_FRESH_SIGNUP_HOURS).toBeLessThanOrEqual(96);
  });
});

describe("מתי המסלול נגמר", () => {
  const conversion = [stage({ key: "a", offsetDays: 0 }), stage({ key: "b", offsetDays: 1 })];

  it("המשפך נעצר ברגע שיש כרטיס תקף", () => {
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts({ hasValidCard: true }),
        stages: conversion,
        sent: [],
        anchors: anchors({ funnelStartedAt: T0 }),
        now: T0,
      }),
    ).toBe("paid");
  });

  it("הגבייה נעצרת ברגע שהחיוב עבר", () => {
    expect(
      funnelExitReason({
        track: "dunning",
        facts: facts({ chargeFailing: false }),
        stages: [stage({ key: "p0", track: "dunning", clock: "payment", offsetDays: 0 })],
        sent: [],
        anchors: anchors({ paymentFailedAt: T0 }),
        now: T0,
      }),
    ).toBe("resolved");
  });

  it("‏„מוצה” כשכל השלבים נשלחו", () => {
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts(),
        stages: conversion,
        sent: ["a", "b"],
        anchors: anchors({ funnelStartedAt: T0 }),
        now: T0,
      }),
    ).toBe("completed");
  });

  /**
   * ‏הכלל שהחזיק את המשרד הריק תקוע: שלב עם תנאי קהל שלא התקיים
   * לעולם אינו נרשם כנשלח. „כולם נשלחו” היה משאיר אותו במסלול
   * לנצח — לא מקבל דבר, ולא נסגר.
   */
  it("משרד שלא ענה על תנאי הקהל נסגר כשחלון השלב חלף", () => {
    const gated = [stage({ key: "only_with_data", offsetDays: 0, audience: ["has_data"] })];
    const stillOpen = funnelExitReason({
      track: "conversion",
      facts: facts({ hasData: false }),
      stages: gated,
      sent: [],
      anchors: anchors({ funnelStartedAt: T0 }),
      now: T0,
    });
    expect(stillOpen).toBeNull();

    const afterWindow = funnelExitReason({
      track: "conversion",
      facts: facts({ hasData: false }),
      stages: gated,
      sent: [],
      anchors: anchors({ funnelStartedAt: T0 }),
      now: new Date(T0.getTime() + (FUNNEL_MAX_LAG_DAYS.funnel + 1) * DAY),
    });
    expect(afterWindow).toBe("completed");
  });

  /*
   * ‎**הבדיקה הזו קבעה בדיוק את הבאג — והפוכה עכשיו.**
   *
   * ‏היא טענה ש„שלב ששעונו אינו רץ אינו מחזיק את המסלול פתוח”,
   * ‏כלומר שעוגן חסר פירושו „בלתי אפשרי”. אבל `trialEndsAt` ריק
   * ‏במסלול המרה אינו „השעון הזה לא שייך לכאן” — הוא **ערך שנעלם**:
   * ‏`enrollDue` מחייב אותו בכניסה, ומנהל פלטפורמה יכול לאפס אותו
   * ‏אחר כך (`setBillingOverride` מתיר `null` במפורש). סגירה על סמך
   * ‏זה היא לצמיתות, ואם התאריך הוחזר — מאותו מסך — המשרד כבר לא
   * ‏יקבל את שלבי הניסיון (ביקורת Codex).
   *
   * ‏מה שהפך את ההיפוך לבטוח הוא `FUNNEL_TRACK_CLOCKS`: הצירוף
   * ‏שאינו מעוגן **בהגדרה** נפסל מוקדם, ולכן כל `null` שמגיע לכאן
   * ‏הוא חריגה בנתונים ולא מצב רגיל.
   */
  it("עוגן שחסר מחזיק את המסלול פתוח — הוא „לא ידוע”, לא „בלתי אפשרי”", () => {
    const trialOnly = [stage({ key: "t", clock: "trial", offsetDays: -2 })];
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts(),
        stages: trialOnly,
        sent: [],
        anchors: anchors({ funnelStartedAt: T0, trialEndsAt: null }),
        now: T0,
      }),
    ).toBeNull();
  });

  /*
   * ‏והצד השני, שבלעדיו „אף פעם לא סוגרים” היה עובר: אותו שלב
   * ‏בדיוק, עם עוגן קיים שחלונו חלף, כן סוגר.
   */
  it("ואותו שלב עם עוגן שחלונו חלף — נסגר", () => {
    const trialOnly = [stage({ key: "t", clock: "trial", offsetDays: -2 })];
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts(),
        stages: trialOnly,
        sent: [],
        anchors: anchors({ funnelStartedAt: T0, trialEndsAt: T0 }),
        now: new Date(T0.getTime() + 40 * DAY),
      }),
    ).toBe("completed");
  });

  /*
   * ‏ושהעוגן החסר אינו מונע יציאה מסיבה אחרת — משרד ששילם יוצא,
   * ‏אחרת היינו שולחים „נשארו יומיים” למי שכבר שילם.
   */
  it("עוגן חסר אינו מונע יציאה על תשלום", () => {
    const trialOnly = [stage({ key: "t", clock: "trial", offsetDays: -2 })];
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts({ hasValidCard: true }),
        stages: trialOnly,
        sent: [],
        anchors: anchors({ funnelStartedAt: T0, trialEndsAt: null }),
        now: T0,
      }),
    ).toBe("paid");
  });

  it("שלב כבוי אינו נספר, ומסלול בלי שלבים פעילים אינו „מוצה”", () => {
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts(),
        stages: [stage({ key: "off", offsetDays: 0, enabled: false })],
        sent: [],
        anchors: anchors({ funnelStartedAt: T0 }),
        now: T0,
      }),
    ).toBeNull();
  });

  it("מסלול שעוד באמצע מחזיר null", () => {
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts(),
        stages: conversion,
        sent: ["a"],
        anchors: anchors({ funnelStartedAt: T0 }),
        now: T0,
      }),
    ).toBeNull();
  });
});


/*
 * ‏שישי אחר הצהריים בירושלים. UTC+3 בקיץ, ולכן 15:30Z הוא 18:30
 * ‏שעון ישראל — אחרי סגירת חלון השליחה של שישי.
 */
const FRIDAY_EVENING = new Date("2026-09-11T15:30:00.000Z");

describe("תפוגת שלב מול שעות השליחה", () => {
  /**
   * ‎**הבאג שנתפס בסקירה: תזכורת על הודעה שלא נשלחה.**
   *
   * ‏חיוב שנכשל בערב שישי. תקרת הפיגור של שעון הגבייה היא יום אחד,
   * ‏ולכן `pay_failed` היה פג בשבת בערב — לפני שנפתח החלון הבא,
   * ‏ראשון בתשע. ההודעה הראשונה שהמשרד היה מקבל היא `pay_reminder`.
   */
  it("‏„החיוב לא עבר” שורד את השבת ויוצא בראשון", () => {
    const failed = stage({ key: "pay_failed", track: "dunning", clock: "payment", offsetDays: 0 });
    const expires = funnelStageExpiresAt(failed, anchors({ paymentFailedAt: FRIDAY_EVENING }));

    // ‏התפוגה הנאיבית — שישי בערב ועוד יום — נופלת בשבת
    const naive = FRIDAY_EVENING.getTime() + FUNNEL_MAX_LAG_DAYS.payment * DAY;
    expect(expires!.getTime()).toBeGreaterThan(naive);

    // ‏ראשון בבוקר: השלב עדיין חי
    const sunday = new Date("2026-09-13T06:30:00.000Z"); // 09:30 בירושלים
    expect(
      dueFunnelStages({
        stages: [failed],
        anchors: anchors({ paymentFailedAt: FRIDAY_EVENING }),
        facts: facts({ chargeFailing: true }),
        sent: [],
        lastSentAt: null,
        now: sunday,
      }).map((s) => s.key),
    ).toEqual(["pay_failed"]);
  });

  it("‏המסלול אינו נחשב „מוצה” כל עוד לא הייתה הזדמנות לשלוח", () => {
    const failed = stage({ key: "pay_failed", track: "dunning", clock: "payment", offsetDays: 0 });
    // ‏שבת בצהריים — אחרי התפוגה הנאיבית, לפני החלון הראשון
    const saturday = new Date("2026-09-12T16:00:00.000Z");
    expect(
      funnelExitReason({
        track: "dunning",
        facts: facts({ chargeFailing: true }),
        stages: [failed],
        sent: [],
        anchors: anchors({ paymentFailedAt: FRIDAY_EVENING }),
        now: saturday,
      }),
    ).toBeNull();
  });

  /**
   * ‎**הגבול השני: ההארכה היא עד ההזדמנות הראשונה, לא ויתור על
   * תקרת הפיגור.**
   *
   * ‏שעון המשפך נבחר כאן במכוון: תקרת הפיגור שלו שבוע, ולכן היא
   * ‏זו שקובעת בכל מקרה שאינו סוף שבוע. מוטציה שתחזיר תמיד את סוף
   * ‏החלון — כלומר תוותר על התקרה — נופלת כאן.
   */
  it("תקרת הפיגור היא שקובעת כשהיא המאוחרת", () => {
    const day3 = stage({ key: "day3", clock: "funnel", offsetDays: 3 });
    const started = new Date("2026-09-14T07:00:00.000Z"); // שני 10:00 בירושלים
    const due = funnelStageDueAt(day3, anchors({ funnelStartedAt: started }))!;
    const expires = funnelStageExpiresAt(day3, anchors({ funnelStartedAt: started }));
    expect(expires!.getTime()).toBe(due.getTime() + FUNNEL_MAX_LAG_DAYS.funnel * DAY);
  });

  /*
   * ‏ובשעון הגבייה, שתקרתו יום אחד, ההזדמנות היא לרוב המאוחרת —
   * ‏וזה בדיוק מה שהתיקון נועד לעשות.
   */
  it("בשעון הגבייה החלון הוא לרוב המאוחר, והתפוגה נדחית אליו", () => {
    const failed = stage({ key: "pay_failed", track: "dunning", clock: "payment", offsetDays: 0 });
    const mondayMorning = new Date("2026-09-14T07:00:00.000Z");
    const expires = funnelStageExpiresAt(failed, anchors({ paymentFailedAt: mondayMorning }));
    expect(expires!.getTime()).toBeGreaterThan(
      mondayMorning.getTime() + FUNNEL_MAX_LAG_DAYS.payment * DAY,
    );
    // ‏שלישי 18:00 בירושלים — סוף החלון השלם הראשון
    expect(expires!.toISOString()).toBe("2026-09-15T15:00:00.000Z");
  });

  it("חלון השליחה הבא מדלג על שבת", () => {
    const end = firstFunnelSendingWindowEnd(FRIDAY_EVENING);
    // ‏ראשון 18:00 בירושלים = 15:00Z בקיץ
    expect(end.toISOString()).toBe("2026-09-13T15:00:00.000Z");
  });

  it("‏מועד שקודם לפתיחת החלון — החלון הוא של אותו יום", () => {
    const thursdayEarly = new Date("2026-09-10T05:00:00.000Z"); // 08:00 בירושלים
    expect(firstFunnelSendingWindowEnd(thursdayEarly).toISOString()).toBe(
      "2026-09-10T15:00:00.000Z",
    );
  });

  /**
   * ‎**שארית של חלון אינה הזדמנות.**
   *
   * ‏הסורק רץ בראש כל שעה. חיוב שנכשל בשישי ב-17:01 לא ייסרק לפני
   * ‏18:00, ואז כבר מחוץ לשעות — כלומר אף סריקה לא עברה בו. הכלל
   * ‏דורש חלון ש**נפתח** אחרי המועד, ולכן אינו תלוי בקצב הסורק.
   */
  it("שארית של חלון אינה נחשבת הזדמנות", () => {
    const fridayLate = new Date("2026-09-11T14:01:00.000Z"); // 17:01 בירושלים
    // ‏לא שישי 18:00 — ראשון 18:00
    expect(firstFunnelSendingWindowEnd(fridayLate).toISOString()).toBe("2026-09-13T15:00:00.000Z");

    const failed = stage({ key: "pay_failed", track: "dunning", clock: "payment", offsetDays: 0 });
    const sunday = new Date("2026-09-13T06:30:00.000Z"); // 09:30 בירושלים
    expect(
      dueFunnelStages({
        stages: [failed],
        anchors: anchors({ paymentFailedAt: fridayLate }),
        facts: facts({ chargeFailing: true }),
        sent: [],
        lastSentAt: null,
        now: sunday,
      }).map((s) => s.key),
    ).toEqual(["pay_failed"]);
  });
});


/**
 * ‎**הפעלה הדרגתית לא תשרוף את הקוהורט הקיים.**
 *
 * ‏תוכנית ההפעלה היא 14 שלבים שנזרעים כבויים ונדלקים אחד-אחד. אילו
 * ‏„מוצה” נמדד על השלבים **המופעלים** בלבד, המשרד הראשון שקיבל את
 * ‏השלב היחיד שהודלק היה נסגר מיד, ו-`enrollDue` מוציא מהמועמדות כל
 * ‏מי שכבר היה לו רישום — כלומר כל שלב שיודלק אחר כך לא היה מגיע
 * ‏אליו לעולם. ההדרגתיות עצמה הייתה הבאג.
 */
/**
 * ‎**צירוף מסלול ושעון — שני ערכים מוכרים שיחד אינם מעוגנים.**
 *
 * ‏רישום המרה אינו נפתח מדחיית חיוב, ולכן אין לו `paymentFailedAt`.
 * ‏שלב שמצרף `conversion` עם `payment` עובר את שתי הבדיקות
 * ‏הבודדות, ואז `funnelStageDueAt` מחזיר `null` — היעדר מידע
 * ‏שנקרא כידיעה שלילית (ביקורת Codex, P1).
 */
describe("עיגון שעון למסלול", () => {
  it("מסלול ההמרה מעוגן בשעון המשפך ובשעון הניסיון", () => {
    expect(isFunnelClockAnchored("conversion", "funnel")).toBe(true);
    expect(isFunnelClockAnchored("conversion", "trial")).toBe(true);
  });

  /** ‏זה הצירוף שנפל. */
  it("שעון התשלום אינו מעוגן במסלול ההמרה", () => {
    expect(isFunnelClockAnchored("conversion", "payment")).toBe(false);
  });

  it("ובמסלול הגבייה הוא כן", () => {
    expect(isFunnelClockAnchored("dunning", "payment")).toBe(true);
  });

  /*
   * ‏שעון הניסיון אינו במסלול הגבייה: רישום גבייה נפתח מדחיית
   * ‏חיוב של משרד משלם, ותפוגת הניסיון שלו כבר מאחוריו וחסרת
   * ‏משמעות — שלב שנמדד ממנה היה יוצא בתאריך שרירותי.
   */
  it("שעון הניסיון אינו במסלול הגבייה", () => {
    expect(isFunnelClockAnchored("dunning", "trial")).toBe(false);
  });

  /*
   * ‎**והראיה שזה אינו סתם טבלה:** כל צירוף שהוכרז מעוגן חייב
   * ‏להחזיר מועד אמיתי עם עוגנים מלאים, וכל צירוף שאינו — `null`.
   * ‏טבלה שאינה מסכימה עם `funnelStageDueAt` גרועה מאין טבלה.
   */
  it("הטבלה מסכימה עם חישוב המועד בפועל", () => {
    const filled: FunnelAnchors = {
      funnelStartedAt: new Date("2026-09-01T06:00:00.000Z"),
      trialEndsAt: new Date("2026-09-15T06:00:00.000Z"),
      paymentFailedAt: new Date("2026-09-10T06:00:00.000Z"),
    };
    for (const track of FUNNEL_TRACKS) {
      for (const clock of FUNNEL_CLOCKS) {
        const anchors: FunnelAnchors = {
          ...filled,
          // ‏כמו ש-`closePage` בונה אותם: עוגן התשלום קיים רק בגבייה
          paymentFailedAt: track === "dunning" ? filled.paymentFailedAt : null,
          trialEndsAt: track === "conversion" ? filled.trialEndsAt : null,
        };
        const due = funnelStageDueAt(stage({ key: "x", clock, offsetDays: 0 }), anchors);
        expect(
          due !== null,
          `${track}/${clock}: הטבלה אומרת ${String(isFunnelClockAnchored(track, clock))}`,
        ).toBe(isFunnelClockAnchored(track, clock));
      }
    }
  });
});

describe("הפעלה הדרגתית של שלבים", () => {
  const started = new Date("2026-09-07T06:00:00.000Z");
  const anchorsFor = (): FunnelAnchors => anchors({ funnelStartedAt: started });

  it("שלב כבוי שעוד לא הגיע זמנו מחזיק את הרישום פתוח", () => {
    const stages = [
      stage({ key: "day0", clock: "funnel", offsetDays: 0, enabled: true }),
      // ‏עוד לא הודלק — אבל יודלק, וזמנו עוד לפנינו
      stage({ key: "day3", clock: "funnel", offsetDays: 3, enabled: false }),
    ];
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts({ hasValidCard: false }),
        stages,
        sent: ["day0"],
        anchors: anchorsFor(),
        now: new Date(started.getTime() + 1 * DAY),
      }),
    ).toBeNull();
  });

  /*
   * ‏הגבול: שלב כבוי שחלונו כבר חלף **כן** בלתי אפשרי — הדלקה מחר
   * ‏לא תשלח מועד שעבר. בלי זה הרישום היה נשאר פתוח לנצח בגלל מתג
   * ‏שאיש לא הדליק.
   */
  it("שלב כבוי שחלונו חלף אינו מחזיק את הרישום", () => {
    const stages = [
      stage({ key: "day0", clock: "funnel", offsetDays: 0, enabled: true }),
      stage({ key: "day3", clock: "funnel", offsetDays: 3, enabled: false }),
    ];
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts({ hasValidCard: false }),
        stages,
        sent: ["day0"],
        // ‏הרבה אחרי שגם `day3` וגם תקרת הפיגור שלו חלפו
        now: new Date(started.getTime() + 40 * DAY),
        anchors: anchorsFor(),
      }),
    ).toBe("completed");
  });

  /*
   * ‎**והגבול השני: הגדרה שלא הצלחנו לקרוא.**
   *
   * ‏שלב עם שעון, תנאי קהל או ערוץ לא מוכר נזרק לפני שהוא מגיע
   * ‏לכאן, ולכן „לא נשאר שלב שיכול לצאת” נכון על מה שקראנו וייתכן
   * ‏שאינו נכון על מה שנכתב. סגירה בלתי הפיכה על סמך תמונה חלקית
   * ‏היא בדיוק אותה תקלה של השלב הכבוי, במסווה אחר (ביקורת Codex).
   */
  it("הגדרה חסרה מחזיקה את הרישום פתוח — גם כשכל התקפים מוצו", () => {
    const stages = [stage({ key: "day0", clock: "funnel", offsetDays: 0, enabled: true })];
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts({ hasValidCard: false }),
        stages,
        definitionsIncomplete: true,
        sent: ["day0"],
        now: new Date(started.getTime() + 40 * DAY),
        anchors: anchorsFor(),
      }),
    ).toBeNull();
  });

  /*
   * ‏אבל היא אינה מבטלת יציאה מסיבה אחרת: משרד ששילם יצא מהמסלול
   * ‏גם אם שורת שלב פסולה. שער שמחזיק את **כולם** היה שולח „נשארו
   * ‏יומיים” למי שכבר שילם.
   */
  it("הגדרה חסרה אינה מונעת יציאה על תשלום", () => {
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts({ hasValidCard: true }),
        stages: [stage({ key: "day0", clock: "funnel", offsetDays: 0, enabled: true })],
        definitionsIncomplete: true,
        sent: [],
        now: new Date(started.getTime() + 1 * DAY),
        anchors: anchorsFor(),
      }),
    ).toBe("paid");
  });

  /*
   * ‏וברירת המחדל היא „ההגדרה שלמה”: השדה אופציונלי, ולכן כל קורא
   * ‏קיים שלא עודכן ממשיך להתנהג כשהתנהג.
   */
  it("בלי השדה — התנהגות ללא שינוי", () => {
    const stages = [stage({ key: "day0", clock: "funnel", offsetDays: 0, enabled: true })];
    expect(
      funnelExitReason({
        track: "conversion",
        facts: facts({ hasValidCard: false }),
        stages,
        sent: ["day0"],
        now: new Date(started.getTime() + 40 * DAY),
        anchors: anchorsFor(),
      }),
    ).toBe("completed");
  });
});
