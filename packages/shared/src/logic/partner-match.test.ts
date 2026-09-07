import { describe, it, expect } from "vitest";
import {
  partnershipApplies,
  PARTNER_CANDIDATE_MAX,
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

  it("נכס שנרשם בסוג הוותיק „טאבו משותף” כן מייצר שותפויות", () => {
    /*
     * ‏בלי הגזירה מהסוג, דווקא הנכסים הוותיקים — אלה שהתכונה
     * ‏נבנתה בשבילם — לא היו מקבלים אותה.
     *
     * ‏הקונים מבקשים את הסוג הזה, כי נכס שנרשם כך אינו מכריז על
     * ‏צורת המבנה שלו; מי שביקש „דירה” נשאר מחוץ להתאמה, וזו
     * ‏התנהגות קיימת שלא נגעתי בה.
     */
    const byType = { ...PROPERTY, sharedTabu: false, propertyType: "shared_tabu" as const };
    const wanting = twoHalves().map((c) => ({
      ...c,
      requirements: { ...c.requirements, propertyTypes: ["shared_tabu" as const] },
    }));
    expect(partnerPairs(byType, wanting)).toHaveLength(1);
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

  it("שני כרטיסים של אותו אדם אינם צמד", () => {
    /* ‏מפתח זהות זהה — מיזוג כרטיסים, או שתי דרישות של אותו לקוח */
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(100_000_000), partnerKey: "person-1" },
      { buyerId: "B", requirements: buyer(100_000_000), partnerKey: "person-1" },
    ]);
    expect(pairs).toEqual([]);
  });

  /*
   * ‎**והוא מצטרף אליהם פעם אחת, ולא פעמיים** (ביקורת Codex, P2).
   *
   * ‏הניסוח הקודם ציפה לשתי שורות — כרטיס א׳ עם ג׳, וכרטיס ב׳ עם
   * ‏ג׳. אבל ההצעה כאן היא „חבר בין שני **האנשים** האלה”, ושתי
   * ‏שורות על אותם שני אנשים הן אותה הצעה פעמיים.
   *
   * ‏וזה גם מה שהפך את התקרה לבאג: כרטיסים כפולים נספרו אל תוך
   * ‏60 המקומות לפני שהפסילה רצה, ולכן לקוח אחד יכול היה למלא
   * ‏אותם לבדו ולהסתיר שותפויות אמיתיות של לקוחות אחרים.
   */
  it("אבל הוא מצטרף אליהם פעם אחת — הצעה בין אנשים", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A", requirements: buyer(90_000_000), partnerKey: "person-1" },
      { buyerId: "B", requirements: buyer(100_000_000), partnerKey: "person-1" },
      { buyerId: "C", requirements: buyer(100_000_000), partnerKey: "person-2" },
    ]);
    expect(pairs).toHaveLength(1);
    /*
     * ‏והכרטיס שנבחר הוא השימושי לשותפות: `combined >= price` הוא
     * ‏מה שמכריע אם צמד נוצר בכלל, ולכן התקציב הגדול. עם כרטיס א׳
     * ‏(90 מיליון) הצמד לא היה מגיע ל-2 מיליון כלל.
     */
    expect(pairs[0]!.partners.map((p) => p.buyerId).sort()).toEqual(["B", "C"]);
  });

  /*
   * ‏והבאג עצמו: לקוח אחד עם יותר כרטיסים מהתקרה אינו מסתיר את
   * ‏השותפות של הלקוח שאחריו ברשימה.
   */
  it("לקוח אחד עם המון כרטיסים אינו ממלא את התקרה", () => {
    const many: PartnerCandidate[] = Array.from({ length: 80 }, (_, index) => ({
      buyerId: `dup-${String(index).padStart(2, "0")}`,
      requirements: buyer(100_000_000),
      partnerKey: "person-1",
    }));
    const pairs = partnerPairs(PROPERTY, [
      ...many,
      { buyerId: "C", requirements: buyer(100_000_000), partnerKey: "person-2" },
    ]);
    expect(pairs).toHaveLength(1);
    const ids = pairs[0]!.partners.map((p) => p.buyerId);
    expect(ids).toContain("C");
    expect(ids.some((id) => id.startsWith("dup-"))).toBe(true);
  });

  /*
   * ‎**והתקרה סוגרת את הדלת רק לזהות חדשה** (ביקורת Codex, P2).
   *
   * ‏`break` עצר את הלולאה כולה ברגע שהתמלאו שישים הזהויות, ולכן
   * ‏גם כרטיס נוסף של מי ש**כבר בפנים** לא הגיע להשוואה. ההערה
   * ‏מעל `byIdentity` מבטיחה במפורש שכרטיס כזה „מחליף את הקודם אם
   * ‏הוא שימושי יותר לשותפות” — וה-`break` ביטל את החצי הזה.
   *
   * ‏שישים לקוחות דלים ממלאים את התקרה; לשניים מהם יש כרטיס שני,
   * ‏מאוחר יותר ברשימה, שבו התקציב מספיק. עם `break` התשובה הייתה
   * ‏„אין שותפויות” — על צמד שקיים.
   */
  it("כרטיס מאוחר של מי שכבר בתקרה עדיין מחליף את החלש", () => {
    const fillers: PartnerCandidate[] = Array.from(
      { length: PARTNER_CANDIDATE_MAX },
      (_, index) => ({
        buyerId: `thin-${String(index).padStart(2, "0")}`,
        /* ‏10 מיליון אגורות — שני כאלה יחד רחוקים מהמחיר */
        requirements: buyer(10_000_000),
        partnerKey: `person-${String(index).padStart(2, "0")}`,
      }),
    );
    const pairs = partnerPairs(PROPERTY, [
      ...fillers,
      { buyerId: "late-a", requirements: buyer(100_000_000), partnerKey: "person-00" },
      { buyerId: "late-b", requirements: buyer(100_000_000), partnerKey: "person-01" },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.partners.map((p) => p.buyerId).sort()).toEqual(["late-a", "late-b"]);
  });

  /*
   * ‏והצד השני, שבלעדיו „בטל את התקרה” היה עובר: זהות **חדשה**
   * ‏מעבר לתקרה עדיין אינה נכנסת.
   */
  it("אבל זהות חדשה מעבר לתקרה אינה נכנסת", () => {
    const fillers: PartnerCandidate[] = Array.from(
      { length: PARTNER_CANDIDATE_MAX },
      (_, index) => ({
        buyerId: `thin-${String(index).padStart(2, "0")}`,
        requirements: buyer(10_000_000),
        partnerKey: `person-${String(index).padStart(2, "0")}`,
      }),
    );
    const pairs = partnerPairs(PROPERTY, [
      ...fillers,
      { buyerId: "new-a", requirements: buyer(100_000_000), partnerKey: "person-new-a" },
      { buyerId: "new-b", requirements: buyer(100_000_000), partnerKey: "person-new-b" },
    ]);
    expect(pairs).toEqual([]);
  });

  it("בלי מפתח זהות כל כרטיס עומד בפני עצמו", () => {
    /* ‏ברירת המחדל הבטוחה למי שאין לו מידע כזה — המזהה עצמו */
    expect(partnerPairs(PROPERTY, twoHalves())).toHaveLength(1);
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
  /*
   * ‎**צמד מושלם מוצג כמושלם** (ביקורת Codex, P2).
   *
   * ‏מחיקת התקציב הותירה את הכיסוי נמדד מול משקל הליבה המלא,
   * ‏שהתקציב הוא רבע ממנו — ולכן התקרה הייתה `0.5/0.75` = 67%,
   * ‏לנצח. הרשימה הייתה מדורגת נכון ומוצגת שקר.
   */
  it("צמד שמתאים בכל הקריטריונים מקבל 100 ולא 67", () => {
    const pairs = partnerPairs(PROPERTY, twoHalves());
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.score).toBe(100);
    for (const partner of pairs[0]!.partners) expect(partner.score).toBe(100);
  });

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

  /*
   * ‎**וגם הגדול אינו חורג — זה החצי שנשבר** (ביקורת Codex, P2).
   *
   * ‏הבדיקה הקודמת אימתה `lower <= lo` בלבד, ולכן החריגה יצאה
   * ‏דווקא מהצד שלא נבדק: `priceAgorot * lowerBudget` היא מכפלת
   * ‏שתי אגורות, ובמחירי דיור רגילים היא עוברת את טווח השלמים
   * ‏הבטוח — `Number` מעגל אותה כלפי מטה, הקטן מקבל אגורה פחות,
   * ‏והשארית שנופלת על הגדול עולה על מה שהצהיר.
   *
   * ‏ההבטחה השלמה היא שלוש שורות ולא אחת, וכל שלושתן נבדקות.
   */
  it("החלקים מסתכמים במחיר, ואיש מהשניים אינו חורג ממה שהצהיר", () => {
    for (const [price, lo, hi] of [
      [1, 1, 1],
      [999_999, 333_333, 777_777],
      [200_000_000, 70_000_001, 149_999_999],
      /* ‏הצירוף מהממצא: שני התקציבים מסתכמים למחיר במדויק */
      [166_322_027, 59_840_431, 106_481_596],
      /* ‏ומחיר דירה רגיל, שם המכפלה חורגת מהטווח הבטוח */
      [280_000_000, 130_000_003, 150_000_001],
    ] as const) {
      const split = splitShares(price, lo, hi);
      expect(split.lower + split.higher, `סכום — ${price}`).toBe(price);
      expect(split.lower, `הקטן — ${price}`).toBeLessThanOrEqual(lo);
      expect(split.higher, `הגדול — ${price}`).toBeLessThanOrEqual(hi);
    }
  });

  /*
   * ‏והשאלה נשאלת על טווח ולא על דוגמאות: כל עוד השניים מכסים את
   * ‏המחיר, אף אחד מהם אינו חורג. סריקה דטרמיניסטית — לא אקראית —
   * ‏כדי שכישלון יהיה ניתן לשחזור.
   */
  it("ההבטחה מתקיימת על פני טווח מחירים שלם", () => {
    for (let price = 150_000_000; price <= 400_000_000; price += 7_919_311) {
      for (const share of [1, 17, 233, 4999]) {
        const lo = Math.floor(price / 2) - share;
        const hi = price - lo;
        const split = splitShares(price, lo, hi);
        expect(split.lower + split.higher, `${price}/${share}`).toBe(price);
        expect(split.lower, `הקטן ${price}/${share}`).toBeLessThanOrEqual(lo);
        expect(split.higher, `הגדול ${price}/${share}`).toBeLessThanOrEqual(hi);
      }
    }
  });
});

/**
 * ‎**„שייך לנכס הזה” — שאלה אחת לשלושה קוראים** (ביקורת Codex, P2).
 *
 * ‏המנוע, השירות והמסך שאלו אותה בנפרד, והשלישי לא הסכים: נכס
 * ‏שנמכר, נכס להשכרה או נכס בלי מחיר קיבלו מקטע שאומר „לא נמצאו
 * ‏שני לקוחות מתאימים”, בזמן שהחישוב מעולם לא רץ.
 */
describe("partnershipApplies", () => {
  const BASE = {
    sharedTabu: true,
    dealType: "sale",
    priceAgorot: 200_000_000,
    status: "active",
  };

  it("נכס במושאע, למכירה, עם מחיר ובשיווק — שייך", () => {
    expect(partnershipApplies(BASE)).toBe(true);
  });

  /* ‏גם הייצוג הישן, כמו בכל שאר המערכת */
  it("וגם הסוג הישן, בלי הדגל", () => {
    expect(
      partnershipApplies({ propertyType: "shared_tabu", dealType: "sale", priceAgorot: 1, status: "draft" }),
    ).toBe(true);
  });

  it("נכס שאינו במושאע — אינו שייך", () => {
    expect(partnershipApplies({ ...BASE, sharedTabu: false })).toBe(false);
  });

  it("השכרה — אינה שייכת", () => {
    expect(partnershipApplies({ ...BASE, dealType: "rent" })).toBe(false);
  });

  it("בלי מחיר — אין מה לחלק", () => {
    expect(partnershipApplies({ ...BASE, priceAgorot: undefined })).toBe(false);
  });

  /* ‏נכס שיצא משיווק אינו מזמין פעולה, וזו רשימת פעולות */
  it("נמכר, הושכר או בארכיון — אינם שייכים", () => {
    for (const status of ["sold", "rented", "archived", "on_hold"]) {
      expect(partnershipApplies({ ...BASE, status }), status).toBe(false);
    }
  });

  /*
   * ‎`status` אופציונלי: המנוע נשאל על שדות הנכס ולא על מצבו
   * ‏בשיווק. מי שאינו מחזיק אותו אינו נחסם בגללו.
   */
  it("בלי מצב שיווק — השאלה אינה נשאלת עליו", () => {
    expect(partnershipApplies({ sharedTabu: true, dealType: "sale", priceAgorot: 1 })).toBe(true);
  });
});

/**
 * ‎**„תקציב גדול יותר” אינו „שימושי יותר”** (ביקורת Codex, P2).
 *
 * ‏הנציג היחיד לכל זהות נבחר לפי תקציב. זה נכון להיתכנות ושגוי
 * ‏לדירוג: הרשימה ממוינת לפי ציון ואז לפי הידוק, ובשניהם כרטיס
 * ‏זול יותר יכול לנצח. במקומו נשמרת חזית פארטו לכל אדם.
 */
describe("‏חזית הכרטיסים לכל לקוח", () => {
  /** ‏שכונה על הנכס — היא מוסיפה קריטריון, ואיתו מדרגות ציון. */
  const HOOD: PropertyFields = { ...PROPERTY, neighborhood: "נאות שושנים" };
  /** ‏דרישה שאינה מתקיימת בנכס — כל אחת גורעת מהציון. */
  const FEAT: Partial<BuyerRequirements> = { features: { parking: true } };
  const ROOMS: Partial<BuyerRequirements> = { roomsMin: 4.5, roomsMax: 5.5 };
  const OTHER_HOOD: Partial<BuyerRequirements> = { neighborhoods: ["קרית שרת"] };

  /*
   * ‏זה הממצא עצמו: לאותו לקוח כרטיס של מיליון בהתאמה מלאה
   * ‏וכרטיס של מיליון-ומאה ב-94%, ולצדו קונה של מיליון. הנציג
   * ‏לפי תקציב יצר צמד של 94% עם עודף של 100 אלף, בזמן שצמד של
   * ‏100% בכיסוי מדויק היה קיים בנתונים ומעולם לא הוצע.
   */
  it("‏כרטיס זול יותר עם התאמה טובה יותר מנצח", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A1", partnerKey: "אדם", requirements: buyer(100_000_000) },
      { buyerId: "A2", partnerKey: "אדם", requirements: buyer(110_000_000, FEAT) },
      { buyerId: "Z", requirements: buyer(100_000_000) },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.score).toBe(100);
    expect(pairs[0]!.headroomAgorot).toBe(0);
    expect(pairs[0]!.partners.map((p) => p.buyerId).sort()).toEqual(["A1", "Z"]);
  });

  /*
   * ‎**והכרטיס היקר נשאר** — הוא הנציג שנבחר עד היום, ולכן שום
   * ‏צמד שהתקבל קודם אינו נעלם. כאן רק הוא מגיע: 60 + 60 אינם
   * ‏שני מיליון, ו-140 + 60 כן.
   */
  it("‏הכרטיס היקר נשאר, וצמד שרק הוא מגיע אליו נמצא", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A1", partnerKey: "אדם", requirements: buyer(60_000_000) },
      { buyerId: "A2", partnerKey: "אדם", requirements: buyer(140_000_000, FEAT) },
      { buyerId: "Z", requirements: buyer(60_000_000) },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.partners.map((p) => p.buyerId).sort()).toEqual(["A2", "Z"]);
  });

  /*
   * ‎**אותם נתונים בכל סדר הגעה — אותה תשובה.**
   *
   * ‏זו הטענה שנשארה כאן אחרי שהתקרה ירדה. סינון הכרטיסים
   * ‏הנשלטים הוא מעכשיו **חסם עלות בלבד**: כרטיס גרוע בשני
   * ‏הצירים אינו יכול לייצר צמד טוב יותר מזה ששולט בו, ובלי
   * ‏תקרה הוא גם אינו תופס מקום של אחר — ולכן הסרתו אינה משנה
   * ‏את התשובה, ואין בדיקה שתתפוס אותה. הוא נשאר כי הוא מה
   * ‏שמקטין את לולאת הצמדים, וזה מה שמאפשר לוותר על התקרה.
   *
   * ‏מה שכן ניתן לבדוק, וגם חשוב: לסינון שני צדדים — כרטיס נשלט
   * ‏אינו נכנס, וכרטיס ששולט מפנה את מי שכבר בפנים — וכל אחד
   * ‏פעיל בסדר הגעה אחר. אם הם אינם מסכימים, אותם נתונים בסדר
   * ‏אחר יחזירו רשימה אחרת, וזה תנאי לכל השוואה.
   */
  it("‏התשובה אינה תלויה בסדר ההגעה של הכרטיסים", () => {
    const cards: PartnerCandidate[] = [
      { buyerId: "A1", partnerKey: "אדם", requirements: buyer(60_000_000) },
      { buyerId: "A2", partnerKey: "אדם", requirements: buyer(50_000_000, FEAT) },
      { buyerId: "A3", partnerKey: "אדם", requirements: buyer(40_000_000, OTHER_HOOD) },
      { buyerId: "A4", partnerKey: "אדם", requirements: buyer(30_000_000, ROOMS) },
      { buyerId: "A5", partnerKey: "אדם", requirements: buyer(140_000_000, { ...OTHER_HOOD, ...FEAT }) },
      { buyerId: "Z", requirements: buyer(140_000_000) },
    ];
    const forward = partnerPairs(HOOD, cards);
    const backward = partnerPairs(HOOD, [...cards].reverse());
    expect(forward).toEqual(backward);
    expect(forward).toHaveLength(1);
    expect(forward[0]!.score).toBe(100);
    expect(forward[0]!.headroomAgorot).toBe(0);
    expect(forward[0]!.partners.map((p) => p.buyerId).sort()).toEqual(["A1", "Z"]);
  });

  /*
   * ‎**וזוג אנשים מופיע פעם אחת.** זו התוצאה הישירה של שמירת
   * ‏החזית: לאותם שניים יש עכשיו כמה צירופי כרטיסים חוקיים,
   * ‏ובלי איחוד הם היו ממלאים את הרשימה בעצמם ודוחקים זוגות
   * ‏אחרים.
   */
  it("‏זוג לקוחות תופס מקום אחד, גם בכמה צירופי כרטיסים", () => {
    const pairs = partnerPairs(PROPERTY, [
      { buyerId: "A1", partnerKey: "אדם", requirements: buyer(100_000_000) },
      { buyerId: "A2", partnerKey: "אדם", requirements: buyer(120_000_000, FEAT) },
      { buyerId: "B1", partnerKey: "רעות", requirements: buyer(100_000_000) },
      { buyerId: "B2", partnerKey: "רעות", requirements: buyer(130_000_000, ROOMS) },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.score).toBe(100);
    expect(pairs[0]!.headroomAgorot).toBe(0);
  });

  /*
   * ‎**וכרטיס ביניים נשמר — הוא יכול להיות הזול ביותר שמגיע**
   * ‏(ביקורת Codex, P2).
   *
   * ‏הניסוח הקודם שמר ארבעה כרטיסים לאדם והשמיט את האמצע, מתוך
   * ‏הנחה ש„נקודות הביניים משפיעות רק על ההידוק”. הנה ההפרכה,
   * ‏שאומתה מול המנוע: חזית של חמישה, ושותף של 110 שדורש לפחות
   * ‏90. הכרטיס של 90 הוא הזול ביותר שמגיע, והציון שלו גבוה
   * ‏בהרבה מזה של 140 — והשמטתו החזירה 77% עם עודף של חצי מיליון
   * ‏במקום 90% בכיסוי מדויק.
   */
  it("‏כרטיס ביניים שהוא הזול ביותר שמגיע — נשמר", () => {
    const pairs = partnerPairs(HOOD, [
      { buyerId: "A1", partnerKey: "אדם", requirements: buyer(60_000_000) },
      { buyerId: "A2", partnerKey: "אדם", requirements: buyer(70_000_000, FEAT) },
      { buyerId: "A3", partnerKey: "אדם", requirements: buyer(80_000_000, OTHER_HOOD) },
      { buyerId: "A4", partnerKey: "אדם", requirements: buyer(90_000_000, ROOMS) },
      {
        buyerId: "A5",
        partnerKey: "אדם",
        requirements: buyer(140_000_000, { ...OTHER_HOOD, ...ROOMS, ...FEAT }),
      },
      { buyerId: "Z", requirements: buyer(110_000_000) },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.partners.map((p) => p.buyerId).sort()).toEqual(["A4", "Z"]);
    expect(pairs[0]!.headroomAgorot).toBe(0);
    expect(pairs[0]!.score).toBe(90);
  });
});
