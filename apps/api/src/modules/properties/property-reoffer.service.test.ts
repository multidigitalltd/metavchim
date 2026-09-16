import { describe, expect, it } from "vitest";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PropertyReofferService } from "./property-reoffer.service";

/**
 * ‏שתי דלתות, שתי יכולות: הרשימה והסימון נוגעים בנכס **ובקונה**, ולכן
 * ‏כל אחת מהן דורשת גם `properties.view` וגם יכולת קונים — הדקורטור
 * ‏מאחד ב„או”, והשירות משלים ל„וגם” (ביקורת Codex).
 */

const TENANT = "01TENANT00000000000000000A";
const ME = "01USERME000000000000000000";
const PROPERTY = "01PROPERTY000000000000000A";
const BUYER = "01BUYERMINE00000000000000A";
const CHANGED = new Date(Date.now() - 2 * 86_400_000);

function service(options: { status?: string; contactedBefore?: boolean } = {}) {
  const created: string[] = [];
  const tx = {
    property: {
      findFirst: async () => ({
        status: options.status ?? "active",
        priceAgorot: 240_000_000n,
        previousPriceAgorot: 250_000_000n,
        priceChangedAt: CHANGED,
        marketingTitle: null, street: "ויטל", houseNumber: "41", city: "תל אביב",
      }),
    },
    buyer: { findFirst: async () => ({ id: BUYER }), findMany: async () => [] },
    appointment: { findMany: async () => [] },
    match: { findMany: async () => [] },
    interaction: {
      findFirst: async () => (options.contactedBefore ? { id: "01INT" } : null),
      findMany: async () => [],
      create: async ({ data }: { data: { id: string } }) => { created.push(data.id); return data; },
    },
    $queryRaw: async () => [],
  };
  const prisma = { withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx) };
  const contacts = { getByIds: async () => new Map() };
  const audit = { record: async () => undefined };
  return { svc: new PropertyReofferService(prisma as never, contacts as never, audit as never), created };
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run({ tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false }, fn);
}

describe("הצעה חוזרת — יכולות ומצב הנכס", () => {
  it("בלי מודול הנכסים: 403 גם לרשימה וגם לסימון, אף שיכולת הקונים קיימת", async () => {
    const { svc } = service();
    await expect(asUser(["buyers.view_own", "offers.send"], () => svc.candidates(PROPERTY))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(asUser(["buyers.view_all", "offers.send"], () => svc.markContacted(PROPERTY, BUYER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("בלי יכולת קונים: 403 גם עם offers.send", async () => {
    const { svc } = service();
    await expect(asUser(["properties.view", "offers.send"], () => svc.markContacted(PROPERTY, BUYER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("נכס שנמכר: אין רשימה, והסימון נדחה", async () => {
    const { svc, created } = service({ status: "sold" });
    const dto = await asUser(["properties.view", "buyers.view_all"], () => svc.candidates(PROPERTY));
    expect(dto.drop).toBeNull();
    await expect(asUser(["properties.view", "buyers.view_all", "offers.send"], () => svc.markContacted(PROPERTY, BUYER))).rejects.toBeInstanceOf(ConflictException);
    expect(created).toEqual([]);
  });

  it("פנייה שנייה אחרי אותה הורדה: 409, בלי שורה נוספת", async () => {
    const { svc, created } = service({ contactedBefore: true });
    await expect(asUser(["properties.view", "buyers.view_own", "offers.send"], () => svc.markContacted(PROPERTY, BUYER))).rejects.toBeInstanceOf(ConflictException);
    expect(created).toEqual([]);
    const fresh = service();
    await asUser(["properties.view", "buyers.view_own", "offers.send"], () => fresh.svc.markContacted(PROPERTY, BUYER));
    expect(fresh.created).toHaveLength(1);
  });
});
