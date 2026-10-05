import { describe, expect, it } from "vitest";
import { fillFunnelPlaceholders, funnelEmail, type FunnelEmailCopy } from "./funnel.js";

/**
 * ‎**המייל של שלב — מה שהנמען מקבל, ולא עותק שלו.**
 *
 * ‏שליחת הבדיקה למנהל הפלטפורמה והשליחה האמיתית בונות את המייל באותה
 * ‏פונקציה. כאן נבדק מה הנמען רואה: מצייני המקום מוחלפים, פסקאות
 * ‏נשמרות, והכפתור מוביל לכתובת מלאה במערכת.
 */

const VALUES = { שם_פרטי: "דנה", שם_המשרד: "תיווך השרון" };
const ORIGIN = "https://app.example.test";

const COPY: FunnelEmailCopy = {
  emailSubject: "{{שם_פרטי}}, הנכס הראשון מחכה",
  emailHeading: "",
  emailBody: "שלום {{שם_פרטי}},\n\nב{{שם_המשרד}} עוד אין נכסים.\n\n\n  כדאי להתחיל.  ",
  ctaLabel: "להוספת נכס",
  ctaPath: "/properties/new",
};

describe("fillFunnelPlaceholders", () => {
  it("מחליף את המוכרים, גם עם רווחים בתוך הסוגריים", () => {
    expect(fillFunnelPlaceholders("{{ שם_פרטי }} מ{{שם_המשרד}}", VALUES)).toBe("דנה מתיווך השרון");
  });

  it("שם שאינו ברשימה נשאר כמו שהוא — לא נמחק בשקט", () => {
    expect(fillFunnelPlaceholders("{{שם_הסוכן}}", VALUES)).toBe("{{שם_הסוכן}}");
  });
});

describe("funnelEmail", () => {
  it("נושא, כותרת, פסקאות וכפתור — כפי שהנמען יראה", () => {
    expect(funnelEmail(COPY, VALUES, ORIGIN)).toEqual({
      subject: "דנה, הנכס הראשון מחכה",
      content: {
        // ‏בלי כותרת נפרדת — הנושא הוא הכותרת
        heading: "דנה, הנכס הראשון מחכה",
        paragraphs: ["שלום דנה,", "בתיווך השרון עוד אין נכסים.", "כדאי להתחיל."],
        button: { label: "להוספת נכס", url: "https://app.example.test/properties/new" },
      },
    });
  });

  it("בלי תווית או בלי נתיב — בלי כפתור", () => {
    expect(funnelEmail({ ...COPY, ctaPath: "" }, VALUES, ORIGIN)?.content.button).toBeUndefined();
    expect(funnelEmail({ ...COPY, ctaLabel: " " }, VALUES, ORIGIN)?.content.button).toBeUndefined();
  });

  it("בלי נושא או בלי גוף — אין מייל לשלוח", () => {
    expect(funnelEmail({ ...COPY, emailSubject: " " }, VALUES, ORIGIN)).toBeNull();
    expect(funnelEmail({ ...COPY, emailBody: "\n\n" }, VALUES, ORIGIN)).toBeNull();
  });
});
