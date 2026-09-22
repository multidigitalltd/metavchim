import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEDIA_COMMISSION_PERCENT,
  MEDIA_ORDER_MAX_QUANTITY,
  isMediaSlug,
  mediaOrderTotals,
  resolveMediaCommissionPercent,
} from "./media.js";

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
});
