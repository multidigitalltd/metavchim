import { describe, expect, it } from "vitest";
import { capitalGains, DEFAULT_TAX_TABLES, linearExemptShare } from "./capital-gains.js";

const base = {
  purchasePriceShekels: 1_500_000,
  purchaseDate: "2016-01-01",
  salePriceShekels: 2_500_000,
  saleDate: "2026-01-01",
  expensesShekels: 100_000,
  cpiPercent: 0,
  singleHome: false,
  singleHomeCeilingShekels: DEFAULT_TAX_TABLES.capitalGains.singleHomeCeiling,
};

describe("מס שבח — הערכה", () => {
  it("דירה נוספת שנרכשה אחרי 2014: 25% על כל השבח הריאלי", () => {
    const r = capitalGains(base);
    expect(r.nominalGain).toBe(900_000);
    expect(r.linearExemptShare).toBe(0);
    expect(r.taxableGain).toBe(900_000);
    expect(r.tax).toBe(225_000);
  });

  it("המדד מוריד את השבח הריאלי — על מחיר הרכישה בלבד, לא על ההוצאות", () => {
    const r = capitalGains({ ...base, cpiPercent: 10 });
    expect(r.inflationary).toBe(150_000);
    expect(r.inflationaryTaxable).toBe(0);
    expect(r.realGain).toBe(750_000);
    expect(r.tax).toBe(187_500);
  });

  it("רכישה לפני 1994: החלק האינפלציוני שעד סוף 1993 חייב ב-10%", () => {
    /* ‏1.1.1984 ⟵ 1.1.2024: רבע מהתקופה לפני 1994; הכול לפני 2014 בחצי מהתקופה... */
    const r = capitalGains({ ...base, purchaseDate: "1984-01-01", saleDate: "2024-01-01", purchasePriceShekels: 100_000, salePriceShekels: 2_100_000, expensesShekels: 0, cpiPercent: 400 });
    expect(r.inflationary).toBe(400_000);
    expect(r.inflationaryTaxable).toBeCloseTo(100_000, -3);
    /* ‏שבח ריאלי 1,600,000 × (1 − 0.75 ליניארי) × 25% + 100,000 × 10% */
    expect(r.tax).toBeCloseTo(110_000, -3);
    expect(r.notes.some((n) => n.includes("31.12.1993"))).toBe(true);
  });

  it("חישוב ליניארי מוטב: חצי מהתקופה לפני 2014 — חצי פטור", () => {
    expect(linearExemptShare("2010-01-01", "2018-01-01")).toBeCloseTo(0.5, 2);
    expect(linearExemptShare("2000-01-01", "2013-06-01")).toBe(1);
    expect(linearExemptShare("2015-01-01", "2020-01-01")).toBe(0);
    const r = capitalGains({ ...base, purchaseDate: "2010-01-01", saleDate: "2018-01-01" });
    expect(r.taxableGain).toBeCloseTo(450_000, -3);
  });

  it("דירה יחידה: פטור מלא עד התקרה, ומעליה — החלק היחסי חייב", () => {
    expect(capitalGains({ ...base, singleHome: true }).tax).toBe(0);
    const above = capitalGains({ ...base, singleHome: true, salePriceShekels: 10_016_000 });
    expect(above.taxableShare).toBeCloseTo(0.5, 6);
    /* ‏שבח 8,416,000 × חצי × 25% */
    expect(above.tax).toBe(1_052_000);
  });

  it("בלי שבח — בלי מס", () => {
    const r = capitalGains({ ...base, salePriceShekels: 1_000_000 });
    expect(r.tax).toBe(0);
    expect(r.notes[0]).toContain("אין שבח");
  });
});
