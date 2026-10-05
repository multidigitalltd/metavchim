import { describe, expect, it } from "vitest";
import { lastOffer } from "./history.js";
import { buildInterpretPrompt, type AgentHistoryTurn } from "./prompt.js";
import { AGENT_REPLY_MAX, agentReplyTurn } from "./result-lines.js";
import { InterpretResponseSchema } from "./schema.js";

/**
 * ‎**תשובה חופשית — וזיכרון שלה.**
 *
 * ## מה היה שבור
 *
 * הבוט ענה רק על ברכות, ובשתי שורות. שאלה מקצועית או „תנסח לי
 * הודעה ללקוח” נפלו ל„אולי התכוונתם ל…”, וכשכן ניתנה תשובה חופשית
 * היא לא נשמרה — ולכן „תן עוד דוגמה” הגיע למודל כאילו השיחה מתחילה
 * בו. בעל המוצר תיאר את זה כבוט „מקובע לתבניות תשובה”.
 */

const NOW = "יום שני, 5 באוקטובר 2026, 10:00";

describe("agentReplyTurn", () => {
  it("נשמר כתור שיחתי: בלי פעולה, בלי פרמטרים ובלי הצעה", () => {
    const turn = agentReplyTurn("איך עונים ללקוח שאומר שהמחיר גבוה?", "שאל אותו מול מה הוא משווה.");
    expect(turn).toEqual({
      transcript: "איך עונים ללקוח שאומר שהמחיר גבוה?",
      action: "unknown",
      params: {},
      reply: "שאל אותו מול מה הוא משווה.",
    });
    // „כן” אחרי תשובה חופשית אינו מריץ הצעה ישנה מתור קודם
    expect(lastOffer([{ ...turn }])).toBeNull();
  });

  // ‏תשובה שהוצגה שלמה נזכרת שלמה — „תקצר את הסוף” צריך את הסוף
  it("נשמרת שלמה עד תקרת התשובה עצמה, עם השורות שלה", () => {
    const full = `שורה ראשונה\n${"א".repeat(1000)}`;
    expect(agentReplyTurn("שאלה", full).reply).toBe(full);
    const over = agentReplyTurn("שאלה", "ב".repeat(AGENT_REPLY_MAX + 10));
    expect(over.reply).toHaveLength(AGENT_REPLY_MAX);
  });
});

describe("תשובה חופשית בפרומפט", () => {
  it("תור שיחתי מודפס כ„עניתי” ולא כפעולה שבוצעה", () => {
    const history: AgentHistoryTurn[] = [
      agentReplyTurn("תנסח לי הודעה ללקוח שלא ענה", "היי, רציתי לוודא שראית את הדירה ששלחתי."),
    ];
    const prompt = buildInterpretPrompt("תקצר", {
      nowText: NOW,
      allowedActions: ["search"],
      history,
    });
    expect(prompt).toContain('המתווך: "תנסח לי הודעה ללקוח שלא ענה"');
    expect(prompt).toContain('עניתי: "היי, רציתי לוודא שראית את הדירה ששלחתי."');
    expect(prompt).not.toContain("בוצע: unknown");
  });

  it("תשובה בכמה שורות מודפסת בשורה אחת — לא נשברת לשורות של השיחה", () => {
    const prompt = buildInterpretPrompt("תקצר", {
      nowText: NOW,
      allowedActions: ["search"],
      history: [agentReplyTurn("תנסח הודעה", "שלום רב,\nרציתי לעדכן")],
    });
    expect(prompt).toContain('עניתי: "שלום רב, רציתי לעדכן"');
  });

  it("השאלות החופשיות מותרות — עם הגבולות שמשאירים אותן בטוחות", () => {
    const prompt = buildInterpretPrompt("מה ההבדל בין בלעדיות לתיווך רגיל?", {
      nowText: NOW,
      allowedActions: ["search"],
    });
    expect(prompt).toContain("שאלה מקצועית");
    expect(prompt).toContain("בקשה לנסח טקסט");
    // לא מבצע, לא ממציא נתוני משרד
    expect(prompt).toContain("לעולם אינו מבצע דבר");
    expect(prompt).toContain("רק אם היא מופיעה בשיחה עד כה");
  });

  it("בוואטסאפ — עד שש שורות, לא שתיים", () => {
    const prompt = buildInterpretPrompt("שאלה", {
      nowText: NOW,
      allowedActions: ["search"],
      channel: "whatsapp",
    });
    expect(prompt).toContain("עד שש שורות קצרות");
    expect(prompt).not.toContain("שתי שורות לכל היותר");
  });
});

describe("תקרת התשובה", () => {
  const base = { action: "unknown" };

  it("תשובה מנוסחת באורך סביר נשמרת שלמה", () => {
    const reply = "ב".repeat(1000);
    const parsed = InterpretResponseSchema.parse({ ...base, reply });
    expect(parsed.reply).toBe(reply);
  });

  it("ארוכה מהתקרה — נחתכת ואינה נדחית", () => {
    const parsed = InterpretResponseSchema.parse({ ...base, reply: "ג".repeat(AGENT_REPLY_MAX + 50) });
    expect(parsed.reply).toHaveLength(AGENT_REPLY_MAX);
  });
});
