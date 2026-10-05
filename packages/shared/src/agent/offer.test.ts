import { describe, expect, it } from "vitest";
import { lastOffer } from "./history.js";
import { buildInterpretPrompt } from "./prompt.js";
import type { AgentHistoryTurn } from "./prompt.js";

/**
 * ‎**„כן” על מה שהסוכן הרגע הציע.**
 *
 * ## מה היה שבור
 *
 * הסוכן סיים תשובה ב„רוצה שנעבור על המשימות הפתוחות שלך להיום?”,
 * המתווך ענה „כן”, והסוכן השיב **„במה אוכל לעזור?”** — כלומר שאל
 * בדיוק את מה שהוא עצמו הרגע הציע (דיווח מהשטח).
 *
 * הסיבה: ההצעה נוסחה בתשובה שנשלחה ולא נשמרה בשום מקום. זיכרון
 * השיחה שומר מה **המתווך** אמר ומה יצא מהפעולה, ולכן „כן” הגיע
 * למודל אחרי תור שבו נאמר „תציג לי לידים ממתינים” — בלי שום דבר
 * להסכים לו.
 */

const turn = (over: Partial<AgentHistoryTurn> = {}): AgentHistoryTurn => ({
  transcript: "תציג לי את הלידים שממתינים",
  action: "show_leads",
  params: {},
  resultSummary: "אין לידים בסטטוס ממתין ללקוח",
  ...over,
});

describe("lastOffer", () => {
  it("מחזירה את המשפט שהוצע בתור האחרון", () => {
    expect(lastOffer([turn({ offer: "מה המשימות שלי להיום?" })])).toBe(
      "מה המשימות שלי להיום?",
    );
  });

  it("בלי הצעה — null, ו„כן” ממשיך במסלול הרגיל", () => {
    expect(lastOffer([turn()])).toBeNull();
    expect(lastOffer([])).toBeNull();
  });

  /*
   * ‎**לא סורקת אחורה, ובכוונה.** „כן” אחרי שיחה שלמה על משהו
   * אחר שחוזר להצעה מלפני עשרה תורות הוא בדיוק סוג ההפתעה שגורמת
   * למתווך להפסיק לענות „כן”.
   */
  it("רק ההצעה האחרונה — לא אחת ישנה שנקברה מאז", () => {
    expect(
      lastOffer([turn({ offer: "מה המשימות שלי להיום?" }), turn({ transcript: "תוסיף קונה" })]),
    ).toBeNull();
  });

  it("הצעה ריקה נחשבת כאין", () => {
    expect(lastOffer([turn({ offer: "   " })])).toBeNull();
  });
});

describe("ההצעה בפרומפט", () => {
  /*
   * הענף הדטרמיניסטי תופס „כן” בדיוק; הפרומפט הוא מה שמכסה את
   * „בטח”, „קדימה” ו„כן בבקשה”. שניהם מצביעים לאותו מקום.
   */
  it("המודל רואה מה הוצע, ולכן „כן” אינו תלוש", () => {
    const prompt = buildInterpretPrompt("כן", {
      nowText: "יום חמישי, 9:35",
      allowedActions: ["show_tasks", "show_leads"],
      history: [turn({ offer: "מה המשימות שלי להיום?" })],
      channel: "whatsapp",
    });
    expect(prompt).toContain("הצעתי:");
    expect(prompt).toContain("מה המשימות שלי להיום?");
  });

  it("תור בלי הצעה אינו מוסיף שורה ריקה לפרומפט", () => {
    const prompt = buildInterpretPrompt("כן", {
      nowText: "יום חמישי, 9:35",
      allowedActions: ["show_tasks"],
      history: [turn()],
      channel: "whatsapp",
    });
    expect(prompt).not.toContain("הצעתי");
  });
});
