import { describe, expect, it } from "vitest";
import {
  nextViewingFeedbackField,
  parseViewingFeedbackCommand,
  summarizeViewingFeedback,
  viewingFeedbackCommand,
  viewingFeedbackSentences,
} from "./viewing-feedback.js";

describe("סיכום המשוב מביקורים", () => {
  it("סופר רק ערכים מהרשימה, וביקור נספר פעם אחת גם עם שלוש תשובות", () => {
    const s = summarizeViewingFeedback([
      { price: "high", condition: "needs_work", fit: "location" },
      { price: "high", condition: null, fit: null },
      { price: "weird", condition: null, fit: null },
      { price: null, condition: null, fit: null },
    ]);
    expect(s.withFeedback).toBe(2);
    expect(s.asked).toEqual({ price: 2, condition: 1, fit: 1 });
    expect(s.price).toEqual({ high: 2, fair: 0, low: 0 });
    expect(s.condition.needs_work).toBe(1);
    expect(s.fit.location).toBe(1);
  });
  it("המשפטים למוכר — מחיר קודם, „מתוך” במקום אחוזים, וכלום כשאין משוב", () => {
    expect(viewingFeedbackSentences(summarizeViewingFeedback([]))).toEqual([]);
    const lines = viewingFeedbackSentences(
      summarizeViewingFeedback([
        { price: "high", condition: "needs_work", fit: "size" },
        { price: "high", condition: "good", fit: "fits" },
        { price: "fair", condition: null, fit: null },
      ]),
    );
    expect(lines[0]).toBe("2 מתוך 3 אמרו שהמחיר גבוה");
    expect(lines).toContain("1 מתוך 3 אמרו שהמחיר הוגן");
    expect(lines).toContain("אחד ציין שהנכס דורש שיפוץ");
    expect(lines).toContain("לאחד הגודל לא התאים");
    expect(lines).toContain("אחד אמר שהנכס מתאים להם");
  });
});

describe("כפתורי הוואטסאפ אחרי הסיור", () => {
  const ID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
  it("הפקודה נושאת את הסיור, השדה והתשובה — והפענוח מחזיר אותם", () => {
    const cmd = viewingFeedbackCommand(ID, "price", "high");
    expect(cmd).toBe(`משוב סיור: המחיר גבוה [${ID}:price:high]`);
    expect(parseViewingFeedbackCommand(cmd)).toEqual({ appointmentId: ID, field: "price", value: "high" });
    expect(parseViewingFeedbackCommand(viewingFeedbackCommand(ID, "fit", "layout"))).toEqual({ appointmentId: ID, field: "fit", value: "layout" });
  });
  it("ערך שאינו ברשימה, או טקסט אחר — אינו פקודה", () => {
    expect(parseViewingFeedbackCommand(`משוב סיור: משהו [${ID}:price:cheap]`)).toBeNull();
    expect(parseViewingFeedbackCommand("איך היה הסיור?")).toBeNull();
  });
  it("השאלה הבאה — לפי מה שחסר, ו-null כשהכול נענה", () => {
    expect(nextViewingFeedbackField({ price: null, condition: null, fit: null })).toBe("price");
    expect(nextViewingFeedbackField({ price: "high", condition: null, fit: null })).toBe("condition");
    expect(nextViewingFeedbackField({ price: "high", condition: "good", fit: null })).toBe("fit");
    expect(nextViewingFeedbackField({ price: "high", condition: "good", fit: "fits" })).toBeNull();
  });
});

describe("המכנה הוא מי שנשאל על השאלה, לא כל מי שהשאיר משוב", () => {
  it("ביקור שענה רק על מצב הנכס אינו נספר במכנה של המחיר", () => {
    const s = summarizeViewingFeedback([
      { price: "high", condition: null, fit: null },
      { price: null, condition: "needs_work", fit: null },
      { price: null, condition: null, fit: null },
    ]);
    expect(s.withFeedback).toBe(2);
    expect(s.asked).toEqual({ price: 1, condition: 1, fit: 0 });
    const sentences = viewingFeedbackSentences(s);
    expect(sentences).toContain("1 מתוך 1 אמרו שהמחיר גבוה");
    expect(sentences.some((line) => line.includes("מתוך 2"))).toBe(false);
  });
});
