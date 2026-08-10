import { describe, expect, it } from "vitest";
import { sharedLeadPrice } from "./lead-marketplace.js";
import { DEFAULT_LEAD_SOURCES } from "./collaboration-cost.js";

describe("sharedLeadPrice", () => {
  it("מקור מתומחר — המחיר מהטבלה", () => {
    expect(sharedLeadPrice("kanko", DEFAULT_LEAD_SOURCES)).toBe(1);
    expect(
      sharedLeadPrice("facebook", [{ source: "facebook", label: "פייסבוק", creditsCost: 5 }]),
    ).toBe(5);
  });

  it("מקור חינמי בביקושים אינו חינמי בשוק — רצפה של קרדיט", () => {
    /*
     * network מתומחר 0 בהצעות על ביקושים (שת"פ בין משרדים חינם),
     * אבל ליד שנמכר הוא איש קשר אמיתי — מכירה ב-0 משאירה את המוכר
     * בלי כלום ואת השוק בלי סיבה לשתף.
     */
    expect(sharedLeadPrice("network", DEFAULT_LEAD_SOURCES)).toBe(1);
  });

  it("מקור לא מתומחר — ברירת המחדל בתשלום, לא חינם", () => {
    expect(sharedLeadPrice("web_form", DEFAULT_LEAD_SOURCES)).toBeGreaterThanOrEqual(1);
  });

  it("תמחור פגום (שלילי) לא הופך למחיר שלילי", () => {
    expect(
      sharedLeadPrice("bad", [{ source: "bad", label: "פגום", creditsCost: -3 }]),
    ).toBe(1);
  });
});
