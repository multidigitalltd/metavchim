import { describe, expect, it } from "vitest";
import { notificationFromEvent } from "./notifications.js";

const TENANT = "01KYJH6YN3B48PJS8WK2HFQ98Y";
const ID = "01KYJHBB71E85DWX3NDPJ5BYZY";
const OWNER = "01KYJHBB71E85DWX3NDPJ5BZZZ";

describe("notificationFromEvent", () => {
  it("קונה מעוניין ⇒ התראה דחופה", () => {
    const n = notificationFromEvent("offer.interested", { offerId: ID, tenantId: TENANT });
    expect(n?.type).toBe("offer_interested");
    expect(n?.title).toContain("מעוניין");
  });

  it("פתיחה שלישית ⇒ 'הוא מתלבט' (אפיון §4)", () => {
    const n = notificationFromEvent("offer.opened", { offerId: ID, tenantId: TENANT, openCount: 3 });
    expect(n?.body).toContain("מתלבט");
  });

  it("ליד רגיל ⇒ אין התראה; requiresHuman ⇒ יש", () => {
    expect(
      notificationFromEvent("lead.created", { leadId: ID, tenantId: TENANT, source: "whatsapp", requiresHuman: false }),
    ).toBeNull();
    expect(
      notificationFromEvent("lead.created", { leadId: ID, tenantId: TENANT, source: "voice_call", requiresHuman: true })?.type,
    ).toBe("lead_requires_human");
  });

  it("התאמות: מתריעים על חדשות בלבד", () => {
    /*
     * הלב של השינוי. חישוב ההתאמות רץ בכל עריכה, ורובן מסתיימות
     * באותן התאמות שכבר היו — התראה עליהן מלמדת את הסוכן להתעלם.
     */
    expect(
      notificationFromEvent("matches.computed", {
        tenantId: TENANT,
        propertyId: ID,
        matchCount: 17,
        newMatchCount: 0,
        strongMatchCount: 0,
      }),
    ).toBeNull();

    const n = notificationFromEvent("matches.computed", {
      tenantId: TENANT,
      propertyId: ID,
      matchCount: 17,
      newMatchCount: 3,
      strongMatchCount: 0,
    });
    expect(n?.title).toContain("3"); // החדשות, לא ה-17
    expect(n?.title).not.toContain("17");
    expect(n?.entityType).toBe("property");
    expect(n?.recipientUserId).toBeUndefined(); // נכס = כל המשרד
  });

  it("התאמות: צד הקונה מתריע לסוכן שהכרטיס שלו", () => {
    // הכיוון הזה שתק לגמרי — המיפוי דרש propertyId
    const n = notificationFromEvent("matches.computed", {
      tenantId: TENANT,
      buyerId: ID,
      ownerUserId: OWNER,
      matchCount: 4,
      newMatchCount: 2,
      strongMatchCount: 1,
    });
    expect(n?.entityType).toBe("buyer");
    expect(n?.recipientUserId).toBe(OWNER);
    expect(n?.title).toContain("2");
    expect(n?.body).toContain("גבוהה"); // ההתאמה החזקה מוזכרת
  });

  it("התאמות: ביקוש בלי בעלים ⇒ התראה משרדית", () => {
    const n = notificationFromEvent("matches.computed", {
      tenantId: TENANT,
      buyerId: ID,
      matchCount: 1,
      newMatchCount: 1,
      strongMatchCount: 0,
    });
    expect(n?.recipientUserId).toBeUndefined();
    expect(n?.title).toContain("נכס חדש"); // לשון יחיד
  });

  it("התאמות: אירוע בלי נכס ובלי קונה אינו מתריע", () => {
    expect(
      notificationFromEvent("matches.computed", {
        tenantId: TENANT,
        matchCount: 5,
        newMatchCount: 5,
        strongMatchCount: 5,
      }),
    ).toBeNull();
  });

  it("ליד נמכר בשוק ⇒ התראה למוכר עם הסכום", () => {
    const n = notificationFromEvent("shared_lead.sold", {
      sharedLeadId: ID,
      tenantId: TENANT,
      priceCredits: 3,
    });
    expect(n?.type).toBe("shared_lead_sold");
    expect(n?.tenantId).toBe(TENANT);
    expect(n?.body).toContain("3 קרדיטים");
  });

  it("אירוע לא ממופה ⇒ null", () => {
    expect(notificationFromEvent("property.ready", { propertyId: ID, tenantId: TENANT, readinessScore: 90 })).toBeNull();
  });
});

/*
 * הזדמנות שנפתחה. אותו אירוע כמו "התאמות חדשות" — ההבדל היחיד הוא
 * ה-trigger, ולכן הבדיקות ממוקדות בו: שהוא משנה את הניסוח, שהוא
 * מציג את המספר החדש, ושבלעדיו שום דבר לא משתנה.
 */
describe("התאמות שנפתחו בעקבות שינוי מסחרי", () => {
  it("ירידת מחיר — ההודעה מדברת על ההורדה ולא על 'קונים חדשים'", () => {
    const n = notificationFromEvent("matches.computed", {
      tenantId: "01J000000000000000000000AA",
      propertyId: "01J000000000000000000000BB",
      matchCount: 5,
      newMatchCount: 3,
      strongMatchCount: 1,
      trigger: { kind: "price_drop", fromAgorot: 200_000_000, toAgorot: 190_000_000 },
    });
    expect(n?.type).toBe("opportunity_opened");
    expect(n?.title).toContain("הורדת המחיר");
    expect(n?.title).toContain("3 התאמות");
    expect(n?.body).toContain("1,900,000");
    expect(n?.entityType).toBe("property");
  });

  it("העלאת תקציב — ההתראה אישית לסוכן שהכרטיס שלו", () => {
    const n = notificationFromEvent("matches.computed", {
      tenantId: "01J000000000000000000000AA",
      buyerId: "01J000000000000000000000CC",
      ownerUserId: "01J000000000000000000000DD",
      matchCount: 2,
      newMatchCount: 1,
      strongMatchCount: 0,
      trigger: { kind: "budget_raise", fromAgorot: 180_000_000, toAgorot: 220_000_000 },
    });
    expect(n?.title).toContain("העלאת התקציב");
    expect(n?.title).toContain("התאמה אחת");
    expect(n?.recipientUserId).toBe("01J000000000000000000000DD");
  });

  it("שינוי שלא פתח כלום אינו מתריע — גם כשהמחיר ירד", () => {
    expect(
      notificationFromEvent("matches.computed", {
        tenantId: "01J000000000000000000000AA",
        propertyId: "01J000000000000000000000BB",
        matchCount: 4,
        newMatchCount: 0,
        strongMatchCount: 0,
        trigger: { kind: "price_drop", fromAgorot: 200_000_000, toAgorot: 190_000_000 },
      }),
    ).toBeNull();
  });

  it("בלי trigger — הניסוח הרגיל נשמר", () => {
    const n = notificationFromEvent("matches.computed", {
      tenantId: "01J000000000000000000000AA",
      propertyId: "01J000000000000000000000BB",
      matchCount: 3,
      newMatchCount: 3,
      strongMatchCount: 0,
    });
    expect(n?.type).toBe("matches_found");
  });
});

describe("ניסוח יחיד ורבים בהתאמה חזקה", () => {
  it("התאמה אחת שהיא חזקה — לא '1 מהן'", () => {
    const n = notificationFromEvent("matches.computed", {
      tenantId: "01J000000000000000000000AA",
      propertyId: "01J000000000000000000000BB",
      matchCount: 1,
      newMatchCount: 1,
      strongMatchCount: 1,
    });
    expect(n?.body).toContain("ההתאמה ברמה גבוהה");
    expect(n?.body).not.toContain("1 מהן");
  });

  it("כמה התאמות — הספירה נשארת", () => {
    const n = notificationFromEvent("matches.computed", {
      tenantId: "01J000000000000000000000AA",
      propertyId: "01J000000000000000000000BB",
      matchCount: 4,
      newMatchCount: 3,
      strongMatchCount: 2,
    });
    expect(n?.body).toContain("2 מהן");
  });
});
