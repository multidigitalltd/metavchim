import { describe, expect, it } from "vitest";
import { MediaOutletPatchSchema, MediaOutletUpsertSchema } from "../schemas/media.js";
import {
  DEFAULT_MEDIA_COMMISSION_PERCENT,
  MEDIA_ORDER_MAX_AMOUNT_AGOROT,
  MEDIA_ORDER_MAX_QUANTITY,
  MEDIA_ORDER_STATUSES,
  MEDIA_PRODUCT_PRICE_MAX_AGOROT,
  isMediaSlug,
  mediaCanUploadCreative,
  mediaClosingReminderDue,
  mediaClosingState,
  mediaCreativeMime,
  mediaOrderCanPublish,
  mediaOrderTimeline,
  mediaOrderTotals,
  resolveMediaCommissionPercent,
} from "./media.js";

const OUTLET = { slug: "tabu-magazine", name: "מגזין טאבו", kind: "magazine", commissionPercent: 10 };

describe("resolveMediaCommissionPercent", () => {
  it("ריק אינו אפס — נופל לברירת המחדל", () => {
    expect(resolveMediaCommissionPercent("")).toBe(DEFAULT_MEDIA_COMMISSION_PERCENT);
    expect(resolveMediaCommissionPercent(null)).toBe(DEFAULT_MEDIA_COMMISSION_PERCENT);
    expect(resolveMediaCommissionPercent(undefined)).toBe(DEFAULT_MEDIA_COMMISSION_PERCENT);
  });

  it("אפס הוא החלטה מפורשת", () => {
    expect(resolveMediaCommissionPercent(0)).toBe(0);
    expect(resolveMediaCommissionPercent("0")).toBe(0);
  });

  it("ערך פסול או מעל התקרה נופל לברירת המחדל", () => {
    expect(resolveMediaCommissionPercent("abc")).toBe(DEFAULT_MEDIA_COMMISSION_PERCENT);
    expect(resolveMediaCommissionPercent(-3)).toBe(DEFAULT_MEDIA_COMMISSION_PERCENT);
    expect(resolveMediaCommissionPercent(300)).toBe(DEFAULT_MEDIA_COMMISSION_PERCENT);
  });
});

describe("mediaOrderTotals", () => {
  it("עשרה אחוז מרבע עמוד ב-1,200 ₪", () => {
    const totals = mediaOrderTotals({ unitPriceAgorot: 120_000, quantity: 1, commissionPercent: 10 });
    expect(totals.amountAgorot).toBe(120_000);
    expect(totals.commissionAgorot).toBe(12_000);
    expect(totals.outletAgorot).toBe(108_000);
  });

  it("הכמות מכפילה, והעמלה נגזרת מהסכום הכולל", () => {
    const totals = mediaOrderTotals({ unitPriceAgorot: 33_333, quantity: 3, commissionPercent: 10 });
    expect(totals.amountAgorot).toBe(99_999);
    // 9,999.9 ⟵ רצפה
    expect(totals.commissionAgorot).toBe(9_999);
    expect(totals.outletAgorot).toBe(90_000);
  });

  it("העמלה מעוגלת כלפי מטה ולא עולה על הסכום", () => {
    expect(mediaOrderTotals({ unitPriceAgorot: 1, quantity: 1, commissionPercent: 50 }).commissionAgorot).toBe(0);
    expect(mediaOrderTotals({ unitPriceAgorot: 100, quantity: 1, commissionPercent: 0 }).commissionAgorot).toBe(0);
  });

  it("המחיר המרבי כפול הכמות המרבית נשאר בתקרת ההזמנה — גם עם מע\"מ, בתוך INTEGER", () => {
    const totals = mediaOrderTotals({
      unitPriceAgorot: MEDIA_PRODUCT_PRICE_MAX_AGOROT,
      quantity: MEDIA_ORDER_MAX_QUANTITY,
      commissionPercent: 10,
    });
    expect(totals.amountAgorot).toBeLessThanOrEqual(MEDIA_ORDER_MAX_AMOUNT_AGOROT);
    expect(Math.ceil(MEDIA_ORDER_MAX_AMOUNT_AGOROT * 1.5)).toBeLessThan(2_147_483_647);
  });

  it("כמות מחוץ לטווח נחתכת לטווח", () => {
    expect(mediaOrderTotals({ unitPriceAgorot: 100, quantity: 0, commissionPercent: 10 }).quantity).toBe(1);
    expect(mediaOrderTotals({ unitPriceAgorot: 100, quantity: 999, commissionPercent: 10 }).quantity).toBe(
      MEDIA_ORDER_MAX_QUANTITY,
    );
  });
});

describe("mediaClosingState / mediaClosingReminderDue", () => {
  const now = new Date("2026-09-22T09:00:00.000Z");
  const hours = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000);

  it("בלי מועד — none; רחוק — open; בתוך יומיים — soon; עבר — closed", () => {
    expect(mediaClosingState(null, now)).toBe("none");
    expect(mediaClosingState(hours(100), now)).toBe("open");
    expect(mediaClosingState(hours(30), now)).toBe("soon");
    expect(mediaClosingState(hours(-1), now)).toBe("closed");
  });

  it("התזכורת יוצאת פעם אחת לגיליון, ושוב כשהמועד מתעדכן", () => {
    const closing = hours(20);
    expect(mediaClosingReminderDue({ nextClosingAt: closing, remindedForClosingAt: null, now })).toBe(true);
    expect(mediaClosingReminderDue({ nextClosingAt: closing, remindedForClosingAt: closing, now })).toBe(false);
    const next = hours(20 + 7 * 24);
    expect(mediaClosingReminderDue({ nextClosingAt: next, remindedForClosingAt: closing, now })).toBe(false);
    expect(
      mediaClosingReminderDue({ nextClosingAt: next, remindedForClosingAt: closing, now: hours(7 * 24) }),
    ).toBe(true);
  });

  it("מועד שעבר או רחוק מדי — אין תזכורת", () => {
    expect(mediaClosingReminderDue({ nextClosingAt: hours(-2), remindedForClosingAt: null, now })).toBe(false);
    expect(mediaClosingReminderDue({ nextClosingAt: hours(40), remindedForClosingAt: null, now })).toBe(false);
  });
});

describe("isMediaSlug", () => {
  it("מקבל אותיות קטנות, ספרות ומקפים", () => {
    expect(isMediaSlug("tabu-magazine")).toBe(true);
    expect(isMediaSlug("yad2")).toBe(true);
  });

  it("דוחה רישיות, רווחים ומקף בקצה", () => {
    expect(isMediaSlug("Tabu")).toBe(false);
    expect(isMediaSlug("tabu magazine")).toBe(false);
    expect(isMediaSlug("tabu-")).toBe(false);
    expect(isMediaSlug("a")).toBe(false);
  });

  it("דוחה שמות שמורים — /media/orders הוא מסך ההזמנות", () => {
    expect(isMediaSlug("orders")).toBe(false);
    expect(MediaOutletUpsertSchema.safeParse({ ...OUTLET, slug: "orders" }).success).toBe(false);
    expect(MediaOutletPatchSchema.safeParse({ slug: "orders" }).success).toBe(false);
    expect(MediaOutletUpsertSchema.safeParse(OUTLET).success).toBe(true);
  });
});

describe("mediaCreativeMime / mediaCanUploadCreative", () => {
  it("מזהה JPEG, PNG ו-PDF לפי הבייטים — לא לפי השם", () => {
    expect(mediaCreativeMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(mediaCreativeMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(mediaCreativeMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe("application/pdf");
  });

  it("דוחה כל דבר אחר — גם קובץ קצר מדי", () => {
    expect(mediaCreativeMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(mediaCreativeMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(mediaCreativeMime(new Uint8Array([]))).toBeNull();
  });

  it("מעלים כל עוד ההזמנה חיה וטרם פורסמה", () => {
    expect(MEDIA_ORDER_STATUSES.filter(mediaCanUploadCreative)).toEqual(["pending_payment", "paid", "referred"]);
    expect(MEDIA_ORDER_STATUSES.filter(mediaOrderCanPublish)).toEqual(["paid", "referred"]);
  });
});

describe("mediaOrderTimeline", () => {
  const t0 = new Date("2026-10-01T08:00:00.000Z");
  const t1 = new Date("2026-10-01T09:00:00.000Z");
  const base = { createdAt: t0, paidAt: null, notifiedAt: null, creativeUploadedAt: null, publishedAt: null };

  it("הזמנה בתשלום שממתינה — „שולם” הוא השלב הנוכחי", () => {
    const steps = mediaOrderTimeline({ ...base, kind: "paid", status: "pending_payment" });
    expect(steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      "created:done",
      "paid:current",
      "sent:pending",
      "creative:pending",
      "published:pending",
    ]);
  });

  it("שולם ונשלח — הקובץ הוא מה שמחכה", () => {
    const steps = mediaOrderTimeline({ ...base, kind: "paid", status: "paid", paidAt: t1, notifiedAt: t1 });
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done", "current", "pending"]);
  });

  it("הפניה — בלי שלב תשלום; נכשל — נעצר בשלב התשלום", () => {
    expect(mediaOrderTimeline({ ...base, kind: "lead", status: "referred", notifiedAt: t1 }).map((s) => s.key)).toEqual([
      "created",
      "sent",
      "creative",
      "published",
    ]);
    const failed = mediaOrderTimeline({ ...base, kind: "paid", status: "failed" });
    expect(failed[1]).toMatchObject({ key: "paid", state: "failed", label: "התשלום נכשל" });
    expect(failed.slice(2).every((s) => s.state === "pending")).toBe(true);
  });

  it("פורסם — כל מה שקדם מסומן כבוצע, חוץ מקובץ שלא הועלה", () => {
    const steps = mediaOrderTimeline({ ...base, kind: "lead", status: "referred", publishedAt: t1 });
    expect(steps.at(-1)?.state).toBe("pending");
    const published = mediaOrderTimeline({ ...base, kind: "lead", status: "published", publishedAt: t1 });
    expect(published.map((s) => s.state)).toEqual(["done", "done", "pending", "done"]);
  });
});
