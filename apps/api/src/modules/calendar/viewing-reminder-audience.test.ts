import { describe, expect, it } from "vitest";
import { ViewingReminderService } from "./viewing-reminder.service";

/**
 * ‏למי יוצאת תזכורת הסיור: הקונה — או, כשאין קונה, **הליד** של הסיור.
 * ‏מבקר בבית פתוח הוא ליד עם סיור, ובלי הענף הזה הוא היה המבקר
 * ‏היחיד במערכת שאינו מקבל תזכורת.
 */
const TENANT = "01TENANT00000000000000000A";

function service(rows: { buyer?: { contactId: string }; lead?: { contactId: string } }) {
  const tx = {
    property: { findFirst: async () => ({ street: "ויטל", houseNumber: "41", city: "תל אביב", occupancy: null, occupantContactId: null, ownerContactId: null }) },
    buyer: { findFirst: async () => rows.buyer ?? null },
    lead: { findFirst: async () => rows.lead ?? null },
    contact: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, optedOutAt: null })) },
  };
  const prisma = { withExplicitTenant: async <T>(_t: string, fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx) };
  const contacts = {
    getByIds: async (_tx: unknown, ids: readonly string[]) => new Map(ids.map((id) => [id, { name: `איש ${id}`, phone: "0501234567", email: undefined }])),
  };
  const svc = new ViewingReminderService(prisma as never, {} as never, {} as never, contacts as never, {} as never);
  return svc as unknown as {
    audience: (tenantId: string, a: { buyerId: string | null; leadId: string | null; propertyId: string | null }) => Promise<{ recipients: { audience: string; contactId: string }[] }>;
  };
}

describe("תזכורת לסיור — הנמען בצד הקונה", () => {
  it("סיור של קונה — הקונה", async () => {
    const { recipients } = await service({ buyer: { contactId: "C-BUYER" } }).audience(TENANT, { buyerId: "B1", leadId: null, propertyId: "P1" });
    expect(recipients.map((r) => [r.audience, r.contactId])).toEqual([["buyer", "C-BUYER"]]);
  });

  it("סיור של ליד (בית פתוח) — הליד מקבל את נוסח הקונה", async () => {
    const { recipients } = await service({ lead: { contactId: "C-LEAD" } }).audience(TENANT, { buyerId: null, leadId: "L1", propertyId: "P1" });
    expect(recipients.map((r) => [r.audience, r.contactId])).toEqual([["buyer", "C-LEAD"]]);
  });

  it("בלי קונה ובלי ליד — אין נמען בצד הקונה", async () => {
    const { recipients } = await service({}).audience(TENANT, { buyerId: null, leadId: null, propertyId: "P1" });
    expect(recipients).toEqual([]);
  });
});
