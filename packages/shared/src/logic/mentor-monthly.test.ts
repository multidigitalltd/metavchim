import { describe, expect, it } from "vitest";
import {
  mentorMonthLabel,
  mentorMonthlyBody,
  mentorMonthlyReview,
  type MentorMonthSignals,
  type MentorMonthWeek,
} from "./mentor-monthly.js";
import { mentorIdeaOutcome } from "./mentor-outcome.js";
import { MENTOR_PLAYBOOK, ideaKeyInText } from "./mentor-playbook.js";
import type { MentorActivity } from "./mentor.js";

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

// 1 בספטמבר 2026 00:00 שעון ישראל
const SEPTEMBER = new Date("2026-08-31T21:00:00.000Z");

const PLURAL = /אתם|שלכם|לכם|כתבו|לחצו|קבעו|תם[.,!?:]|תם$/u;
const GENDERED = /\bאתה\b|\bאת\b(?! ה)/u;

function week(
  weekStart: string,
  pace: "done" | "behind" | "on_track",
  actual: number,
  extra: Partial<MentorMonthWeek> = {},
): MentorMonthWeek {
  return {
    weekStart: new Date(weekStart),
    goals: [{ metric: "offers_sent", period: "week", target: 5, actual, pace }],
    ...extra,
  };
}

const base: MentorMonthSignals = {
  monthStart: SEPTEMBER,
  activity: { ...quiet, offers_sent: 18, viewings_held: 9, deals_closed: 1 },
  previousActivity: { ...quiet, offers_sent: 12, viewings_held: 11 },
  wins: [
    { kind: "deal_closed", title: "דירה בהרצל" },
    { kind: "exclusivity_signed", title: "בית בגבעה" },
    { kind: "goal_reached", title: "5 הצעות בשבוע" },
  ],
  weeks: [
    week("2026-08-29T21:00:00.000Z", "done", 6),
    week("2026-09-05T21:00:00.000Z", "behind", 2),
    week("2026-09-12T21:00:00.000Z", "done", 5),
    week("2026-09-19T21:00:00.000Z", "behind", 1),
  ],
  marks: [
    { key: "offers_sent:0", verdict: "helped", date: "2026-09-01" },
    { key: "offers_sent:1", verdict: "dismissed", date: "2026-09-02" },
    { key: "calls_made:0", verdict: "helped", date: "2026-09-10" },
  ],
  firstName: "דנה",
};

describe("הסיכום החודשי — מה עבד ומה לא", () => {
  it("שם החודש בעברית, מהלוח הישראלי", () => {
    expect(mentorMonthLabel(SEPTEMBER)).toBe("ספטמבר");
    // רגע לפני ה-1 בספטמבר הוא עדיין אוגוסט
    expect(mentorMonthLabel(new Date(SEPTEMBER.getTime() - 1))).toBe("אוגוסט");
  });

  it("הצלחות בשמן, המספרים מול החודש שעבר, כמה שבועות היעד הושג, הרעיונות, ומיקוד אחד", () => {
    const review = mentorMonthlyReview(base)!;
    expect(review.headline).toBe("ספטמבר: עסקה אחת — חודש שלך");
    expect(review.greeting).toBe("היי דנה. חודש שלם מאחוריך — הנה מה שראיתי.");
    const [wins, totals, trend, goal, ideas, focus] = review.paragraphs;
    expect(wins).toBe("החודש: עסקה אחת ובלעדיות אחת.");
    expect(totals).toBe("המספרים של ספטמבר: עסקה אחת · 18 הצעות · 9 סיורים.");
    expect(trend).toBe(
      "מול אוגוסט: יותר עסקאות שנסגרו (0 ⟵ 1), יותר הצעות שנשלחו (12 ⟵ 18), פחות סיורים שהתקיימו (11 ⟵ 9).",
    );
    expect(goal).toBe("„5 הצעות בשבוע” — הושג ב-2 מתוך 4 שבועות.");
    expect(ideas).toBe("סימנת 3 רעיונות החודש: 2 עזרו, אחד לא בשבילך.");
    expect(focus).toMatch(
      /^המיקוד לחודש הבא: הצעות\. היעד היה מאחור ב-2 מתוך 4 שבועות\. טיפ: /u,
    );
    expect(review.focus).toBe("offers_sent");
    // הטיפ מספר המשחק, על המדד של המיקוד, ובלי מה שנדחה
    const tip = ideaKeyInText(focus);
    expect(tip).toMatch(/^offers_sent:\d$/u);
    const learned = mentorMonthlyReview({
      ...base,
      feedback: { liked: [], dismissed: [tip!], marks: [] },
    })!.paragraphs.at(-1)!;
    expect(ideaKeyInText(learned)).not.toBe(tip);
    for (const p of review.paragraphs) {
      expect(p, p).not.toMatch(PLURAL);
      expect(p, p).not.toMatch(GENDERED);
    }
  });

  it("הרעיון שהזיז הכי הרבה — ומי שלא הזיז; נשמרים בגוף", () => {
    const up = mentorIdeaOutcome(
      { key: "offers_sent:0", verdict: "helped", date: "2026-09-01" },
      { ...quiet, offers_sent: 2 },
      { ...quiet, offers_sent: 6 },
    )!;
    const small = mentorIdeaOutcome(
      { key: "offers_sent:2", verdict: "helped", date: "2026-09-08" },
      { ...quiet, offers_sent: 3 },
      { ...quiet, offers_sent: 4 },
    )!;
    const flat = mentorIdeaOutcome(
      { key: "calls_made:0", verdict: "helped", date: "2026-09-10" },
      { ...quiet, calls_made: 5 },
      { ...quiet, calls_made: 5 },
    )!;
    const signals: MentorMonthSignals = {
      ...base,
      weeks: [
        week("2026-09-05T21:00:00.000Z", "done", 6, { ideaOutcomes: [up] }),
        week("2026-09-12T21:00:00.000Z", "done", 5, {
          ideaOutcomes: [small, flat],
        }),
      ],
    };
    const review = mentorMonthlyReview(signals)!;
    const text = review.paragraphs.join("\n");
    expect(text).toContain(
      "הרעיון שהזיז הכי הרבה: „לקבוע שעה קבועה להצעות” — הצעות 2 ⟵ 6 בשבוע שאחריו.",
    );
    expect(text).toContain(
      "רעיון אחד שסימנת „עזר לי” לא הזיז את המספר — התחושה נכונה, המספר עוד לא.",
    );
    expect(text).toContain(
      "„5 הצעות בשבוע” — הושג בכל שני שבועות. כל הכבוד לך.",
    );
    expect(text).toContain("לחודש הבא: אותם יעדים — או אחד גבוה יותר.");
    expect(mentorMonthlyBody(signals, review).ideaOutcomes).toEqual([
      up,
      small,
      flat,
    ]);
    expect(MENTOR_PLAYBOOK.offers_sent.ideas[0]).toContain(
      "לקבוע שעה קבועה להצעות",
    );
  });

  it("יעד חודשי נמדד על החודש כולו; בלי סימונים — הזמנה; בלי יעדים — יעד אחד", () => {
    const review = mentorMonthlyReview({
      monthStart: SEPTEMBER,
      activity: { ...quiet, deals_closed: 1, offers_sent: 4 },
      wins: [],
      weeks: [
        {
          weekStart: new Date("2026-09-05T21:00:00.000Z"),
          goals: [
            {
              metric: "deals_closed",
              period: "month",
              target: 2,
              actual: 0,
              pace: "behind",
            },
          ],
        },
      ],
      marks: [],
    })!;
    expect(review.headline).toBe("ספטמבר: מה עבד ומה עוד לא");
    expect(review.greeting).toBeNull();
    expect(review.paragraphs).toEqual([
      "המספרים של ספטמבר: עסקה אחת · 4 הצעות.",
      "היעד החודשי „2 עסקאות בחודש” — עסקה אחת מתוך 2. לא הפעם, והיעד עדיין שלך.",
      "לא סימנת רעיונות החודש. „עזר לי” ו„לא בשבילי” בבוקר הם איך שאני לומד מה עובד אצלך.",
      "לחודש הבא: יעד שבועי אחד במסך היעדים — ואני אעקוב איתך.",
    ]);
    expect(review.focus).toBeNull();
  });

  it("כותרת עם שם המנטור, ו„כל היעדים הושגו” כשכל שבוע הושג", () => {
    const review = mentorMonthlyReview({
      ...base,
      wins: [],
      weeks: [
        week("2026-09-05T21:00:00.000Z", "done", 6),
        week("2026-09-12T21:00:00.000Z", "done", 5),
      ],
      persona: { name: "נועה", style: "direct" },
    })!;
    expect(review.headline).toBe("ספטמבר: כל היעדים הושגו, שבוע אחרי שבוע");
    expect(review.greeting).toBe(
      "היי דנה, כאן נועה. חודש שלם מאחוריך — הנה מה שראיתי.",
    );
  });

  it("חודש ריק לגמרי — שקט", () => {
    expect(
      mentorMonthlyReview({
        monthStart: SEPTEMBER,
        activity: quiet,
        wins: [],
        weeks: [],
        marks: [],
      }),
    ).toBeNull();
  });
});
