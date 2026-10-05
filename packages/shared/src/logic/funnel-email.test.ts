import { describe, expect, it } from "vitest";
import {
  fillFunnelPlaceholders,
  funnelEmail,
  funnelFacts,
  funnelStageEnableBlock,
  isFunnelSendingTime,
  type FunnelEmailCopy,
} from "./funnel.js";
import type { OnboardingFacts } from "./onboarding.js";

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

describe("funnelEmail — עם מעקב", () => {
  const tracking = {
    clickUrl: "https://app.example.test/api/v1/public/funnel/c/TOKEN",
    pixelUrl: "https://app.example.test/api/v1/public/funnel/o/TOKEN",
    optOutUrl: "https://app.example.test/nudge-optout/OPT",
  };

  it("הכפתור עובר דרך כתובת הלחיצה, ויש פיקסל וקישור הסרה", () => {
    const email = funnelEmail(COPY, VALUES, ORIGIN, tracking)!;
    expect(email.content.button?.url).toBe(tracking.clickUrl);
    expect(email.content.pixel).toBe(tracking.pixelUrl);
    expect(email.content.footnote).toContain(tracking.optOutUrl);
  });

  it("בלי מעקב (הבדיקה למנהל) — אין פיקסל ואין קישור הסרה", () => {
    const email = funnelEmail(COPY, VALUES, ORIGIN)!;
    expect(email.content.pixel).toBeUndefined();
    expect(email.content.footnote).toBeUndefined();
  });
});

describe("funnelStageEnableBlock", () => {
  const ready = {
    track: "conversion",
    key: "d1_empty_screen",
    clock: "funnel",
    emailSubject: "נושא",
    emailBody: "גוף",
    unknownPlaceholders: [] as string[],
  };

  it("שלב המרה עם נוסח מלא — אפשר להדליק", () => {
    expect(funnelStageEnableBlock(ready)).toBeNull();
  });

  it("שעון הניסיון — חסום, כי תזכורות ההפעלה כבר שולחות", () => {
    expect(funnelStageEnableBlock({ ...ready, clock: "trial" })).toContain("כפולה");
  });

  it("שיחת ההיכרות — חסומה, כי היא כבר נשלחת מסבב משלה", () => {
    expect(funnelStageEnableBlock({ ...ready, key: "d5_intro_call" })).toContain("כפולה");
  });

  it("גבייה, נוסח חסר או מציין מקום לא מוכר — חסום", () => {
    expect(funnelStageEnableBlock({ ...ready, track: "dunning" })).not.toBeNull();
    expect(funnelStageEnableBlock({ ...ready, emailBody: " " })).not.toBeNull();
    expect(funnelStageEnableBlock({ ...ready, unknownPlaceholders: ["x"] })).not.toBeNull();
  });
});

describe("funnelFacts", () => {
  const onboarding: OnboardingFacts = {
    officeProfileComplete: true,
    activeUsers: 1,
    properties: 0,
    buyers: 0,
    leadWebhookConfigured: false,
    whatsappConfigured: false,
    emailDomainVerified: false,
    emailDomainAvailable: false,
    transcriptionAvailable: false,
  };
  const base = { calls: 0, hasValidCard: false, subscribed: false, trialActive: true, chargeFailing: false };

  it("משרד ריק: אין נכסים ואין נתונים, והצעד החיוני הבא פתוח", () => {
    expect(funnelFacts({ ...base, onboarding })).toMatchObject({
      hasProperties: false,
      hasData: false,
      nextStepPending: true,
      featureUnused: true,
    });
  });

  it("שיחה לבדה היא כבר נתונים", () => {
    expect(funnelFacts({ ...base, onboarding, calls: 2 }).hasData).toBe(true);
  });
});

describe("isFunnelSendingTime", () => {
  it("לפי שעון ירושלים — לא לפי שעון השרת", () => {
    // ‏07:00Z ביום שני = 10:00 בירושלים
    expect(isFunnelSendingTime(new Date("2026-10-05T07:00:00Z"))).toBe(true);
    // ‏05:00Z = 08:00 בירושלים, לפני החלון
    expect(isFunnelSendingTime(new Date("2026-10-05T05:00:00Z"))).toBe(false);
    // ‏שבת
    expect(isFunnelSendingTime(new Date("2026-10-10T07:00:00Z"))).toBe(false);
  });
});
