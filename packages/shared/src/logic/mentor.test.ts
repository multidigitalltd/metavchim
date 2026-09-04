import { describe, expect, it } from "vitest";
import {
  MENTOR_GOAL_METRICS,
  type MentorActivity,
  type MentorGoalProgress,
  mentorGoalLabel,
  mentorGoalProgress,
  mentorMidweekNudge,
  mentorPeriodRange,
  mentorQuantity,
  MENTOR_GOAL_TARGET_MAX,
  mentorReviewTitle,
  mentorWeeklyReview,
  obstaclePlanSuggestions,
  suggestProcessGoals,
} from "./mentor.js";
import { MentorGoalInputSchema } from "../schemas/mentor.js";

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
    expect(review?.paragraphs[0]).toContain("ביקשתם מעצמכם");
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
    expect(review?.paragraphs[0]).toContain("סגרתם את הרצל 12, רעננה");
    expect(review?.paragraphs[0]).toContain("כל הכבוד");
    expect(review?.paragraphs[1]).toContain("חסרו 3 הצעות ליעד שקבעתם");
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
      "סגרתם את הרצל 12, וחתמתם בלעדיות על ויצמן 3. שבוע כזה לא קורה במקרה.",
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
    expect(review?.headline).toBe("3 שבועות רצופים שכל היעדים מושגים");
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
    expect(review?.headline).toBe("שבוע של עבודה, בקצב");
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
      "כל 5 סיורים ⟵ עסקה אחת — לפי ממוצע מקובל, עד שתהיה היסטוריה משלכם",
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
      "כל 3 סיורים ⟵ עסקה אחת — לפי 13 השבועות האחרונים שלכם",
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
    expect(review?.paragraphs[0]).toContain(
      "כתבתם שזה בשביל: הדירה של הילדים.",
    );

    const done = mentorWeeklyReview({
      weekStart: WEEK_START,
      wins: [],
      activity: { ...quiet, offers_sent: 5 },
      goals: [goal({ pace: "done", why: "הדירה של הילדים" })],
    });
    expect(done?.paragraphs[0]).not.toContain("כתבתם");
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
      "התוכנית שכתבתם: „כל בוקר ב-11:00 שולח הצעות”.",
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
      "התוכנית שכתבתם: „כל יום ב-16:00 מתקשר לקבוע סיור”",
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
    expect(mentorMidweekNudge(behind, wednesday)?.body).toBe(
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
    expect(review?.paragraphs[0]).toBe("התחייבתם ל5 הצעות בשבוע — ועמדתם בזה.");
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
    expect(review?.headline).toBe("עמדתם במה שהתחייבתם");
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
      "התחייבתם ל5 הצעות בשבוע. הפעם לא יצא, וההתחייבות עדיין שלכם.",
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
        expect(plan.length).toBeLessThanOrEqual(300);
      }
    }
  });
});
