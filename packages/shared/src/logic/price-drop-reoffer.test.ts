import { describe, expect, it } from "vitest";
import { priceDropReofferMessage, priceDropStillFresh } from "./price-drop-reoffer.js";

describe("הצעה חוזרת אחרי הורדת מחיר", () => {
  it("ההודעה נושאת את שני המחירים ואת שם הנכס, עם שם הקונה כשיש", () => {
    const text = priceDropReofferMessage({ name: "דנה", propertyLabel: "ויטל 7, תל אביב", fromAgorot: 250_000_000, toAgorot: 235_000_000 });
    expect(text.startsWith("היי דנה,")).toBe(true);
    expect(text).toContain("ויטל 7, תל אביב");
    expect(text).toContain("2,500,000");
    expect(text).toContain("2,350,000");
    expect(priceDropReofferMessage({ propertyLabel: "הנכס", fromAgorot: 100, toAgorot: 50 }).startsWith("היי,")).toBe(true);
  });
  it("החלון: 30 יום", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(priceDropStillFresh(new Date("2026-09-01T00:00:00Z"), now)).toBe(true);
    expect(priceDropStillFresh(new Date("2026-08-30T00:00:00Z"), now)).toBe(false);
  });
});
