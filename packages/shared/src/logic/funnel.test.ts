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
  funnelEntryBatch,
  funnelEntryPlan,
  funnelExitReason,
  funnelStageDueAt,
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
  const mk = (id: string, days: number) => ({
    id,
    createdAt: new Date(T0.getTime() - days * DAY),
  });

  it("הוותיקים ראשונים, ולא יותר מהמכסה", () => {
    const batch = funnelEntryBatch([mk("c", 1), mk("a", 30), mk("b", 10)], 2);
    expect(batch.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("מכסה אפס או שלילית אינה מכניסה איש", () => {
    expect(funnelEntryBatch([mk("a", 1)], 0)).toEqual([]);
    expect(funnelEntryBatch([mk("a", 1)], -5)).toEqual([]);
  });

  it("אינה משנה את המערך שקיבלה", () => {
    const input = [mk("c", 1), mk("a", 30)];
    const copy = input.map((t) => t.id);
    funnelEntryBatch(input, 2);
    expect(input.map((t) => t.id)).toEqual(copy);
  });

  it("ברירת המחדל היומית סבירה לקטלוג הנוכחי", () => {
    expect(FUNNEL_DEFAULT_DAILY_ENTRIES).toBeGreaterThan(0);
    expect(FUNNEL_DEFAULT_DAILY_ENTRIES).toBeLessThanOrEqual(100);
  });

  /**
   * ‏המכסה מנקזת פיגור. משרד שנרשם הבוקר אינו פיגור — ואם הוא נספר
   * בה, „יום 0” שלו מגיע בעוד שבוע, אחרי שכבר ניסה את המערכת לבד.
   */
  it("הרשמה טרייה נכנסת מיד ואינה נספרת במכסה", () => {
    const brandNew = { id: "new", createdAt: new Date(T0.getTime() - 2 * 60 * 60 * 1000) };
    const old1 = mk("old1", 40);
    const old2 = mk("old2", 30);
    const plan = funnelEntryPlan([old1, old2, brandNew], 1, T0);
    expect(plan.map((t) => t.id)).toEqual(["new", "old1"]);
  });

  it("מכסה אפס עדיין מכניסה את החדשים", () => {
    const brandNew = { id: "new", createdAt: T0 };
    expect(funnelEntryPlan([brandNew, mk("old", 40)], 0, T0).map((t) => t.id)).toEqual(["new"]);
  });

  it("מי שנרשם לפני יותר מהחלון הטרי הוא פיגור לכל דבר", () => {
    const stale = {
      id: "stale",
      createdAt: new Date(T0.getTime() - (FUNNEL_FRESH_SIGNUP_HOURS + 1) * 60 * 60 * 1000),
    };
    expect(funnelEntryPlan([stale], 0, T0)).toEqual([]);
    expect(funnelEntryPlan([stale], 1, T0).map((t) => t.id)).toEqual(["stale"]);
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

  it("שלב ששעונו אינו רץ אינו מחזיק את המסלול פתוח", () => {
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
    ).toBe("completed");
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
