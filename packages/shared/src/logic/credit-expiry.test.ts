import { describe, expect, it } from "vitest";
import {
  addMonths,
  EXPIRY_KIND,
  expiryWarningText,
  planCreditExpiry,
  type CreditLedgerEntry,
} from "./credit-expiry.js";

const at = (iso: string): Date => new Date(iso);

let seq = 0;
function entry(
  kind: string,
  amount: number,
  createdAt: string,
  refId: string | null = null,
): CreditLedgerEntry {
  seq += 1;
  return { id: `01ENTRY${String(seq).padStart(5, "0")}`, kind, amount, refId, createdAt: at(createdAt) };
}

describe("addMonths", () => {
  it("סוף חודש אינו גולש קדימה", () => {
    expect(addMonths(at("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("שנה מעוברת", () => {
    expect(addMonths(at("2028-01-31T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("שעה נשמרת — התוקף נגמר באותה שעה ביום", () => {
    expect(addMonths(at("2026-03-15T09:30:00Z"), 12).toISOString()).toBe("2027-03-15T09:30:00.000Z");
  });
});

describe("planCreditExpiry", () => {
  it("מענק שפג ולא נוצל — מופקע במלואו", () => {
    const plan = planCreditExpiry(
      [entry("initial_grant", 20, "2025-01-01T00:00:00Z")],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.expire).toHaveLength(1);
    expect(plan.expire[0]!.amount).toBe(20);
  });

  it("מנה שנוצלה חלקית — מופקעת רק היתרה", () => {
    const plan = planCreditExpiry(
      [
        entry("initial_grant", 20, "2025-01-01T00:00:00Z"),
        entry("lead_purchase", -15, "2025-02-01T00:00:00Z"),
      ],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.expire).toHaveLength(1);
    expect(plan.expire[0]!.amount).toBe(5);
  });

  it("קרדיטים שנרכשו בכסף אינם פגים — הפקעתם הייתה חילוט", () => {
    const plan = planCreditExpiry(
      [entry("purchase", 100, "2020-01-01T00:00:00Z")],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.expire).toEqual([]);
    expect(plan.balance).toBe(100);
  });

  it("החזר כספי אינו פג אף הוא", () => {
    const plan = planCreditExpiry(
      [entry("refund", 30, "2020-01-01T00:00:00Z")],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.expire).toEqual([]);
  });

  it("תפוגה כבויה (0) — שום דבר אינו פג, גם ליתרה ותיקה", () => {
    const plan = planCreditExpiry(
      [entry("initial_grant", 20, "2019-01-01T00:00:00Z")],
      0,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.expire).toEqual([]);
    expect(plan.batches[0]!.expiresAt).toBeNull();
  });

  it("הקרוב לפוג נצרך ראשון — כך מופקע הכי מעט", () => {
    const plan = planCreditExpiry(
      [
        entry("purchase", 50, "2026-01-01T00:00:00Z"),
        entry("initial_grant", 20, "2026-02-01T00:00:00Z"),
        entry("lead_purchase", -20, "2026-03-01T00:00:00Z"),
      ],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    // המענק נצרך במלואו, הרכישה נשארה — אין מה להפקיע בעתיד
    const grant = plan.batches.find((b) => b.kind === "initial_grant")!;
    const purchase = plan.batches.find((b) => b.kind === "purchase")!;
    expect(grant.remaining).toBe(0);
    expect(purchase.remaining).toBe(50);
  });

  it("חיוב אינו מבטל בדיעבד קנייה שאושרה — גם כשהמנה כבר פגה בזמנו", () => {
    /*
     * המענק פג בינואר 2026, החיוב נרשם בפברואר, והסריקה מעולם לא
     * רצה. הכלל: מה שנקנה נקנה. אין יתרה שלילית רטרואקטיבית.
     */
    const plan = planCreditExpiry(
      [
        entry("initial_grant", 20, "2025-01-01T00:00:00Z"),
        entry("lead_purchase", -20, "2026-02-01T00:00:00Z"),
      ],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.expire).toEqual([]);
    expect(plan.balance).toBe(0);
  });

  it("הפקעה שכבר נכתבה אינה מופקעת שוב", () => {
    const grant = entry("initial_grant", 20, "2025-01-01T00:00:00Z");
    const plan = planCreditExpiry(
      [grant, entry(EXPIRY_KIND, -20, "2026-01-01T00:00:00Z", grant.id)],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.expire).toEqual([]);
    expect(plan.balance).toBe(0);
  });

  it("הפקעה שנכתבה אינה נוגסת במנה אחרת — זו הייתה הפקעה כפולה", () => {
    const old = entry("initial_grant", 20, "2025-01-01T00:00:00Z");
    const fresh = entry("lead_sale", 30, "2026-06-01T00:00:00Z");
    const plan = planCreditExpiry(
      [old, fresh, entry(EXPIRY_KIND, -20, "2026-01-01T00:00:00Z", old.id)],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.batches.find((b) => b.id === fresh.id)!.remaining).toBe(30);
    expect(plan.expire).toEqual([]);
  });

  it("מתריעים 30 יום מראש, ולא על מה שכבר פג", () => {
    const plan = planCreditExpiry(
      [
        entry("lead_sale", 12, "2025-09-01T00:00:00Z"), // פג 01/09/2026 — בעוד 17 יום
        entry("lead_sale", 5, "2025-11-01T00:00:00Z"), // פג 01/11/2026 — רחוק
      ],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.expiringSoon).toHaveLength(1);
    expect(plan.expiringSoon[0]!.amount).toBe(12);
  });

  it("יתרה שלילית אפשרית ואינה מפילה את החישוב", () => {
    const plan = planCreditExpiry(
      [entry("initial_grant", 5, "2026-01-01T00:00:00Z"), entry("coop_offer", -8, "2026-02-01T00:00:00Z")],
      12,
      at("2026-08-15T00:00:00Z"),
    );
    expect(plan.balance).toBe(-3);
    expect(plan.expire).toEqual([]);
  });

  it("ספר ריק", () => {
    const plan = planCreditExpiry([], 12, at("2026-08-15T00:00:00Z"));
    expect(plan).toMatchObject({ balance: 0, expire: [], expiringSoon: [] });
  });
});

describe("expiryWarningText", () => {
  it("מסכם את הכמות ואת המועד הקרוב ביותר", () => {
    const out = expiryWarningText(
      [
        { batchId: "a", amount: 12, expiresAt: at("2026-09-01T00:00:00Z") },
        { batchId: "b", amount: 8, expiresAt: at("2026-09-10T00:00:00Z") },
      ],
      at("2026-08-15T00:00:00Z"),
    );
    expect(out.title).toBe("20 קרדיטים עומדים לפוג");
    expect(out.body).toContain("17 ימים");
  });

  it("יום אחד — לא \"בעוד 1 ימים\"", () => {
    const out = expiryWarningText(
      [{ batchId: "a", amount: 3, expiresAt: at("2026-08-16T00:00:00Z") }],
      at("2026-08-15T00:00:00Z"),
    );
    expect(out.body).toContain("מחר");
  });
});
