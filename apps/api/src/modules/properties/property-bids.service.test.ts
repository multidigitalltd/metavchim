import { describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PropertyBidsService } from "./property-bids.service";

/**
 * ‎**הסכום הוא של הנכס; השם הוא של הקונה.**
 *
 * ‏מי שרואה את הכרטיס רואה שיש מו״מ וכמה. את **שם** הקונה רואה רק
 * ‏מי שרשאי לראות את הקונה — קונה של סוכן אחר מופיע במסכה, ואי
 * ‏אפשר לרשום הצעה בשמו.
 */

const TENANT = "01TENANT00000000000000000A";
const ME = "01USERME000000000000000000";
const OTHER = "01USEROTHER00000000000000A";
const PROPERTY = "01PROPERTY000000000000000A";
const MINE = "01BUYERMINE00000000000000A";
const THEIRS = "01BUYERTHEIRS000000000000A";

function service(recorded: { buyerId: string; side: string }[] = []) {
  const bids = [
    { id: "01BID1", buyerId: MINE, side: "buyer", amountAgorot: 200_000_000n, status: "open", note: null, createdAt: new Date("2026-09-10T10:00:00Z") },
    { id: "01BID2", buyerId: THEIRS, side: "buyer", amountAgorot: 210_000_000n, status: "open", note: "מזומן", createdAt: new Date("2026-09-11T10:00:00Z") },
  ];
  const buyers = [
    { id: MINE, contactId: "01CONTACTMINE", ownerUserId: ME },
    { id: THEIRS, contactId: "01CONTACTTHEIRS", ownerUserId: OTHER },
  ];
  const tx = {
    property: { findFirst: async () => ({ id: PROPERTY }) },
    propertyBid: {
      findMany: async () => bids,
      findFirst: async () => null,
      create: async ({ data }: { data: { buyerId: string; side: string } }) => {
        recorded.push({ buyerId: data.buyerId, side: data.side });
        return data;
      },
    },
    buyer: {
      findMany: async ({ where }: { where: { id?: { in: string[] }; ownerUserId?: string } }) =>
        buyers
          .filter((b) => where.id === undefined || where.id.in.includes(b.id))
          .filter((b) => where.ownerUserId === undefined || b.ownerUserId === where.ownerUserId)
          .map((b) => ({ id: b.id, contactId: b.contactId })),
      findFirst: async ({ where }: { where: { id: string; ownerUserId?: string } }) =>
        buyers.find((b) => b.id === where.id && (where.ownerUserId === undefined || b.ownerUserId === where.ownerUserId)) ?? null,
    },
    appointment: { findMany: async () => [{ buyerId: MINE }, { buyerId: THEIRS }] },
    match: { findMany: async () => [] },
    $queryRaw: async () => [],
  };
  const prisma = { withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx) };
  const contacts = {
    getByIds: async (_tx: unknown, ids: readonly string[]) =>
      new Map(ids.map((id) => [id, { name: id === "01CONTACTMINE" ? "משה כהן" : "דנה לוי" }])),
  };
  const audit = { record: async () => undefined };
  return new PropertyBidsService(prisma as never, contacts as never, audit as never);
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

describe("הצעות מחיר — מי רואה שם ומי רואה מסכה", () => {
  it("סוכן שרואה רק את הקונים שלו: הסכום של כולם, השם רק שלו, ובבורר רק שלו", async () => {
    const dto = await asUser(["properties.view", "buyers.view_own"], () => service().list(PROPERTY));
    expect(dto.threads.map((t) => [t.buyer.name, t.buyer.visible, t.open?.amountAgorot])).toEqual([
      ["קונה של סוכן אחר", false, 210_000_000],
      ["משה כהן", true, 200_000_000],
    ]);
    expect(dto.buyerOptions).toEqual([{ id: MINE, name: "משה כהן" }]);
    /* ‏המשפטים למוכר — מספרים בלבד, ולכן זהים לכל קורא */
    expect(dto.summary).toMatchObject({ bidders: 2, openThreads: 2, highestOpenAgorot: 210_000_000 });
  });

  it("מודול הקונים חסום: הסכומים נשארים, כל השמות במסכה, ואין רישום", async () => {
    const recorded: { buyerId: string; side: string }[] = [];
    const dto = await asUser(["properties.view"], () => service(recorded).list(PROPERTY));
    expect(dto.threads.map((t) => t.buyer.visible)).toEqual([false, false]);
    expect(dto.buyerOptions).toEqual([]);
    expect(dto.summary.bidders).toBe(2);
    await expect(
      asUser(["properties.edit"], () => service(recorded).create(PROPERTY, { buyerId: MINE, side: "buyer", amountAgorot: 100 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(recorded).toEqual([]);
  });

  it("בעל המשרד רואה את כולם בשם", async () => {
    const dto = await asUser(["properties.view", "buyers.view_all"], () => service().list(PROPERTY));
    expect(dto.threads.map((t) => t.buyer.name)).toEqual(["דנה לוי", "משה כהן"]);
    expect(dto.buyerOptions.map((b) => b.name)).toEqual(["דנה לוי", "משה כהן"]);
  });

  it("אי אפשר לרשום הצעה בשם קונה של סוכן אחר", async () => {
    const recorded: { buyerId: string; side: string }[] = [];
    await expect(
      asUser(["properties.edit", "buyers.view_own"], () =>
        service(recorded).create(PROPERTY, { buyerId: THEIRS, side: "buyer", amountAgorot: 100 }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(recorded).toEqual([]);
    await asUser(["properties.edit", "buyers.view_own"], () =>
      service(recorded).create(PROPERTY, { buyerId: MINE, side: "seller", amountAgorot: 100 }),
    );
    expect(recorded).toEqual([{ buyerId: MINE, side: "seller" }]);
  });
});
