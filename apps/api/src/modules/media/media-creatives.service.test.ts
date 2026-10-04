import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  loadEnv: () => ({ WEB_ORIGIN: "https://app.test", PLATFORM_ADMIN_EMAILS: [] }),
}));

import { TenantContext } from "../../common/tenant-context";
import { MediaCreativesService, safeName } from "./media-creatives.service";
import { MediaMailService } from "./media-mail.service";

/**
 * קובץ המודעה — זיהוי לפי תוכן, שמירה כפי שהוא, אסימון שמתחלף,
 * ומייל לנציג רק כשההזמנה כבר אצלו.
 */

const TENANT = "01TENANT00000000000000000A";
const OTHER = "01OTHER000000000000000000A";
const ME = "01USER000000000000000000A0";
const ORDER = "01ORDER00000000000000000A0";
const OUTLET = "01OUTLET0000000000000000A0";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF = Buffer.from("%PDF-1.7 fake");
const GIF = Buffer.from("GIF89a....");

function harness(status = "paid", options: { publishedAt?: Date; filesLockedAt?: Date } = {}) {
  const order: Record<string, unknown> = {
    id: ORDER,
    tenantId: TENANT,
    outletId: OUTLET,
    kind: "paid",
    status,
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
    createdAt: new Date("2026-10-01T08:00:00.000Z"),
    creativeKey: null,
    creativeMime: null,
    creativeName: null,
    creativeToken: null,
    creativeUploadedAt: null,
    publishedAt: options.publishedAt ?? null,
    publishedNote: "",
  };
  const stored = new Map<string, { body: Buffer; mime: string }>();
  const deleted: string[] = [];
  const audits: string[] = [];
  const sent: { to: string; subject: string; key: string }[] = [];
  const adminNotices: string[] = [];
  const tx = {
    mediaOrder: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; tenantId: string; status?: string; publishedAt?: null };
        data: Record<string, unknown>;
      }) => {
        if (order["id"] !== where.id || order["tenantId"] !== where.tenantId) return { count: 0 };
        if (where.status !== undefined && order["status"] !== where.status) return { count: 0 };
        if (where.publishedAt === null && order["publishedAt"] !== null) return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      },
    },
  };
  const prisma = {
    mediaOrder: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        order["id"] === where.id && order["tenantId"] === where.tenantId ? order : null,
      findUnique: async ({ where }: { where: { id?: string; creativeToken?: string } }) =>
        (where.id !== undefined && order["id"] === where.id) ||
        (where.creativeToken !== undefined && order["creativeToken"] === where.creativeToken)
          ? order
          : null,
    },
    mediaOutlet: {
      findUnique: async () => ({
        name: "מגזין טאבו",
        contactName: "ר׳ נציג",
        contactEmail: "ads@tabu.example",
        contactPhone: "",
        closingText: "",
        nextClosingAt: null,
      }),
    },
    tenant: { findUnique: async () => ({ filesLockedAt: options.filesLockedAt ?? null }) },
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };
  const storage = {
    put: async (key: string, body: Buffer, mime: string) => void stored.set(key, { body, mime }),
    delete: async (key: string) => void deleted.push(key),
    getObject: async (key: string) => {
      const hit = stored.get(key);
      if (!hit) throw new Error("NoSuchKey");
      return { body: hit.body as never, contentType: hit.mime, contentLength: hit.body.length };
    },
  };
  const audit = { record: async (_tx: unknown, entry: { action: string }) => void audits.push(entry.action) };
  const email = {
    send: async (to: string, subject: string, _c: unknown, opts: { idempotency: { key: string } }) => {
      sent.push({ to, subject, key: opts.idempotency.key });
    },
  };
  const admins = {
    notify: async (n: { subject: string }) => {
      adminNotices.push(n.subject);
      return { sent: 1, failed: 0 };
    },
  };
  const service = new MediaCreativesService(
    prisma as never,
    storage as never,
    audit as never,
    new MediaMailService(email as never, admins as never),
  );
  return { service, prisma, order, stored, deleted, audits, sent, adminNotices };
}

const asTenant = <T>(fn: () => Promise<T>) =>
  TenantContext.run({ tenantId: TENANT, userId: ME, capabilities: new Set(), billingOnly: false }, fn);

describe("MediaCreativesService.upload", () => {
  it("JPEG נשמר כפי שהוא תחת המשרד, עם אסימון; הנציג ומנהלי הפלטפורמה מקבלים מייל", async () => {
    const h = harness("paid");
    const res = await asTenant(() =>
      h.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: JPEG, originalname: "../מודעה סופית.JPEG" }),
    );
    expect(res.creativeMime).toBe("image/jpeg");
    expect(res.creativeName).toBe("מודעה סופית.jpg");
    const key = h.order["creativeKey"] as string;
    expect(key).toMatch(new RegExp(`^tenants/${TENANT}/media-orders/${ORDER}/[0-9A-Z]{26}\\.jpg$`, "u"));
    expect(h.stored.get(key)?.body.equals(JPEG)).toBe(true);
    expect(h.order["creativeToken"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(h.audits).toEqual(["media.creative_uploaded"]);
    expect(h.sent.map((s) => s.to)).toEqual(["ads@tabu.example"]);
    expect(h.sent[0]?.subject).toContain("קובץ המודעה");
    expect(h.adminNotices[0]).toContain("קובץ הועלה");
  });

  it("החלפה: קובץ חדש, אסימון חדש, הישן נמחק, והמייל לנציג במפתח אחר", async () => {
    const h = harness("referred");
    await asTenant(() => h.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: JPEG, originalname: "a.jpg" }));
    const firstKey = h.order["creativeKey"] as string;
    const firstToken = h.order["creativeToken"] as string;
    await asTenant(() => h.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: PDF, originalname: "b.pdf" }));
    expect(h.order["creativeMime"]).toBe("application/pdf");
    expect(h.order["creativeKey"]).not.toBe(firstKey);
    expect(h.order["creativeToken"]).not.toBe(firstToken);
    expect(h.deleted).toEqual([firstKey]);
    expect(h.audits).toEqual(["media.creative_uploaded", "media.creative_replaced"]);
    expect(new Set(h.sent.map((s) => s.key)).size).toBe(2);
    // ‏הקישור הישן מת
    await expect(h.service.getByToken(firstToken)).rejects.toThrow(/אין קובץ|אינו זמין/u);
  });

  it("ממתינה לתשלום — נשמר, אבל הנציג עוד לא שומע; פורסם — אין להחליף", async () => {
    const pending = harness("pending_payment");
    await asTenant(() => pending.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: PDF, originalname: "ad.pdf" }));
    expect(pending.sent).toHaveLength(0);
    expect(pending.adminNotices).toHaveLength(0);

    // ‏„פורסם” אינו מצב — ההזמנה נשארת שולמה, והנעילה היא לפי מועד הפרסום
    const published = harness("paid", { publishedAt: new Date("2026-10-02T08:00:00.000Z") });
    await expect(
      asTenant(() => published.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: PDF, originalname: "ad.pdf" })),
    ).rejects.toThrow(/כבר פורסמה/u);
    expect(published.stored.size).toBe(0);
  });

  it("ההזמנה השתנתה בין הקריאה לכתיבה — הקובץ שהועלה נמחק, הנציג אינו שומע", async () => {
    const h = harness("paid");
    // ‏בעל הפלטפורמה סימן „פורסם” בדיוק אחרי שההעלאה קראה את ההזמנה
    h.prisma.mediaOrder.findFirst = async () => ({ ...h.order });
    h.order["publishedAt"] = new Date("2026-10-02T08:00:00.000Z");
    await expect(
      asTenant(() => h.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: PDF, originalname: "ad.pdf" })),
    ).rejects.toThrow(/השתנתה בינתיים|כבר פורסמה/u);
    expect(h.order["creativeKey"]).toBeNull();
    expect(h.sent).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it("המשרד ננעל למחיקה בזמן ההעלאה — הקובץ נמחק ו-410", async () => {
    const h = harness("paid", { filesLockedAt: new Date("2026-10-02T08:00:00.000Z") });
    await expect(
      asTenant(() => h.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: JPEG, originalname: "ad.jpg" })),
    ).rejects.toThrow(/המשרד נמחק/u);
    const key = h.order["creativeKey"] as string;
    expect(h.deleted).toEqual([key]);
    expect(h.sent).toHaveLength(0);
  });

  it("סוג לא נתמך, קובץ ריק, ומשרד אחר — נדחים לפני שנשמר דבר", async () => {
    const h = harness("paid");
    await expect(
      asTenant(() => h.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: GIF, originalname: "ad.gif" })),
    ).rejects.toThrow(/JPEG, PNG או PDF/u);
    await expect(
      asTenant(() => h.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: Buffer.alloc(0), originalname: "x.pdf" })),
    ).rejects.toThrow(/ריק/u);
    await expect(
      asTenant(() => h.service.upload({ tenantId: OTHER, userId: ME }, ORDER, { buffer: PDF, originalname: "x.pdf" })),
    ).rejects.toThrow(/לא נמצאה/u);
    expect(h.stored.size).toBe(0);
  });

  it("קריאה: המשרד שלו כן, משרד אחר לא, ולפי אסימון — תיאור בלי פרטי המשרד", async () => {
    const h = harness("paid");
    await asTenant(() => h.service.upload({ tenantId: TENANT, userId: ME }, ORDER, { buffer: PDF, originalname: "ad.pdf" }));
    expect((await h.service.getForTenant(TENANT, ORDER)).name).toBe("ad.pdf");
    await expect(h.service.getForTenant(OTHER, ORDER)).rejects.toThrow(/אין קובץ/u);
    const described = await h.service.describeByToken(h.order["creativeToken"] as string);
    expect(described).toMatchObject({ outletName: "מגזין טאבו", creativeName: "ad.pdf", creativeMime: "application/pdf" });
    expect(Object.keys(described)).not.toContain("officeName");
  });
});

describe("safeName", () => {
  it("בלי נתיבים ותווי בקרה, ועם הסיומת לפי התוכן", () => {
    expect(safeName("C:\\Users\\x\\final  ad.png", "jpg")).toBe("final  ad.jpg");
    expect(safeName("\u0000<>\"|:*?", "pdf")).toBe("ad.pdf");
    expect(safeName("", "png")).toBe("ad.png");
    expect(safeName(`${"a".repeat(200)}.pdf`, "pdf")).toBe(`${"a".repeat(120)}.pdf`);
  });
});
