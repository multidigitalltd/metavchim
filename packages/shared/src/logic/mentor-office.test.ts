import { describe, expect, it } from "vitest";
import { buildMentorPrompt } from "./mentor-chat.js";
import { mentorAdvice } from "./mentor-advice.js";
import { mentorMonthlyReview } from "./mentor-monthly.js";
import {
  EMPTY_OFFICE_PLAYBOOK,
  officeEvidenceLabel,
  officePlaybook,
  officePlaybookBlock,
  officeProvenKeys,
  type OfficeEvidenceEntry,
} from "./mentor-office.js";
import { mentorIdeaOutcome } from "./mentor-outcome.js";
import {
  MENTOR_PLAYBOOK,
  ideaByKey,
  ideaKeyInText,
  playbookIdeaPick,
} from "./mentor-playbook.js";
import {
  mentorDailyPlan,
  mentorWeeklyReview,
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

const entry = (
  liked: string[],
  dismissed: string[] = [],
  outcomes: OfficeEvidenceEntry["outcomes"] = [],
): OfficeEvidenceEntry => ({
  feedback: { liked, dismissed, marks: [] },
  outcomes,
});

const up = mentorIdeaOutcome(
  { key: "offers_sent:0", verdict: "helped", date: "2026-09-01" },
  { ...quiet, offers_sent: 2 },
  { ...quiet, offers_sent: 6 },
)!;
const flat = mentorIdeaOutcome(
  { key: "offers_sent:1", verdict: "helped", date: "2026-09-01" },
  { ...quiet, offers_sent: 3 },
  { ...quiet, offers_sent: 3 },
)!;

describe("ספר המשחק שלומד מהמשרד — ספירות, בלי שמות", () => {
  it("מדידה שווה שתיים, „עזר לי” אחת, „לא בשבילי” מוריד; רק חיובי הוא מוכח; מהחזק לחלש", () => {
    const office = officePlaybook([
      entry(["offers_sent:0", "offers_sent:1"], [], [up]),
      entry(["offers_sent:1", "offers_sent:1"], ["offers_sent:2"], [flat]),
      entry([], ["offers_sent:1"]),
      // רעיון שדחו יותר משאהבו — אינו מוכח; מפתח זר — מתעלמים
      entry(["calls_made:0", "nope:9"], ["offers_sent:2"]),
      // בלי שום עדות — לא נספר כמתווך שתרם
      entry([]),
    ]);
    expect(office.agents).toBe(4);
    // שוויון בציון — לפי המפתח, כדי שהסדר יציב
    expect(office.proven.map((e) => [e.key, e.score])).toEqual([
      ["offers_sent:0", 3],
      ["calls_made:0", 1],
      ["offers_sent:1", 1],
    ]);
    const first = office.proven[0]!;
    expect(first).toMatchObject({
      metric: "offers_sent",
      text: MENTOR_PLAYBOOK.offers_sent.ideas[0],
      helped: 1,
      up: 1,
      measured: 1,
    });
    expect(officeEvidenceLabel(first)).toBe("עזר לאחד · המספר עלה אצל אחד");
    expect(officeEvidenceLabel(office.proven[2]!)).toBe(
      "עזר ל-2 · אחד אמר לא בשבילו",
    );
    expect(officeProvenKeys(office, "offers_sent")).toEqual([
      "offers_sent:0",
      "offers_sent:1",
    ]);
    expect(officeProvenKeys(undefined, "offers_sent")).toEqual([]);
    expect(officePlaybook([])).toEqual(EMPTY_OFFICE_PLAYBOOK);
  });

  it("הבחירה: מוכח ראשון בשניים מכל שלושה ימים; מה שהמתווך עצמו דחה — לא", () => {
    const office = officePlaybook([entry(["offers_sent:3"], [], [up])]);
    // ימים 0 ו-1 — מהמוכחים; יום 2 — מהרשימה הרגילה
    const day0 = playbookIdeaPick("offers_sent", 0, undefined, office);
    const day1 = playbookIdeaPick("offers_sent", 1, undefined, office);
    const day2 = playbookIdeaPick("offers_sent", 2, undefined, office);
    expect([day0.key, day1.key]).toEqual(["offers_sent:0", "offers_sent:3"]);
    expect(day0.proven).toBe(true);
    expect(day0.text).toBe(ideaByKey("offers_sent:0")!.text);
    expect(day2.proven).toBeUndefined();
    // מה שנדחה על ידי המתווך עצמו אינו מוצע גם אם המשרד אהב אותו
    const mine = { liked: [], dismissed: ["offers_sent:0"], marks: [] };
    expect(playbookIdeaPick("offers_sent", 0, mine, office).key).toBe(
      "offers_sent:3",
    );
    // מדד בלי מוכחים — הרשימה הרגילה
    expect(
      playbookIdeaPick("calls_made", 0, undefined, office).proven,
    ).toBeUndefined();
  });

  it("העצה, הבוקר, הטיפ השבועי והמיקוד החודשי אומרים שזה עבד אצל אחרים", () => {
    const office = officePlaybook([entry([], [], [up])]);
    const goal: MentorGoalProgress = {
      metric: "offers_sent",
      period: "week",
      target: 5,
      actual: 1,
      ratio: 0.2,
      elapsed: 0.6,
      expected: 3,
      pace: "behind",
      remaining: 4,
      periodStart: new Date("2026-09-05T21:00:00.000Z"),
    };
    // יום שהזרע שלו אינו 2 מודולו 3
    const monday = new Date("2026-09-07T06:00:00.000Z");
    const advice = mentorAdvice({
      goals: [goal],
      activity: quiet,
      office,
      now: monday,
    });
    const proven = advice.find((a) => a.proven);
    expect(proven?.ideaKey).toBe("offers_sent:0");
    const plan = mentorDailyPlan({
      goals: [goal],
      now: monday,
      idea: MENTOR_PLAYBOOK.offers_sent.ideas[0]!,
      ideaProven: true,
    });
    expect(plan?.body).toContain("רעיון להיום — עבד אצל אחרים במשרד:");
    // השבוע שמתחיל 13.9 — הזרע שלו 2958, ואינו 2 מודולו 3
    const review = mentorWeeklyReview({
      weekStart: new Date("2026-09-12T21:00:00.000Z"),
      wins: [],
      activity: { ...quiet, offers_sent: 1 },
      goals: [goal],
      office,
    })!;
    const tip = review.paragraphs.find((p) => p.startsWith("טיפ לשבוע הבא"))!;
    expect(tip).toMatch(/^טיפ לשבוע הבא — עבד אצל אחרים במשרד: /u);
    expect(ideaKeyInText(tip)).toBe("offers_sent:0");
    // נובמבר 2026 (ה-1 בחודש הוא 31.10 ב-UTC) — הזרע 24321, ואינו 2 מודולו 3
    const monthly = mentorMonthlyReview({
      monthStart: new Date("2026-10-31T22:00:00.000Z"),
      activity: { ...quiet, offers_sent: 4 },
      wins: [],
      weeks: [
        {
          weekStart: new Date("2026-11-07T22:00:00.000Z"),
          goals: [
            {
              metric: "offers_sent",
              period: "week",
              target: 5,
              actual: 1,
              pace: "behind",
            },
          ],
        },
      ],
      marks: [],
      ideaOutcomes: [],
      office,
    })!;
    expect(monthly.paragraphs.at(-1)).toContain("טיפ (עבד אצל אחרים במשרד):");
  });

  it("הפרומפט: ידע משותף עם ספירות, לא השוואה; שקט כשאין", () => {
    const base = {
      firstName: "דנה",
      nowText: "יום שני",
      goals: [],
      lastReview: null,
      history: [],
      question: "מה לעשות היום?",
    };
    expect(officePlaybookBlock(undefined)).toEqual([]);
    expect(buildMentorPrompt(base)).not.toContain("הוכיחו את עצמם במשרד");
    const office = officePlaybook([
      entry(["offers_sent:0"], [], [up]),
      entry(["offers_sent:0"]),
    ]);
    const text = buildMentorPrompt({ ...base, office });
    expect(text).toContain(
      "רעיונות שהוכיחו את עצמם במשרד הזה (ספירות בלבד, בלי שמות",
    );
    expect(text).toContain(
      "- הצעות: „לקבוע שעה קבועה להצעות” — עזר ל-2 · המספר עלה אצל אחד",
    );
  });
});
