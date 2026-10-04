import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  loadEnv: () => ({ WEB_ORIGIN: "https://app.test", PLATFORM_ADMIN_EMAILS: [] }),
}));

import { MediaClosingReminderService } from "./media-closing-reminder.service";
import { MediaMailService } from "./media-mail.service";

/**
 * תזכורת סגירת גיליון — פעם אחת לגיליון, רק להזמנה שממתינה, ושוב
 * כשהמועד מתעדכן לגיליון הבא.
 */

const OUTLET = "01OUTLET0000000000000000A0";
const TENANT = "01TENANT00000000000000000A";
const NOW = new Date("2026-09-22T09:00:00.000Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 60 * 60 * 1000);

const PRODUCT = "01PRODUCT000000000000000A0";
const COVER = "01PRODUCTCOVER0000000000A0";

function harness(input: {
  closingAt: Date | null;
  remindedFor?: Date | null;
  orders?: Record<string, unknown>[];
  /** מוצרים עם מועד משלהם — כפי שהשאילתה מחזירה אותם על המדיה */
  products?: Record<string, unknown>[];
}) {
  const products = input.products ?? [];
  const outlet: Record<string, unknown> = {
    id: OUTLET,
    name: "מגזין טאבו",
    nextClosingAt: input.closingAt,
    remindedForClosingAt: input.remindedFor ?? null,
    contactName: "ר׳ נציג",
    contactEmail: "ads@tabu.example",
    contactPhone: "",
    closingText: "",
    products,
  };
  const orders = input.orders ?? [
    {
      id: "01ORDER00000000000000000A0",
      tenantId: TENANT,
      outletId: OUTLET,
      productId: PRODUCT,
      status: "pending_payment",
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
      createdAt: NOW,
      closingReminderAt: null,
      creativeToken: null,
      creativeName: null,
      creativeUploadedAt: null,
      publishedAt: null,
      publishedNote: "",
    },
  ];
  const notifications: { dedupeKey: string; userId: string | null }[] = [];
  const sent: { to: string; key: string }[] = [];
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      // ‏ה-INSERT של notifyOnce — הערכים לפי הסדר בתבנית
      if (strings.join("").includes("INSERT INTO notifications")) {
        notifications.push({ dedupeKey: String(values[8]), userId: values[2] as string | null });
        return 1;
      }
      return 0;
    },
  };
  const prisma = {
    mediaOutlet: {
      findMany: async () => [outlet],
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(outlet, data),
    },
    mediaProduct: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = products.find((p) => p["id"] === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
    mediaOrder: {
      findMany: async ({
        where,
      }: {
        where: {
          productId?: string | { notIn: string[] };
          OR: [{ closingReminderAt: null }, { closingReminderAt: { lt: Date } }];
        };
      }) =>
        orders.filter(
          (o) =>
            o["status"] === "pending_payment" &&
            (where.productId === undefined ||
              (typeof where.productId === "string"
                ? o["productId"] === where.productId
                : !where.productId.notIn.includes(o["productId"] as string))) &&
            (o["closingReminderAt"] === null ||
              (o["closingReminderAt"] as Date).getTime() < where.OR[1].closingReminderAt.lt.getTime()),
        ),
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = orders.find((o) => o["id"] === where.id);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
    withExplicitTenant: async <T>(_tenantId: string, fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };
  const email = {
    send: async (to: string, _subject: string, _content: unknown, opts: { idempotency: { key: string } }) => {
      sent.push({ to, key: opts.idempotency.key });
    },
  };
  const adminNotices: string[] = [];
  const admins = {
    notify: async (notice: { subject: string }) => {
      adminNotices.push(notice.subject);
      return { sent: 1, failed: 0 };
    },
  };
  const service = new MediaClosingReminderService(
    prisma as never,
    new MediaMailService(email as never, admins as never),
  );
  return { service, outlet, orders, notifications, sent, adminNotices };
}

describe("MediaClosingReminderService.sweep", () => {
  it("בתוך יממה מהסגירה — התראה למי שהתחיל את ההזמנה, מייל לאיש הקשר, וסימון על ההזמנה ועל המדיה", async () => {
    const h = harness({ closingAt: hours(20) });
    expect((await h.service.sweep(NOW)).reminded).toBe(1);
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]?.userId).toBe("01USER000000000000000000A0");
    expect(h.sent).toEqual([{ to: "dana@office.example", key: `media-closing:01ORDER00000000000000000A0:${hours(20).getTime()}` }]);
    expect(h.adminNotices).toHaveLength(1);
    expect(h.adminNotices[0]).toContain("נסגר מחר");
    expect(h.orders[0]?.["closingReminderAt"]).toEqual(hours(20));
    expect(h.outlet["remindedForClosingAt"]).toEqual(hours(20));
  });

  it("סבב שני על אותו גיליון — שקט", async () => {
    const h = harness({ closingAt: hours(20) });
    await h.service.sweep(NOW);
    expect((await h.service.sweep(hours(1))).reminded).toBe(0);
    expect(h.sent).toHaveLength(1);
  });

  it("רחוק מהסגירה, או שהמועד עבר — אין תזכורת", async () => {
    expect((await harness({ closingAt: hours(60) }).service.sweep(NOW)).reminded).toBe(0);
    expect((await harness({ closingAt: hours(-1) }).service.sweep(NOW)).reminded).toBe(0);
    expect((await harness({ closingAt: null }).service.sweep(NOW)).reminded).toBe(0);
  });

  it("המועד התעדכן לגיליון הבא — הזמנה שעדיין ממתינה מקבלת תזכורת חדשה", async () => {
    const h = harness({ closingAt: hours(20) });
    await h.service.sweep(NOW);
    // ‏בעל הפלטפורמה עדכן לשבוע הבא
    h.outlet["nextClosingAt"] = hours(20 + 7 * 24);
    expect((await h.service.sweep(hours(7 * 24))).reminded).toBe(1);
    expect(h.sent).toHaveLength(2);
  });

  it("הזמנה ששולמה או הפניה — לא מקבלות תזכורת", async () => {
    const h = harness({
      closingAt: hours(20),
      orders: [
        { id: "01ORDERPA1D0000000000000A0", tenantId: TENANT, outletId: OUTLET, productId: PRODUCT, status: "paid", createdBy: null, kind: "paid", outletName: "x", productName: "x", quantity: 1, amountAgorot: 0, commissionAgorot: 0, leadFeeAgorot: null, brief: "", contactName: "y", contactPhone: "", contactEmail: "a@b.c", officeName: "o", customerNo: null, createdAt: NOW, closingReminderAt: null, creativeToken: null, creativeName: null, creativeUploadedAt: null, publishedAt: null, publishedNote: "", publishedBy: "", outletToken: null, outletConfirmedAt: null },
        { id: "01ORDERREF00000000000000A0", tenantId: TENANT, outletId: OUTLET, productId: PRODUCT, status: "referred", createdBy: null, kind: "lead", outletName: "x", productName: "x", quantity: 1, amountAgorot: 0, commissionAgorot: 0, leadFeeAgorot: null, brief: "", contactName: "y", contactPhone: "", contactEmail: "a@b.c", officeName: "o", customerNo: null, createdAt: NOW, closingReminderAt: null, creativeToken: null, creativeName: null, creativeUploadedAt: null, publishedAt: null, publishedNote: "", publishedBy: "", outletToken: null, outletConfirmedAt: null },
      ],
    });
    expect((await h.service.sweep(NOW)).reminded).toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it("מוצר עם מועד משלו — ההזמנות שלו לפי המועד שלו, השאר לפי המדיה; כל אחד מסומן בנפרד", async () => {
    const base = {
      tenantId: TENANT,
      outletId: OUTLET,
      status: "pending_payment",
      createdBy: null,
      kind: "paid",
      outletName: "x",
      productName: "x",
      quantity: 1,
      amountAgorot: 0,
      commissionAgorot: 0,
      leadFeeAgorot: null,
      brief: "",
      contactName: "y",
      contactPhone: "",
      contactEmail: "a@b.c",
      officeName: "o",
      customerNo: null,
      createdAt: NOW,
      closingReminderAt: null,
      creativeToken: null,
      creativeName: null,
      creativeUploadedAt: null,
      publishedAt: null,
      publishedNote: "",
      publishedBy: "",
      outletToken: null,
      outletConfirmedAt: null,
    };
    // ‏השער נסגר בעוד 10 שעות; המדיה — בעוד 60 (עדיין רחוק)
    const h = harness({
      closingAt: hours(60),
      products: [{ id: COVER, nextClosingAt: hours(10), remindedForClosingAt: null }],
      orders: [
        { ...base, id: "01ORDERCOVER000000000000A0", productId: COVER },
        { ...base, id: "01ORDERINNER000000000000A0", productId: PRODUCT },
      ],
    });
    expect((await h.service.sweep(NOW)).reminded).toBe(1);
    expect(h.sent.map((m) => m.key)).toEqual([`media-closing:01ORDERCOVER000000000000A0:${hours(10).getTime()}`]);
    expect(h.outlet["products"]).toMatchObject([{ remindedForClosingAt: hours(10) }]);
    expect(h.outlet["remindedForClosingAt"]).toBeNull();
    // ‏יומיים אחרי — המדיה נסגרת מחר: רק העמוד הפנימי מקבל, השער כבר קיבל לפי המועד שלו
    expect((await h.service.sweep(hours(40))).reminded).toBe(1);
    expect(h.sent.at(-1)?.key).toBe(`media-closing:01ORDERINNER000000000000A0:${hours(60).getTime()}`);
    expect(h.outlet["remindedForClosingAt"]).toEqual(hours(60));
  });
});
