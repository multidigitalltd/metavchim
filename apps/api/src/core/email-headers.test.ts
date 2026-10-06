import { describe, expect, it } from "vitest";
import { AUTO_SUBMITTED_HEADER, emailHeaders } from "./email.service";

/**
 * ‎**הכותרות נגזרות מהתוכן — ואין דרך לשכוח אחת מהן.**
 *
 * ‏`List-Unsubscribe` עם `List-Unsubscribe-Post` (RFC 8058) הוא מה שמציג
 * ‏את כפתור „ביטול הרשמה” של Gmail ו-Outlook. הוא יוצא בכל דיוור שיש בו
 * ‏נתיב הסרה בלחיצה אחת, ורק בו.
 */
describe("emailHeaders", () => {
  const unsubscribe = {
    reason: "קיבלתם את ההודעה כי פתחתם חשבון.",
    label: "להפסקת ההודעות",
    url: "https://app.example.test/nudge-optout/tok",
    oneClickUrl: "https://app.example.test/api/v1/public/nudge/tok/optout",
  };

  it("דיוור עם נתיב לחיצה אחת — שתי הכותרות, והנתיב בסוגריים זוויתיים", () => {
    expect(emailHeaders({ paragraphs: [], unsubscribe })).toEqual({
      Headers: [
        { Name: "List-Unsubscribe", Value: `<${unsubscribe.oneClickUrl}>` },
        { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
      ],
    });
  });

  it("קישור לדף בלבד (מייל הבדיקה) — בלי כותרת", () => {
    const { oneClickUrl: _omit, ...pageOnly } = unsubscribe;
    expect(emailHeaders({ paragraphs: [], unsubscribe: pageOnly })).toEqual({});
  });

  it("הודעה רגילה — בלי כותרות כלל", () => {
    expect(emailHeaders({ paragraphs: [] })).toEqual({});
  });

  it("הודעה אוטומטית עם קישור הסרה — שתיהן יחד, ואף אחת לא דורסת", () => {
    expect(emailHeaders({ paragraphs: [], unsubscribe }, true).Headers).toEqual([
      AUTO_SUBMITTED_HEADER,
      { Name: "List-Unsubscribe", Value: `<${unsubscribe.oneClickUrl}>` },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ]);
  });
});
