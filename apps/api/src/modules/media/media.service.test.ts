import { describe, expect, it, vi } from "vitest";
import { TenantContext } from "../../common/tenant-context";

vi.mock("../../config/env", () => ({
  loadEnv: () => ({ WEB_ORIGIN: "https://app.test", PLATFORM_ADMIN_EMAILS: [] }),
}));

import { MediaMailService, outletMailKey } from "./media-mail.service";
import { MediaService } from "./media.service";

/**
 * רכש מדיה — מה שחייב להישאר נכון בלי מסד ובלי סולק:
 *
 * - הפניה נרשמת ונשלחת מיד; הזמנה בתשלום נרשמת, פותחת דף תשלום,
 *   ו**אינה** נשלחת לנציג עד שהתשלום נתפס.
 * - המחיר והעמלה נצרבים מהמוצר ולא מהבקשה.
 * - דף תשלום שננטש על אותו מוצר מתבטל כשנפתח חדש.
 * - שליחה כפולה של אותה הזמנה נעצרת במפתח האידמפוטנטיות.
 */

const TENANT = "01TENANT00000000000000000A";
const ME = "01USER000000000000000000A0";
const OUTLET = "01OUTLET0000000000000000A0";
const PAID = "01PRODUCTPAID00000000000A0";
const LEAD = "01PRODUCTLEAD00000000000A0";
const BIG = "01PRODUCTB1G000000000000A0";

interface Sent {
  to: string;
  subject: string;
  key: string | null;
}

function harness(options: { cardcom?: boolean; mail?: boolean; contactEmail?: string } = {}) {
  const orders: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const sent: Sent[] = [];
  const adminNotices: string[] = [];
  const audits: string[] = [];

  const products: Record<string, Record<string, unknown>> = {
    [PAID]: {
      id: PAID,
      outletId: OUTLET,
      name: "מודעה רבע עמוד",
      kind: "paid",
      priceAgorot: 90_000,
      active: true,
      outlet: { name: "מגזין טאבו", slug: "tabu-magazine", commissionPercent: 10 },
    },
    [BIG]: {
      id: BIG,
      outletId: OUTLET,
      name: "כריכה — מהדורה מיוחדת",
      kind: "paid",
      // ‏מעל תקרת הסכימה — מוצר שנוצר לפני התקרה. השרת בודק בכל מקרה.
      priceAgorot: 20_000_000,
      active: true,
      outlet: { name: "מגזין טאבו", slug: "tabu-magazine", commissionPercent: 10 },
    },
    [LEAD]: {
      id: LEAD,
      outletId: OUTLET,
      name: "עמוד שער",
      kind: "lead",
      priceAgorot: null,
      leadFeeAgorot: 5_000,
      active: true,
      outlet: { name: "מגזין טאבו", slug: "tabu-magazine", commissionPercent: 10 },
    },
  };

  const mediaOrder = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      orders.push({ notifiedAt: null, ...data });
      return data;
    },
    findMany: async ({ where }: { where: { tenantId: string; productId?: string; status?: string } }) =>
      orders.filter(
        (o) =>
          o["tenantId"] === where.tenantId &&
          (where.productId === undefined || o["productId"] === where.productId) &&
          (where.status === undefined || o["status"] === where.status),
      ),
    findUnique: async ({ where }: { where: { id: string } }) =>
      orders.find((o) => o["id"] === where.id) ?? null,
    findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
      orders.find((o) => o["id"] === where.id && o["tenantId"] === where.tenantId) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = orders.find((o) => o["id"] === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { tenantId?: string; id?: string | { in: string[] }; status?: string };
      data: Record<string, unknown>;
    }) => {
      const ids =
        where.id === undefined ? null : typeof where.id === "string" ? [where.id] : where.id.in;
      let count = 0;
      for (const row of orders) {
        if (where.tenantId !== undefined && row["tenantId"] !== where.tenantId) continue;
        if (ids !== null && !ids.includes(row["id"] as string)) continue;
        if (where.status !== undefined && row["status"] !== where.status) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
  };
  const payment = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      payments.push({ ...data });
      return data;
    },
    findUnique: async ({ where }: { where: { lowProfileId: string } }) =>
      payments.find((p) => p["lowProfileId"] === where.lowProfileId) ?? null,
    findMany: async ({ where }: { where: { tenantId: string; mediaOrderId: string; status: string } }) =>
      payments.filter(
        (p) =>
          p["tenantId"] === where.tenantId &&
          p["mediaOrderId"] === where.mediaOrderId &&
          p["status"] === where.status,
      ),
    count: async ({ where }: { where: { tenantId: string; mediaOrderId: string; status: string } }) =>
      payments.filter(
        (p) =>
          p["tenantId"] === where.tenantId &&
          p["mediaOrderId"] === where.mediaOrderId &&
          p["status"] === where.status,
      ).length,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = payments.find((p) => p["id"] === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { tenantId: string; mediaOrderId: string | { in: string[] }; status: string };
      data: Record<string, unknown>;
    }) => {
      const ids = typeof where.mediaOrderId === "string" ? [where.mediaOrderId] : where.mediaOrderId.in;
      let count = 0;
      for (const row of payments) {
        if (
          row["tenantId"] === where.tenantId &&
          ids.includes(row["mediaOrderId"] as string) &&
          row["status"] === where.status
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };
  const tx = { mediaOrder, payment };
  const prisma = {
    mediaOrder,
    payment,
    mediaProduct: {
      findFirst: async ({ where }: { where: { id: string } }) => products[where.id] ?? null,
    },
    mediaOutlet: {
      findUnique: async () => ({
        id: OUTLET,
        name: "מגזין טאבו",
        contactName: "ר׳ נציג",
        contactEmail: options.contactEmail ?? "ads@tabu.example",
        contactPhone: "+972521234567",
        closingText: "יום שני 12:00",
        nextClosingAt: null,
      }),
      findMany: async () => [{ id: OUTLET, slug: "tabu-magazine" }],
    },
    tenant: { findUnique: async () => ({ name: "משרד הדגמה", customerNo: 100123 }) },
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const cardcom = {
    isConfigured: async () => options.cardcom ?? true,
    createPaymentPage: async (input: { reference: string; amountAgorot: number }) => ({
      lowProfileId: `lp-${input.reference}`,
      url: `https://pay.example/${input.reference}?amount=${input.amountAgorot}`,
    }),
  };
  const vat = {
    percent: async () => 18,
    charge: async (net: number) => ({ amountAgorot: Math.round(net * 1.18), vatPercent: 18 }),
  };
  const email = {
    /*
     * ‏כמו `EmailService.send` האמיתי: בלי דואר מוגדר — שתיקה, אלא אם
     * ‏`required`, ואז חריגה. זה בדיוק ההבדל שהבדיקות למטה בודקות.
     */
    send: async (
      to: string,
      subject: string,
      _content: unknown,
      opts: { idempotency: { key: string } | null; required?: boolean },
    ) => {
      if (options.mail === false) {
        if (opts.required) throw new Error("הדואר לא הוגדר");
        return;
      }
      sent.push({ to, subject, key: opts.idempotency?.key ?? null });
    },
  };
  const admins = {
    notify: async (notice: { subject: string }) => {
      adminNotices.push(notice.subject);
      return { sent: 1, failed: 0 };
    },
  };
  const audit = { record: async (_tx: unknown, entry: { action: string }) => void audits.push(entry.action) };

  const service = new MediaService(
    prisma as never,
    cardcom as never,
    vat as never,
    new MediaMailService(email as never, admins as never),
    admins as never,
    audit as never,
  );
  return { service, orders, payments, sent, adminNotices, audits, tx };
}

function asOwner<T>(fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(["billing.manage"]), billingOnly: false },
    fn,
  );
}

const ORDER = {
  quantity: 2,
  brief: "דירת 4 חדרים בגבעה הצרפתית",
  contactName: "דנה כהן",
  contactPhone: "+972521111111",
  contactEmail: "dana@office.example",
};

describe("MediaService — הפניה", () => {
  it("נרשמת כ-referred ונשלחת מיד לנציג, למנהלים ולמזמין", async () => {
    const h = harness();
    const result = await asOwner(() =>
      h.service.createReferral({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: LEAD }),
    );
    expect(result.status).toBe("referred");
    expect(h.orders).toHaveLength(1);
    expect(h.orders[0]).toMatchObject({
      kind: "lead",
      status: "referred",
      officeName: "משרד הדגמה",
      customerNo: 100123,
    });
    expect(h.sent.map((s) => s.to)).toEqual(["ads@tabu.example", "dana@office.example"]);
    expect(h.sent[0]?.key).toBe(outletMailKey(result.orderId, "ads@tabu.example"));
    expect(h.adminNotices).toHaveLength(1);
    expect(h.orders[0]?.["notifiedAt"]).not.toBeNull();
    expect(h.audits).toEqual(["media.order_referred"]);
  });

  it("התמורה על ההפניה מצולמת על ההזמנה", async () => {
    const h = harness();
    await asOwner(() =>
      h.service.createReferral({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: LEAD }),
    );
    expect(h.orders[0]?.["leadFeeAgorot"]).toBe(5_000);
  });

  it("בלי דואר מוגדר — ההזמנה נרשמת, אבל אינה מסומנת כנשלחה", async () => {
    const h = harness({ mail: false });
    const result = await asOwner(() =>
      h.service.createReferral({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: LEAD }),
    );
    expect(result.status).toBe("referred");
    expect(h.orders[0]?.["notifiedAt"]).toBeNull();
  });

  it("מדיה בלי איש קשר — מנהלי הפלטפורמה מקבלים, וההזמנה נשארת „לא נשלח”", async () => {
    const h = harness({ contactEmail: "" });
    await asOwner(() =>
      h.service.createReferral({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: LEAD }),
    );
    expect(h.adminNotices).toHaveLength(1);
    expect(h.sent.map((s) => s.to)).toEqual(["dana@office.example"]);
    expect(h.orders[0]?.["notifiedAt"]).toBeNull();
  });

  it("מוצר בתשלום אינו נשלח כהפניה", async () => {
    const h = harness();
    await expect(
      asOwner(() =>
        h.service.createReferral({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
      ),
    ).rejects.toThrow(/בתשלום/u);
    expect(h.orders).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });
});

describe("MediaService — הזמנה בתשלום", () => {
  it("המחיר והעמלה נצרבים מהמוצר, נפתח דף תשלום, ואיש אינו מקבל מייל עדיין", async () => {
    const h = harness();
    const result = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    expect(result.url).toContain(result.paymentId);
    expect(h.orders[0]).toMatchObject({
      kind: "paid",
      status: "pending_payment",
      quantity: 2,
      unitPriceAgorot: 90_000,
      amountAgorot: 180_000,
      commissionPercent: 10,
      commissionAgorot: 18_000,
    });
    // ‏המע"מ נוסף פעם אחת, על שורת התשלום ולא על ההזמנה
    expect(h.payments[0]).toMatchObject({
      purpose: "media_order",
      mediaOrderId: result.orderId,
      amountAgorot: 212_400,
      vatPercent: 18,
      status: "pending",
      lowProfileId: `lp-${result.paymentId}`,
    });
    // ‏„ההזמנה נפתחה” — ללקוח ולמנהלים; לנציג המדיה עדיין לא
    expect(h.sent.map((s) => s.to)).toEqual(["dana@office.example"]);
    expect(h.sent[0]?.subject).toContain("נפתחה");
    expect(h.adminNotices).toHaveLength(1);
  });

  it("דף תשלום קודם על אותו מוצר מתבטל ותשלומו מסומן superseded", async () => {
    const h = harness();
    const first = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    const second = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    expect(h.orders.find((o) => o["id"] === first.orderId)?.["status"]).toBe("cancelled");
    expect(h.orders.find((o) => o["id"] === second.orderId)?.["status"]).toBe("pending_payment");
    expect(h.payments.find((p) => p["id"] === first.paymentId)?.["status"]).toBe("superseded");
    expect(h.payments.find((p) => p["id"] === second.paymentId)?.["status"]).toBe("pending");
  });

  it("בלי סליקה מוגדרת — הזמנה בתשלום נדחית לפני שנכתב דבר", async () => {
    const h = harness({ cardcom: false });
    await expect(
      asOwner(() =>
        h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
      ),
    ).rejects.toThrow(/הסליקה/u);
    expect(h.orders).toHaveLength(0);
    expect(h.payments).toHaveLength(0);
  });

  it("settleWithin מסמן שולם פעם אחת, ואז notifyAfterPayment שולח", async () => {
    const h = harness();
    const { orderId } = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    const now = new Date("2026-09-22T10:00:00.000Z");
    expect(await h.service.settleWithin(h.tx as never, orderId, now)).toEqual({ tenantId: TENANT });
    expect(h.orders[0]).toMatchObject({ status: "paid", paidAt: now });
    // ‏פעם שנייה — כבר שולם, אין מה לתפוס
    expect(await h.service.settleWithin(h.tx as never, orderId, now)).toBeNull();

    await h.service.notifyAfterPayment(orderId);
    // ‏[נפתחה ללקוח] ואז [שולם: לנציג, ללקוח]
    expect(h.sent.map((s) => s.to)).toEqual(["dana@office.example", "ads@tabu.example", "dana@office.example"]);
    expect(h.sent[1]?.subject).toContain("הזמנת פרסום");
    expect(h.sent[2]?.subject).toContain("התשלום התקבל");
    expect(h.orders[0]?.["notifiedAt"]).not.toBeNull();
  });

  it("תשלום שנדחה אצל הסולק מכשיל את ההזמנה, ולא הזמנה ששולמה", async () => {
    const h = harness();
    const { orderId, paymentId } = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    // ‏כמו `apply`: שורת התשלום כבר סומנה failed לפני שההזמנה נשאלת
    const page = h.payments.find((p) => p["id"] === paymentId);
    if (page) page["status"] = "failed";
    await h.service.markFailedForPaymentPage(`lp-${paymentId}`);
    expect(h.orders[0]?.["status"]).toBe("failed");
    // ‏הלקוח והמנהלים שומעים על הדחייה; דחייה חוזרת אינה מייל נוסף
    expect(h.sent.at(-1)?.subject).toContain("לא הושלם");
    const sentBefore = h.sent.length;
    await h.service.markFailedForPaymentPage(`lp-${paymentId}`);
    expect(h.sent).toHaveLength(sentBefore);
    // ‏ומאוחר יותר האישור כן מגיע (דף שנשאר פתוח) — ההזמנה נסגרת כשולמה
    expect(await h.service.settleWithin(h.tx as never, orderId, new Date())).toEqual({ tenantId: TENANT });
    await h.service.markFailed(orderId);
    expect(h.orders[0]?.["status"]).toBe("paid");
  });

  it("הזמנה שחורגת מתקרת הסכום נדחית לפני שנכתב דבר", async () => {
    const h = harness();
    await expect(
      asOwner(() =>
        h.service.startCheckout(
          { tenantId: TENANT, userId: ME },
          { ...ORDER, productId: BIG, quantity: 20 },
        ),
      ),
    ).rejects.toThrow(/גדולה מדי/u);
    expect(h.orders).toHaveLength(0);
  });

  it("הפניה אינה נתפסת כתשלום — settleWithin מחזיר null", async () => {
    const h = harness();
    const { orderId } = await asOwner(() =>
      h.service.createReferral({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: LEAD }),
    );
    expect(await h.service.settleWithin(h.tx as never, orderId, new Date())).toBeNull();
  });
});

describe("MediaService — המשך לתשלום, ביטול ושליחה חוזרת", () => {
  it("המשך לתשלום פותח דף חדש על אותה הזמנה, והקודם מסומן superseded", async () => {
    const h = harness();
    const first = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    const resumed = await asOwner(() => h.service.resumeCheckout({ tenantId: TENANT, userId: ME }, first.orderId));
    expect(resumed.orderId).toBe(first.orderId);
    expect(resumed.paymentId).not.toBe(first.paymentId);
    expect(h.orders).toHaveLength(1);
    expect(h.orders[0]?.["status"]).toBe("pending_payment");
    expect(h.payments.find((p) => p["id"] === first.paymentId)?.["status"]).toBe("superseded");
    expect(h.payments.find((p) => p["id"] === resumed.paymentId)?.["amountAgorot"]).toBe(212_400);
  });

  it("הזמנה שנכשלה חוזרת ל„ממתינה” בהמשך לתשלום; הזמנה ששולמה — לא", async () => {
    const h = harness();
    const { orderId, paymentId } = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    const page = h.payments.find((p) => p["id"] === paymentId);
    if (page) page["status"] = "failed";
    await h.service.markFailed(orderId);
    expect(h.orders[0]?.["status"]).toBe("failed");
    await asOwner(() => h.service.resumeCheckout({ tenantId: TENANT, userId: ME }, orderId));
    expect(h.orders[0]?.["status"]).toBe("pending_payment");
    await h.service.settleWithin(h.tx as never, orderId, new Date());
    await expect(
      asOwner(() => h.service.resumeCheckout({ tenantId: TENANT, userId: ME }, orderId)),
    ).rejects.toThrow(/אינה ממתינה/u);
  });

  it("ביטול — ההזמנה מבוטלת ודף התשלום superseded; משרד אחר אינו יכול", async () => {
    const h = harness();
    const { orderId, paymentId } = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    await expect(
      h.service.cancel({ tenantId: "01OTHERTENANT0000000000A0", userId: ME }, orderId),
    ).rejects.toThrow(/לא נמצאה/u);
    await asOwner(() => h.service.cancel({ tenantId: TENANT, userId: ME }, orderId));
    expect(h.orders[0]?.["status"]).toBe("cancelled");
    expect(h.sent.at(-1)?.subject).toContain("בוטלה");
    expect(h.adminNotices.at(-1)).toContain("בוטל");
    expect(h.payments.find((p) => p["id"] === paymentId)?.["status"]).toBe("superseded");
    expect(h.audits).toContain("media.order_cancelled");
  });

  it("שליחה חוזרת — רק להזמנה ששולמה או הפניה, ובלי כפילות למי שכבר קיבל", async () => {
    const h = harness();
    const { orderId } = await asOwner(() =>
      h.service.createReferral({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: LEAD }),
    );
    expect(h.sent).toHaveLength(2);
    expect((await h.service.resendNotification(orderId)).notified).toBe(true);
    // ‏המדומה כאן אינו זוכר מפתחות — במערכת האמיתית זיכרון השליחה עוצר את הכפילות
    const pending = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    await expect(h.service.resendNotification(pending.orderId)).rejects.toThrow(/רק הזמנה ששולמה/u);
  });

  it("מפתח המייל לנציג — לפי ההזמנה והנמען: כתובת מתוקנת מקבלת שליחה, אותה כתובת לא", () => {
    const a = outletMailKey("01ORDER00000000000000000A0", "Ads@Tabu.example ");
    expect(a).toBe(outletMailKey("01ORDER00000000000000000A0", "ads@tabu.example"));
    expect(a).not.toBe(outletMailKey("01ORDER00000000000000000A0", "new@tabu.example"));
    expect(a).toMatch(/^media-order:01ORDER00000000000000000A0:outlet:[0-9a-f]{12}$/u);
    expect(a.length).toBeLessThanOrEqual(80);
  });

  it("דחיית הדף הישן אחרי „המשך לתשלום” אינה מכשילה את ההזמנה — הדף החדש עוד פתוח", async () => {
    const h = harness();
    const first = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    const resumed = await asOwner(() => h.service.resumeCheckout({ tenantId: TENANT, userId: ME }, first.orderId));
    const sentBefore = h.sent.length;
    // ‏הסולק דוחה את הדף הישן (superseded) — כמו `apply` שמסמן את השורה failed ואז קורא לנו
    const old = h.payments.find((p) => p["id"] === first.paymentId);
    if (old) old["status"] = "failed";
    await h.service.markFailedForPaymentPage(`lp-${first.paymentId}`);
    expect(h.orders[0]?.["status"]).toBe("pending_payment");
    expect(h.sent).toHaveLength(sentBefore);
    // ‏הדף החדש נדחה — עכשיו ההזמנה באמת נכשלה
    const fresh = h.payments.find((p) => p["id"] === resumed.paymentId);
    if (fresh) fresh["status"] = "failed";
    await h.service.markFailedForPaymentPage(`lp-${resumed.paymentId}`);
    expect(h.orders[0]?.["status"]).toBe("failed");
    expect(h.sent.at(-1)?.subject).toContain("לא הושלם");
  });

  it("תשלום שני על הזמנה ששולמה — חיוב כפול למנהלים; אותו תשלום פעמיים — שקט", async () => {
    const h = harness();
    const first = await asOwner(() =>
      h.service.startCheckout({ tenantId: TENANT, userId: ME }, { ...ORDER, productId: PAID }),
    );
    const resumed = await asOwner(() => h.service.resumeCheckout({ tenantId: TENANT, userId: ME }, first.orderId));
    const paymentOf = (id: string) => h.payments.find((p) => p["id"] === id) as Record<string, unknown>;
    // ‏הדף החדש שולם ונתפס
    paymentOf(resumed.paymentId)["status"] = "paid";
    expect(await h.service.settleWithin(h.tx as never, first.orderId, new Date())).toEqual({ tenantId: TENANT });
    // ‏הודעה כפולה על אותו תשלום — כפילות רגילה, בלי רעש
    const before = h.adminNotices.length;
    await h.service.reportOrphanPayment(resumed.paymentId, first.orderId);
    expect(h.adminNotices).toHaveLength(before);
    // ‏הדף הישן (superseded) שולם גם הוא ונתפס — הלקוח חויב פעמיים
    paymentOf(first.paymentId)["status"] = "paid";
    expect(await h.service.settleWithin(h.tx as never, first.orderId, new Date())).toBeNull();
    await h.service.reportOrphanPayment(first.paymentId, first.orderId);
    expect(h.adminNotices.at(-1)).toContain("חיוב כפול");
  });
});
