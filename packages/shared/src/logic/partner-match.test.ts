import { describe, it, expect } from "vitest";
import {
  PARTNER_PAIR_LIMIT,
  partnerPairs,
  splitShares,
  type PartnerCandidate,
} from "./partner-match.js";
import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";

/** ‏2 מיליון ₪, בטאבו משותף. */
const PROPERTY: PropertyFields = {
  city: "חולון",
  propertyType: "apartment",
  dealType: "sale",
  rooms: 4,
  areaSqm: 95,
  priceAgorot: 200_000_000,
  sharedTabu: true,
};

function buyer(budgetAgorot: number | undefined, over: Partial<BuyerRequirements> = {}): BuyerRequirements {
  return {
    cities: ["חולון"],
    neighborhoods: [],
    searchAreas: [],
    dealType: "sale",
    propertyTypes: ["apartment"],
    roomsMin: 3.5,
    roomsMax: 4.5,
    features: {},
    sharedTabu: "accepts",
    ...(budgetAgorot === undefined ? {} : { budgetMaxAgorot: budgetAgorot }),
    ...over,
  };
}

/** ‏שני קונים של מיליון כל אחד — לבד אף אחד לא מגיע, יחד בדיוק. */
function twoHalves(): PartnerCandidate[] {
  return [
    { buyerId: "A", requirements: buyer(100_000_000) },
    { buyerId: "B", requirements: buyer(100_000_000) },
  ];
}

describe("partnerPairs — שדה המשחק", () => {
  it("מצמיד שניים שאיש מהם אינו מגיע לבד", () => {
    const pairs = partnerPairs(PROPERTY, twoHalves());
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.combinedBudgetAgorot).toBe(200_000_000);
    expect(pairs[0]!.headroomAgorot).toBe(0);
    expect(pairs[0]!.partners.map((p) => p.buyerId).sort()).toEqual(["A", "B"]);
  });

  it("נכס שאינו בטאבו משותף אינו מייצר שותפויות", () => {
    expect(partnerPairs({ ...PROPERTY, sharedTabu: false }, twoHalves())).toEqual([]);
    expect(partnerPairs({ ...PROPERTY, sharedTabu: undefined }, twoHalves())).toEqual([]);
  });

  it("שכירות אינה שותפות — אין מה לחלק בטאבו", () => {
    const rent = { ...PROPERTY, dealType: "rent" as const };
    const renters = twoHalves().map((c) => ({
      ...c,
      requirements: { ...c.requirements, dealType: "rent" as const },
    }));
    expect(partnerPairs(rent, renters)).toEqual([]);
  });

  it("נכס בלי מחיר אינו מייצר שותפויות", () => {
    expect(partnerPairs({ ...PROPERTY, priceAgorot: undefined }, twoHalves())).toEqual([]);
  });
});

describe("partnerPairs — מי נכנס", () => {
  it("‏„טרם נשאל” אינו נכנס לשותפות, גם כשהכול אחר מתאים", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(100_000_000, { sharedTabu: undefined }) },
      { buyerId: "B", requirements: buyer(100_000_000) },
    ]);
    expect(pairs).toEqual([]);
  });

  it("מי שסירב אינו נכנס", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(100_000_000, { sharedTabu: "refuses" }) },
      { buyerId: "B", requirements: buyer(100_000_000) },
    ]);
    expect(pairs).toEqual([]);
  });

  it("קונה בלי תקציב מוצהר אינו מועמד — „לא ידוע” אינו אפס", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(undefined) },
      { buyerId: "B", requirements: buyer(100_000_000) },
    ]);
    expect(pairs).toEqual([]);
  });

  it("מי שמגיע לבד אינו מוצע כשותף — שתי הרשימות זרות", () => {
    /* ‏1.65 מיליון + רצועת 400 אלף = 2.05 מיליון ≥ המחיר: הוא ברשימה הרגילה */
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "SOLO", requirements: buyer(165_000_000) },
      { buyerId: "B", requirements: buyer(100_000_000) },
    ]);
    expect(pairs).toEqual([]);
  });

  it("מי שאינו מתאים בקריטריון שאינו תקציב נופל — עיר אחרת", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(100_000_000, { cities: ["אילת"] }) },
      { buyerId: "B", requirements: buyer(100_000_000) },
    ]);
    expect(pairs).toEqual([]);
  });

  it("מי שאינו מתאים בסוג הנכס נופל — וילה מול דירה", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(100_000_000, { propertyTypes: ["house"] }) },
      { buyerId: "B", requirements: buyer(100_000_000) },
    ]);
    expect(pairs).toEqual([]);
  });

  it("צמד שהתקציב המשותף שלו קצר מהמחיר נופל — בלי רצועת גמישות", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(99_999_999) },
      { buyerId: "B", requirements: buyer(100_000_000) },
    ]);
    expect(pairs).toEqual([]);
  });
});

describe("partnerPairs — הדירוג והחלוקה", () => {
  it("החוליה החלשה קובעת את ציון הצמד", () => {
    /* ‏B מתאים פחות: חדרים בקצה הטווח מורידים את ציונו */
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(100_000_000) },
      { buyerId: "B", requirements: buyer(100_000_000, { roomsMin: 5, roomsMax: 5 }) },
    ]);
    /* ‏B נפסל לגמרי על חדרים — ולכן אין צמד בכלל */
    expect(pairs).toEqual([]);

    const weaker = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(100_000_000) },
      { buyerId: "B", requirements: buyer(100_000_000, { areaSqmMin: 200 }) },
    ]);
    expect(weaker).toHaveLength(1);
    const [a, b] = weaker[0]!.partners;
    expect(weaker[0]!.score).toBe(Math.min(a.score, b.score));
    expect(weaker[0]!.score).toBeLessThan(Math.max(a.score, b.score));
  });

  it("צמד הדוק קודם לצמד עם עודף, באותו ציון", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(100_000_000) },
      { buyerId: "B", requirements: buyer(100_000_000) },
      { buyerId: "C", requirements: buyer(140_000_000) },
    ]);
    /* ‏A+B מכסים בדיוק; A+C ו-B+C מכסים בעודף 400 אלף ₪ */
    expect(pairs[0]!.headroomAgorot).toBe(0);
    expect(pairs.map((p) => p.headroomAgorot)).toEqual([0, 40_000_000, 40_000_000]);
  });

  it("שני החלקים מסתכמים במחיר במדויק, ואיש אינו חורג מתקציבו", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(70_000_000) },
      { buyerId: "B", requirements: buyer(150_000_000) },
    ]);
    expect(pairs).toHaveLength(1);
    const [lower, higher] = pairs[0]!.partners;
    expect(lower.shareAgorot + higher.shareAgorot).toBe(200_000_000);
    expect(lower.shareAgorot).toBeLessThanOrEqual(lower.budgetMaxAgorot);
    expect(higher.shareAgorot).toBeLessThanOrEqual(higher.budgetMaxAgorot);
    /* ‏הקטן ראשון תמיד — המסך קורא „מי משלים למי” */
    expect(lower.budgetMaxAgorot).toBeLessThanOrEqual(higher.budgetMaxAgorot);
  });

  it("אותו קלט מחזיר תמיד את אותה רשימה", () => {
    const candidates = [
      { buyerId: "C", requirements: buyer(100_000_000) },
      { buyerId: "A", requirements: buyer(100_000_000) },
      { buyerId: "B", requirements: buyer(100_000_000) },
    ];
    const first = partnerPairs(PROPERTY, candidates).map((p) => p.partners.map((x) => x.buyerId));
    const second = partnerPairs(PROPERTY, [...candidates].reverse()).map((p) =>
      p.partners.map((x) => x.buyerId),
    );
    expect(first).toEqual(second);
  });

  it("הרשימה חסומה באורכה", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      buyerId: `B${String(i).padStart(2, "0")}`,
      requirements: buyer(120_000_000),
    }));
    expect(partnerPairs(PROPERTY, many).length).toBe(PARTNER_PAIR_LIMIT);
    expect(partnerPairs(PROPERTY, many, { limit: 3 })).toHaveLength(3);
  });
});

describe("splitShares", () => {
  it("העיגול נופל על בעל התקציב הגדול", () => {
    /* ‏7 בין 3 ל-5 — יחסית 2.625 ו-4.375; הקטן מקבל 2, השארית לגדול */
    expect(splitShares(7, 3, 5)).toEqual({ lower: 2, higher: 5 });
  });

  it("הקטן לעולם אינו משלם מעל תקציבו, גם כשהיחס דורש זאת", () => {
    /* ‏היחס היה נותן לו 2.33 מתוך 7, אבל הצהיר על 1 בלבד */
    expect(splitShares(7, 1, 2)).toEqual({ lower: 1, higher: 6 });
  });

  it("חלוקה שווה", () => {
    expect(splitShares(200, 100, 100)).toEqual({ lower: 100, higher: 100 });
  });

  it("תקציב אפס משני הצדדים אינו מחלק באפס", () => {
    expect(splitShares(500, 0, 0)).toEqual({ lower: 0, higher: 500 });
  });

  it("החלקים מסתכמים במחיר לכל צירוף", () => {
    for (const [price, lo, hi] of [
      [1, 1, 1],
      [999_999, 333_333, 777_777],
      [200_000_000, 70_000_001, 149_999_999],
    ] as const) {
      const split = splitShares(price, lo, hi);
      expect(split.lower + split.higher).toBe(price);
      expect(split.lower).toBeLessThanOrEqual(lo);
    }
  });
});
