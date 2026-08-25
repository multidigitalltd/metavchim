import { describe, expect, it } from "vitest";
import { historySummary, summarizeData } from "./assistant-results";

const RESULTS = {
  buyers: [
    { name: "משה כהן", phone: "050-1234567" },
    { name: "דנה לוי", contactPhone: "050-7654321" },
  ],
};

describe("summarizeData", () => {
  it("שם וטלפון, שורה לכל תוצאה", () => {
    const text = summarizeData(RESULTS);
    expect(text).toContain("משה כהן · 050-1234567");
    expect(text).toContain("דנה לוי · 050-7654321");
  });

  it("תוצאה בלי טלפון מוצגת בשמה בלבד", () => {
    expect(summarizeData({ leads: [{ name: "שרה" }] })).toContain("• שרה");
  });

  it("מה שאין בו תוצאות מחזיר מחרוזת ריקה", () => {
    expect(summarizeData(undefined)).toBe("");
    expect(summarizeData({ card: { kind: "buyer" } })).toBe("");
  });
});

describe("historySummary", () => {
  it("שומר את הסדר והשמות — בלי זה „תקבע לראשון” נשבר", () => {
    const summary = historySummary("נמצאו 2 קונים", RESULTS);
    expect(summary).toContain("נמצאו 2 קונים");
    expect(summary).toContain("משה כהן, דנה לוי");
  });

  it("לא טלפון ולא אימייל — הזיכרון נשלח למודל חיצוני", () => {
    const summary = historySummary("נמצאו 2 קונים", RESULTS);
    expect(summary).not.toContain("050-1234567");
    expect(summary).not.toContain("050-7654321");
  });

  it("שדות הכרטיס המלא אינם נכנסים לזיכרון", () => {
    const summary = historySummary("הכרטיס של משה כהן", {
      card: {
        kind: "buyer",
        contact: { name: "משה כהן", phone: "050-1234567", email: "m@example.com" },
        agentNotes: "גמיש בקומה",
        calls: [{ id: "c1", summary: "דיבר על תקציב" }],
      },
    });
    expect(summary).toBe("הכרטיס של משה כהן");
  });

  it("תשובה בלי תוצאות נשמרת כמות שהיא, בשורה אחת", () => {
    expect(historySummary("הקונה נוצר\nבהצלחה", undefined)).toBe("הקונה נוצר בהצלחה");
  });

  it("נחתך לתקרת השדה בסכימת הנתיב", () => {
    expect(historySummary("א".repeat(900), undefined)).toHaveLength(600);
  });

  /*
   * שיחה ממספר לא מוכר מוצגת עם המספר — הוא בדיוק מה שדרוש כדי
   * לחזור אליו. אבל אז הוא גם הכותרת, והכותרות הן מה שנשמר לתור
   * הבא ונשלח לפרומפט של מודל חיצוני (ביקורת Codex).
   */
  it("מספר של מתקשר לא מוכר אינו נכנס לזיכרון", () => {
    const calls = {
      calls: [
        {
          id: "c1",
          direction: "inbound",
          contactPhone: "052-1111111",
          occurredAt: "2026-08-24T11:30:00Z",
          outcome: "missed",
        },
      ],
    };
    expect(summarizeData(calls)).toContain("052-1111111");
    const summary = historySummary("שיחה אחת אחרונה", calls);
    expect(summary).not.toContain("052-1111111");
    expect(summary).toContain("מספר לא מזוהה");
  });

  it("שמונה כותרות ארוכות נכנסות בשלמותן — בלי קטיעה באמצע שם", () => {
    const buyers = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      name: `${"א".repeat(120)}${i}`,
      cities: [],
    }));
    const summary = historySummary("נמצאו 8 קונים", { buyers });
    expect(summary.length).toBeLessThan(600);
    expect(summary.split(", ")).toHaveLength(8);
  });

  /*
   * מה שנשמר חוזר בתור הבא כביטוי מזהה, והחיפוש מוצא רשומה לפי
   * `name.includes(phrase)`. שם שנקטע באמצע מפני שההודעה הייתה
   * ארוכה הוא מפתח חיפוש שבור, וההודעה — לעומתו — היא ניסוח שהמודל
   * מייצר מחדש ממילא.
   */
  it("הודעה ארוכה נחתכת, והשמות נשארים שלמים", () => {
    const buyers = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      name: `קונה מספר ${i}`,
      cities: [],
    }));
    const summary = historySummary("א".repeat(900), { buyers });
    expect(summary).toHaveLength(600);
    expect(summary.endsWith("קונה מספר 7")).toBe(true);
  });
});
