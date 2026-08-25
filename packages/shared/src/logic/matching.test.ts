import { describe, expect, it } from "vitest";
import { MIN_CORE_COVERAGE, scoreMatch } from "./matching.js";
import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";

const baseProperty: PropertyFields = {
  city: "בני ברק",
  neighborhood: "פרדס כץ",
  propertyType: "apartment",
  dealType: "sale",
  rooms: 4,
  areaSqm: 95,
  floor: 2,
  hasElevator: true,
  hasParking: true,
  hasBalcony: true,
  priceAgorot: 265_000_000, // 2.65M ₪
};

const baseBuyer: BuyerRequirements = {
  cities: ["בני ברק"],
  neighborhoods: [],
  dealType: "sale",
  propertyTypes: ["apartment"],
  budgetMaxAgorot: 280_000_000,
  roomsMin: 3.5,
  roomsMax: 4.5,
  features: {},
};

describe("scoreMatch — מנוע ההתאמות", () => {
  it("התאמה מלאה מקבלת ציון גבוה", () => {
    const result = scoreMatch(baseProperty, baseBuyer);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("עיר לא מבוקשת ⇒ מוחרג לחלוטין", () => {
    const result = scoreMatch({ ...baseProperty, city: "חיפה" }, baseBuyer);
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(0);
  });

  it("מעל התקציב ביותר מרצועת 400 אלף ₪ ⇒ מוחרג", () => {
    // תקציב 2.8M, מחיר 3.5M — סטייה של 700 אלף ₪ מעל הרצועה
    const result = scoreMatch({ ...baseProperty, priceAgorot: 350_000_000 }, baseBuyer);
    expect(result.excluded).toBe(true);
  });

  it("מעל התקציב בתוך הרצועה ⇒ נשאר עם ניקוד חלקי (גמישות שוק)", () => {
    // תקציב 2.8M, מחיר 2.95M — סטייה של 150 אלף ₪, בתוך הרצועה
    const result = scoreMatch({ ...baseProperty, priceAgorot: 295_000_000 }, baseBuyer);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeLessThan(95);
    expect(result.score).toBeGreaterThan(50);
  });

  it("נמוך מהתקציב המסומן ביותר מהרצועה ⇒ מוחרג — סגמנט אחר", () => {
    // תקציב 2.8M בלי מינימום מוצהר, מחיר 2.2M — 600 אלף ₪ מתחת
    const result = scoreMatch({ ...baseProperty, priceAgorot: 220_000_000 }, baseBuyer);
    expect(result.excluded).toBe(true);
  });

  it("מי שאמר רק „עד” — מחיר בתוך הרצועה מתחת הוא בתקציב מלא", () => {
    // תקציב 2.8M בלי מינימום, מחיר 2.5M — בתוך הרצועה: לא עונשים
    const result = scoreMatch({ ...baseProperty, priceAgorot: 250_000_000 }, baseBuyer);
    expect(result.excluded).toBe(false);
    const budget = result.breakdown.find((p) => p.criterion === "budget");
    expect(budget?.score).toBe(1);
  });

  it("מינימום מוצהר — מתחתיו בתוך הרצועה ⇒ ניקוד חלקי, לא פסילה", () => {
    const buyer: BuyerRequirements = { ...baseBuyer, budgetMinAgorot: 260_000_000 };
    const result = scoreMatch({ ...baseProperty, priceAgorot: 250_000_000 }, buyer);
    expect(result.excluded).toBe(false);
    const budget = result.breakdown.find((p) => p.criterion === "budget");
    expect(budget?.score).toBe(0.5);
  });

  it("מינימום מוצהר מזיז את הרצפה — הרצועה נמדדת ממנו", () => {
    const buyer: BuyerRequirements = { ...baseBuyer, budgetMinAgorot: 200_000_000 };
    // 1.7M — בתוך הרצועה מתחת למינימום של 2M
    expect(
      scoreMatch({ ...baseProperty, priceAgorot: 170_000_000 }, buyer).excluded,
    ).toBe(false);
    // 1.5M — מעבר לרצועה מתחת למינימום
    expect(
      scoreMatch({ ...baseProperty, priceAgorot: 150_000_000 }, buyer).excluded,
    ).toBe(true);
  });

  it("בשכירות הרצועה יחסית (15%) ולא 400 אלף ₪", () => {
    const buyer: BuyerRequirements = {
      ...baseBuyer,
      dealType: "rent",
      budgetMaxAgorot: 700_000, // 7,000 ₪
    };
    const rental = { ...baseProperty, dealType: "rent" };
    // 8,500 ₪ — יותר מ-15% מעל: מוחרג (רצועת המכירה הייתה בולעת הכל)
    expect(
      scoreMatch({ ...rental, priceAgorot: 850_000 }, buyer).excluded,
    ).toBe(true);
    // 7,800 ₪ — בתוך 15%: ניקוד חלקי
    expect(
      scoreMatch({ ...rental, priceAgorot: 780_000 }, buyer).excluded,
    ).toBe(false);
  });

  it("בשכירות עם טווח — רצועת הרצפה נמדדת מהמינימום, לא מהתקרה", () => {
    // טווח 5,000–10,000 ₪: הרצפה 5,000 − 15% = 4,250
    const buyer: BuyerRequirements = {
      ...baseBuyer,
      dealType: "rent",
      budgetMinAgorot: 500_000,
      budgetMaxAgorot: 1_000_000,
    };
    const rental = { ...baseProperty, dealType: "rent" };
    // 4,000 ₪ — מתחת לרצפה: מוחרג (רצועה מהתקרה הייתה מקבלת אותו)
    expect(
      scoreMatch({ ...rental, priceAgorot: 400_000 }, buyer).excluded,
    ).toBe(true);
    // 4,300 ₪ — בתוך רצועת הרצפה: ניקוד חלקי, לא פסילה
    const near = scoreMatch({ ...rental, priceAgorot: 430_000 }, buyer);
    expect(near.excluded).toBe(false);
    expect(near.breakdown.find((p) => p.criterion === "budget")?.score).toBe(0.5);
  });

  it("דרישת חובה שמופרת במפורש ⇒ מוחרג עם הסבר", () => {
    const buyer: BuyerRequirements = { ...baseBuyer, features: { hasElevator: "must" } };
    const result = scoreMatch({ ...baseProperty, hasElevator: false }, buyer);
    expect(result.excluded).toBe(true);
    expect(result.explanation).toContain("מעלית");
    expect(result.explanation).toContain("חובה");
  });

  it("דרישת חובה על שדה לא-ידוע ⇒ ניקוד חלקי, לא פסילה", () => {
    const buyer: BuyerRequirements = { ...baseBuyer, features: { hasSafeRoom: "must" } };
    const withoutSafeRoom = { ...baseProperty };
    delete withoutSafeRoom.hasSafeRoom;
    const result = scoreMatch(withoutSafeRoom, buyer);
    expect(result.excluded).toBe(false);
    expect(result.explanation).toContain("להשלים בנכס");
  });

  it("העדפה (nice) חסרה מורידה ניקוד אך לא פוסלת — עם ההסבר מהאפיון", () => {
    const buyer: BuyerRequirements = { ...baseBuyer, features: { hasSafeRoom: "nice" } };
    const result = scoreMatch({ ...baseProperty, hasSafeRoom: false }, buyer);
    expect(result.excluded).toBe(false);
    expect(result.explanation).toContain("עדיפות ולא כחובה");
  });

  it("חדרים חצי-חדר מחוץ לטווח ⇒ ניקוד חלקי (near miss)", () => {
    const result = scoreMatch({ ...baseProperty, rooms: 5 }, baseBuyer);
    expect(result.excluded).toBe(false);
    const roomsPart = result.breakdown.find((p) => p.criterion === "rooms");
    expect(roomsPart?.score).toBe(0.5);
  });

  it("חדרים מחוץ לטווח ביותר מחצי חדר ⇒ מוחרג — קריטריון פוסל", () => {
    // הטווח 3.5–4.5; נכס 6 חדרים אינו מה שהקונה ביקש
    const result = scoreMatch({ ...baseProperty, rooms: 6 }, baseBuyer);
    expect(result.excluded).toBe(true);
  });

  it("נכס בלי מספר חדרים אינו נפסל — לא ידוע אינו מחוץ לטווח", () => {
    const noRooms = { ...baseProperty };
    delete noRooms.rooms;
    const result = scoreMatch(noRooms, baseBuyer);
    expect(result.excluded).toBe(false);
  });

  it("הפירוט (breakdown) מסביר כל קריטריון שנבחן", () => {
    const result = scoreMatch(baseProperty, baseBuyer);
    const criteria = result.breakdown.map((p) => p.criterion);
    expect(criteria).toContain("location");
    expect(criteria).toContain("budget");
    expect(criteria).toContain("rooms");
  });
});

/**
 * המיקום — שני המסלולים.
 *
 * עד כה הקריטריון היה `a.trim() === b.trim()` על שם העיר, והוא
 * קריטריון **פוסל**: כתיב שונה לא הוריד ניקוד אלא מחק את ההתאמה.
 */
describe("scoreMatch — מיקום", () => {
  const areaBuyer: BuyerRequirements = {
    ...baseBuyer,
    cities: [],
    searchAreas: [{ lat: 32.0853, lon: 34.7818, radiusKm: 2, label: "ליד העבודה" }],
  };
  const located = (lat: number, lon: number): PropertyFields => ({
    ...baseProperty,
    city: "תל אביב יפו",
    latitude: lat,
    longitude: lon,
  });

  it("כתיב שונה של אותה עיר אינו מוחק את ההתאמה", () => {
    const result = scoreMatch(
      { ...baseProperty, city: "בני-ברק" },
      { ...baseBuyer, cities: ["בני ברק"] },
    );
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("שם חלופי מוכר — ת״א מול תל אביב יפו", () => {
    const result = scoreMatch(
      { ...baseProperty, city: "תל אביב-יפו" },
      { ...baseBuyer, cities: ["ת״א"] },
    );
    expect(result.excluded).toBe(false);
  });

  it("שכונה בכתיב אחר אינה גורעת מהניקוד", () => {
    const strict = scoreMatch(baseProperty, { ...baseBuyer, neighborhoods: ["פרדס כץ"] });
    const loose = scoreMatch({ ...baseProperty, neighborhood: "פרדס-כץ" }, {
      ...baseBuyer,
      neighborhoods: ["פרדס כץ"],
    });
    expect(loose.score).toBe(strict.score);
  });

  it("אזור על המפה: נכס במרכז מקבל ניקוד מלא על המיקום", () => {
    const result = scoreMatch(located(32.0853, 34.7818), areaBuyer);
    const location = result.breakdown.find((p) => p.criterion === "location")!;
    expect(location.score).toBe(1);
    expect(location.note).toContain("ליד העבודה");
  });

  it("נכס מעט מחוץ לרדיוס עדיין מוצג — זה ההבדל מכל שער קשיח", () => {
    // ~2.3 ק״מ מהמרכז, ברדיוס של 2
    const result = scoreMatch(located(32.1053, 34.7918), areaBuyer);
    expect(result.excluded).toBe(false);
    const location = result.breakdown.find((p) => p.criterion === "location")!;
    expect(location.score).toBeGreaterThan(0.5);
  });

  it("נכס רחוק מכל האזורים מוחרג", () => {
    const result = scoreMatch(located(32.794, 34.9896), areaBuyer); // חיפה
    expect(result.excluded).toBe(true);
  });

  it("המפה גוברת על שם העיר — נכס בעיר אחרת בתוך הרדיוס מתאים", () => {
    /*
     * רמת גן, כשהקונה ביקש "תל אביב" ברשימת הערים. לפני השינוי
     * ההתאמה הייתה נמחקת; עכשיו הרדיוס הוא מה שקובע.
     */
    const buyer: BuyerRequirements = {
      ...baseBuyer,
      cities: ["תל אביב יפו"],
      searchAreas: [{ lat: 32.07, lon: 34.82, radiusKm: 3 }],
    };
    const result = scoreMatch(
      { ...baseProperty, city: "רמת גן", latitude: 32.0684, longitude: 34.8248 },
      buyer,
    );
    expect(result.excluded).toBe(false);
  });

  it("אזורים מוגדרים אבל לנכס אין קואורדינטה — נופלים לשם העיר", () => {
    const buyer: BuyerRequirements = {
      ...baseBuyer,
      cities: ["בני ברק"],
      searchAreas: [{ lat: 32.0853, lon: 34.7818, radiusKm: 1 }],
    };
    // הנכס בבני ברק בלי מיקום: לפי הרדיוס הוא היה נפסל, לפי העיר הוא מתאים
    const result = scoreMatch(baseProperty, buyer);
    expect(result.excluded).toBe(false);
  });

  it("בלי ערים ובלי אזורים — הקריטריון מדולג ואינו גורע", () => {
    const result = scoreMatch(baseProperty, { ...baseBuyer, cities: [] });
    expect(result.breakdown.some((p) => p.criterion === "location")).toBe(false);
    expect(result.excluded).toBe(false);
  });
});

/*
 * מאפיינים שהמשרד הוסיף בעצמו — הבדיקה שהם **באמת** משתתפים בניקוד
 * ואינם תווית על הכרטיס. זו הייתה נקודת ההכרעה בעיצוב: אפשר היה
 * לשמור אותם כתיאור בלבד, ואז קונה שדורש מיזוג היה מקבל נכסים בלי
 * מיזוג ומסיק שהמנוע לא עובד.
 */
describe("scoreMatch — מאפיינים מותאמים", () => {
  const withAircon: PropertyFields = {
    ...baseProperty,
    customFeatures: [{ key: "custom:מיזוג מרכזי", label: "מיזוג מרכזי", value: true }],
  };
  const withoutAircon: PropertyFields = {
    ...baseProperty,
    customFeatures: [{ key: "custom:מיזוג מרכזי", label: "מיזוג מרכזי", value: false }],
  };

  it("דרישת חובה שמתקיימת אינה פוסלת", () => {
    const result = scoreMatch(withAircon, {
      ...baseBuyer,
      features: { "custom:מיזוג מרכזי": "must" },
    });
    expect(result.excluded).toBe(false);
  });

  it("דרישת חובה שמופרת במפורש פוסלת את הנכס", () => {
    const result = scoreMatch(withoutAircon, {
      ...baseBuyer,
      features: { "custom:מיזוג מרכזי": "must" },
    });
    expect(result.excluded).toBe(true);
  });

  /*
   * ההבחנה שהמנוע כבר עושה על הקבועים, ושחייבת לחול גם כאן: נכס
   * שלא סומן אינו נכס בלי מיזוג. פסילה על היעדר סימון הייתה מוחקת
   * מהרשימה כל נכס ותיק שנקלט לפני שהמאפיין הומצא.
   */
  it("מאפיין שלא סומן בנכס הוא „לא ידוע” ולא „אין”", () => {
    const result = scoreMatch(baseProperty, {
      ...baseBuyer,
      features: { "custom:מיזוג מרכזי": "must" },
    });
    expect(result.excluded).toBe(false);
    expect(result.explanation).toContain("לא ידוע");
  });

  it("ההסבר מציג את שם המאפיין בלי הקידומת הפנימית", () => {
    const result = scoreMatch(withoutAircon, {
      ...baseBuyer,
      features: { "custom:מיזוג מרכזי": "must" },
    });
    expect(result.explanation).toContain("מיזוג מרכזי");
    expect(result.explanation).not.toContain("custom:");
  });

  it("עדיפות שאינה מתקיימת מורידה ניקוד ואינה פוסלת", () => {
    const hit = scoreMatch(withAircon, {
      ...baseBuyer,
      features: { "custom:מיזוג מרכזי": "nice" },
    });
    const miss = scoreMatch(withoutAircon, {
      ...baseBuyer,
      features: { "custom:מיזוג מרכזי": "nice" },
    });
    expect(miss.excluded).toBe(false);
    expect(miss.score).toBeLessThan(hit.score);
  });
});

/*
 * קונה בלי תקציב — המצב שהיה שובר הכול בשקט.
 *
 * `price <= undefined` הוא `false`, ולכן בלי השמירה במנוע **כל**
 * נכס מתומחר היה מסומן `excluded` וקונה כזה לא היה מקבל ולו
 * התאמה אחת. כאן נבדק גם שהציון מנורמל לפי מה שנבחן בפועל.
 */
describe("קונה בלי תקציב", () => {
  const noBudget = { ...baseBuyer, budgetMaxAgorot: undefined };

  it("אינו מוצא מההתאמה, וקריטריון התקציב אינו נספר", () => {
    const result = scoreMatch({ ...baseProperty, priceAgorot: 900_000_000 }, noBudget);
    expect(result.excluded).toBe(false);
    expect(result.breakdown.map((p) => p.criterion)).not.toContain("budget");
  });

  it("אותו ציון בלי קשר למחיר הנכס — כי אין מול מה להשוות", () => {
    const cheap = scoreMatch({ ...baseProperty, priceAgorot: 100_000_000 }, noBudget);
    const dear = scoreMatch({ ...baseProperty, priceAgorot: 900_000_000 }, noBudget);
    expect(cheap.score).toBe(dear.score);
  });

  it("קונה עם תקציב ממשיך להיבדק כרגיל", () => {
    const over = scoreMatch({ ...baseProperty, priceAgorot: 900_000_000 }, baseBuyer);
    expect(over.excluded).toBe(true);
  });
});

/**
 * הכשל שדווח מהשטח: משרד ייבא רשימת קונים שיש בהם שם, טלפון
 * ותקציב בלבד, וכל נכס במאגר הוצג להם כהתאמה של 100%.
 *
 * הסיבה אינה באג בחישוב אלא במשמעות שלו. הציון הוא ממוצע משוקלל
 * של הקריטריונים שאפשר היה להשוות, כלומר „מתאים בכל מה שנבדק” —
 * וכשנבדק דבר אחד, „100%” אומר „הנכס בתקציב” ונקרא „הנכס מושלם
 * עבורו”.
 */
describe("סף המידע — כרטיס ריק אינו נכנס להתאמות", () => {
  /** בדיוק המקרה שדווח: שם וטלפון אינם דרישות, ונשאר התקציב בלבד. */
  const importedBuyer: BuyerRequirements = {
    cities: [],
    neighborhoods: [],
    dealType: "sale",
    propertyTypes: [],
    budgetMaxAgorot: 350_000_000,
    features: {},
  };

  it("קונה עם תקציב בלבד אינו מקבל התאמה — גם לא 100%", () => {
    const result = scoreMatch(baseProperty, importedBuyer);
    expect(result.breakdown).toHaveLength(1);
    expect(result.insufficientData).toBe(true);
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(0);
  });

  it("ההסבר אומר שחסרים פרטים, ולא שהנכס אינו מתאים", () => {
    const result = scoreMatch(baseProperty, importedBuyer);
    expect(result.explanation).toContain("אין מספיק פרטים");
  });

  /*
   * הצד השני של אותו מטבע. הקונה מלא לגמרי, והנכס הוא זה שאין
   * עליו כמעט דבר — וגם אז אין על מה לבסס „התאמה”.
   */
  it("נכס בלי פרטים אינו מקבל התאמה מול קונה מלא", () => {
    const result = scoreMatch({ dealType: "sale", priceAgorot: 265_000_000 }, baseBuyer);
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBe(0);
  });

  /*
   * השער חייב לא לפגוע במי שהוא נועד לשרת. כרטיס שנבדקה בו כל
   * הליבה עובר, כיסוי מלא, והציון אינו נוגס בכלום.
   */
  it("כרטיס מלא עובר את השער ואינו נפגע", () => {
    const result = scoreMatch(baseProperty, baseBuyer);
    expect(result.insufficientData).toBe(false);
    expect(result.coverage).toBe(1);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  /*
   * ‎**הבאג המדויק שדווח, בצורתו העמידה יותר.** תקציב+שטח+מועד
   * כניסה הם שלושה קריטריונים — ולכן עברו את שער הספירה הישן
   * וקיבלו 100%, אף שאיש לא בדק היכן הנכס, כמה חדרים בו או מה
   * סוגו. ספירה מתייחסת לכל הקריטריונים כשווים; משקל לא.
   */
  it("שלושה קריטריונים שוליים אינם „שלושה קריטריונים”", () => {
    const thin: BuyerRequirements = {
      ...importedBuyer,
      areaSqmMin: 80,
      entryDatePreference: "flexible",
    };
    const result = scoreMatch(baseProperty, thin);
    expect(result.breakdown.length).toBeGreaterThanOrEqual(2);
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBe(0);
  });

  /*
   * הצד השני של אותה החלפה, וזו הקלה מכוונת: עיר+תקציב נחסמו
   * בשער הספירה הישן, אף שהם צמד שאומר הרבה יותר מהשלישייה
   * שלמעלה. הם עוברים — ומקבלים ציון שנוקב בכך שנבדקו שני שליש.
   */
  it("צמד מרכזי עובר, ואומר במפורש שנבדקו שני שליש", () => {
    const cityAndBudget: BuyerRequirements = {
      cities: ["בני ברק"],
      neighborhoods: [],
      dealType: "sale",
      propertyTypes: [],
      // בתוך רצועת התקציב של הנכס (2.65M) — הבדיקה על הכיסוי, לא על הרצועה
      budgetMaxAgorot: 280_000_000,
      features: {},
    };
    const result = scoreMatch(baseProperty, cityAndBudget);
    expect(result.insufficientData).toBe(false);
    expect(result.coverage).toBeCloseTo(2 / 3, 2);
    /* התאמה מושלמת במה שנבדק — ובכל זאת לא 100% */
    expect(result.score).toBe(67);
    expect(result.explanation).toContain("מספר חדרים");
  });

  /*
   * הלב של התיקון. אותה התאמה מושלמת בדיוק, בשני כרטיסים שנבדלים
   * רק במידע שיש עליהם — ושני מספרים שונים. זה מה שהופך את הציון
   * מ„מתאים בכל מה שנבדק” ל„מתאים”.
   */
  it("התאמה מושלמת מקבלת ציון נמוך יותר כשנבדק פחות", () => {
    const full = scoreMatch(baseProperty, baseBuyer);
    const partial = scoreMatch(baseProperty, {
      ...baseBuyer,
      propertyTypes: [],
      roomsMin: undefined,
      roomsMax: undefined,
    });
    expect(partial.breakdown.every((p) => p.score === 1)).toBe(true);
    expect(partial.score).toBeLessThan(full.score);
    expect(partial.coverage).toBeLessThan(full.coverage);
  });

  /* השער מנוסח על משקל, ולכן הוא חייב להיאמר במשקל ולא בספירה. */
  it("הסף עצמו: מתחת לחצי ממשקל הליבה — אין התאמה", () => {
    const belowGate = scoreMatch(baseProperty, importedBuyer);
    expect(belowGate.coverage).toBeLessThan(MIN_CORE_COVERAGE);
    expect(belowGate.insufficientData).toBe(true);

    const atGate = scoreMatch(baseProperty, {
      ...importedBuyer,
      roomsMin: 3,
      roomsMax: 5,
    });
    expect(atGate.coverage).toBeGreaterThanOrEqual(MIN_CORE_COVERAGE);
    expect(atGate.insufficientData).toBe(false);
  });

  /* ההסבר החסום נוקב במה שחסר — „אין מספיק פרטים” לבדו אינו פעולה. */
  it("ההסבר החסום מונה את הקריטריונים שלא נבדקו", () => {
    const result = scoreMatch(baseProperty, importedBuyer);
    for (const label of ["מיקום", "מספר חדרים", "סוג הנכס"]) {
      expect(result.explanation).toContain(label);
    }
  });
});
