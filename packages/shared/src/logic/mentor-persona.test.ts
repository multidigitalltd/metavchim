import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENTOR_PERSONA,
  MENTOR_STYLES,
  MENTOR_STYLE_INFO,
  mentorCadence,
  mentorCloser,
  mentorHasName,
  mentorSalutation,
  mentorStyleGuidance,
  mentorWeeklyGreeting,
  resolveMentorPersona,
} from "./mentor-persona.js";
import {
  mentorDailyPlan,
  mentorMidweekNudge,
  mentorWeeklyReview,
} from "./mentor.js";
import { buildMentorPrompt } from "./mentor-chat.js";
import { MentorPersonaSchema } from "../schemas/mentor.js";
import type { MentorActivity, MentorGoalProgress } from "./mentor.js";

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

const behindGoal: MentorGoalProgress = {
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

const PLURAL = /אתם|שלכם|לכם|כתבו|לחצו|קבעו|תם[.,!?:]|תם$/u;
const GENDERED = /\bאתה\b|\bאת\b(?! ה)/u;

describe("resolveMentorPersona — מה-preferences, סלחני", () => {
  it("חסר, פגום או ריק — ברירת המחדל; שם ארוך נחתך; סגנון זר נופל ל„תומך”", () => {
    expect(resolveMentorPersona(undefined)).toEqual(DEFAULT_MENTOR_PERSONA);
    expect(resolveMentorPersona({ a11y: {} })).toEqual(DEFAULT_MENTOR_PERSONA);
    expect(resolveMentorPersona({ mentor: "נועה" })).toEqual(
      DEFAULT_MENTOR_PERSONA,
    );
    expect(
      resolveMentorPersona({ mentor: { name: "  ", style: "direct" } }),
    ).toEqual({
      name: "המנטור",
      style: "direct",
    });
    expect(
      resolveMentorPersona({ mentor: { name: "נ".repeat(40), style: "loud" } }),
    ).toEqual({
      name: "נ".repeat(24),
      style: "warm",
    });
    expect(
      resolveMentorPersona({ mentor: { name: " נועה ", style: "calm" } }),
    ).toEqual({
      name: "נועה",
      style: "calm",
    });
  });

  it("הסכמה לשמירה: שם 1–24 תווים וסגנון מהרשימה; שדה זר נדחה", () => {
    expect(
      MentorPersonaSchema.safeParse({ name: "נועה", style: "analytic" })
        .success,
    ).toBe(true);
    expect(
      MentorPersonaSchema.safeParse({ name: "", style: "warm" }).success,
    ).toBe(false);
    expect(
      MentorPersonaSchema.safeParse({ name: "נועה", style: "loud" }).success,
    ).toBe(false);
    expect(
      MentorPersonaSchema.safeParse({ name: "נועה", style: "warm", x: 1 })
        .success,
    ).toBe(false);
  });

  it("שם — רק כשהמתווך נתן אחד; „המנטור” אינו שם", () => {
    expect(mentorHasName(DEFAULT_MENTOR_PERSONA)).toBe(false);
    expect(mentorHasName({ name: "נועה", style: "warm" })).toBe(true);
    expect(mentorSalutation("בוקר טוב", "דנה", DEFAULT_MENTOR_PERSONA)).toBe(
      "בוקר טוב דנה.",
    );
    expect(
      mentorSalutation("בוקר טוב", "דנה", { name: "נועה", style: "warm" }),
    ).toBe("בוקר טוב דנה, כאן נועה.");
    expect(
      mentorSalutation("בוקר טוב", undefined, { name: "נועה", style: "warm" }),
    ).toBe("בוקר טוב, כאן נועה.");
  });
});

describe("הסגנון משנה איך אומרים — לא מה", () => {
  it("לכל סגנון תווית, תיאור ודוגמה — וכולם בקול של המנטור", () => {
    expect(MENTOR_STYLE_INFO.map((s) => s.code)).toEqual([...MENTOR_STYLES]);
    for (const style of MENTOR_STYLES) {
      const info = MENTOR_STYLE_INFO.find((s) => s.code === style)!;
      const texts = [
        info.blurb,
        info.sample,
        mentorCloser(style, true),
        mentorCloser(style, false),
        mentorStyleGuidance(style),
        mentorWeeklyGreeting({ name: "נועה", style }, "encourage", "דנה") ?? "",
      ];
      for (const text of texts) {
        expect(text, `${style}: ${text}`).not.toMatch(PLURAL);
        expect(text, `${style}: ${text}`).not.toMatch(GENDERED);
      }
    }
    // חמישה סיומים שונים לפיגור — לא אותו משפט בכולם
    expect(new Set(MENTOR_STYLES.map((s) => mentorCloser(s, true))).size).toBe(
      5,
    );
  });

  it("הבוקר: הפתיח בשם המנטור, הסיום לפי הסגנון; הרגוע בלי בוקר", () => {
    const monday = new Date("2026-09-07T06:00:00.000Z");
    const direct = mentorDailyPlan({
      goals: [behindGoal],
      now: monday,
      firstName: "דנה",
      persona: { name: "נועה", style: "direct" },
    });
    expect(direct?.body).toMatch(/^בוקר טוב דנה, כאן נועה\. /u);
    expect(direct?.body).toMatch(/זה בהישג יד\. לעבודה\.$/u);
    const warm = mentorDailyPlan({
      goals: [behindGoal],
      now: monday,
      firstName: "דנה",
    });
    expect(warm?.body).toMatch(/^בוקר טוב דנה\. /u);
    expect(warm?.body).toMatch(/ואני איתך\.$/u);
    expect(mentorCadence("calm").morning).toBe(false);
    expect(mentorCadence("warm").morning).toBe(true);
  });

  it("הסיכום: הפתיח לפי הסגנון ומצב הרוח; בלי שם פרטי — בלי פתיח", () => {
    const signals = {
      weekStart: new Date("2026-09-05T21:00:00.000Z"),
      wins: [],
      activity: { ...quiet, offers_sent: 1 },
      goals: [behindGoal],
      firstName: "דנה",
    };
    expect(mentorWeeklyReview(signals)?.greeting).toBe(
      "היי דנה, הנה השבוע שלך — נעבור עליו ביחד.",
    );
    expect(
      mentorWeeklyReview({
        ...signals,
        persona: { name: "נועה", style: "challenging" },
      })?.greeting,
    ).toBe("היי דנה, כאן נועה. השבוע לא יצא. השבוע הבא הוא ההזדמנות.");
    expect(
      mentorWeeklyReview({
        ...signals,
        persona: { name: "המנטור", style: "analytic" },
      })?.greeting,
    ).toBe("היי דנה, המספרים של השבוע.");
    expect(
      mentorWeeklyReview({ ...signals, firstName: "" })?.greeting,
    ).toBeNull();
    // הגוף אינו משתנה עם הסגנון — הכללים נשארים
    expect(
      mentorWeeklyReview({
        ...signals,
        persona: { name: "נועה", style: "direct" },
      })?.paragraphs,
    ).toEqual(mentorWeeklyReview(signals)?.paragraphs);
  });

  it("הדחיפה: הסיום לפי הסגנון", () => {
    const wednesday = new Date("2026-09-09T10:00:00.000Z");
    expect(
      mentorMidweekNudge([behindGoal], wednesday, "דנה", {
        name: "נועה",
        style: "calm",
      })?.body,
    ).toMatch(/צעד אחד היום מספיק\.$/u);
    expect(mentorMidweekNudge([behindGoal], wednesday, "דנה")?.body).toMatch(
      /ואני איתך\.$/u,
    );
  });

  it("השיחה: כלל 12 עם הנחיית הסגנון, והשם שהמתווך נתן", () => {
    const base = {
      firstName: "דנה",
      nowText: "יום שני",
      goals: [],
      lastReview: null,
      history: [],
      question: "מה לעשות היום?",
    };
    const named = buildMentorPrompt({
      ...base,
      persona: { name: "נועה", style: "analytic" },
    });
    expect(named).toContain("12. הסגנון שהמתווך בחר: אנליטי.");
    expect(named).toContain("השם שהמתווך נתן לכם: „נועה”");
    const plain = buildMentorPrompt(base);
    expect(plain).toContain("12. הסגנון שהמתווך בחר: תומך.");
    expect(plain).toContain("אין לכם שם");
  });
});
