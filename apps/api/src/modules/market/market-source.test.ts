import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MarketSourceFormatError,
  MarketSourceRateLimitError,
  MarketSourceTransientError,
  OverOrgIlSource,
} from "./market-source";

/**
 * המתאם מול התשובות של over.org.il — **בצורה שבה הן הגיעו באמת.**
 *
 * הגופים כאן הועתקו מתשובות אמיתיות (2026-10-05) ונקצצו לשדות
 * שהמתאם קורא. שימו לב שהמקור עצמו אינו עקבי: `gush` מגיע כמחרוזת
 * בחיפוש וכמספר בחלקה, `portion` כ-"1.000", ותת-חלקה כ-"006". זה
 * בדיוק מה שהמתאם צריך לבלוע — ומה שבדיקה עם מספרים נקיים לא הייתה
 * תופסת.
 */

const SEARCH_ROW = {
  date: "2026-08-23",
  date_src: "23/08/2026",
  amount: 1230252,
  declared_amount: 1230252,
  nature: "דירה בבית קומות",
  area_sqm: 91,
  rooms: 3,
  year_built: 2029,
  portion: "1.000",
  portion_fraction: 1.0,
  price_per_sqm: 13519,
  price_per_sqm_normalized: 13519,
  sub_parcel: "006",
  settlement: "חיפה",
  settlement_code: "4000",
  gush: "11359",
  helka: "81",
  addresses: [],
  addresses_total: 0,
};

const searchBody = (rows: unknown[], sort = "date_asc") => ({
  query: {},
  data: rows,
  total: rows.length,
  total_capped: false,
  limit: 200,
  offset: 0,
  sort,
});

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const source = () => new OverOrgIlSource("https://example.test/api");

describe("חיפוש עסקאות", () => {
  it("בולע מחרוזות-מספרים ומנרמל", async () => {
    respond(200, searchBody([SEARCH_ROW]));
    const page = await source().dealsSince("חיפה", "2026-01-01", 0, 200);
    expect(page.pageSize).toBe(1);
    expect(page.deals[0]).toEqual({
      date: "2026-08-23",
      amountIls: 1230252,
      nature: "דירה בבית קומות",
      areaSqm: 91,
      rooms: 3,
      yearBuilt: 2029,
      portion: 1,
      subParcel: 6,
      settlement: "חיפה",
      gush: 11359,
      helka: 81,
    });
  });

  it("שולח את הפרמטרים שהסנכרון נשען עליהם", async () => {
    respond(200, searchBody([]));
    await source().dealsSince("תל אביב -יפו", "2020-02-01", 400, 200);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/deals/search");
    expect(url.searchParams.get("settlement")).toBe("תל אביב -יפו");
    expect(url.searchParams.get("date_from")).toBe("2020-02-01");
    expect(url.searchParams.get("sort")).toBe("date_asc");
    expect(url.searchParams.get("offset")).toBe("400");
  });

  it("עסקה בלי גוש או סכום נזרקת — אבל נספרת בגודל העמוד", async () => {
    respond(200, searchBody([SEARCH_ROW, { ...SEARCH_ROW, gush: null }, { ...SEARCH_ROW, amount: "" }]));
    const page = await source().dealsSince("חיפה", "2026-01-01", 0, 200);
    expect(page.deals).toHaveLength(1);
    expect(page.pageSize).toBe(3);
  });

  it("חדרים של בניין וחלק נמכר לא הגיוני — null ולא מספר שגוי", async () => {
    respond(200, searchBody([{ ...SEARCH_ROW, rooms: 120, portion_fraction: 0, portion: "0.000", year_built: 0 }]));
    const [deal] = (await source().dealsSince("חיפה", "2026-01-01", 0, 200)).deals;
    expect(deal!.rooms).toBeNull();
    expect(deal!.portion).toBeNull();
    expect(deal!.yearBuilt).toBeNull();
  });

  it("מקור שאינו ממיין מהישנה לחדשה — עוצר הכול", async () => {
    respond(200, searchBody([SEARCH_ROW], "date_desc"));
    await expect(source().dealsSince("חיפה", "2026-01-01", 0, 200)).rejects.toBeInstanceOf(MarketSourceFormatError);
  });

  it("הד נכון אבל סדר הפוך בפועל — גם עוצר", async () => {
    respond(200, searchBody([{ ...SEARCH_ROW, date: "2026-09-01" }, SEARCH_ROW]));
    await expect(source().dealsSince("חיפה", "2026-01-01", 0, 200)).rejects.toBeInstanceOf(MarketSourceFormatError);
  });

  it("שדה ששינה טיפוס — עוצר, ולא מדלג בשקט", async () => {
    respond(200, searchBody([{ ...SEARCH_ROW, date: "23/08/2026" }]));
    await expect(source().dealsSince("חיפה", "2026-01-01", 0, 200)).rejects.toBeInstanceOf(MarketSourceFormatError);
  });
});

describe("שגיאות רשת", () => {
  it("429 ו-403 — האטה", async () => {
    respond(429, {});
    await expect(source().stats()).rejects.toBeInstanceOf(MarketSourceRateLimitError);
    respond(403, {});
    await expect(source().stats()).rejects.toBeInstanceOf(MarketSourceRateLimitError);
  });

  it("5xx — תקלה זמנית", async () => {
    respond(502, {});
    await expect(source().stats()).rejects.toBeInstanceOf(MarketSourceTransientError);
  });

  it("404 על חלקה — „אין כזו”, לא שגיאה", async () => {
    respond(404, { detail: "Not Found" });
    await expect(source().parcel(1, 1)).resolves.toBeNull();
  });

  it("404 על חיפוש — שגיאת צורה", async () => {
    respond(404, { detail: "Not Found" });
    await expect(source().dealsSince("x", "2020-01-01", 0, 10)).rejects.toBeInstanceOf(MarketSourceFormatError);
  });
});

describe("קטלוג וחלקות", () => {
  it("יישובים — קוד כמחרוזת, שם ריק נזרק", async () => {
    respond(200, {
      data: [
        { settlement: "תל אביב -יפו", settlement_code: "5000", deals: 250853, last_deal: "2026-07-26", resolved_code: 5000 },
        { settlement: " ", settlement_code: null, deals: 4, last_deal: null },
      ],
    });
    expect(await source().settlements()).toEqual([
      { name: "תל אביב -יפו", code: 5000, deals: 250853, lastDeal: "2026-07-26" },
    ]);
  });

  it("חלקה לפי נקודה — מזהה, אזור סטטיסטי ואשכול", async () => {
    respond(200, {
      query: { mode: "point" },
      data: [
        {
          parcel_key: "7104-0-289",
          identity: {
            gush: 7104,
            gush_suffix: 0,
            helka: 289,
            settlement: { code: 5000, name: "תל אביב -יפו" },
            distance_m: 0.0,
          },
          stat_area: { code: 613, yishuv_stat: 50000613, socio: { eshkol: 10, index_year: 2021 } },
        },
      ],
    });
    expect(await source().parcelAt(32.0682, 34.7847)).toEqual({
      gush: 7104,
      helka: 289,
      settlementCode: 5000,
      statArea: 50000613,
      socioEshkol: 10,
      lat: 32.0682,
      lon: 34.7847,
      street: null,
    });
  });

  it("חלקה לפי כתובת — נקודה ורחוב מהזהות", async () => {
    respond(200, {
      data: [
        {
          identity: {
            gush: 6319,
            helka: 225,
            settlement: { code: 7900, name: "פתח תקווה" },
            point: { lat: 32.0789, lon: 34.9172 },
            streets: ["אבימלך"],
          },
        },
      ],
    });
    const parcel = await source().parcel(6319, 225);
    expect(parcel?.lat).toBeCloseTo(32.0789);
    expect(parcel?.street).toBe("אבימלך");
    expect(parcel?.statArea).toBeNull();
  });
});
