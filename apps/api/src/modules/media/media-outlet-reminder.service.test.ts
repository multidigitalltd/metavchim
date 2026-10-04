import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  loadEnv: () => ({ WEB_ORIGIN: "https://app.test", PLATFORM_ADMIN_EMAILS: [] }),
}));

import { MediaMailService } from "./media-mail.service";
import { MediaOutletReminderService } from "./media-outlet-reminder.service";

/**
 * תזכורת לנציג שטרם אישר קבלה — יומיים אחרי המסירה, פעם אחת להזמנה,
 * ולא למי שאישר או שהמודעה שלו כבר פורסמה.
 */

const OUTLET = "01OUTLET0000000000000000A0";
const TENANT = "01TENANT00000000000000000A";
const NOW = new Date("2026-10-04T09:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function order(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "01ORDER00000000000000000A0",
    tenantId: TENANT,
    outletId: OUTLET,
    status: "paid",
    createdBy: "01USER000000000000000000A0",
    kind: "paid",
    outletName: "מגזין טאבו",
    productName: "מודעה רבע עמוד",
    quantity: 1,
    amountAgorot: 90_000,
    commissionAgorot: 9_000,
    leadFeeAgorot: null,
    brief: "",
    contactName: "דנה כהן",
    contactPhone: "+972521111111",
    contactEmail: "dana@office.example",
    officeName: "משרד הדגמה",
    customerNo: 100123,
    createdAt: hoursAgo(80),
    notifiedAt: hoursAgo(72),
    creativeToken: null,
    creativeName: null,
    creativeUploadedAt: null,
    outletToken: "o".repeat(43),
    outletConfirmedAt: null,
    outletReminderAt: null,
    publishedAt: null,
    publishedNote: "",
    publishedBy: "",
    ...overrides,
  };
}

function harness(orders: Record<string, unknown>[], contactEmail = "ads@tabu.example") {
  const sent: { to: string; key: string }[] = [];
  const adminNotices: string[] = [];
  const prisma = {
    mediaOrder: {
      // ‏הסינון של השאילתה — כמו בבסיס הנתונים: נמסרה לפני הסף, בלי אישור, פרסום או תזכורת
      findMany: async ({ where }: { where: { notifiedAt: { lte: Date } } }) =>
        orders.filter(
          (o) =>
            (o["status"] === "paid" || o["status"] === "referred") &&
            o["notifiedAt"] !== null &&
            (o["notifiedAt"] as Date).getTime() <= where.notifiedAt.lte.getTime() &&
            o["outletConfirmedAt"] === null &&
            o["publishedAt"] === null &&
            o["outletReminderAt"] === null,
        ),
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = orders.find((o) => o["id"] === where.id);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
    mediaOutlet: {
      findUnique: async () => ({
        name: "מגזין טאבו",
        contactName: "ר׳ נציג",
        contactEmail,
        contactPhone: "",
        closingText: "",
        nextClosingAt: null,
      }),
    },
  };
  const email = {
    send: async (to: string, _subject: string, _content: unknown, opts: { idempotency: { key: string }; required?: boolean }) => {
      sent.push({ to, key: opts.idempotency.key });
    },
  };
  const admins = {
    notify: async (notice: { subject: string }) => {
      adminNotices.push(notice.subject);
      return { sent: 1, failed: 0 };
    },
  };
  const service = new MediaOutletReminderService(prisma as never, new MediaMailService(email as never, admins as never));
  return { service, orders, sent, adminNotices };
}

describe("MediaOutletReminderService.sweep", () => {
  it("יומיים בלי אישור — מייל לנציג עם הקישור, הודעה למנהלים, וסימון; הסבב הבא שקט", async () => {
    const h = harness([order({})]);
    expect((await h.service.sweep(NOW)).reminded).toBe(1);
    expect(h.sent).toEqual([{ to: "ads@tabu.example", key: "media-order:01ORDER00000000000000000A0:outlet-reminder" }]);
    expect(h.adminNotices).toHaveLength(1);
    expect(h.adminNotices[0]).toContain("טרם אישר קבלה");
    expect(h.orders[0]?.["outletReminderAt"]).toEqual(NOW);
    expect((await h.service.sweep(NOW)).reminded).toBe(0);
    expect(h.sent).toHaveLength(1);
  });

  it("אישר, פורסם, נמסרה לפני פחות מיומיים, או לא נמסרה — בלי תזכורת", async () => {
    const h = harness([
      order({ id: "01ORDERCONF0000000000000A0", outletConfirmedAt: hoursAgo(1) }),
      order({ id: "01ORDERPUBL0000000000000A0", publishedAt: hoursAgo(1) }),
      order({ id: "01ORDERFRESH000000000000A0", notifiedAt: hoursAgo(10) }),
      order({ id: "01ORDERUNSENT00000000000A0", notifiedAt: null }),
    ]);
    expect((await h.service.sweep(NOW)).reminded).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(h.adminNotices).toHaveLength(0);
  });

  it("לנציג אין כתובת — המנהלים מקבלים הודעה, וההזמנה מסומנת כדי שלא תחזור כל שעה", async () => {
    const h = harness([order({})], "");
    expect((await h.service.sweep(NOW)).reminded).toBe(1);
    expect(h.sent).toHaveLength(0);
    expect(h.adminNotices).toHaveLength(1);
    expect(h.orders[0]?.["outletReminderAt"]).toEqual(NOW);
  });
});
