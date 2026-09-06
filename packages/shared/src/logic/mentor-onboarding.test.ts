import { describe, expect, it } from "vitest";
import { buildMentorPrompt } from "./mentor-chat.js";
import {
  ONBOARDING_DAYS,
  mentorOnboarding,
  onboardingDay,
  onboardingMorningLine,
} from "./mentor-onboarding.js";
import { mentorDailyPlan, type MentorGoalProgress } from "./mentor.js";

const PLURAL = /אתם|שלכם|לכם|כתבו|לחצו|קבעו|תם[.,!?:]|תם$/u;
const GENDERED = /\bאתה\b|\bאת\b(?! ה)/u;

// הצטרפות: יום שלישי 1.9.2026 בערב שעון ישראל
const JOINED = new Date("2026-09-01T18:00:00.000Z");
const goal = (
  metric: MentorGoalProgress["metric"],
  period: MentorGoalProgress["period"] = "week",
): MentorGoalProgress => ({
  metric,
  period,
  target: 3,
  actual: 0,
  ratio: 0,
  elapsed: 0.2,
  expected: 1,
  pace: "on_track",
  remaining: 3,
  periodStart: new Date("2026-08-30T21:00:00.000Z"),
});
// יום N של התוכנית, 09:00 שעון ישראל (06:00Z) — לפי הלוח, לא לפי שעת ההצטרפות
const at = (day: number) => new Date(Date.UTC(2026, 8, day, 6));

describe("30 הימים הראשונים — היום והשבוע", () => {
  it("יום ההצטרפות הוא יום 1 בלוח הישראלי; אחרי 30 — אין תוכנית", () => {
    expect(onboardingDay(JOINED, JOINED)).toBe(1);
    // חצות ישראל עברה — יום 2, גם אם ב-UTC זה עדיין אותו תאריך
    expect(onboardingDay(JOINED, new Date("2026-09-01T21:30:00.000Z"))).toBe(2);
    expect(
      mentorOnboarding({
        userCreatedAt: JOINED,
        now: at(30),
        goals: [],
        practices: 0,
      })?.day,
    ).toBe(30);
    expect(
      mentorOnboarding({
        userCreatedAt: JOINED,
        now: at(31),
        goals: [],
        practices: 0,
      }),
    ).toBeNull();
    // ותיק — מי שהצטרף לפני שנה
    expect(
      mentorOnboarding({
        userCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
        now: JOINED,
        goals: [],
        practices: 0,
      }),
    ).toBeNull();
  });

  it("שבוע 1: יעד ראשון קטן; עם יעד — הבוקר", () => {
    const fresh = mentorOnboarding({
      userCreatedAt: JOINED,
      now: at(1),
      goals: [],
      practices: 0,
    })!;
    expect(fresh).toMatchObject({ day: 1, week: 1, weekTitle: "להכיר" });
    expect(fresh.step).toMatchObject({
      kind: "goal",
      cta: "לקבוע 3 הצעות בשבוע",
      goal: { metric: "offers_sent", target: 3, period: "week" },
    });
    const withGoal = mentorOnboarding({
      userCreatedAt: JOINED,
      now: at(4),
      goals: [goal("offers_sent")],
      practices: 0,
    })!;
    expect(withGoal.step.kind).toBe("chat");
    expect(withGoal.step.question).toBe("מה שווה לעשות היום?");
  });

  it("שבוע 2: יעד שני על שלב אחר במשפך; בלי יעד — עדיין הראשון; עם שניים — לעמוד בהם", () => {
    const one = mentorOnboarding({
      userCreatedAt: JOINED,
      now: at(9),
      goals: [goal("offers_sent")],
      practices: 0,
    })!;
    expect(one).toMatchObject({ week: 2, weekTitle: "להוסיף" });
    expect(one.step.goal).toEqual({
      metric: "viewings_held",
      target: 2,
      period: "week",
    });
    expect(
      mentorOnboarding({
        userCreatedAt: JOINED,
        now: at(9),
        goals: [],
        practices: 0,
      })!.step.goal,
    ).toEqual({ metric: "offers_sent", target: 3, period: "week" });
    expect(
      mentorOnboarding({
        userCreatedAt: JOINED,
        now: at(9),
        goals: [goal("offers_sent"), goal("viewings_held")],
        practices: 0,
      })!.step.kind,
    ).toBe("chat");
  });

  it("שבוע 3: תרגול אחד; אחרי תרגול — להשתמש בזה. שבוע 4: יעד תוצאה, ואז הסיכום החודשי", () => {
    const three = mentorOnboarding({
      userCreatedAt: JOINED,
      now: at(16),
      goals: [],
      practices: 0,
    })!;
    expect(three).toMatchObject({ week: 3, weekTitle: "להתייצב" });
    expect(three.step.kind).toBe("practice");
    expect(
      mentorOnboarding({
        userCreatedAt: JOINED,
        now: at(16),
        goals: [],
        practices: 1,
      })!.step.kind,
    ).toBe("chat");
    const four = mentorOnboarding({
      userCreatedAt: JOINED,
      now: at(25),
      goals: [goal("offers_sent")],
      practices: 1,
    })!;
    expect(four).toMatchObject({ week: 4, weekTitle: "לסכם" });
    expect(four.step.goal).toEqual({
      metric: "deals_closed",
      target: 1,
      period: "month",
    });
    expect(
      mentorOnboarding({
        userCreatedAt: JOINED,
        now: at(29),
        goals: [goal("deals_closed", "month")],
        practices: 1,
      })!.step.kind,
    ).toBe("keep");
    for (const day of [1, 4, 9, 16, 25, 29]) {
      const o = mentorOnboarding({
        userCreatedAt: JOINED,
        now: at(day),
        goals: [],
        practices: 0,
      })!;
      for (const text of [o.weekFocus, o.step.title, o.step.body, o.step.cta]) {
        expect(text, `${day}: ${text}`).not.toMatch(PLURAL);
        expect(text, `${day}: ${text}`).not.toMatch(GENDERED);
      }
    }
  });
});

describe("30 הימים הראשונים — בבוקר ובשיחה", () => {
  it("השורה לבוקר ביום הראשון ובתחילת כל שבוע; בוקר ריק אומר את הצעד", () => {
    const day1 = mentorOnboarding({
      userCreatedAt: JOINED,
      now: at(1),
      goals: [],
      practices: 0,
    })!;
    expect(onboardingMorningLine(day1)).toBe(
      "היום הראשון שלנו ביחד. השבוע — להכיר: יעד אחד קטן, ובוקר טוב כל יום. לא יותר מזה.",
    );
    const day8 = mentorOnboarding({
      userCreatedAt: JOINED,
      now: at(8),
      goals: [],
      practices: 0,
    })!;
    expect(onboardingMorningLine(day8)).toMatch(/^יום 8 מתוך 30 — להוסיף: /u);
    expect(
      onboardingMorningLine(
        mentorOnboarding({
          userCreatedAt: JOINED,
          now: at(5),
          goals: [],
          practices: 0,
        }),
      ),
    ).toBeNull();
    expect(onboardingMorningLine(null)).toBeNull();
    // יום חול בלי יעד, בלי אתמול — בלי התוכנית: שקט; עם התוכנית: הצעד
    const wednesday = new Date("2026-09-09T06:00:00.000Z");
    expect(mentorDailyPlan({ goals: [], now: wednesday })).toBeNull();
    const plan = mentorDailyPlan({
      goals: [],
      now: wednesday,
      firstName: "דנה",
      onboarding: { morningLine: null, stepBody: day1.step.body },
    });
    expect(plan?.body).toContain("3 הצעות השבוע.");
    // בתחילת שבוע — המיקוד ראשון, לפני הכול
    const sunday = new Date("2026-09-06T06:00:00.000Z");
    const first = mentorDailyPlan({
      goals: [],
      now: sunday,
      onboarding: {
        morningLine: onboardingMorningLine(day8),
        stepBody: day8.step.body,
      },
    });
    expect(first?.body).toMatch(/^בוקר טוב\. יום 8 מתוך 30 — להוסיף: /u);
    // ההזמנה הרגילה של יום ראשון אינה נאמרת פעמיים
    expect(first?.body).not.toContain("השבוע עוד בלי יעד");
  });

  it("הפרומפט של השיחה יודע שהמתווך חדש ואיפה הוא בתוכנית", () => {
    const base = {
      firstName: "דנה",
      nowText: "יום שני",
      goals: [],
      lastReview: null,
      history: [],
      question: "מה לעשות היום?",
    };
    expect(buildMentorPrompt(base)).not.toContain("המתווך חדש במערכת");
    const text = buildMentorPrompt({
      ...base,
      onboarding: mentorOnboarding({
        userCreatedAt: JOINED,
        now: at(3),
        goals: [],
        practices: 0,
      }),
    });
    expect(text).toContain(`המתווך חדש במערכת — יום 3 מתוך ${ONBOARDING_DAYS}`);
    expect(text).toContain("הצעד הנוכחי: היעד הראשון");
  });
});
