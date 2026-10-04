import { describe, expect, it } from "vitest";
import { MediaAdminService } from "./media-admin.service";

/**
 * ההתחשבנות מול המדיה — שני כיוונים, מנגנון אחד:
 * `payout` תופס הזמנות ששולמו וטרם הועברו; `lead_fees` תופס הפניות עם
 * תמורה שטרם נגבו. הסכום נגזר ממה שנתפס בפועל, ולא מהמסך.
 */

const OUTLET = "01OUTLET0000000000000000A0";
const OTHER = "01OUTLET0000000000000000B0";
const ME = "01USER000000000000000000A0";

function harness() {
  const orders: Record<string, unknown>[] = [
    { id: "p1", outletId: OUTLET, status: "paid", amountAgorot: 100_000, commissionAgorot: 10_000, leadFeeAgorot: null, settlementId: null },
    { id: "p2", outletId: OUTLET, status: "paid", amountAgorot: 50_000, commissionAgorot: 5_000, leadFeeAgorot: null, settlementId: null },
    { id: "p3", outletId: OUTLET, status: "pending_payment", amountAgorot: 70_000, commissionAgorot: 7_000, leadFeeAgorot: null, settlementId: null },
    { id: "l1", outletId: OUTLET, status: "referred", amountAgorot: 0, commissionAgorot: 0, leadFeeAgorot: 5_000, settlementId: null },
    { id: "l2", outletId: OUTLET, status: "referred", amountAgorot: 0, commissionAgorot: 0, leadFeeAgorot: 3_000, settlementId: null },
    { id: "l3", outletId: OUTLET, status: "referred", amountAgorot: 0, commissionAgorot: 0, leadFeeAgorot: null, settlementId: null },
    { id: "x1", outletId: OTHER, status: "paid", amountAgorot: 999_999, commissionAgorot: 0, leadFeeAgorot: null, settlementId: null },
  ];
  const settlements: Record<string, unknown>[] = [];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value !== null && typeof value === "object" && "gt" in (value as object)) {
        const current = row[key];
        return typeof current === "number" && current > (value as { gt: number }).gt;
      }
      return row[key] === value;
    });
  const tx = {
    mediaOrder: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of orders) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = orders.filter((row) => matches(row, where));
        const sum = (key: string) => rows.reduce((acc, row) => acc + ((row[key] as number | null) ?? 0), 0);
        return { _sum: { amountAgorot: sum("amountAgorot"), commissionAgorot: sum("commissionAgorot"), leadFeeAgorot: sum("leadFeeAgorot") } };
      },
    },
    mediaSettlement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        settlements.push(data);
        return data;
      },
    },
  };
  const prisma = {
    mediaOutlet: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === OUTLET ? { id: OUTLET } : null) },
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };
  return { service: new MediaAdminService(prisma as never), orders, settlements };
}

describe("MediaAdminService.settle", () => {
  it("העברה למדיה — ההזמנות ששולמו בלבד, הסכום פחות העמלה, רק של המדיה הזו", async () => {
    const h = harness();
    const result = await h.service.settle(OUTLET, { kind: "payout", reference: "123", note: "" }, ME);
    expect(result).toMatchObject({ amountAgorot: 135_000, orderCount: 2 });
    expect(h.orders.filter((o) => o["settlementId"] === result.id).map((o) => o["id"])).toEqual(["p1", "p2"]);
    expect(h.settlements[0]).toMatchObject({ kind: "payout", amountAgorot: 135_000, orderCount: 2, reference: "123" });
    // ‏פעם שנייה — אין מה להעביר
    await expect(h.service.settle(OUTLET, { kind: "payout", reference: "", note: "" }, ME)).rejects.toThrow(/אין הזמנות/u);
  });

  it("תקבול על הפניות — ההפניות עם תמורה בלבד; ההזמנות ששולמו אינן נוגעות", async () => {
    const h = harness();
    const result = await h.service.settle(OUTLET, { kind: "lead_fees", reference: "", note: "העברה 4.10" }, ME);
    expect(result).toMatchObject({ amountAgorot: 8_000, orderCount: 2 });
    expect(h.orders.filter((o) => o["settlementId"] === result.id).map((o) => o["id"])).toEqual(["l1", "l2"]);
    expect(h.orders.find((o) => o["id"] === "p1")?.["settlementId"]).toBeNull();
    expect(h.settlements[0]).toMatchObject({ kind: "lead_fees", amountAgorot: 8_000 });
    await expect(h.service.settle(OUTLET, { kind: "lead_fees", reference: "", note: "" }, ME)).rejects.toThrow(/אין הפניות/u);
    // ‏ההעברה למדיה עדיין פתוחה — הכיוונים אינם מתערבבים
    expect((await h.service.settle(OUTLET, { kind: "payout", reference: "", note: "" }, ME)).amountAgorot).toBe(135_000);
  });

  it("מדיה שאינה קיימת — 404 לפני שנוגעים בהזמנות", async () => {
    const h = harness();
    await expect(h.service.settle("01NOPE000000000000000000A0", { kind: "payout", reference: "", note: "" }, ME)).rejects.toThrow(/לא נמצאה/u);
    expect(h.settlements).toHaveLength(0);
  });
});
