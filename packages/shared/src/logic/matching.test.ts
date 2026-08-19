import { describe, expect, it } from "vitest";
import { MIN_MATCH_CRITERIA, scoreMatch } from "./matching.js";
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

  it("מעל התקציב ביותר מ-7% ⇒ מוחרג", () => {
    const result = scoreMatch({ ...baseProperty, priceAgorot: 350_000_000 }, baseBuyer);
    expect(result.excluded).toBe(true);
  });

  it("עד 7% מעל התקציב ⇒ נשאר עם ניקוד חלקי (גמישות שוק)", () => {
    const result = scoreMatch({ ...baseProperty, priceAgorot: 295_000_000 }, baseBuyer);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeLessThan(95);
    expect(result.score).toBeGreaterThan(50);
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
   * השער חייב לא לפגוע במי שהוא נועד לשרת. כרטיס סביר לגמרי —
   * אזור, תקציב, חדרים וסוג — עובר, ומקבל את הציון המלא שלו.
   */
  it("כרטיס מלא עובר את השער ואינו נפגע", () => {
    const result = scoreMatch(baseProperty, baseBuyer);
    expect(result.insufficientData).toBe(false);
    expect(result.breakdown.length).toBeGreaterThanOrEqual(MIN_MATCH_CRITERIA);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  /* בדיוק על הסף — שלושה קריטריונים עוברים, שניים לא. */
  it("הסף עצמו: שלושה קריטריונים עוברים, שניים נחסמים", () => {
    const twoCriteria: BuyerRequirements = {
      cities: ["בני ברק"],
      neighborhoods: [],
      dealType: "sale",
      propertyTypes: [],
      budgetMaxAgorot: 350_000_000,
      features: {},
    };
    expect(scoreMatch(baseProperty, twoCriteria).insufficientData).toBe(true);

    const threeCriteria: BuyerRequirements = { ...twoCriteria, roomsMin: 3, roomsMax: 5 };
    const passed = scoreMatch(baseProperty, threeCriteria);
    expect(passed.insufficientData).toBe(false);
    expect(passed.score).toBeGreaterThan(0);
  });
});
