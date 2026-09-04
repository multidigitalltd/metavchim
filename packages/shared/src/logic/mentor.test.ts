import { describe, expect, it } from "vitest";
import {
  MENTOR_GOAL_METRICS,
  MENTOR_GOAL_TARGET_MAX,
  type MentorActivity,
  mentorCelebration,
  mentorGoalLabel,
  mentorGoalProgress,
  type MentorGoalProgress,
  mentorGoalStatusLine,
  mentorMidweekNudge,
  type MentorPastReview,
  mentorPatternLine,
  mentorPatterns,
  mentorPeriodRange,
  mentorQuantity,
  mentorReviewTitle,
  mentorStatusMessage,
  mentorWeeklyReview,
  obstaclePlanSuggestions,
  suggestProcessGoals,
} from "./mentor.js";
import {
  MENTOR_INTENTION_MAX,
  MentorGoalInputSchema,
} from "../schemas/mentor.js";

// ראשון 2026-09-06 00:00 שעון ישראל (UTC+3 בקיץ)
const WEEK_START = new Date("2026-09-05T21:00:00.000Z");
const WEEK_END = new Date("2026-09-12T21:00:00.000Z");

const quiet: MentorActivity = {
  deals_closed: 0,
  offers_sent: 0,
  viewings_held: 0,
  leads_answered: 0,
  new_buyers: 0,
  new_properties: 0,
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
    ...partial,
  };
}

describe("mentorQuantity / mentorGoalLabel — כמויות בעברית", () => {
  it("יחידה אחת בצורת היחיד, ומעבר לכך מספר וצורת רבים", () => {
    expect(mentorQuantity("deals_closed", 1)).toBe("עסקה אחת");
    expect(mentorQuantity("deals_closed", 3)).toBe("3 עסקאות");
    expect(mentorGoalLabel("offers_sent", 5, "week")).toBe("5 הצעות בשבוע");
    expect(mentorGoalLabel("viewings_held", 1, "month")).toBe("סיור אחד בחודש");
  });
});

describe("mentorPeriodRange — גבולות בשעון ישראל", () => {
  it("שבוע: ראשון 00:00 ישראל עד ראשון הבא", () => {
    const { start, end } = mentorPeriodRange(
      "week",
      new Date("2026-09-09T10:00:00.000Z"),
    );
    expect(start.toISOString()).toBe(WEEK_START.toISOString());
    expect(end.toISOString()).toBe(WEEK_END.toISOString());
  });

  it("חודש: הראשון בחודש 00:00 ישראל, כולל מעבר שנה", () => {
    const sep = mentorPeriodRange(
      "month",
      new Date("2026-09-09T10:00:00.000Z"),
    );
    expect(sep.start.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(sep.end.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    const dec = mentorPeriodRange(
      "month",
      new Date("2026-12-20T10:00:00.000Z"),
    );
    // חורף — UTC+2
    expect(dec.start.toISOString()).toBe("2026-11-30T22:00:00.000Z");
    expect(dec.end.toISOString()).toBe("2026-12-31T22:00:00.000Z");
  });

  it("חצות ישראלית של יום ראשון שייכת כבר לשבוע החדש — גם כשב-UTC עדיין שבת", () => {
    const { start } = mentorPeriodRange(
      "week",
      new Date("2026-09-05T21:30:00.000Z"),
    );
    expect(start.toISOString()).toBe(WEEK_START.toISOString());
  });
});

describe("mentorGoalProgress — מול הקצב ולא מול המספר הסופי", () => {
  const base = {
    metric: "offers_sent" as const,
    period: "week" as const,
    periodStart: WEEK_START,
    periodEnd: WEEK_END,
  };
  const monday = new Date("2026-09-07T07:00:00.000Z");
  const friday = new Date("2026-09-11T07:00:00.000Z");

  it("יום שני עם אפס אינו פיגור — היעד עוד לא היה אמור להתחיל", () => {
    const p = mentorGoalProgress({
      ...base,
      target: 5,
      actual: 0,
      now: monday,
    });
    expect(p.pace).toBe("on_track");
    expect(p.remaining).toBe(5);
  });

  it("אותם 2 מתוך 5: מצוין בשני, פיגור בשישי", () => {
    expect(
      mentorGoalProgress({ ...base, target: 5, actual: 2, now: monday }).pace,
    ).toBe("ahead");
    expect(
      mentorGoalProgress({ ...base, target: 5, actual: 2, now: friday }).pace,
    ).toBe("behind");
  });

  it("יעד שהושג הוא „הושג” גם באמצע התקופה, והיחס עובר את 1", () => {
    const p = mentorGoalProgress({
      ...base,
      target: 5,
      actual: 7,
      now: monday,
    });
    expect(p.pace).toBe("done");
    expect(p.ratio).toBeCloseTo(1.4);
    expect(p.remaining).toBe(0);
  });

  it("יעד קטן: עסקה אינה מתחלקת — 0 מתוך 3 בחודש ביום העשירי הוא בקצב", () => {
    const p = mentorGoalProgress({
      metric: "deals_closed",
      period: "month",
      target: 3,
      actual: 0,
      periodStart: new Date("2026-08-31T21:00:00.000Z"),
      periodEnd: new Date("2026-09-30T21:00:00.000Z"),
      now: new Date("2026-09-10T09:00:00.000Z"),
    });
    expect(p.pace).toBe("on_track");
  });

  it("יעד גדול: שתי הצעות מעל הצפוי אינן „מקדים” — הסובלנות היא 15%", () => {
    const p = mentorGoalProgress({
      ...base,
      target: 40,
      actual: 21,
      now: friday,
    });
    // צפוי ≈ 31 · 21 נמוך ב-10 — מעל יחידה ועוד 6 (15%) ⇒ פיגור
    expect(p.pace).toBe("behind");
    const q = mentorGoalProgress({
      ...base,
      target: 40,
      actual: 33,
      now: friday,
    });
    expect(q.pace).toBe("on_track");
    const r = mentorGoalProgress({
      ...base,
      target: 40,
      actual: 37,
      now: friday,
    });
    expect(r.pace).toBe("ahead");
  });

  it("התקופה נגמרה: יש רק „הושג” או „מאחור” — 4 מתוך 5 בסוף השבוע אינו „בקצב”", () => {
    const p = mentorGoalProgress({
      ...base,
      target: 5,
      actual: 4,
      now: WEEK_END,
    });
    expect(p.pace).toBe("behind");
    const one = mentorGoalProgress({
      ...base,
      target: 1,
      actual: 0,
      now: WEEK_END,
    });
    expect(one.pace).toBe("behind");
  });

  it("יעד של אחד: אפס ביום שישי עדיין אינו פיגור — אין חצי עסקה", () => {
    expect(
      mentorGoalProgress({ ...base, target: 1, actual: 0, now: friday }).pace,
    ).toBe("on_track");
  });

  it("קלט מחוץ לתקופה נחתך: לפני התחלה elapsed=0, אחרי סוף elapsed=1", () => {
    expect(
      mentorGoalProgress({
        ...base,
        target: 5,
        actual: 0,
        now: new Date("2026-09-01T00:00:00Z"),
      }).elapsed,
    ).toBe(0);
    expect(
      mentorGoalProgress({
        ...base,
        target: 5,
        actual: 0,
        now: new Date("2026-09-20T00:00:00Z"),
      }).elapsed,
    ).toBe(1);
  });

  it("יעד לא תקין מנורמל — אפס או שלילי נעשה 1, ואין חלוקה באפס", () => {
    const p = mentorGoalProgress({
      ...base,
      target: 0,
      actual: -2,
      now: friday,
    });
    expect(p.target).toBe(1);
    expect(p.actual).toBe(0);
    expect(Number.isFinite(p.ratio)).toBe(true);
  });
});

describe("mentorWeeklyReview — מה המנטור אומר במוצאי שבת", () => {
  it("אין יעדים, אין הצלחות, אין פעילות ⇒ שקט", () => {
    expect(
      mentorWeeklyReview({
        weekStart: WEEK_START,
        wins: [],
        activity: quiet,
        goals: [],
      }),
    ).toBeNull();
  });

  it("שבוע ריק עם יעד ⇒ עידוד, לא נזיפה — והיעד מוזכר כמה שהמתווך ביקש מעצמו", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: quiet,
      goals: [goal({ pace: "behind", actual: 0, ratio: 0, remaining: 5 })],
    });
    expect(review?.mood).toBe("encourage");
    expect(review?.headline).toContain("שבוע שקט");
    expect(review?.paragraphs[0]).toContain("ביקשת מעצמך");
    expect(review?.askNextWeek).toContain("5 הצעות בשבוע");
    // בלי מילת שיפוט
    expect(review?.paragraphs.join(" ")).not.toMatch(/מעט|רק|חבל/);
  });

  it("עסקה שנסגרה נאמרת בשמה, והטון חוגג גם כשיעד אחר בפיגור", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [{ kind: "deal_closed", title: "הרצל 12, רעננה" }],
      activity: { ...quiet, deals_closed: 1, offers_sent: 2 },
      goals: [goal({ pace: "behind", actual: 2, ratio: 0.4, remaining: 3 })],
    });
    expect(review?.mood).toBe("celebrate");
    expect(review?.paragraphs[0]).toContain("סגרת את הרצל 12, רעננה");
    expect(review?.paragraphs[0]).toContain("כל הכבוד");
    expect(review?.paragraphs[1]).toContain("חסרו 3 הצעות ליעד שקבעת לעצמך");
    expect(mentorReviewTitle(review!)).toMatch(/^🎉 /);
  });

  it("שתי הצלחות מחוברות במשפט אחד", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [
        { kind: "deal_closed", title: "הרצל 12" },
        { kind: "exclusivity_signed", title: "ויצמן 3" },
      ],
      activity: { ...quiet, deals_closed: 1 },
      goals: [],
    });
    expect(review?.paragraphs[0]).toBe(
      "סגרת את הרצל 12, וחתמת בלעדיות על ויצמן 3. שבוע כזה לא קורה במקרה — זה שלך.",
    );
  });

  it("כל היעדים הושגו ⇒ חגיגה, ורצף של שבועות נאמר בכותרת", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 6 },
      goals: [goal({ pace: "done", actual: 6, ratio: 1.2 })],
      streakWeeks: 3,
    });
    expect(review?.mood).toBe("celebrate");
    expect(review?.headline).toBe("3 שבועות רצופים שכל היעדים שלך מושגים");
    expect(review?.askNextWeek).toContain("להעלות");
  });

  it("השוואה רק לעצמו — ורק מה שהשתנה", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 4, viewings_held: 2, new_buyers: 1 },
      previousActivity: {
        ...quiet,
        offers_sent: 2,
        viewings_held: 3,
        new_buyers: 1,
      },
      goals: [],
    });
    expect(review?.mood).toBe("steady");
    const trend = review?.paragraphs[0] ?? "";
    expect(trend).toContain("הצעות שנשלחו 2 ⟵ 4");
    expect(trend).toContain("סיורים שהתקיימו 3 ⟵ 2");
    expect(trend).not.toContain("קונים חדשים");
    expect(review?.askNextWeek).toBeNull();
  });

  it("מתווך בלי שבוע קודם אינו מקבל השוואה", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 4 },
      goals: [],
    });
    expect(review?.paragraphs).toEqual([]);
    expect(review?.headline).toBe("שבוע של עבודה, בקצב שלך");
  });

  it("הבקשה לשבוע הבא מתמקדת ביעד שבפיגור, לא בראשון ברשימה", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 5, viewings_held: 1 },
      goals: [
        goal({ pace: "done", actual: 5 }),
        goal({
          metric: "viewings_held",
          target: 3,
          pace: "behind",
          actual: 1,
          ratio: 1 / 3,
          remaining: 2,
        }),
      ],
    });
    expect(review?.askNextWeek).toContain("3 סיורים בשבוע");
  });
});

describe("suggestProcessGoals — מתוצאה לתהליך, לפי המשפך של המתווך עצמו", () => {
  it("בלי היסטוריה: ברירת המחדל, וההסבר אומר את זה", () => {
    const plan = suggestProcessGoals({
      outcome: { target: 1, period: "week" },
      history: quiet,
      historyWeeks: 0,
    });
    expect(plan.map((p) => [p.metric, p.target])).toEqual([
      ["leads_answered", 60],
      ["new_buyers", 30],
      ["offers_sent", 15],
      ["viewings_held", 5],
    ]);
    expect(plan.every((p) => p.period === "week")).toBe(true);
    expect(plan[3]?.reason).toBe(
      "כל 5 סיורים ⟵ עסקה אחת — לפי ממוצע מקובל, עד שתהיה לך היסטוריה משלך",
    );
  });

  it("עסקה בחודש היא כרבע עסקה בשבוע — ויעדי התהליך מתעגלים כלפי מעלה, אף פעם לא אפס", () => {
    const plan = suggestProcessGoals({
      outcome: { target: 1, period: "month" },
      history: quiet,
      historyWeeks: 0,
    });
    const byMetric = Object.fromEntries(plan.map((p) => [p.metric, p.target]));
    // 1/4.33 עסקאות × 5 = 1.15 סיורים ⇒ 2
    expect(byMetric.viewings_held).toBe(2);
    // ומכאן **מהמעוגל**: 2 סיורים × 3 = 6 הצעות, לא 4 מהשבר — היעדים עקביים זה עם זה
    expect(byMetric.offers_sent).toBe(6);
    expect(byMetric.new_buyers).toBe(12);
    expect(byMetric.leads_answered).toBe(24);
    expect(plan.every((p) => p.target >= 1)).toBe(true);
  });

  it("כל הצעה היא יעד שהסכמה מקבלת — גם כשהמשפך מייצר מספר גדול", () => {
    const plan = suggestProcessGoals({
      outcome: { target: 4, period: "week" },
      history: quiet,
      historyWeeks: 0,
    });
    expect(plan.find((p) => p.metric === "leads_answered")?.target).toBe(
      MENTOR_GOAL_TARGET_MAX,
    );
    for (const p of plan) {
      expect(
        MentorGoalInputSchema.safeParse({
          metric: p.metric,
          period: p.period,
          target: p.target,
        }).success,
      ).toBe(true);
    }
  });

  it("עם היסטוריה מספקת: היחסים של המתווך, וההסבר נוקב בחלון", () => {
    const plan = suggestProcessGoals({
      outcome: { target: 1, period: "week" },
      history: {
        deals_closed: 3,
        viewings_held: 9, // 3 סיורים לעסקה — טוב מברירת המחדל
        offers_sent: 18, // 2 הצעות לסיור
        new_buyers: 18, // הצעה לכל קונה
        leads_answered: 36, // 2 לידים לקונה
        new_properties: 4,
      },
      historyWeeks: 13,
    });
    expect(plan.map((p) => [p.metric, p.target])).toEqual([
      ["leads_answered", 12],
      ["new_buyers", 6],
      ["offers_sent", 6],
      ["viewings_held", 3],
    ]);
    expect(plan[3]?.reason).toBe(
      "כל 3 סיורים ⟵ עסקה אחת — לפי 13 השבועות האחרונים שלך",
    );
  });

  it("עסקה אחת בהיסטוריה אינה יחס — חוזרים לברירת המחדל", () => {
    const plan = suggestProcessGoals({
      outcome: { target: 1, period: "week" },
      history: { ...quiet, deals_closed: 1, viewings_held: 1 },
      historyWeeks: 13,
    });
    expect(plan.find((p) => p.metric === "viewings_held")?.target).toBe(5);
  });

  it("שלב חסר בהיסטוריה (אפס הצעות) מקבל ברירת מחדל — לא חלוקה באפס", () => {
    const plan = suggestProcessGoals({
      outcome: { target: 2, period: "week" },
      history: { ...quiet, deals_closed: 4, viewings_held: 8 },
      historyWeeks: 8,
    });
    expect(plan.find((p) => p.metric === "viewings_held")?.target).toBe(4);
    expect(plan.find((p) => p.metric === "offers_sent")?.target).toBe(12);
    expect(plan.every((p) => Number.isFinite(p.target))).toBe(true);
  });
});

describe("mentorWeeklyReview — שיטת המאמן: „למה”, כוונת יישום ורפלקציה", () => {
  it("ה„למה” מצוטט רק כשקשה — ורק אם המתווך כתב אחד", () => {
    const behind = goal({
      pace: "behind",
      actual: 2,
      ratio: 0.4,
      remaining: 3,
      why: "הדירה של הילדים",
    });
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 2 },
      goals: [behind],
    });
    expect(review?.paragraphs[0]).toContain("כתבת שזה בשביל: הדירה של הילדים.");

    const done = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 5 },
      goals: [goal({ pace: "done", why: "הדירה של הילדים" })],
    });
    expect(done?.paragraphs[0]).not.toContain("כתבת");
  });

  it("כוונת היישום של המתווך חוזרת בבקשה לשבוע הבא — התוכנית שלו, לא תוכנית חדשה", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 1 },
      goals: [
        goal({
          pace: "behind",
          actual: 1,
          ratio: 0.2,
          remaining: 4,
          intention: "כל בוקר ב-11:00 שולח הצעות",
        }),
      ],
    });
    expect(review?.askNextWeek).toContain(
      "התוכנית שכתבת: „כל בוקר ב-11:00 שולח הצעות”.",
    );
  });

  it("אחרי שהתקופה נגמרה אין „עוד יש זמן” — הסיכום נאמר כשהשבוע כבר מאחור", () => {
    const over = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: quiet,
      goals: [
        goal({ pace: "behind", actual: 0, ratio: 0, remaining: 5, elapsed: 1 }),
      ],
    });
    expect(over?.paragraphs[0]).not.toContain("עוד יש זמן");
    expect(over?.paragraphs[0]).toContain("מתחיל מחדש");
    const partial = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 3 },
      goals: [
        goal({
          pace: "behind",
          actual: 3,
          ratio: 0.6,
          remaining: 2,
          elapsed: 1,
        }),
      ],
    });
    expect(partial?.paragraphs[0]).toContain("חסרו 2 הצעות");
    expect(partial?.paragraphs[0]).not.toContain("עד עכשיו");
  });

  it("פיגור מקבל שאלת רפלקציה אחת לפי המדד; בלי פיגור — אין שאלה", () => {
    const behind = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, viewings_held: 1 },
      goals: [
        goal({ pace: "done" }),
        goal({
          metric: "viewings_held",
          target: 3,
          pace: "behind",
          actual: 1,
          ratio: 1 / 3,
          remaining: 2,
        }),
      ],
    });
    expect(behind?.reflection).toContain("מה עצר את הסיורים");

    const fine = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 3 },
      goals: [goal({ pace: "on_track", actual: 3, ratio: 0.6, remaining: 2 })],
    });
    expect(fine?.reflection).toBeNull();
  });
});

describe("mentorMidweekNudge — רביעי, לא מוצאי שבת", () => {
  // רביעי 09/09 13:00 ישראל
  const wednesday = new Date("2026-09-09T10:00:00.000Z");

  it("אין יעד שבועי בפיגור ⇒ שקט, גם כשיעד חודשי מאחור", () => {
    expect(
      mentorMidweekNudge(
        [goal({ pace: "on_track", actual: 3, ratio: 0.6, remaining: 2 })],
        wednesday,
      ),
    ).toBeNull();
    expect(
      mentorMidweekNudge(
        [
          goal({
            period: "month",
            target: 3,
            metric: "deals_closed",
            pace: "behind",
            actual: 0,
            ratio: 0,
            remaining: 3,
          }),
        ],
        wednesday,
      ),
    ).toBeNull();
  });

  it("יעד אחד בלבד — זה שהכי רחוק מהקצב — עם התוכנית וה„למה” של המתווך", () => {
    const nudge = mentorMidweekNudge(
      [
        goal({
          pace: "behind",
          actual: 3,
          ratio: 0.6,
          remaining: 2,
          expected: 4,
          elapsed: 0.5,
        }),
        goal({
          metric: "viewings_held",
          target: 4,
          pace: "behind",
          actual: 0,
          ratio: 0,
          remaining: 4,
          expected: 2,
          elapsed: 0.5,
          intention: "כל יום ב-16:00 מתקשר לקבוע סיור",
          why: "הדירה של הילדים",
        }),
      ],
      wednesday,
    );
    expect(nudge?.metric).toBe("viewings_held");
    expect(nudge?.title).toBe("🧭 אמצע השבוע — 4 סיורים בשבוע");
    expect(nudge?.body).toContain("עדיין לא התחיל, ונשאר יום עבודה אחד");
    expect(nudge?.body).toContain(
      "התוכנית שכתבת: „כל יום ב-16:00 מתקשר לקבוע סיור”",
    );
    expect(nudge?.body).toContain("בשביל: הדירה של הילדים");
    expect(nudge?.body).not.toMatch(/מעט|רק|חבל/);
  });

  it("הימים שנשארו נגזרים מרגע השליחה — לא „שלושה” קבוע", () => {
    const behind = [
      goal({
        pace: "behind",
        actual: 1,
        ratio: 0.2,
        remaining: 4,
        expected: 3,
        elapsed: 0.6,
      }),
    ];
    // רביעי 09:00 ישראל — היום נספר, ועוד חמישי
    expect(
      mentorMidweekNudge(behind, new Date("2026-09-09T06:00:00.000Z"))?.body,
    ).toContain("ונשארו יומיים");
    // חמישי 10:00 — יום אחד
    expect(
      mentorMidweekNudge(behind, new Date("2026-09-10T07:00:00.000Z"))?.body,
    ).toContain("ונשאר יום עבודה אחד");
    // חמישי אחר הצהריים ושישי — השבוע כמעט נגמר
    expect(
      mentorMidweekNudge(behind, new Date("2026-09-10T13:00:00.000Z"))?.body,
    ).toContain("והשבוע כמעט נגמר");
    expect(
      mentorMidweekNudge(behind, new Date("2026-09-11T06:00:00.000Z"))?.body,
    ).toContain("והשבוע כמעט נגמר");
    expect(mentorMidweekNudge(behind, wednesday)?.body).toContain(
      "5 הצעות בשבוע: הצעה אחת עד עכשיו, עוד 4 הצעות ליעד — ונשאר יום עבודה אחד.",
    );
  });
});

describe("mentorWeeklyReview — מחויבות: מה שאמרתם שתעשו הוא הדבר הראשון שבודקים", () => {
  it("הבקשה נושאת את היעד שאפשר להתחייב אליו", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 2 },
      goals: [goal({ pace: "behind", actual: 2, ratio: 0.4, remaining: 3 })],
    });
    expect(review?.ask).toEqual({
      metric: "offers_sent",
      period: "week",
      target: 5,
    });
    expect(
      mentorWeeklyReview({
        weekStart: WEEK_START,
        wins: [],
        activity: { ...quiet, offers_sent: 1 },
        goals: [],
      })?.ask,
    ).toBeNull();
  });

  it("עמידה במחויבות — נאמרת ראשונה גם כשיש עסקה, בשמה, והטון חוגג", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [{ kind: "deal_closed", title: "דירה ברחוב הרצל 12" }],
      activity: { ...quiet, offers_sent: 5 },
      goals: [
        goal({ pace: "done", actual: 5 }),
        goal({
          metric: "viewings_held",
          target: 3,
          pace: "behind",
          actual: 1,
          ratio: 1 / 3,
          remaining: 2,
        }),
      ],
      previousCommitment: {
        metric: "offers_sent",
        period: "week",
        target: 5,
        kept: true,
      },
    });
    expect(review?.mood).toBe("celebrate");
    expect(review?.paragraphs[0]).toContain(
      "התחייבת ל5 הצעות בשבוע — ועמדת בזה",
    );
    expect(review?.paragraphs[1]).toContain("הרצל 12");
  });

  it("בלי עסקה — הכותרת היא העמידה במחויבות", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 5 },
      goals: [
        goal({ pace: "done", actual: 5 }),
        goal({
          metric: "viewings_held",
          target: 3,
          pace: "behind",
          actual: 1,
          ratio: 1 / 3,
          remaining: 2,
        }),
      ],
      previousCommitment: {
        metric: "offers_sent",
        period: "week",
        target: 5,
        kept: true,
      },
    });
    expect(review?.mood).toBe("celebrate");
    expect(review?.headline).toBe("עמדת במה שהתחייבת");
  });

  it("הבקשה לשבוע הבא היא על יעד שבועי בלבד — יעד חודשי מאחור אינו בקשה", () => {
    const monthly = goal({
      metric: "deals_closed",
      period: "month",
      target: 2,
      pace: "behind",
      actual: 0,
      ratio: 0,
      remaining: 2,
    });
    const withWeekly = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: quiet,
      goals: [
        monthly,
        goal({ pace: "on_track", actual: 3, ratio: 0.6, remaining: 2 }),
      ],
    });
    expect(withWeekly?.ask).toEqual({
      metric: "offers_sent",
      period: "week",
      target: 5,
    });
    expect(withWeekly?.askNextWeek).toContain("5 הצעות בשבוע");

    const monthlyOnly = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: quiet,
      goals: [monthly],
    });
    expect(monthlyOnly?.ask).toBeNull();
    expect(monthlyOnly?.askNextWeek).toContain("יעד תהליך שבועי");
    expect(monthlyOnly?.reflection).not.toBeNull();
  });

  it("אי-עמידה — עובדה, וההתחייבות נשארת של המתווך; בלי נזיפה", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 2 },
      goals: [goal({ pace: "behind", actual: 2, ratio: 0.4, remaining: 3 })],
      previousCommitment: {
        metric: "offers_sent",
        period: "week",
        target: 5,
        kept: false,
      },
    });
    expect(review?.mood).toBe("encourage");
    expect(review?.paragraphs[0]).toBe(
      "התחייבת ל5 הצעות בשבוע. הפעם לא יצא, וההתחייבות עדיין שלך — נמשיך ביחד.",
    );
    expect(review?.paragraphs.join(" ")).not.toMatch(/מעט|רק|חבל|אכזב/);
  });
});

describe("obstaclePlanSuggestions — החצי השני של WOOP", () => {
  it("לכל מדד שלוש הצעות בצורת „כש… אז…”, קצרות מגבול התוכנית", () => {
    for (const metric of MENTOR_GOAL_METRICS) {
      const plans = obstaclePlanSuggestions(metric);
      expect(plans).toHaveLength(3);
      for (const plan of plans) {
        expect(plan).toMatch(/^כש.*— אז /u);
        expect(plan.length).toBeLessThanOrEqual(MENTOR_INTENTION_MAX);
      }
    }
  });
});

function past(
  weeksAgo: number,
  goals: MentorPastReview["goals"],
  extra: Partial<MentorPastReview> = {},
): MentorPastReview {
  return {
    weekStart: new Date(WEEK_START.getTime() - weeksAgo * 7 * 24 * 3600 * 1000),
    goals,
    askMetric: null,
    reflectionAnswer: null,
    plan: null,
    commitment: null,
    commitmentKept: null,
    ...extra,
  };
}
const behindOffers = {
  metric: "offers_sent" as const,
  period: "week" as const,
  target: 5,
  actual: 2,
  pace: "behind" as const,
};
const doneOffers = {
  metric: "offers_sent" as const,
  period: "week" as const,
  target: 5,
  actual: 5,
  pace: "done" as const,
};

const patternsNow = (reviews: MentorPastReview[]) =>
  mentorPatterns(reviews, WEEK_START);

describe("mentorPatterns — הזיכרון הארוך של המנטור", () => {
  it("פחות משלוש פעמים מאחור אינו דפוס", () => {
    expect(
      patternsNow([
        past(1, [behindOffers]),
        past(2, [behindOffers]),
        past(3, [doneOffers]),
      ]),
    ).toEqual([]);
  });

  it("שלוש פעמים מאחור בשמונה שבועות — דפוס, עם מה שהמתווך אמר ומה שקבע", () => {
    const patterns = patternsNow([
      past(1, [behindOffers], {
        askMetric: "offers_sent",
        reflectionAnswer: "לא היה זמן",
        plan: "כשלא נשאר זמן — אז ההצעות ראשונות",
      }),
      past(2, [doneOffers]),
      past(3, [behindOffers], {
        askMetric: "offers_sent",
        reflectionAnswer: "לא היו התאמות",
      }),
      past(4, [behindOffers]),
    ]);
    expect(patterns).toEqual([
      {
        kind: "recurring_behind",
        metric: "offers_sent",
        weeksBehind: 3,
        weeksWithGoal: 4,
        answers: ["לא היה זמן", "לא היו התאמות"],
        plans: ["כשלא נשאר זמן — אז ההצעות ראשונות"],
      },
    ]);
    expect(mentorPatternLine(patterns[0]!)).toBe(
      "הצעות שנשלחו: מאחור ב-3 מתוך 4 השבועות האחרונים. בפעמים הקודמות אמרת: „לא היה זמן”, „לא היו התאמות”. והתוכנית שקבעת אז: „כשלא נשאר זמן — אז ההצעות ראשונות”.",
    );
  });

  it("שני שבועות בקצב אחרי פיגור חוזר — מפנה, לא דפוס", () => {
    const patterns = patternsNow([
      past(1, [doneOffers]),
      past(2, [doneOffers]),
      past(3, [behindOffers]),
      past(4, [behindOffers]),
    ]);
    expect(patterns).toEqual([
      {
        kind: "turned_around",
        metric: "offers_sent",
        weeksBehind: 2,
        weeksSince: 2,
      },
    ]);
    expect(mentorPatternLine(patterns[0]!)).toContain(
      "זה מפנה — ועשית אותו בעצמך",
    );
  });

  it("רק שמונת השבועות האחרונים נספרים — מהיום, לא מהסיכום החדש ביותר", () => {
    const old = [9, 10, 11].map((w) => past(w, [behindOffers]));
    expect(patternsNow([past(1, [doneOffers]), ...old])).toEqual([]);
    // אשכול ישן של פיגורים אינו „החודשיים האחרונים” חצי שנה אחרי
    const cluster = [1, 2, 3].map((w) => past(w, [behindOffers]));
    expect(patternsNow(cluster)).toHaveLength(1);
    const halfYearLater = new Date(
      WEEK_START.getTime() + 26 * 7 * 24 * 3600 * 1000,
    );
    expect(mentorPatterns(cluster, halfYearLater)).toEqual([]);
  });

  it("מפנה דורש שבועות רצופים — חור בסיכומים או ביעד שובר את הרצף", () => {
    // שבוע 2 חסר: שני שבועות טובים עם חור ביניהם אינם „שבועיים רצופים”
    expect(
      patternsNow([
        past(1, [doneOffers]),
        past(3, [doneOffers]),
        past(4, [behindOffers]),
        past(5, [behindOffers]),
      ]),
    ).toEqual([]);
    // בשבוע האחרון אין יעד על המדד — הרצף לא נמשך עד היום
    expect(
      patternsNow([
        past(1, []),
        past(2, [doneOffers]),
        past(3, [doneOffers]),
        past(4, [behindOffers]),
        past(5, [behindOffers]),
      ]),
    ).toEqual([]);
  });

  it("רשומת המחויבויות — מתוך שתיים לפחות שנשפטו", () => {
    const patterns = patternsNow([
      past(1, [doneOffers], { commitmentKept: true }),
      past(2, [doneOffers], { commitmentKept: false }),
      past(3, [doneOffers], { commitmentKept: true }),
    ]);
    expect(patterns).toContainEqual({
      kind: "commitment_record",
      accepted: 3,
      kept: 2,
    });
    expect(
      mentorPatternLine({ kind: "commitment_record", accepted: 3, kept: 2 }),
    ).toBe("מחויבויות: עמדת ב-2 מתוך 3 שהתחייבת אליהן בחודשיים האחרונים.");
  });
});

describe("mentorWeeklyReview — הזיכרון בסיכום: משפט אחד, ורק כשרלוונטי השבוע", () => {
  const recurring = {
    kind: "recurring_behind" as const,
    metric: "offers_sent" as const,
    weeksBehind: 3,
    weeksWithGoal: 5,
    answers: ["לא היה זמן"],
    plans: [],
  };
  it("מדד שמאחור גם השבוע — הדפוס נאמר עם המילים של המתווך", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 2 },
      goals: [goal({ pace: "behind", actual: 2, ratio: 0.4, remaining: 3 })],
      patterns: [recurring],
    });
    expect(review?.paragraphs.join(" ")).toContain(
      "מאחור ב-3 מתוך 5 השבועות האחרונים. בפעמים הקודמות אמרת: „לא היה זמן”",
    );
  });
  it("השבוע בקצב — הדפוס הישן לא נאמר", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 5 },
      goals: [goal({ pace: "done" })],
      patterns: [recurring],
    });
    expect(review?.paragraphs.join(" ")).not.toContain("השבועות האחרונים");
  });
});

describe("mentorStatusMessage — „מה המצב ביעדים שלי?” בוואטסאפ", () => {
  it("שורה לכל יעד עם הקצב, ההצלחות בשמן, והסיכום האחרון", () => {
    const status = mentorStatusMessage({
      goals: [
        goal({ pace: "on_track", actual: 3, ratio: 0.6, remaining: 2 }),
        goal({
          metric: "viewings_held",
          target: 2,
          pace: "done",
          actual: 2,
          ratio: 1,
          remaining: 0,
        }),
      ],
      wins: [{ kind: "deal_closed", title: "דירת 4 חדרים בהרצל 12" }],
      latestHeadline: "שבוע עם תוצאה",
    });
    expect(status.message).toBe(
      "1 מתוך 2 היעדים שלך הושגו עד עכשיו — ממשיכים.",
    );
    expect(status.lines[0]).toBe("• 3 מתוך 5 הצעות בשבוע — בקצב");
    expect(status.lines[1]).toBe("• 2 מתוך 2 סיורים בשבוע — הושג");
    expect(status.lines[2]).toContain("דירת 4 חדרים בהרצל 12");
    expect(status.lines[3]).toBe("🧭 הסיכום האחרון: שבוע עם תוצאה");
    expect(status.lines.join(" ")).not.toMatch(/מעט|רק|חבל/);
  });

  it("בלי יעדים — הזמנה לקבוע אחד; כולם הושגו — חגיגה", () => {
    expect(
      mentorStatusMessage({ goals: [], wins: [], latestHeadline: null })
        .message,
    ).toContain("תקבע לי יעד");
    expect(
      mentorStatusMessage({
        goals: [goal({ pace: "done", actual: 5, ratio: 1, remaining: 0 })],
        wins: [],
        latestHeadline: null,
      }).message,
    ).toBe("היעד שלך הושג — כל הכבוד לך!");
    expect(
      mentorGoalStatusLine(
        goal({ pace: "behind", actual: 1, ratio: 0.2, remaining: 4 }),
      ),
    ).toBe("1 מתוך 5 הצעות בשבוע — מאחור");
  });
});

describe("הקול של המנטור — אישי, בגוף שני יחיד, בשם", () => {
  const PLURAL = /אתם|שלכם|לכם|כתבו|לחצו|קבעו|תם[.,!?:]|תם$/u;

  it("עם שם פרטי — פתיח אישי; בלי שם — אין פתיח", () => {
    const named = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [{ kind: "deal_closed", title: "הרצל 12" }],
      activity: { ...quiet, deals_closed: 1 },
      goals: [goal({ pace: "on_track", actual: 3, ratio: 0.6, remaining: 2 })],
      firstName: "דנה",
    });
    expect(named?.greeting).toBe("היי דנה, איזה שבוע היה לך.");
    const anonymous = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 1 },
      goals: [goal({ pace: "behind", actual: 1, ratio: 0.2, remaining: 4 })],
    });
    expect(anonymous?.greeting).toBeNull();
    expect(anonymous?.headline).toBe("לא הגעת ליעד השבוע — והוא עדיין שלך");
  });

  it("שום ניסוח של המנטור אינו ברבים — סיכום, חגיגה, דחיפה, זיכרון ומצב", () => {
    const review = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [{ kind: "exclusivity_signed", title: "הרצל 12" }],
      activity: { ...quiet, offers_sent: 2 },
      previousActivity: { ...quiet, offers_sent: 4 },
      goals: [
        goal({
          pace: "behind",
          actual: 2,
          ratio: 0.4,
          remaining: 3,
          why: "הדירה",
          intention: "בבוקר",
        }),
        goal({
          metric: "viewings_held",
          target: 2,
          pace: "done",
          actual: 2,
          ratio: 1,
          remaining: 0,
        }),
      ],
      previousCommitment: {
        metric: "offers_sent",
        period: "week",
        target: 5,
        kept: false,
      },
      patterns: [
        {
          kind: "recurring_behind",
          metric: "offers_sent",
          weeksBehind: 3,
          weeksWithGoal: 5,
          answers: ["לא היה זמן"],
          plans: ["בבוקר"],
        },
      ],
      firstName: "דנה",
    });
    const texts = [
      review?.greeting ?? "",
      review?.headline ?? "",
      ...(review?.paragraphs ?? []),
      review?.askNextWeek ?? "",
      mentorCelebration({ kind: "deal_closed", title: "הרצל 12" }, "דנה").body,
      mentorMidweekNudge(
        [
          goal({
            pace: "behind",
            actual: 1,
            ratio: 0.2,
            remaining: 4,
            expected: 3,
            elapsed: 0.6,
            why: "הדירה",
            intention: "בבוקר",
          }),
        ],
        new Date("2026-09-09T10:00:00.000Z"),
        "דנה",
      )?.body ?? "",
      mentorPatternLine({ kind: "commitment_record", accepted: 3, kept: 2 }),
      mentorStatusMessage({ goals: [], wins: [], latestHeadline: null })
        .message,
    ];
    for (const text of texts) expect(text, text).not.toMatch(PLURAL);
    expect(
      mentorCelebration({ kind: "deal_closed", title: "הרצל 12" }, "דנה").body,
    ).toMatch(/^דנה, /u);
  });
});
