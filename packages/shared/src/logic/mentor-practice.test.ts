import { describe, expect, it } from "vitest";
import {
  PRACTICE_GENERIC_CHECKS,
  PRACTICE_SCENARIO_INFO,
  PRACTICE_SCENARIOS,
  buildPracticeFeedbackPrompt,
  buildPracticeReplyPrompt,
  practiceChecklist,
  practiceChecklistScore,
  practiceFallbackFeedback,
  practiceFallbackReply,
  practiceModelFeedback,
  practiceOpening,
  practiceScenario,
  type PracticeTurn,
} from "./mentor-practice.js";

const PLURAL = /אתם|שלכם|לכם|כתבו|לחצו|קבעו|תם[.,!?:]|תם$/u;
const GENDERED = /\bאתה\b|\bאת\b(?! ה)/u;

describe("תרחישי התרגול", () => {
  it("שישה תרחישים, לכל אחד דמות, פתיח, מטרה, שלוש תשובות גיבוי, בדיקה וטיפ", () => {
    expect(PRACTICE_SCENARIO_INFO.map((s) => s.code)).toEqual([
      ...PRACTICE_SCENARIOS,
    ]);
    for (const s of PRACTICE_SCENARIO_INFO) {
      expect(s.label.length).toBeGreaterThan(3);
      expect(s.opening.length).toBeGreaterThan(20);
      expect(s.fallbackLines).toHaveLength(3);
      expect(s.tip).toMatch(/^לנסות בשיחה הבאה: „/u);
      // הטיפ פונה למתווך — בלי רבים ובלי מין; הדמות מדברת על עצמה
      expect(s.tip, s.code).not.toMatch(PLURAL);
      expect(s.goal, s.code).not.toMatch(PLURAL);
      expect(s.goal, s.code).not.toMatch(GENDERED);
      expect(s.blurb, s.code).not.toMatch(GENDERED);
    }
    expect(practiceScenario("seller_price")?.counterpart.name).toBe("יוסי");
    expect(practiceScenario("nope")).toBeNull();
  });

  it("הפתיח הוא של הדמות; בלי מודל — שלוש התשובות לפי הסדר, ואז מהתחלה", () => {
    const s = practiceScenario("seller_price")!;
    expect(practiceOpening(s)).toEqual({
      role: "counterpart",
      text: s.opening,
    });
    expect(practiceFallbackReply(s, 1)).toBe(s.fallbackLines[0]);
    expect(practiceFallbackReply(s, 3)).toBe(s.fallbackLines[2]);
    expect(practiceFallbackReply(s, 4)).toBe(s.fallbackLines[0]);
  });
});

describe("הרשימה של הקוד — מה בדקנו בשיחה", () => {
  const s = practiceScenario("seller_price")!;
  const turns = (...agent: string[]): PracticeTurn[] => [
    practiceOpening(s),
    ...agent.map((text): PracticeTurn => ({ role: "agent", text })),
  ];

  it("חמש בדיקות כלליות ואחת של התרחיש; בלי תורים — הכול לא", () => {
    expect(PRACTICE_GENERIC_CHECKS.map((c) => c.key)).toEqual([
      "listened",
      "asked",
      "evidence",
      "next_step",
      "held",
    ]);
    const empty = practiceChecklist(s, [practiceOpening(s)]);
    expect(empty).toHaveLength(6);
    expect(empty.every((c) => !c.met)).toBe(true);
    for (const c of empty) expect(c.label, c.key).not.toMatch(PLURAL);
  });

  it("שיחה טובה — הקשבה, שאלה, נתון, צעד הבא, בלי ויתור, ועיגון בעסקאות", () => {
    const list = practiceChecklist(
      s,
      turns(
        "אני מבין למה 2.3 של השכן מרגיש כמו הרצפה. מה השתנה בדירה מאז השיפוץ?",
        "הנה שלוש עסקאות דומות מהרחוב — 2.1, 2.15 ו-2.2 בחצי השנה האחרונה. נכס שמתחיל גבוה יושב 90 ימים בשוק.",
        "בוא נתחיל ב-2.25 ונקבע פגישה בעוד שבועיים לבדוק את התגובות.",
      ),
    );
    expect(list.every((c) => c.met)).toBe(true);
    expect(practiceChecklistScore(list)).toBe(5);
  });

  it("התקפלות במשפט הראשון נתפסת; שאלה בלבד — ציון נמוך אבל לא אפס", () => {
    const caved = practiceChecklist(
      s,
      turns("בסדר, נוריד את המחיר ל-2.4 כמו שביקשת."),
    );
    expect(caved.find((c) => c.key === "held")?.met).toBe(false);
    const thin = practiceChecklist(s, turns("למה?"));
    expect(thin.filter((c) => c.met).map((c) => c.key)).toEqual([
      "asked",
      "held",
    ]);
    expect(practiceChecklistScore(thin)).toBe(2);
    expect(practiceChecklistScore([])).toBe(1);
  });

  it("הבדיקה של כל תרחיש תופסת את המשפט הנכון", () => {
    const hits: Record<string, string> = {
      seller_price: "יש שלוש עסקאות דומות ברחוב",
      seller_exclusive: "הנה תוכנית השיווק לשבועיים הראשונים",
      buyer_hesitant: "מה באמת מפריע לך?",
      buyer_lowball: "על מה ההצעה מבוססת?",
      lead_cold: "איזה אזור מעניין אותך?",
      commission: "מה העמלה כוללת — משא ומתן וקונים מוכנים",
    };
    for (const info of PRACTICE_SCENARIO_INFO) {
      const list = practiceChecklist(info, [
        practiceOpening(info),
        { role: "agent", text: hits[info.code]! },
      ]);
      expect(list.at(-1)?.met, info.code).toBe(true);
    }
  });
});

describe("המשוב", () => {
  const s = practiceScenario("buyer_hesitant")!;
  const turns: PracticeTurn[] = [
    practiceOpening(s),
    { role: "agent", text: "ברור, החלטה גדולה. מה הכי מטריד עכשיו?" },
    { role: "counterpart", text: "המשכנתא יצאה יותר ממה שחשבנו." },
    { role: "agent", text: "מבין. אפשר לקבוע שיחה עם יועץ משכנתאות מחר?" },
  ];

  it("בלי מודל — הרשימה כפי שהיא, הטיפ של התרחיש, והציון מהרשימה", () => {
    const fb = practiceFallbackFeedback(s, turns);
    expect(fb.source).toBe("checklist");
    expect(fb.worked).toContain("שאלת מה באמת עוצר");
    expect(fb.worked).toContain("הקשבת לפני שענית");
    expect(fb.missed).toContain("הבאת נתון או דוגמה");
    expect(fb.tryNext).toBe(s.tip);
    expect(fb.score).toBe(4);
    expect(fb.checklist).toHaveLength(6);
  });

  it("עם מודל — עד שלושה בכל רשימה, ציון בין 1 ל-5, והרשימה של הקוד נשארת", () => {
    const checklist = practiceChecklist(s, turns);
    const fb = practiceModelFeedback(
      {
        worked: ["א", "ב", "ג", "ד"],
        missed: [],
        tryNext: "„מה היה גורם לך להרגיש בטוח?”",
        score: 9,
      },
      checklist,
    );
    expect(fb.worked).toHaveLength(3);
    expect(fb.score).toBe(5);
    expect(fb.source).toBe("model");
    expect(fb.checklist).toBe(checklist);
  });

  it("הפרומפטים — הדמות בגוף ראשון ולא מדריכה; המשוב בקול המנטור עם הרשימה והסגנון", () => {
    const reply = buildPracticeReplyPrompt(s, turns);
    expect(reply).toContain("אתם רוני");
    expect(reply).toContain("לא יוצאים מהתפקיד");
    expect(reply).toContain("רוני: אהבנו את הדירה");
    expect(reply).toContain("המתווך: ברור, החלטה גדולה");
    expect(reply).toContain(s.counterpart.convincedBy);
    const feedback = buildPracticeFeedbackPrompt(
      s,
      turns,
      practiceChecklist(s, turns),
      { name: "נועה", style: "direct" },
    );
    expect(feedback).toContain("הסגנון שהמתווך בחר: ישיר");
    expect(feedback).toContain("„נועה”");
    expect(feedback).toContain("- שאלת מה באמת עוצר: כן");
    expect(feedback).toContain("- הבאת נתון או דוגמה: לא");
    expect(feedback).toContain(s.goal);
  });
});

describe("התרגול בסיכום השבועי ובשיחה", () => {
  it("משפט אחד כשתרגלו; שקט כשלא", async () => {
    const { mentorPracticeSentence, mentorWeeklyReview } =
      await import("./mentor.js");
    expect(mentorPracticeSentence(undefined)).toBeNull();
    expect(mentorPracticeSentence({ count: 0, lastScore: null })).toBeNull();
    expect(mentorPracticeSentence({ count: 1, lastScore: 4 })).toBe(
      "תרגלת השבוע שיחה אחת עם המנטור. הציון האחרון: 4 מתוך 5. תרגול הוא מה שהופך ידע להרגל.",
    );
    expect(mentorPracticeSentence({ count: 2, lastScore: null })).toBe(
      "תרגלת השבוע שתי שיחות עם המנטור. תרגול הוא מה שהופך ידע להרגל.",
    );
    const quiet = {
      deals_closed: 0,
      offers_sent: 3,
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
    const review = mentorWeeklyReview({
      weekStart: new Date("2026-09-05T21:00:00.000Z"),
      wins: [],
      activity: quiet,
      goals: [],
      practice: { count: 3, lastScore: 5 },
    });
    expect(review?.paragraphs).toContain(
      "תרגלת השבוע 3 שיחות עם המנטור. הציון האחרון: 5 מתוך 5. תרגול הוא מה שהופך ידע להרגל.",
    );
    // שבוע שבו רק תרגלו — עדיין מקבל סיכום (ביקורת Codex)
    const onlyPractice = mentorWeeklyReview({
      weekStart: new Date("2026-09-05T21:00:00.000Z"),
      wins: [],
      activity: { ...quiet, offers_sent: 0 },
      goals: [],
      practice: { count: 1, lastScore: 3 },
    });
    expect(onlyPractice?.paragraphs).toEqual([
      "תרגלת השבוע שיחה אחת עם המנטור. הציון האחרון: 3 מתוך 5. תרגול הוא מה שהופך ידע להרגל.",
    ]);
  });

  it("הפרומפט של השיחה יודע מה המנטור אמר לנסות", async () => {
    const { buildMentorPrompt } = await import("./mentor-chat.js");
    const base = {
      firstName: "דנה",
      nowText: "יום שני",
      goals: [],
      lastReview: null,
      history: [],
      question: "מה לעשות היום?",
    };
    expect(buildMentorPrompt(base)).not.toContain("התרגול האחרון");
    const text = buildMentorPrompt({
      ...base,
      lastPractice: {
        scenarioLabel: "מוכר על המחיר",
        score: 3,
        tryNext: "„הנה שלוש עסקאות מהרחוב”",
      },
    });
    expect(text).toContain(
      "התרגול האחרון של המתווך (מוכר על המחיר, ציון 3 מתוך 5)",
    );
    expect(text).toContain("„הנה שלוש עסקאות מהרחוב”");
  });
});
