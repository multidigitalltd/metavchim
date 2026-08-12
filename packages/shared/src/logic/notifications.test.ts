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
