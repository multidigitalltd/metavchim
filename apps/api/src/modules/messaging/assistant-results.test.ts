import { describe, expect, it } from "vitest";
import { summarizeData } from "./assistant-results";

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
