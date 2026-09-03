import { describe, expect, it } from "vitest";
import {
  cleanFeedback,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_SUGGESTIONS,
  feedbackCopy,
  goalReachedCopy,
  goalReachedDedupeKey,
} from "./mentor-feedback.js";

describe("ההודעה למנהל", () => {
  const lines = [
    { label: "שיחות", committed: 40, actual: 42 },
    { label: "פגישות", committed: 5, actual: 6 },
  ];

  /**
   * ‎**המספרים הם כל ההבדל.** „דנה עמדה ביעד” היא כותרת שאפשר רק
   * לאשר; „42 מתוך 40 שיחות” היא משהו שאפשר להגיב עליו.
   */
  it("נושאת את המספרים עצמם ולא רק את הבשורה", () => {
    const copy = goalReachedCopy({ agentName: "דנה", percent: 105, lines });
    expect(copy.title).toContain("דנה");
    expect(copy.body).toContain("שיחות 42/40");
    expect(copy.body).toContain("פגישות 6/5");
  });

  it("בלי פירוט — עדיין אומרת מה קרה, ולא נשארת ריקה", () => {
    const copy = goalReachedCopy({ agentName: "דנה", percent: 100, lines: [] });
    expect(copy.body).toContain("100%");
    expect(copy.body.length).toBeGreaterThan(5);
  });

  /**
   * ‏שני מנהלים מקבלים כל אחד הודעה אחת, ואותו מנהל אינו מקבל
   * שתיים על אותו שבוע. האילוץ במסד הוא שמכריע, ולכן המפתח חייב
   * לשאת את שלושת המרכיבים.
   */
  it("מפתח הייחודיות מפריד בין מנהלים, בין סוכנים ובין שבועות", () => {
    const a = goalReachedDedupeKey("AGENT1", "2026-08-30", "MANAGER1");
    expect(a).not.toBe(goalReachedDedupeKey("AGENT1", "2026-08-30", "MANAGER2"));
    expect(a).not.toBe(goalReachedDedupeKey("AGENT2", "2026-08-30", "MANAGER1"));
    expect(a).not.toBe(goalReachedDedupeKey("AGENT1", "2026-09-06", "MANAGER1"));
    expect(a).toBe(goalReachedDedupeKey("AGENT1", "2026-08-30", "MANAGER1"));
  });

  it("המפתח נכנס בעמודה של 120 תווים גם עם שני ULIDים", () => {
    const key = goalReachedDedupeKey("0".repeat(26), "2026-08-30", "1".repeat(26));
    expect(key.length).toBeLessThanOrEqual(120);
  });
});

describe("המשפטים המוכנים", () => {
  /**
   * ‎**שבח על מאמץ ולא על תכונה.** „אתה סוכן מעולה” מייצר פחד לאבד
   * את התואר; „מה שעשית השבוע” מייצר עוד מאמץ. הבדיקה שומרת על
   * הניסוח מפני „שיפור” עתידי שיחזיר שבח על אדם.
   */
  it("מנוסחים סביב הפעולה, לא סביב האדם", () => {
    expect(FEEDBACK_SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
    for (const line of FEEDBACK_SUGGESTIONS) {
      expect(line).not.toMatch(/אתה סוכן|את סוכנת|מוכשר|כישרון/u);
      expect(line.length).toBeLessThanOrEqual(FEEDBACK_MAX_LENGTH);
    }
  });

  it("שלושה, ולא רשימה שהופכת לבחירה", () => {
    expect(FEEDBACK_SUGGESTIONS.length).toBeLessThanOrEqual(4);
  });
});

describe("ניקוי הפידבק", () => {
  /** ‏שתיקה אינה הודעה: טקסט ריק לא ייצור אצל הסוכן התראה חלולה. */
  it("טקסט ריק אינו פידבק", () => {
    expect(cleanFeedback("")).toBeNull();
    expect(cleanFeedback("   ")).toBeNull();
    expect(cleanFeedback("\n\t  \n")).toBeNull();
  });

  it("רווחים מתקפלים והטקסט נחתך לגבול", () => {
    expect(cleanFeedback("  שתי   מילים  ")).toBe("שתי מילים");
    expect(cleanFeedback("א".repeat(500))?.length).toBe(FEEDBACK_MAX_LENGTH);
  });

  it("המשפטים המוכנים עוברים את הניקוי בלי להשתנות", () => {
    for (const line of FEEDBACK_SUGGESTIONS) {
      expect(cleanFeedback(line)).toBe(line);
    }
  });
});

describe("ההודעה לסוכן", () => {
  it("נושאת את מי שכתב ואת מה שנכתב", () => {
    const copy = feedbackCopy("רון", "עבודה עקבית השבוע");
    expect(copy.title).toContain("רון");
    expect(copy.body).toBe("עבודה עקבית השבוע");
  });
});
