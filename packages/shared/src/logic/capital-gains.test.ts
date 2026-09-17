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

  it("המדד מוריד את השבח הריאלי", () => {
    const r = capitalGains({ ...base, cpiPercent: 10 });
    expect(r.inflationary).toBe(160_000);
    expect(r.realGain).toBe(740_000);
    expect(r.tax).toBe(185_000);
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
