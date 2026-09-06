import { describe, expect, it, test } from "vitest";
import {
  MENTOR_REPLY_JSON_SCHEMA,
  buildMentorPrompt,
  mentorFallbackReply,
  parseGoalRequest,
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
    ).toContain("לקבוע יעד אחד");
  });
});

test("התוכנית שנולדה מהרפלקציה נכנסת לפרומפט", () => {
  const prompt = buildMentorPrompt({
    ...base,
    lastReview: {
      ...base.lastReview!,
      reflectionAnswer: "לא היה זמן",
      plan: "כשלא נשאר זמן — אז ההצעות ראשונות בבוקר",
    },
  });
  expect(prompt).toContain("תשובת המתווך: „לא היה זמן”");
  expect(prompt).toContain(
    "התוכנית שהמתווך קבע למקרה שזה יקרה שוב: „כשלא נשאר זמן — אז ההצעות ראשונות בבוקר”",
  );
});

test("הדפוסים נכנסים לפרומפט כזיכרון — במילים של המתווך", () => {
  const prompt = buildMentorPrompt({
    ...base,
    patterns: [
      {
        kind: "recurring_behind",
        metric: "offers_sent",
        weeksBehind: 3,
        weeksWithGoal: 5,
        answers: ["לא היה זמן"],
        plans: [],
      },
    ],
  });
  expect(prompt).toContain("מה שהמנטור זוכר מהחודשיים האחרונים");
  expect(prompt).toContain(
    "הצעות שנשלחו: מאחור ב-3 מתוך 5 השבועות האחרונים. בפעמים הקודמות אמרת: „לא היה זמן”.",
  );
});

describe("השיחה מייעצת — הניתוח והמשפך בפרומפט, והעצה גם בלי מודל", () => {
  const quiet = {
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
  const advised: MentorChatContext = {
    ...base,
    activity: { ...quiet, offers_sent: 2 },
    previousActivity: { ...quiet, offers_sent: 5 },
    funnel: {
      history: { ...quiet, new_buyers: 6, offers_sent: 18, viewings_held: 3 },
      weeks: 13,
    },
    advice: [
      {
        kind: "behind_goal",
        metric: "offers_sent",
        title: "5 הצעות בשבוע: 2 הצעות עד עכשיו — מאחור",
        body: "לקבוע שעה קבועה להצעות.",
        question: "איך להגיע ל5 הצעות בשבוע?",
      },
    ],
  };

  it("הפרומפט: כללי העצה, הפעילות, המגמה, המשפך מול המקובל והניתוח", () => {
    const prompt = buildMentorPrompt(advised);
    expect(prompt).toContain("10. כשמבקשים עצה, רעיון, טיפ");
    expect(prompt).toContain("11. כששואלים על המשפך");
    expect(prompt).toContain("השבוע עד עכשיו: 2 הצעות.");
    expect(prompt).toContain("מול שבוע שעבר: פחות הצעות שנשלחו (5 ⟵ 2).");
    expect(prompt).toContain("הצעה ⟵ סיור: כל 6 (מקובל: כל 3)");
    expect(prompt).toContain(
      "- 5 הצעות בשבוע: 2 הצעות עד עכשיו — מאחור. לקבוע שעה קבועה להצעות.",
    );
    expect(prompt).toContain("רעיונות מספר המשחק");
  });

  it("בלי פעילות בהקשר (קורא ישן) — הפרומפט כמו קודם, בלי ניתוח", () => {
    expect(buildMentorPrompt(base)).not.toContain("השבוע עד עכשיו");
  });

  it("בלי מודל — העצה הראשונה מצטרפת למצב היעדים, וגם בלי יעדים", () => {
    const withGoals = mentorFallbackReply(advised);
    expect(withGoals).toContain("5 הצעות בשבוע — 2 הצעות, מאחור.");
    expect(withGoals).toMatch(/מאחור\. לקבוע שעה קבועה להצעות\.$/u);
    const noGoals = mentorFallbackReply({ ...advised, goals: [] });
    expect(noGoals).toContain("אינה זמינה כרגע");
    expect(noGoals).toContain("לקבוע שעה קבועה להצעות.");
    expect(noGoals).not.toContain("עדיין אין לך יעדים");
  });
});

describe("יעד מהשיחה — המודל מציע, המתווך לוחץ, הקוד כותב", () => {
  it("הסכמה מקבלת proposedGoal רשות, והפרומפט אומר מתי למלא אותו ומה הקודים", () => {
    const props = MENTOR_REPLY_JSON_SCHEMA.properties as Record<
      string,
      unknown
    >;
    expect(props.proposedGoal).toBeDefined();
    expect(MENTOR_REPLY_JSON_SCHEMA.required).toEqual(["reply"]);
    const prompt = buildMentorPrompt(base);
    expect(prompt).toContain("ממלאים proposedGoal");
    expect(prompt).toContain("offers_sent = הצעות שנשלחו");
    expect(prompt).toContain(
      "יעד שהמתווך רק שוקל או שואל עליו — בלי proposedGoal",
    );
  });

  it("parseGoalRequest: בקשה מפורשת עם מספר ומדד — יעד; שבוע כברירת מחדל", () => {
    expect(parseGoalRequest("תקבע לי יעד של 5 הצעות בשבוע")).toEqual({
      metric: "offers_sent",
      target: 5,
      period: "week",
    });
    expect(parseGoalRequest("רוצה יעד: 3 סיורים")).toEqual({
      metric: "viewings_held",
      target: 3,
      period: "week",
    });
    expect(parseGoalRequest("היעד שלי החודש: עסקה אחת")).toEqual({
      metric: "deals_closed",
      target: 1,
      period: "month",
    });
    expect(parseGoalRequest("תקבע לי יעד של עסקה בחודש")).toEqual({
      metric: "deals_closed",
      target: 1,
      period: "month",
    });
    expect(parseGoalRequest("להגדיר יעד של עשר שיחות יוצאות בשבוע")).toEqual({
      metric: "calls_made",
      target: 10,
      period: "week",
    });
    // הספציפי קודם — שיחות נכנסות אינן שיחות יוצאות; „תוך שעה” אינו לידים
    expect(parseGoalRequest("תקבע יעד 8 שיחות נכנסות בשבוע")?.metric).toBe(
      "calls_answered",
    );
    expect(parseGoalRequest("יעד: 4 לידים תוך שעה בשבוע")?.metric).toBe(
      "leads_answered_fast",
    );
  });

  it("parseGoalRequest: שאלה על יעדים, בלי מספר, בלי מדד, או מעל הגבול — null", () => {
    expect(parseGoalRequest("כמה הצעות שלחתי השבוע?")).toBeNull();
    expect(parseGoalRequest("מה המצב ביעדים שלי?")).toBeNull();
    expect(parseGoalRequest("תקבע לי יעד")).toBeNull();
    expect(parseGoalRequest("תקבע לי יעד של 5 בשבוע")).toBeNull();
    expect(parseGoalRequest("תקבע לי יעד של 999 הצעות בשבוע")).toBeNull();
  });
});
