import { describe, expect, it } from "vitest";
import { ForumMailService } from "./forum-mail.service";

/**
 * מתי מגיע מייל — הכלל הטהור של סורק הדיוור.
 *
 * „מיידי” תמיד; „יומי” רק בשעת התקציר, ורק פעם ביום. שעון ישראל:
 * ‎08:30 בספטמבר הוא ‎05:30 UTC.
 */
const AT_0830_IL = new Date("2026-09-15T05:30:00.000Z");
const AT_1330_IL = new Date("2026-09-15T10:30:00.000Z");

describe("ForumMailService.due", () => {
  it("מייל כבוי — לעולם לא", () => {
    expect(ForumMailService.due({ email: false, digest: "instant", followAll: false }, null, AT_0830_IL)).toBe(false);
  });
  it("מיידי — בכל שעה", () => {
    expect(ForumMailService.due({ email: true, digest: "instant", followAll: false }, null, AT_1330_IL)).toBe(true);
  });
  it("יומי — רק ב-08:00 שעון ישראל, ורק אם לא נשלח היום", () => {
    const daily = { email: true, digest: "daily" as const, followAll: false };
    expect(ForumMailService.due(daily, null, AT_1330_IL)).toBe(false);
    expect(ForumMailService.due(daily, null, AT_0830_IL)).toBe(true);
    const tenMinutesAgo = new Date(AT_0830_IL.getTime() - 10 * 60 * 1000);
    expect(ForumMailService.due(daily, tenMinutesAgo, AT_0830_IL)).toBe(false);
    const yesterday = new Date(AT_0830_IL.getTime() - 24 * 60 * 60 * 1000);
    expect(ForumMailService.due(daily, yesterday, AT_0830_IL)).toBe(true);
  });
});
