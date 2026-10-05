import { describe, expect, it } from "vitest";
import {
  MARKET_FLAGS,
  MARKET_MIN_SAMPLE,
  budgetFit,
  countsForStats,
  estimateFromComps,
  formatMarketIls,
  hasMarketFlag,
  isPartialPeriod,
  marketDealFlags,
  marketDealKey,
  marketFlagNames,
  marketNatureGroup,
  marketPosition,
  marketPositionSentence,
  marketPulseSentence,
  marketRoomBucket,
  marketSpread,
  percentChange,
  pricePerSqm,
  propertyTypeToNatureGroup,
  quantile,
  resolveMarketSettlement,
  selectComparables,
  type MarketComparable,
  type MarketSubject,
} from "./market.js";

const NOW = new Date("2026-10-05T12:00:00Z");

function deal(overrides: Partial<MarketComparable> = {}): MarketComparable {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    date: "2026-06-01",
    amountIls: 2_000_000,
    group: "apartment",
    areaSqm: 100,
    rooms: 4,
    yearBuilt: 1990,
    gush: 6319,
    helka: 225,
    subParcel: null,
    statArea: 613,
    ppsqm: 20_000,
    flags: 0,
    ...overrides,
  };
}

const SUBJECT: MarketSubject = {
  group: "apartment",
  rooms: 4,
  areaSqm: 100,
  gush: 6319,
  helka: 225,
  statArea: 613,
};

describe("קבוצות סוג הנכס", () => {
  it("ממפה את הסוגים הנפוצים של רשות המסים", () => {
    expect(marketNatureGroup("דירה בבית קומות")).toBe("apartment");
    expect(marketNatureGroup("דירת גן")).toBe("garden");
    expect(marketNatureGroup("דירת גג")).toBe("penthouse");
    expect(marketNatureGroup("קוטג' דו משפחתי")).toBe("house");
    expect(marketNatureGroup("חנות")).toBe("commercial");
    expect(marketNatureGroup("לא מעובדת")).toBe("land");
    expect(marketNatureGroup("קומבינציה")).toBe("other");
  });

  it("„מגורים” אינו דירה — רובן עסקאות בלי חדרים ובלי שטח", () => {
    expect(marketNatureGroup("מגורים")).toBe("residential_other");
    expect(marketNatureGroup("ד. מגורים")).toBe("residential_other");
  });

  it("„דירת גן” אינה נבלעת ב„דירה”", () => {
    // הסדר בטבלת הכללים — הספציפי קודם
    expect(marketNatureGroup("דירת גן")).not.toBe("apartment");
  });

  it("סוג לא מוכר או ריק → אחר, לא ניחוש", () => {
    expect(marketNatureGroup("משהו חדש")).toBe("other");
    expect(marketNatureGroup("")).toBe("other");
    expect(marketNatureGroup(null)).toBe("other");
  });

  it("סוג הנכס במערכת → קבוצה", () => {
    expect(propertyTypeToNatureGroup("garden_apartment")).toBe("garden");
    expect(propertyTypeToNatureGroup("two_family")).toBe("house");
    expect(propertyTypeToNatureGroup("plot")).toBe("land");
    expect(propertyTypeToNatureGroup(undefined)).toBe("apartment");
  });
});

describe("דגלי עסקה", () => {
  it("חלק נמכר, קבלן, שטח וחדרים חסרים, סכום זעיר", () => {
    const flags = marketDealFlags({
      date: "2024-03-01",
      amountIls: 30_000,
      group: "apartment",
      areaSqm: null,
      rooms: null,
      yearBuilt: 2026,
      portion: 0.5,
    });
    for (const flag of ["partial", "newBuild", "noArea", "noRooms", "tinyAmount"] as const) {
      expect(hasMarketFlag(flags, flag), flag).toBe(true);
    }
    expect(countsForStats(flags)).toBe(false);
  });

  it("שמות הדגלים", () => {
    expect(marketFlagNames(MARKET_FLAGS.partial | MARKET_FLAGS.outlier)).toEqual(["partial", "outlier"]);
    expect(marketFlagNames(0)).toEqual([]);
  });

  it("עסקה תקינה נספרת, וגם עסקת קבלן נספרת", () => {
    const clean = marketDealFlags({
      date: "2024-03-01",
      amountIls: 1_800_000,
      group: "apartment",
      areaSqm: 90,
      rooms: 4,
      yearBuilt: 2027,
      portion: 1,
    });
    expect(clean).toBe(MARKET_FLAGS.newBuild);
    expect(countsForStats(clean)).toBe(true);
  });

  it("סכום זעיר אינו דגל לקרקע — קרקע זולה היא קרקע", () => {
    const flags = marketDealFlags({
      date: "2024-03-01",
      amountIls: 20_000,
      group: "land",
      areaSqm: 500,
      rooms: null,
      yearBuilt: null,
      portion: 1,
    });
    expect(hasMarketFlag(flags, "tinyAmount")).toBe(false);
  });
});

describe("מחיר למ\"ר", () => {
  it("מנורמל לחלק שנמכר", () => {
    // רבע דירה של 100 מ"ר ב-500 אלף = 20 אלף למ"ר, לא 5 אלף
    expect(pricePerSqm(500_000, 100, 0.25)).toBe(20_000);
  });
  it("בלי שטח — אין מחיר למ\"ר", () => {
    expect(pricePerSqm(1_000_000, null, 1)).toBeNull();
    expect(pricePerSqm(1_000_000, 0, 1)).toBeNull();
  });
});

describe("סטטיסטיקה", () => {
  it("אחוזון זהה ל-percentile_cont", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.25)).toBe(10);
  });

  it("פחות מהמינימום — אין מספר", () => {
    expect(marketSpread([1, 2, 3, 4])).toBeNull();
    expect(marketSpread([1, 2, 3, 4, 5])?.median).toBe(3);
  });

  it("גדר החריגים אינה מסמנת את הקצוות של מדגם רגיל", () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(marketSpread(values)?.n).toBe(40);
  });

  it("חיתוך חריגים רחוקים רק כשיש מספיק נתונים", () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + i);
    values.push(1_000_000); // הקלדה שגויה
    const spread = marketSpread(values);
    expect(spread).not.toBeNull();
    expect(spread!.median).toBeLessThan(200);
  });

  it("שינוי באחוזים בלי בסיס → null", () => {
    expect(percentChange(0, 10)).toBeNull();
    expect(percentChange(null, 10)).toBeNull();
    expect(percentChange(100, 108)).toBe(8);
  });

  it("דליי חדרים", () => {
    expect(marketRoomBucket(null)).toBe(0);
    expect(marketRoomBucket(2)).toBe(2);
    expect(marketRoomBucket(3.5)).toBe(4);
    expect(marketRoomBucket(7)).toBe(6);
  });
});

describe("עסקאות דומות", () => {
  it("הבניין עצמו קודם כשיש בו מספיק", () => {
    const candidates = Array.from({ length: MARKET_MIN_SAMPLE }, () => deal());
    const result = selectComparables(SUBJECT, candidates, NOW);
    expect(result.scope).toBe("building");
    expect(result.insufficient).toBe(false);
    expect(result.estimate?.mid).toBe(2_000_000);
    expect(result.estimate?.basis).toBe("ppsqm");
  });

  it("מרחיב לגוש ואז ליישוב, ואומר לאן", () => {
    const sameBlock = Array.from({ length: 3 }, () => deal({ helka: 999 }));
    const elsewhere = Array.from({ length: 6 }, () => deal({ gush: 1, helka: 1, statArea: 1 }));
    const result = selectComparables(SUBJECT, [...sameBlock, ...elsewhere], NOW);
    expect(result.scope).toBe("settlement");
    expect(result.sampleSize).toBe(9);
  });

  it("פוסל גודל שונה מדי ועסקאות חלקיות", () => {
    const candidates = [
      ...Array.from({ length: 5 }, () => deal({ rooms: 6 })),
      ...Array.from({ length: 5 }, () => deal({ areaSqm: 200 })),
      ...Array.from({ length: 5 }, () => deal({ flags: MARKET_FLAGS.partial })),
    ];
    const result = selectComparables(SUBJECT, candidates, NOW);
    expect(result.sampleSize).toBe(0);
    expect(result.insufficient).toBe(true);
    expect(result.estimate).toBeNull();
    expect(result.scope).toBeNull();
  });

  it("עסקאות ישנות מהחלון אינן נספרות", () => {
    const old = Array.from({ length: 10 }, () => deal({ date: "2020-01-01" }));
    expect(selectComparables(SUBJECT, old, NOW).sampleSize).toBe(0);
  });

  it("בלי שטח לנכס — הערכה לפי חציון המחירים", () => {
    const candidates = Array.from({ length: 6 }, (_, i) => deal({ amountIls: 1_000_000 + i * 100_000 }));
    const result = selectComparables({ ...SUBJECT, areaSqm: null }, candidates, NOW);
    expect(result.estimate?.basis).toBe("price");
    expect(result.matchedOn.area).toBe(false);
  });

  it("אפשר להוציא עסקאות קבלן", () => {
    const candidates = Array.from({ length: 6 }, () => deal({ flags: MARKET_FLAGS.newBuild }));
    expect(selectComparables(SUBJECT, candidates, NOW).sampleSize).toBe(6);
    expect(selectComparables(SUBJECT, candidates, NOW, { excludeNewBuild: true }).sampleSize).toBe(0);
  });

  it("הרשימה המוצגת ממוינת מהחדשה לישנה", () => {
    const candidates = [deal({ date: "2026-01-01" }), ...Array.from({ length: 5 }, () => deal({ date: "2025-01-01" })), deal({ date: "2026-09-01" })];
    const result = selectComparables(SUBJECT, candidates, NOW);
    expect(result.comps[0]!.date).toBe("2026-09-01");
  });

  it("estimateFromComps מתעלם מעסקאות מסומנות", () => {
    const comps = [
      ...Array.from({ length: 5 }, () => deal()),
      deal({ ppsqm: 90_000, flags: MARKET_FLAGS.outlier }),
    ];
    expect(estimateFromComps(SUBJECT, comps)?.medianPpsqm).toBe(20_000);
  });
});

describe("מחיר מבוקש מול השוק", () => {
  const estimate = { mid: 2_000_000, low: 1_800_000, high: 2_200_000, basis: "ppsqm" as const, medianPpsqm: 20_000 };

  it("מעל, בתוך, מתחת", () => {
    expect(marketPosition(2_400_000, estimate)).toEqual({ kind: "above", diffPct: 20, opportunity: false });
    expect(marketPosition(2_100_000, estimate)?.kind).toBe("within");
    expect(marketPosition(1_600_000, estimate)).toEqual({ kind: "below", diffPct: -20, opportunity: true });
  });

  it("בלי מחיר או בלי הערכה — אין טענה", () => {
    expect(marketPosition(null, estimate)).toBeNull();
    expect(marketPosition(2_000_000, null)).toBeNull();
  });

  it("המשפט מציין את מספר העסקאות", () => {
    const sentence = marketPositionSentence({ kind: "above", diffPct: 12, opportunity: false }, 9);
    expect(sentence).toContain("9 עסקאות דומות");
    expect(sentence).toContain("+12%");
  });
});

describe("תקציב מול השוק", () => {
  const prices = [
    { settlement: "חיפה", rooms: 4 as const, year: 2025, deals: 400, p25: 1_000_000, median: 1_300_000, p75: 1_600_000 },
    { settlement: "תל אביב -יפו", rooms: 4 as const, year: 2024, deals: 900, p25: 3_000_000, median: 3_800_000, p75: 4_600_000 },
    { settlement: "כפר קטן", rooms: 4 as const, year: 2025, deals: 2, p25: 1, median: 1, p75: 1 },
  ];

  it("לכל עיר בנפרד, ובלי ערים דלות", () => {
    const fit = budgetFit(1_400_000, prices);
    expect(fit.map((f) => [f.settlement, f.kind])).toEqual([
      ["חיפה", "comfortable"],
      ["תל אביב -יפו", "below"],
    ]);
  });

  it("כל עיר נושאת את השנה של המחיר שלה", () => {
    expect(budgetFit(1_400_000, prices).map((f) => [f.settlement, f.year])).toEqual([
      ["חיפה", 2025],
      ["תל אביב -יפו", 2024],
    ]);
  });

  it("בלי תקציב — אין הערכה", () => {
    expect(budgetFit(null, prices)).toEqual([]);
  });
});

describe("דופק השוק", () => {
  it("משפט עם נפח ומחיר", () => {
    const sentence = marketPulseSentence({
      area: "בחיפה",
      periodLabel: "ברבעון האחרון",
      current: { deals: 920, medianPpsqm: 15_450 },
      previous: { deals: 1_000, medianPpsqm: 15_000 },
    });
    expect(sentence).toContain("8% פחות מאשתקד");
    expect(sentence).toContain("עלה 3%");
  });

  it("בסיס דל — שותק", () => {
    expect(
      marketPulseSentence({
        area: "בכפר",
        periodLabel: "ברבעון האחרון",
        current: { deals: 3, medianPpsqm: 10_000 },
        previous: { deals: 6, medianPpsqm: 9_000 },
      }),
    ).toBeNull();
  });
});

describe("עדכניות ומפתח", () => {
  it("שלושת החודשים האחרונים חלקיים", () => {
    expect(isPartialPeriod("2026-09-01", NOW)).toBe(true);
    expect(isPartialPeriod("2026-01-01", NOW)).toBe(false);
  });

  it("מפתח יציב ורגיש לכל שדה מזהה", () => {
    const base = {
      date: "2026-08-23",
      amountIls: 1_230_252,
      gush: 11359,
      helka: 81,
      subParcel: 6,
      nature: "דירה בבית קומות",
      areaSqm: 91,
      rooms: 3,
      portion: 1,
    };
    expect(marketDealKey(base)).toBe(marketDealKey({ ...base }));
    expect(marketDealKey(base)).not.toBe(marketDealKey({ ...base, subParcel: 7 }));
    expect(marketDealKey(base)).not.toBe(marketDealKey({ ...base, portion: 0.5 }));
  });

  it("תצוגת סכומים", () => {
    expect(formatMarketIls(1_250_000)).toBe("1.25 מיליון ₪");
    expect(formatMarketIls(2_000_000)).toBe("2 מיליון ₪");
    expect(formatMarketIls(880_000)).toBe("880 אלף ₪");
  });
});

describe("שם יישוב", () => {
  const settlements = [
    { id: 1, name: "תל אביב -יפו", deals: 250_853 },
    { id: 2, name: "קרית אתא", deals: 30_000 },
    { id: 3, name: "פתח תקווה", deals: 124_367 },
    { id: 4, name: "אור יהודה", deals: 20_000 },
    { id: 5, name: "אור עקיבא", deals: 15_000 },
    { id: 6, name: "אור", deals: 10 },
  ];

  it("תל אביב של המשרד הוא תל אביב -יפו של המקור", () => {
    expect(resolveMarketSettlement("תל אביב", settlements)?.id).toBe(1);
    expect(resolveMarketSettlement("תל-אביב-יפו", settlements)?.id).toBe(1);
  });

  it("כתיב מלא וחסר", () => {
    expect(resolveMarketSettlement("קריית אתא", settlements)?.id).toBe(2);
    expect(resolveMarketSettlement("פתח-תקוה", settlements)?.id).toBe(3);
  });

  it("התאמה מלאה גוברת על תחילית", () => {
    expect(resolveMarketSettlement("אור", settlements)?.id).toBe(6);
  });

  it("עיר שאינה במאגר — null, לא ניחוש", () => {
    expect(resolveMarketSettlement("לונדון", settlements)).toBeNull();
    expect(resolveMarketSettlement("", settlements)).toBeNull();
    expect(resolveMarketSettlement(null, settlements)).toBeNull();
  });
});
