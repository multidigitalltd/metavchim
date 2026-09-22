import { describe, expect, it } from "vitest";
import { MediaOutletPatchSchema, MediaOutletUpsertSchema } from "../schemas/media.js";
import {
  DEFAULT_MEDIA_COMMISSION_PERCENT,
  MEDIA_ORDER_MAX_AMOUNT_AGOROT,
  MEDIA_ORDER_MAX_QUANTITY,
  MEDIA_PRODUCT_PRICE_MAX_AGOROT,
  isMediaSlug,
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
