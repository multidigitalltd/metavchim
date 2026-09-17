import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_TABLES } from "@metavchim/shared";
import { TaxTablesService } from "./tax-tables.service";

/** ‏טבלאות המס: בלי הגדרה (או עם JSON פגום) — ערכי הקוד; שמירה עוברת סכמה. */
describe("TaxTablesService", () => {
  function make(stored: string | undefined) {
    const writes: string[] = [];
    const settings = {
      get: async () => stored,
      set: async (_key: string, value: string) => {
        writes.push(value);
      },
    };
    return { svc: new TaxTablesService(settings as never), writes };
  }

  it("בלי הגדרה — ברירת המחדל שבקוד", async () => {
    expect(await make(undefined).svc.current()).toEqual(DEFAULT_TAX_TABLES);
  });

  it("JSON פגום — ברירת המחדל, לא קריסה", async () => {
    expect(await make("{oops").svc.current()).toEqual(DEFAULT_TAX_TABLES);
    expect(await make(JSON.stringify({ purchase: {} })).svc.current()).toEqual(DEFAULT_TAX_TABLES);
  });

  it("שמירה: מדרגות שאינן עולות נדחות; תקינות נשמרות ונקראות חזרה", async () => {
    const { svc, writes } = make(undefined);
    const bad = { ...DEFAULT_TAX_TABLES, purchase: { ...DEFAULT_TAX_TABLES.purchase, singleHome: [{ upTo: 5, percent: 0 }, { upTo: 4, percent: 3 }, { upTo: null, percent: 5 }] } };
    await expect(svc.replace(bad, "01USER")).rejects.toThrow();
    const good = { ...DEFAULT_TAX_TABLES, capitalGains: { year: 2026, singleHomeCeiling: 5_200_000 } };
    await svc.replace(good, "01USER");
    expect(writes).toHaveLength(1);
    expect(await make(writes[0]).svc.current()).toEqual(good);
  });
});
