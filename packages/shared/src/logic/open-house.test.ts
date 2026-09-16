import { describe, expect, it } from "vitest";
import {
  isOpenHouseSlot,
  openHouseInviteMessage,
  openHouseSentence,
  openHouseSlots,
  openHouseWhen,
  slotAvailability,
} from "./open-house.js";

describe("בית פתוח — משבצות", () => {
  const start = new Date("2026-09-22T14:00:00Z"); // 17:00 בישראל
  const end = new Date("2026-09-22T16:00:00Z");

  it("משבצות שלמות בלבד, ולפי האורך שנבחר", () => {
    expect(openHouseSlots(start, end, 30).map((d) => d.toISOString())).toEqual([
      "2026-09-22T14:00:00.000Z", "2026-09-22T14:30:00.000Z", "2026-09-22T15:00:00.000Z", "2026-09-22T15:30:00.000Z",
    ]);
    /* ‏45 דקות בשעתיים — שתיים, והשלישית לא נכנסת */
    expect(openHouseSlots(start, end, 45)).toHaveLength(2);
    expect(openHouseSlots(start, end, 0)).toEqual([]);
  });

  it("מועד הוא משבצת רק אם הוא על הרשת ובתוך האירוע", () => {
    expect(isOpenHouseSlot(new Date("2026-09-22T14:30:00Z"), start, end, 30)).toBe(true);
    expect(isOpenHouseSlot(new Date("2026-09-22T14:20:00Z"), start, end, 30)).toBe(false);
    expect(isOpenHouseSlot(new Date("2026-09-22T15:45:00Z"), start, end, 30)).toBe(false);
    expect(isOpenHouseSlot(new Date("2026-09-22T13:30:00Z"), start, end, 30)).toBe(false);
  });

  it("זמינות: קיבולת פחות נרשמים, ובלי קיבולת — null", () => {
    const slots = openHouseSlots(start, end, 60);
    const taken = new Map([["2026-09-22T14:00:00.000Z", 3]]);
    expect(slotAvailability(slots, taken, 3).map((s) => s.remaining)).toEqual([0, 3]);
    expect(slotAvailability(slots, taken, null).map((s) => [s.registered, s.remaining])).toEqual([[3, null], [0, null]]);
  });

  it("ניסוחים בשעון ישראל", () => {
    expect(openHouseWhen(start, end)).toContain("17:00–19:00");
    const invite = openHouseInviteMessage({ propertyLabel: "ויטל 41", startsAt: start, endsAt: end, priceAgorot: 250_000_000, url: "https://x/p/t", officeName: "משרד" });
    expect(invite).toContain("2,500,000 ₪");
    expect(invite).toContain("https://x/p/t");
    expect(openHouseSentence({ startsAt: start, registered: 12, arrived: 1 })).toBe("בית פתוח ב-22.9: 12 נרשמו, אחד הגיע.");
  });
});
