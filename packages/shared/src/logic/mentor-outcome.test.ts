import { describe, expect, it } from "vitest";
import {
  ideaMarksDue,
  ideaOutcomeWindows,
  mentorIdeaOutcome,
  shiftDayLabel,
} from "./mentor-outcome.js";
import {
  mentorIdeaOutcomeSentence,
  mentorReviewBody,
  mentorWeeklyReview,
  type MentorActivity,
} from "./mentor.js";
import { MENTOR_PLAYBOOK } from "./mentor-playbook.js";

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

// ראשון 2026-09-06 00:00 שעון ישראל
const WEEK = new Date("2026-09-05T21:00:00.000Z");
const NEXT_WEEK = new Date("2026-09-12T21:00:00.000Z");

describe("האם הרעיון עבד — חלונות המדידה", () => {
  it("שבעה ימים מיום הסימון (כולל) מול שבעת הימים שלפניו, בגבולות חצות ישראל", () => {
    expect(shiftDayLabel("2026-09-03", 7)).toBe("2026-09-10");
    expect(shiftDayLabel("2026-09-03", -7)).toBe("2026-08-27");
    expect(shiftDayLabel("2026-12-28", 7)).toBe("2027-01-04");
    const { before, after } = ideaOutcomeWindows({
      key: "offers_sent:0",
      verdict: "helped",
      date: "2026-09-03",
    });
    expect(after.start.toISOString()).toBe("2026-09-02T21:00:00.000Z");
    expect(after.end.toISOString()).toBe("2026-09-09T21:00:00.000Z");
    expect(before.start.toISOString()).toBe("2026-08-26T21:00:00.000Z");
    expect(before.end).toEqual(after.start);
  });

  it("בשל למדידה — „עזר לי” שחלון ה„אחרי” שלו נסגר בשבוע שמסכמים; פעם אחת בלבד", () => {
    const marks = [
      // סומן שלישי 1.9 — החלון נסגר 8.9, בתוך השבוע 6–13.9
      { key: "offers_sent:0", verdict: "helped" as const, date: "2026-09-01" },
      // סומן שבת 5.9 — נסגר 12.9, עדיין בתוך השבוע
      { key: "calls_made:1", verdict: "helped" as const, date: "2026-09-05" },
      // סומן ראשון 6.9 — החלון נסגר 13.9 00:00, אחרי שהסיכום של השבוע
      // כבר נכתב (מוצאי שבת 20:00); נמדד בשבוע הבא, כשהחלון סגור כולו
      {
        key: "viewings_held:0",
        verdict: "helped" as const,
        date: "2026-09-06",
      },
      // „לא בשבילי” אינו נמדד
      {
        key: "leads_answered:0",
        verdict: "dismissed" as const,
        date: "2026-09-02",
      },
      // סומן „עזר לי” ואז „לא בשבילי” באותו יום — האחרון קובע
      {
        key: "followups_done:0",
        verdict: "helped" as const,
        date: "2026-09-03",
      },
      {
        key: "followups_done:0",
        verdict: "dismissed" as const,
        date: "2026-09-03",
      },
    ];
    const thisWeek = ideaMarksDue(marks, { start: WEEK, end: NEXT_WEEK });
    expect(thisWeek.map((m) => m.key)).toEqual([
      "offers_sent:0",
      "calls_made:1",
    ]);
    const nextWeek = ideaMarksDue(marks, {
      start: NEXT_WEEK,
      end: new Date("2026-09-19T21:00:00.000Z"),
    });
    expect(nextWeek.map((m) => m.key)).toEqual(["viewings_held:0"]);
  });

  it("ההשוואה על המדד של הרעיון בלבד; מפתח זר — null", () => {
    const mark = {
      key: "offers_sent:0",
      verdict: "helped" as const,
      date: "2026-09-01",
    };
    const up = mentorIdeaOutcome(
      mark,
      { ...quiet, offers_sent: 2, calls_made: 9 },
      { ...quiet, offers_sent: 6 },
    );
    expect(up).toMatchObject({
      metric: "offers_sent",
      before: 2,
      after: 6,
      change: "up",
      text: MENTOR_PLAYBOOK.offers_sent.ideas[0],
    });
    expect(
      mentorIdeaOutcome(
        mark,
        { ...quiet, offers_sent: 3 },
        { ...quiet, offers_sent: 3 },
      )?.change,
    ).toBe("flat");
    expect(
      mentorIdeaOutcome(
        mark,
        { ...quiet, offers_sent: 3 },
        { ...quiet, offers_sent: 1 },
      )?.change,
    ).toBe("down");
    expect(
      mentorIdeaOutcome({ ...mark, key: "nope:0" }, quiet, quiet),
    ).toBeNull();
  });
});

describe("האם הרעיון עבד — המשפט בסיכום", () => {
  const mark = {
    key: "offers_sent:0",
    verdict: "helped" as const,
    date: "2026-09-03",
  };
  const outcome = (before: number, after: number) =>
    mentorIdeaOutcome(
      mark,
      { ...quiet, offers_sent: before },
      { ...quiet, offers_sent: after },
    )!;

  it("עלייה — עובדה שמאשרת; בלי עלייה — עובדה וייחוס לתהליך, בלי לקחת את הרעיון בחזרה", () => {
    expect(mentorIdeaOutcomeSentence(outcome(2, 6))).toBe(
      "הרעיון שסימנת „עזר לי” ב-3.9 — „לקבוע שעה קבועה להצעות”: בשבוע שאחריו 6 הצעות, מול 2 הצעות בשבוע שלפני. זה עובד — להמשיך עם זה.",
    );
    expect(mentorIdeaOutcomeSentence(outcome(3, 3))).toContain(
      "3 הצעות בשבוע שאחריו, כמו בשבוע שלפני. הרעיון לבד עוד לא הזיז את המספר",
    );
    expect(mentorIdeaOutcomeSentence(outcome(3, 1))).toContain(
      "הצעה אחת בשבוע שאחריו, מול 3 הצעות בשבוע שלפני. שבוע אחד הוא מעט",
    );
  });

  it("מדידה היא סיבה לסיכום גם בשבוע ריק — הבטחנו לומר אם המספר זז", () => {
    const empty = { weekStart: WEEK, wins: [], activity: quiet, goals: [] };
    expect(mentorWeeklyReview(empty)).toBeNull();
    const review = mentorWeeklyReview({
      ...empty,
      ideaOutcomes: [outcome(2, 0)],
    });
    expect(review?.paragraphs[0]).toContain("הרעיון שסימנת „עזר לי”");
  });

  it("בסיכום השבועי — אחרי היעדים, שניים לכל היותר, ונשמר בגוף לסיכום החודשי", () => {
    const signals = {
      weekStart: WEEK,
      wins: [],
      activity: { ...quiet, offers_sent: 6 },
      goals: [],
      ideaOutcomes: [outcome(1, 2), outcome(2, 6), outcome(3, 3)],
    };
    const review = mentorWeeklyReview(signals)!;
    const said = review.paragraphs.filter((p) => p.startsWith("הרעיון שסימנת"));
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("מול 2 הצעות");
    expect(said[1]).toContain("כמו בשבוע שלפני");
    expect(mentorReviewBody(signals, review).ideaOutcomes).toHaveLength(3);
    // בלי מדידה — השדה חסר, כמו בגופים הישנים
    const plain = { ...signals, ideaOutcomes: [] };
    expect(
      mentorReviewBody(plain, mentorWeeklyReview(plain)!),
    ).not.toHaveProperty("ideaOutcomes");
  });
});
