import { describe, expect, it } from "vitest";
import { dailyBriefBody } from "./daily-brief.js";

// ‎10:00 שעון ישראל בקיץ (UTC+3)
const AT_TEN = new Date("2026-08-28T07:00:00Z");

describe("דו\"ח הבוקר — תדריך, לא מונה", () => {
  it("בוקר ריק אינו הודעה", () => {
    expect(dailyBriefBody({ meetings: { count: 0 }, tasks: 0, waitingLeads: 0 })).toBeNull();
  });

  it("הפגישה הראשונה נאמרת בסוג ובשעה — לא רק בספירה", () => {
    const brief = dailyBriefBody({
      meetings: { count: 3, first: { startsAt: AT_TEN, kind: "viewing" } },
      tasks: 0,
      waitingLeads: 2,
    });
    expect(brief?.body).toContain("3 פגישות היום, הראשונה — סיור ב-10:00");
    expect(brief?.body).toContain("2 לידים ממתינים למענה");
    // ההזמנה לשאול — הסוכן הוא הדרך להמשיך, לא „הדשבורד מחכה לכם”
    expect(brief?.body).toContain("„מה יש לי היום?”");
  });

  it("יחיד מנוסח כיחיד", () => {
    const brief = dailyBriefBody({
      meetings: { count: 1, first: { startsAt: AT_TEN, kind: "meeting" } },
      tasks: 1,
      waitingLeads: 1,
    });
    expect(brief?.body).toContain("פגישה אחת היום — פגישה ב-10:00");
    expect(brief?.body).toContain("משימה אחת להיום");
    expect(brief?.body).toContain("ליד אחד ממתין למענה");
  });
});
