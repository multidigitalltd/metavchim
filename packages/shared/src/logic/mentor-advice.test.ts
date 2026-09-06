import { describe, expect, it } from "vitest";
import {
  mentorAdvice,
  mentorAdviceBlock,
  mentorDailyIdea,
  mentorDaySeed,
  mentorFocusMetric,
} from "./mentor-advice.js";
import {
  FUNNEL_STAGES,
  MENTOR_PLAYBOOK,
  funnelBottleneck,
  funnelReadings,
  playbookIdea,
} from "./mentor-playbook.js";
import {
  MENTOR_METRICS,
  type MentorActivity,
  type MentorGoalProgress,
} from "./mentor.js";

const quiet: MentorActivity = {
  deals_closed: 0,
  offers_sent: 0,
  viewings_held: 0,
  leads_answered: 0,
  new_buyers: 0,
  new_properties: 0,
  calls_made: 0,
  calls_answered: 0,
  leads_answered_fast: 0,
  followups_done: 0,
  owner_updates_sent: 0,
};

function goal(
  partial: Partial<MentorGoalProgress> & Pick<MentorGoalProgress, "pace">,
): MentorGoalProgress {
  return {
    metric: "offers_sent",
    period: "week",
    target: 5,
    actual: 5,
    ratio: 1,
    elapsed: 1,
    expected: 5,
    remaining: 0,
    periodStart: new Date("2026-09-05T21:00:00.000Z"),
    ...partial,
  };
}

// שני 07/09 09:00 ישראל
const monday = new Date("2026-09-07T06:00:00.000Z");
const noInsights = {
  responseMedianMinutes: null,
  previousResponseMedianMinutes: null,
  missedUnreturned: 0,
};

/* הקול של המנטור — לא ברבים, לא „אתה/את” */
const PLURAL = /אתם|שלכם|לכם|כתבו|לחצו|קבעו|תם[.,!?:]|תם$/u;
const GENDERED = /\bאתה\b|\bאת\b(?! ה)/u;

describe("ספר המשחק — רעיונות לכל מדד, בקול של המנטור", () => {
  it("לכל אחד מאחד-עשר המדדים אבחנה ולפחות ארבעה רעיונות קונקרטיים", () => {
    for (const metric of MENTOR_METRICS) {
      const entry = MENTOR_PLAYBOOK[metric.code];
      expect(entry.diagnosis.length, metric.code).toBeGreaterThan(40);
      expect(entry.ideas.length, metric.code).toBeGreaterThanOrEqual(4);
      for (const text of [entry.diagnosis, ...entry.ideas]) {
        expect(text, text).not.toMatch(PLURAL);
        expect(text, text).not.toMatch(GENDERED);
      }
    }
  });

  it("הרעיון מסתובב לפי הזרע, ועובר על כל הרעיונות לפני שחוזר", () => {
    const ideas = MENTOR_PLAYBOOK.offers_sent.ideas;
    const seen = new Set(
      Array.from({ length: ideas.length }, (_, i) =>
        playbookIdea("offers_sent", i),
      ),
    );
    expect(seen.size).toBe(ideas.length);
    expect(playbookIdea("offers_sent", ideas.length)).toBe(ideas[0]);
    // זרע שלילי אינו מפיל
    expect(ideas).toContain(playbookIdea("offers_sent", -1));
  });
});

describe("המשפך של המתווך — יחסים מול המקובל, לא מול עמיתים", () => {
  it("שלב עם פחות משלוש תוצאות אינו יחס; מעל — היחס בפועל", () => {
    const readings = funnelReadings({
      ...quiet,
      offers_sent: 18,
      viewings_held: 3,
      new_buyers: 2,
      deals_closed: 1,
    });
    const offersToViewings = readings.find(
      (r) => r.stage.from === "offers_sent",
    )!;
    expect(offersToViewings.ratio).toBe(6);
    // 3 סיורים, עסקה אחת — פחות משלוש עסקאות
    expect(
      readings.find((r) => r.stage.to === "deals_closed")!.ratio,
    ).toBeNull();
    // 2 קונים — פחות משלושה
    expect(readings.find((r) => r.stage.to === "new_buyers")!.ratio).toBeNull();
  });

  it("צוואר בקבוק: השלב שגרוע פי 1.5 ויותר מהמקובל — הגרוע ביותר, ואחד בלבד", () => {
    // הצעה ⟵ סיור: 6 (מקובל 3) — פי 2; קונה ⟵ הצעה: 18/6 = 3 (מקובל 2) — פי 1.5
    const history = {
      ...quiet,
      new_buyers: 6,
      offers_sent: 18,
      viewings_held: 3,
      deals_closed: 0,
    };
    expect(funnelBottleneck(history)?.stage.label).toBe("הצעה ⟵ סיור");
    // הכול במקובל — אין צוואר בקבוק
    expect(
      funnelBottleneck({
        ...quiet,
        new_buyers: 6,
        offers_sent: 12,
        viewings_held: 4,
      }),
    ).toBeNull();
    expect(funnelBottleneck(quiet)).toBeNull();
  });

  it("ארבעה שלבים, מהליד לעסקה", () => {
    expect(FUNNEL_STAGES.map((s) => s.from)).toEqual([
      "leads_answered",
      "new_buyers",
      "offers_sent",
      "viewings_held",
    ]);
  });
});

describe("mentorAdvice — מה הכי שווה לעשות עכשיו, בסדר של מנטור", () => {
  it("שיחה שמחכה קודמת ליעד שמאחור, ואחריהם צוואר הבקבוק; עד שלוש", () => {
    const advice = mentorAdvice({
      goals: [
        goal({ pace: "behind", actual: 1, ratio: 0.2, remaining: 4 }),
        goal({
          metric: "viewings_held",
          target: 4,
          pace: "behind",
          actual: 0,
          ratio: 0,
          remaining: 4,
        }),
      ],
      activity: { ...quiet, offers_sent: 1 },
      insights: {
        ...noInsights,
        missedUnreturned: 2,
        responseMedianMinutes: 200,
      },
      funnel: {
        history: { ...quiet, new_buyers: 6, offers_sent: 18, viewings_held: 3 },
        weeks: 13,
      },
      now: monday,
    });
    expect(advice.map((a) => a.kind)).toEqual([
      "missed_calls",
      "behind_goal",
      "behind_goal",
    ]);
    expect(advice[0]?.title).toBe("2 שיחות נכנסות מחכות לטלפון חוזר");
    // המאחור ביותר קודם — סיורים (0 מתוך 4) לפני הצעות (1 מתוך 5)
    expect(advice[1]?.metric).toBe("viewings_held");
    expect(advice[1]?.title).toBe("4 סיורים בשבוע: 0 סיורים עד עכשיו — מאחור");
    expect(advice[1]?.question).toBe("איך להגיע ל4 סיורים בשבוע?");
    expect(MENTOR_PLAYBOOK.viewings_held.ideas).toContain(advice[1]?.body);
  });

  it("בלי יעד מאחור — צוואר הבקבוק וזמן המענה; מדד אחד לכל עצה", () => {
    const advice = mentorAdvice({
      goals: [goal({ pace: "on_track", actual: 3, ratio: 0.6, remaining: 2 })],
      activity: { ...quiet, offers_sent: 3 },
      insights: { ...noInsights, responseMedianMinutes: 95 },
      funnel: {
        history: { ...quiet, new_buyers: 6, offers_sent: 18, viewings_held: 3 },
        weeks: 13,
      },
      now: monday,
    });
    expect(advice.map((a) => a.kind)).toEqual(["bottleneck", "response_time"]);
    expect(advice[0]?.title).toBe("צוואר הבקבוק שלך: הצעה ⟵ סיור");
    expect(advice[0]?.body).toContain(
      "הצעה ⟵ סיור: כל 6 (מקובל: כל 3) ב-13 השבועות האחרונים.",
    );
    expect(advice[0]?.question).toBe("איך לשפר את ההמרה הצעה ⟵ סיור?");
    expect(advice[1]?.title).toBe(
      "זמן המענה החציוני ללידים חדשים השבוע: שעה ו-35 דקות",
    );
  });

  it("הכול בקצב ובלי משפך — רעיון אחד להיום על מדד המיקוד, מתחלף כל יום", () => {
    const goals = [
      goal({ pace: "on_track", actual: 3, ratio: 0.6, remaining: 2 }),
    ];
    const today = mentorAdvice({ goals, activity: quiet, now: monday });
    expect(today).toHaveLength(1);
    expect(today[0]?.kind).toBe("idea");
    expect(today[0]?.title).toBe("רעיון להיום — הצעות שנשלחו");
    expect(today[0]?.body).toBe(mentorDailyIdea(goals, monday));
    const tomorrow = mentorAdvice({
      goals,
      activity: quiet,
      now: new Date("2026-09-08T06:00:00.000Z"),
    });
    expect(tomorrow[0]?.body).not.toBe(today[0]?.body);
    // אותו יום, שני רגעים — אותו רעיון
    expect(mentorDaySeed(monday)).toBe(
      mentorDaySeed(new Date("2026-09-07T18:00:00.000Z")),
    );
  });

  it("מדד המיקוד: יעד שבועי מאחור, אחרת השבועי שהכי פחות התקדם, אחרת הצעות", () => {
    expect(mentorFocusMetric([])).toBe("offers_sent");
    expect(
      mentorFocusMetric([
        goal({ metric: "calls_made", pace: "on_track", ratio: 0.5 }),
        goal({ metric: "viewings_held", pace: "behind", ratio: 0.1 }),
        goal({ metric: "new_buyers", pace: "behind", ratio: 0.3 }),
      ]),
    ).toBe("viewings_held");
    expect(
      mentorFocusMetric([
        goal({ metric: "calls_made", pace: "on_track", ratio: 0.5 }),
        goal({ metric: "new_buyers", pace: "ahead", ratio: 0.9 }),
        goal({
          metric: "deals_closed",
          period: "month",
          pace: "behind",
          ratio: 0,
        }),
      ]),
    ).toBe("calls_made");
    expect(
      mentorFocusMetric([
        goal({ metric: "deals_closed", period: "month", pace: "behind" }),
      ]),
    ).toBe("deals_closed");
  });

  it("כל עצה בקול של המנטור — לא ברבים, לא „אתה/את”", () => {
    const advice = mentorAdvice({
      goals: [goal({ pace: "behind", actual: 1, ratio: 0.2, remaining: 4 })],
      activity: quiet,
      insights: {
        ...noInsights,
        missedUnreturned: 1,
        responseMedianMinutes: 90,
      },
      funnel: {
        history: { ...quiet, new_buyers: 6, offers_sent: 18, viewings_held: 3 },
        weeks: 13,
      },
      now: monday,
    });
    expect(advice).toHaveLength(3);
    for (const item of advice) {
      for (const text of [item.title, item.body, item.question]) {
        expect(text, text).not.toMatch(PLURAL);
        expect(text, text).not.toMatch(GENDERED);
      }
    }
  });
});

describe("mentorAdviceBlock — מה המודל מקבל כדי לייעץ", () => {
  it("הפעילות השבוע, המגמה, המשפך מול המקובל, הניתוח ורעיונות על שני מדדי מיקוד", () => {
    const input = {
      goals: [goal({ pace: "behind", actual: 2, ratio: 0.4, remaining: 3 })],
      activity: { ...quiet, offers_sent: 2, calls_made: 4 },
      previousActivity: { ...quiet, offers_sent: 5 },
      insights: { ...noInsights, missedUnreturned: 1 },
      funnel: {
        history: { ...quiet, new_buyers: 6, offers_sent: 18, viewings_held: 3 },
        weeks: 13,
      },
      now: monday,
    };
    const text = mentorAdviceBlock(input, mentorAdvice(input)).join("\n");
    expect(text).toContain("השבוע עד עכשיו: 2 הצעות, 4 שיחות יוצאות.");
    expect(text).toContain(
      "מול שבוע שעבר: יותר שיחות יוצאות (0 ⟵ 4), פחות הצעות שנשלחו (5 ⟵ 2).",
    );
    expect(text).toContain("לא מול עמיתים");
    expect(text).toContain("הצעה ⟵ סיור: כל 6 (מקובל: כל 3)");
    expect(text).toContain("הניתוח של המנטור — מה הכי שווה לעשות עכשיו:");
    expect(text).toContain("- שיחה נכנסת אחת מחכה לטלפון חוזר.");
    expect(text).toContain("רעיונות מספר המשחק");
    // מדד המיקוד (הצעות — היעד שמאחור) ואחריו מדד העצה הראשונה (שיחות נכנסות)
    expect(text).toContain(
      `הצעות שנשלחו — ${MENTOR_PLAYBOOK.offers_sent.diagnosis}`,
    );
    expect(text).toContain(
      `שיחות נכנסות שנענו — ${MENTOR_PLAYBOOK.calls_answered.diagnosis}`,
    );
    expect(text).not.toContain("סיורים שהתקיימו —");
  });

  it("שבוע ריק בלי משפך — אומר זאת, ועדיין נותן רעיונות", () => {
    const text = mentorAdviceBlock(
      { goals: [], activity: quiet, now: monday },
      [],
    ).join("\n");
    expect(text).toContain("עדיין בלי פעילות שנספרה");
    expect(text).not.toContain("המשפך של המתווך");
    expect(text).toContain(
      `הצעות שנשלחו — ${MENTOR_PLAYBOOK.offers_sent.diagnosis}`,
    );
  });
});
