import { describe, expect, it } from "vitest";
import {
  buildMentorPrompt,
  mentorFallbackReply,
  type MentorChatContext,
} from "./mentor-chat.js";
import type { MentorGoalProgress } from "./mentor.js";

const goal: MentorGoalProgress = {
  metric: "offers_sent",
  period: "week",
  target: 5,
  actual: 2,
  ratio: 0.4,
  elapsed: 0.8,
  expected: 4,
  pace: "behind",
  remaining: 3,
  why: "הדירה של הילדים",
  intention: "כל בוקר ב-11:00",
};

const base: MentorChatContext = {
  firstName: "דנה",
  nowText: "יום שלישי, 8 בספטמבר 2026, 10:00",
  goals: [goal],
  lastReview: {
    mood: "encourage",
    headline: "לא הגעתם ליעד השבוע — והוא עדיין שלכם",
    paragraphs: ["5 הצעות בשבוע: 2 הצעות. חסרו 3 הצעות ליעד שקבעתם."],
    askNextWeek: "לשבוע הבא: 5 הצעות בשבוע.",
    ask: { metric: "offers_sent", period: "week", target: 5 },
    reflection: "מה עצר את ההצעות השבוע?",
    weekLabel: "שבוע שעבר",
    reflectionAnswer: null,
  },
  history: [
    { role: "user", text: "איך היה השבוע?" },
    { role: "mentor", text: "שבוע של 2 הצעות מתוך 5." },
  ],
  question: "מה כדאי לי לעשות היום?",
};

describe("buildMentorPrompt — מה המודל מקבל", () => {
  it("כולל את הכללים, היעדים עם הלמה והתוכנית, הסיכום, השאלה והשיחה", () => {
    const prompt = buildMentorPrompt(base);
    expect(prompt).toContain("לעולם לא מול עמיתים");
    expect(prompt).toContain("5 הצעות בשבוע: 2 הצעות עד עכשיו — מאחור");
    expect(prompt).toContain("הלמה: „הדירה של הילדים”");
    expect(prompt).toContain("התוכנית: „כל בוקר ב-11:00”");
    expect(prompt).toContain("„לא הגעתם ליעד השבוע — והוא עדיין שלכם”");
    expect(prompt).toContain("המתווך טרם ענה.");
    expect(prompt).toContain("המתווך: איך היה השבוע?");
    expect(prompt).toContain("המתווך שואל עכשיו: „מה כדאי לי לעשות היום?”");
    expect(prompt).toContain("שדה reply בלבד");
  });

  it("בלי יעדים ובלי סיכום — אומר זאת במפורש ואינו ממציא", () => {
    const prompt = buildMentorPrompt({
      ...base,
      goals: [],
      lastReview: null,
      history: [],
    });
    expect(prompt).toContain("אין יעדים פעילים.");
    expect(prompt).not.toContain("הסיכום השבועי האחרון");
    expect(prompt).not.toContain("השיחה עד כה");
  });

  it("אין בפרומפט שום דבר שאינו מהקשר המנטור — לא טלפון ולא שם לקוח", () => {
    const prompt = buildMentorPrompt(base);
    expect(prompt).not.toMatch(/05\d-?\d{7}/);
    expect(prompt).toContain("אין לכם גישה ללקוחות");
  });
});

describe("mentorFallbackReply — כשאין מודל", () => {
  it("עם יעדים: מצב היעדים והמיקוד, ואומר שהשיחה אינה זמינה", () => {
    const reply = mentorFallbackReply(base);
    expect(reply).toContain("אינה זמינה כרגע");
    expect(reply).toContain("5 הצעות בשבוע — 2 הצעות, מאחור");
    expect(reply).toContain("המיקוד עכשיו: הצעות שנשלחו");
  });

  it("בלי יעדים אבל עם סיכום: הסיכום האחרון", () => {
    const reply = mentorFallbackReply({ ...base, goals: [] });
    expect(reply).toContain("„לא הגעתם ליעד השבוע — והוא עדיין שלכם”");
  });

  it("בלי כלום: הזמנה לקבוע יעד", () => {
    expect(
      mentorFallbackReply({ ...base, goals: [], lastReview: null }),
    ).toContain("קבעו יעד אחד");
  });
});
