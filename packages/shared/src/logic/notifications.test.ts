import { describe, expect, it } from "vitest";
import { notificationFromEvent } from "./notifications.js";

const TENANT = "01KYJH6YN3B48PJS8WK2HFQ98Y";
const ID = "01KYJHBB71E85DWX3NDPJ5BYZY";

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

  it("התאמות: רק כשיש תוצאות ולנכס ספציפי", () => {
    expect(notificationFromEvent("matches.computed", { tenantId: TENANT, propertyId: ID, matchCount: 0 })).toBeNull();
    const n = notificationFromEvent("matches.computed", { tenantId: TENANT, propertyId: ID, matchCount: 17 });
    expect(n?.title).toContain("17");
  });

  it("אירוע לא ממופה ⇒ null", () => {
    expect(notificationFromEvent("property.ready", { propertyId: ID, tenantId: TENANT, readinessScore: 90 })).toBeNull();
  });
});
