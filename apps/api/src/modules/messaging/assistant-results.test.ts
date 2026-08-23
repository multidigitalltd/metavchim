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
});
