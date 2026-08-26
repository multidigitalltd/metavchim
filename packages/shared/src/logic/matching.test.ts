import { describe, expect, it } from "vitest";
import {
  MIN_CORE_COVERAGE,
  propertyEvaluableCriteria,
  resolveMatchWeights,
  scoreMatch,
} from "./matching.js";
import { MATCH_CRITERIA, ScoreComponentSchema } from "../schemas/match.js";
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

  /*
   * ‎**היפוך מכוון של התנהגות קודמת.** הבדיקה הזו קבעה קודם שקונה
   * בלי ערים ובלי אזורים הוא „בלי מגבלת אזור”, ולכן הקריטריון
   * מדולג וההתאמה נשארת. זה נשמע סביר — הקונה לא ביקש להגביל —
   * אבל התוצאה בפועל היא התאמה שהוצגה למתווך **בלי שאיש השווה
   * מיקום**, וזו בדיוק ההתאמה שכלל הברזל אוסר.
   *
   * „הקונה לא ביקש” אינו „בדקנו”. הנימוק החדש קרוב יותר לאמת:
   * כרטיס קונה בלי אזור חיפוש אינו כרטיס שאפשר להתאים לפיו, והוא
   * צריך להוביל להשלמת הכרטיס ולא לרשימת נכסים אקראית.
   */
  it("בלי ערים ובלי אזורים — הקריטריון אינו נבחן, ולכן אין התאמה", () => {
    const result = scoreMatch(baseProperty, { ...baseBuyer, cities: [] });
    expect(result.breakdown.some((p) => p.criterion === "location")).toBe(false);
    expect(result.insufficientData).toBe(true);
    expect(result.excluded).toBe(true);
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
  /**
   * בדיוק המקרה שדווח: שם וטלפון אינם דרישות, ונשאר התקציב בלבד.
   *
   * ‎**התקציב חייב להיות בתוך הרצועה של הנכס, ולא סתם „גדול ממנו”.**
   * קודם עמד כאן 3.5 מיליון מול נכס של 2.65 — פער של 850 אלף, הרבה
   * מעבר לרצועת ה-400 אלף — ולכן הכרטיס נפסל על **התקציב** ולא על
   * חוסר המידע שהבדיקות כאן מתיימרות לבדוק. הן עברו רק מפני ששער
   * הכיסוי דרס את הדחייה ההיא ב„אין מספיק פרטים”, וזו בדיוק
   * הדריסה שתוקנה (ביקורת Codex).
   *
   * כלומר הבדיקות האלה מעולם לא בחנו את מה שנכתב בהן. עכשיו כן.
   */
  const importedBuyer: BuyerRequirements = {
    cities: [],
    neighborhoods: [],
    dealType: "sale",
    propertyTypes: [],
    budgetMaxAgorot: 280_000_000,
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
   * הצד השני של אותה החלפה, וזו הקלה מכוונת: צירוף מרכזי חלקי
   * נחסם בשער הספירה הישן, אף שהוא אומר הרבה יותר מהשלישייה
   * שלמעלה. הוא עובר — ומקבל ציון שנוקב בכך שלא הכול נבדק.
   *
   * סוג הנכס נכלל כאן כי הוא קריטריון חובה; בלעדיו זה כבר לא
   * „צירוף מרכזי חלקי” אלא כרטיס שאי אפשר להתאים לפיו.
   */
  it("צירוף מרכזי עובר, ואומר במפורש שלא הכול נבדק", () => {
    const withoutRooms: BuyerRequirements = {
      cities: ["בני ברק"],
      neighborhoods: [],
      dealType: "sale",
      propertyTypes: ["apartment"],
      // בתוך רצועת התקציב של הנכס (2.65M) — הבדיקה על הכיסוי, לא על הרצועה
      budgetMaxAgorot: 280_000_000,
      features: {},
    };
    const result = scoreMatch(baseProperty, withoutRooms);
    expect(result.insufficientData).toBe(false);
    // מיקום .25 + תקציב .25 + סוג .1 = .6 מתוך .75
    expect(result.coverage).toBeCloseTo(0.8, 2);
    /* התאמה מושלמת במה שנבדק — ובכל זאת לא 100% */
    expect(result.score).toBe(80);
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

  /*
   * השער מנוסח על משקל, ולכן הוא חייב להיאמר במשקל ולא בספירה.
   *
   * ‎**שני הצדדים כאן ממוקמים בכוונה.** קודם הצד העובר היה תקציב
   * וחדרים בלי עיר — כלומר בדיוק ההתאמה שכלל הברזל אוסר, והבדיקה
   * הזו הצהירה עליה כתקינה. הסף שנבדק כאן הוא הכמות שנבחנה, ולכן
   * הוא חייב להיבדק כששאלת החובה כבר נענתה; אחרת שני שערים שונים
   * נמדדים בבדיקה אחת ואי אפשר לדעת מי מהם נפל.
   */
  it("הסף עצמו: מתחת לחצי ממשקל הליבה — אין התאמה", () => {
    // מיקום + סוג נכס = .35 מתוך .75 ⇒ ‎.467, מתחת לסף
    const belowGate = scoreMatch(baseProperty, {
      cities: ["בני ברק"],
      neighborhoods: [],
      dealType: "sale",
      propertyTypes: ["apartment"],
      features: {},
    });
    expect(belowGate.coverage).toBeLessThan(MIN_CORE_COVERAGE);
    expect(belowGate.insufficientData).toBe(true);

    // מיקום + סוג + חדרים = .5 מתוך .75 ⇒ ‎.667, מעל הסף
    const atGate = scoreMatch(baseProperty, {
      cities: ["בני ברק"],
      neighborhoods: [],
      dealType: "sale",
      propertyTypes: ["apartment"],
      roomsMin: 3,
      roomsMax: 5,
      features: {},
    });
    expect(atGate.coverage).toBeGreaterThanOrEqual(MIN_CORE_COVERAGE);
    expect(atGate.insufficientData).toBe(false);
  });

  /*
   * ‎**השער אינו ניתן לכיול, ובכוונה.**
   *
   * הגרסה הראשונה גזרה את הכיסוי מ-`weights`, וזה החזיר את הבאג
   * דרך הדלת האחורית: משרד שמעלה את משקל התקציב לתקרה (0.5) —
   * ובכיול האוטומטי שדולק כברירת מחדל זה קורה מעצמו — הפך את משקל
   * הליבה ל-1.0, כך שקונה עם תקציב בלבד קיבל כיסוי 0.5, עבר את
   * השער וקיבל ציון 50. `MATCH_THRESHOLDS.review` הוא 50 בדיוק,
   * ולכן ההתאמה גם נשמרה (ביקורת Codex).
   *
   * הכיסוי הוא תכונה של הנתונים ולא של ההעדפות, ולכן הוא נמדד
   * בברירת המחדל תמיד. הבדיקה מנפחת את הליבה כדי לוודא זאת.
   */
  it("כיול משקלים אינו יכול לפתוח את השער", () => {
    for (const stored of [
      { budget: 0.5 },
      { budget: 0.5, location: 0.5, rooms: 0.5, property_type: 0.5 },
      { location: 0.5 },
    ]) {
      const result = scoreMatch(baseProperty, importedBuyer, resolveMatchWeights(stored));
      expect(result.coverage).toBeCloseTo(1 / 3, 2);
      expect(result.insufficientData).toBe(true);
      expect(result.score).toBe(0);
    }
  });

  /* אותו נימוק לכיוון השני: הכיסוי המדווח זהה בכל משרד. */
  it("הכיסוי המדווח אינו תלוי במשקלי המשרד", () => {
    const buyer: BuyerRequirements = {
      cities: ["בני ברק"],
      neighborhoods: [],
      dealType: "sale",
      propertyTypes: [],
      budgetMaxAgorot: 280_000_000,
      features: {},
    };
    const plain = scoreMatch(baseProperty, buyer);
    const tuned = scoreMatch(baseProperty, buyer, resolveMatchWeights({ budget: 0.5 }));
    expect(tuned.coverage).toBe(plain.coverage);
  });

  /* ההסבר החסום נוקב במה שחסר — „אין מספיק פרטים” לבדו אינו פעולה. */
  it("ההסבר החסום מונה את הקריטריונים שלא נבדקו", () => {
    const result = scoreMatch(baseProperty, importedBuyer);
    for (const label of ["מיקום", "מספר חדרים", "סוג הנכס"]) {
      expect(result.explanation).toContain(label);
    }
  });
});

/**
 * ‎**כלל ברזל: התאמה בלי השוואת מיקום אינה התאמה.**
 *
 * שער הכיסוי לבדו לא אכף את זה, כי הוא מודד כמות ולא זהות: בלי
 * מיקום נשאר כיסוי של 67%, הרבה מעל הסף. הבדיקות כאן הן על השער
 * השני — זה ששואל *מה* נבחן ולא *כמה*.
 */
describe("כלל הברזל — מיקום חייב להיבחן", () => {
  /*
   * שלוש הדרכים שבהן המיקום נשמט. הן נבדקות יחד ובכוונה: זה אותו
   * כלל, וכיסוי של אחת מהן בלבד היה משאיר את השתיים האחרות פתוחות
   * — בדיוק הדפוס של „תיקנתי את המקום שהצביעו עליו”.
   */
  it("נכס בלי מיקום מול קונה עם ערים — אין התאמה", () => {
    const { city: _city, ...noCity } = baseProperty;
    const result = scoreMatch(noCity, baseBuyer);
    expect(result.breakdown.some((p) => p.criterion === "location")).toBe(false);
    expect(result.insufficientData).toBe(true);
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(0);
  });

  it("קונה בלי ערים ובלי אזורים — אין התאמה, גם על כרטיס נכס מלא", () => {
    const result = scoreMatch(baseProperty, { ...baseBuyer, cities: [], searchAreas: [] });
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBe(0);
  });

  /*
   * הקונה סימן אזורים על מפה, ולנכס אין קואורדינטות — ואין ערים
   * ליפול אליהן. זה המצב שנוצר מייבוא: אזור מצויר יפה, וכתובת
   * שלא פוענחה.
   */
  it("אזורי מפה מול נכס בלי קואורדינטות ובלי עיר — אין התאמה", () => {
    const { city: _city, ...noCity } = baseProperty;
    const result = scoreMatch(noCity, {
      ...baseBuyer,
      cities: [],
      searchAreas: [{ lat: 32.08, lon: 34.78, radiusKm: 3 }],
    });
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBe(0);
  });

  /*
   * ‎**הכלל אוסר להציג, לא להשוות.** מיקום שנבדק ונמצא רחוק הוא
   * תשובה — `excluded` בלי `insufficientData`. ההבחנה הזו היא כל
   * ההבדל בין „בדקנו וזה לא מתאים” לבין „לא היה מה לבדוק”, ומי
   * שסופר למה הרשימה ריקה צריך אותה.
   */
  it("מיקום שנבדק ונדחה אינו „חוסר מידע”", () => {
    const result = scoreMatch(baseProperty, { ...baseBuyer, cities: ["חיפה"] });
    expect(result.breakdown.some((p) => p.criterion === "location")).toBe(true);
    expect(result.excluded).toBe(true);
    expect(result.insufficientData).toBe(false);
  });

  /*
   * ‎**סוג הנכס הוא הקל במשקל ובכל זאת חובה.** וילה למי שמחפש דירת
   * שלושה חדרים אינה „התאמה חלשה” אלא טעות, ומשקל נמוך אומר שהוא
   * מבדיל פחות בין מועמדים — לא שמותר לדלג עליו.
   */
  it("נכס בלי סוג מול קונה שביקש סוג — אין התאמה", () => {
    const { propertyType: _type, ...noType } = baseProperty;
    const result = scoreMatch(noType, baseBuyer);
    expect(result.breakdown.some((p) => p.criterion === "property_type")).toBe(false);
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBe(0);
  });

  it("קונה בלי סוגי נכס — אין התאמה, גם על כרטיס נכס מלא", () => {
    const result = scoreMatch(baseProperty, { ...baseBuyer, propertyTypes: [] });
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBe(0);
  });

  /*
   * ‎**הווילה עצמה — הבדיקה שהייתה חסרה.**
   *
   * „חייב להיבחן” אינו „חייב להתאים”, ובגרסה הראשונה של הכלל
   * נבדקה רק קיומו של הקריטריון. סוג שאינו מבוקש נתן ציון אפס
   * לרכיב, הרכיב היה קיים, השער היה מרוצה — ומכיוון שמשקלו הוא
   * הקל בליבה, שאר הכרטיס גרר את הציון לכ-88 והווילה נשארה
   * ברשימה (ביקורת Codex). כלומר התיקון לא סיפק את הדוגמה שבשמה
   * הוא נעשה.
   */
  it("וילה למי שביקש דירה — נפסלת, לא „מתאימה ב-88%”", () => {
    const villa = scoreMatch({ ...baseProperty, propertyType: "house" }, baseBuyer);
    expect(villa.breakdown.some((p) => p.criterion === "property_type")).toBe(true);
    expect(villa.excluded).toBe(true);
    expect(villa.score).toBe(0);
    /* נבדק ונדחה — לא „חסר מידע” */
    expect(villa.insufficientData).toBe(false);
  });

  /*
   * שני תנאי הסף יחד הם .35 — מתחת ל-`MIN_CORE_COVERAGE`. זו אינה
   * תקלה אלא ההגדרה: הם תנאי כניסה ולא התאמה בפני עצמה.
   */
  it("מיקום וסוג לבדם אינם מספיקים — נדרש עוד קריטריון ליבה", () => {
    const bare = scoreMatch(baseProperty, {
      cities: ["בני ברק"],
      neighborhoods: [],
      dealType: "sale",
      propertyTypes: ["apartment"],
      features: {},
    });
    expect(bare.breakdown.some((p) => p.criterion === "location")).toBe(true);
    expect(bare.breakdown.some((p) => p.criterion === "property_type")).toBe(true);
    expect(bare.insufficientData).toBe(true);
  });

  /*
   * ‎**דחייה מפורשת גוברת על „חסר מידע” — גם כששניהם נכונים.**
   *
   * נכס בעיר שאינה מבוקשת ובלי סוג נכס הוא גם נדחה וגם חסר. השער
   * החדש דיווח עליו „אין מספיק פרטים”, כלומר הזמין את הסוכן להשלים
   * שדה — בזמן שהמיקום כבר נבדק ונדחה, והשלמת הסוג לא תשנה דבר
   * (ביקורת Codex). זו ההבחנה שהשער הזה עצמו נועד להגן עליה.
   */
  it("נדחה על המיקום **וגם** חסר סוג — הדחייה גוברת", () => {
    const { propertyType: _type, ...noType } = baseProperty;
    const result = scoreMatch(noType, { ...baseBuyer, cities: ["חיפה"] });
    expect(result.excluded).toBe(true);
    expect(result.insufficientData).toBe(false);
    expect(result.explanation).not.toContain("אין מספיק פרטים");
  });

  it("סוג שאינו מתאים **וגם** בלי מיקום — הדחייה גוברת", () => {
    const result = scoreMatch(
      { ...baseProperty, propertyType: "house" },
      { ...baseBuyer, cities: [] },
    );
    expect(result.excluded).toBe(true);
    expect(result.insufficientData).toBe(false);
  });

  /* ההסבר חייב לנקוב במיקום, אחרת אין לסוכן מה להשלים. */
  it("ההסבר נוקב במיקום ומכוון להשלמת הכרטיס", () => {
    const { city: _city, ...noCity } = baseProperty;
    const result = scoreMatch(noCity, baseBuyer);
    expect(result.explanation).toContain("מיקום");
    expect(result.explanation).toContain("השלימו");
  });

  /*
   * ‎**המשקלים אינם יכולים לבטל את הכלל.** משרד שמאפס את משקל
   * המיקום אינו מוותר על השאלה — הוא רק אומר שהיא שוקלת פחות.
   * הכיול נוגע לניקוד; החובה קודמת לו.
   */
  it("אין משקל שמכשיר התאמה בלי מיקום", () => {
    const { city: _city, ...noCity } = baseProperty;
    for (const stored of [{ location: 0.5 }, { budget: 0.5 }, { rooms: 0.5 }]) {
      const result = scoreMatch(noCity, baseBuyer, resolveMatchWeights(stored));
      expect(result.insufficientData).toBe(true);
      expect(result.score).toBe(0);
    }
  });
});

/*
 * ‎**רצועת הסטייה בשטח** (בקשת המשתמשת: „שטח — מותרת סטייה קטנה של
 * הטווח, כמו במחיר”).
 *
 * שטח אינו קריטריון חובה ואינו פוסל; מה שנבדק כאן הוא שהניקוד יורד
 * ברצף בתוך הרצועה, ולא במדרגה שמתייחסת ל-87 מ״ר ול-80 מ״ר כאל
 * אותו דבר.
 */
describe("שטח — רצועת סטייה חד-צדדית", () => {
  const buyer = { ...baseBuyer, areaSqmMin: 100 };
  const areaScore = (areaSqm: number): number => {
    const result = scoreMatch({ ...baseProperty, areaSqm }, buyer);
    return result.breakdown.find((p) => p.criterion === "area")?.score ?? -1;
  };

  it("שטח מלא או גדול מהמבוקש — ניקוד מלא, בלי הערה", () => {
    expect(areaScore(100)).toBe(1);
    expect(areaScore(140)).toBe(1);
    const result = scoreMatch({ ...baseProperty, areaSqm: 140 }, buyer);
    expect(result.breakdown.find((p) => p.criterion === "area")?.note).toBeUndefined();
  });

  it("בתוך הרצועה — ניקוד חלקי שיורד ברצף", () => {
    const at97 = areaScore(97);
    const at93 = areaScore(93);
    expect(at97).toBeGreaterThan(at93);
    expect(at93).toBeGreaterThan(0);
    expect(at97).toBeLessThan(1);
  });

  it("מחוץ לרצועה — אפס, אבל בלי לפסול את ההתאמה", () => {
    expect(areaScore(85)).toBe(0);
    const result = scoreMatch({ ...baseProperty, areaSqm: 85 }, buyer);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it("ההערה נוקבת בפער ולא רק בעובדה", () => {
    const result = scoreMatch({ ...baseProperty, areaSqm: 95 }, buyer);
    expect(result.breakdown.find((p) => p.criterion === "area")?.note).toContain("5%");
  });
});

/*
 * ‎**ההערה חייבת להיכנס לסכמה שהיא נשמרת בה.**
 *
 * המנוע כתב הערות בלי לדעת על התקרה, הכתיבה שמרה בלי לאמת,
 * והקריאה השמיטה את הרכיב בשקט — כך שקריטריון שפסל את ההתאמה
 * הופיע על המסך כ„לא נבדק” (ביקורת Codex). הבדיקה מודדת מול
 * הסכמה עצמה, ולא מול חשבון תווים שכתבתי בהערה.
 */
describe("אורך ההערות מול הסכמה", () => {
  /** מפתח מותאם באורך המרבי שהסכמה מתירה — התרחיש הגרוע ביותר. */
  const longFeature = (i: number): string =>
    `custom:${`מאפיין-ארוך-במיוחד-${i}`.padEnd(50, "־")}`.slice(0, 64);

  function withFeatures(level: "must" | "nice", count: number): BuyerRequirements {
    const features: Record<string, "must" | "nice"> = {};
    for (let i = 0; i < count; i += 1) features[longFeature(i)] = level;
    return { ...baseBuyer, features };
  }

  it("דרישות חובה רבות וארוכות — ההערה עדיין עוברת את הסכמה", () => {
    /*
     * המאפיינים המותאמים אינם קיימים בנכס, ולכן הם „לא ידוע”
     * ונכנסים כולם להערה. אין בסכמה גבול על מספר הדרישות של הקונה.
     */
    const result = scoreMatch(baseProperty, withFeatures("must", 40));
    const part = result.breakdown.find((p) => p.criterion === "features_must");
    expect(part).toBeDefined();
    expect(ScoreComponentSchema.safeParse(part).success).toBe(true);
  });

  it("„נחמד שיהיה” רבים וארוכים — אותו דבר", () => {
    const result = scoreMatch(baseProperty, withFeatures("nice", 40));
    const part = result.breakdown.find((p) => p.criterion === "features_nice");
    expect(ScoreComponentSchema.safeParse(part).success).toBe(true);
  });

  it("דרישה שהנכס מפר במפורש — הרשימה מקוצצת והספירה נשמרת", () => {
    const buyer = withFeatures("must", 40);
    /* הנכס מצהיר `false` על כולם — כלומר הפרה מפורשת, לא „לא ידוע” */
    const property: PropertyFields = {
      ...baseProperty,
      /* המפתח נשמר **עם** הקידומת — כך המנוע מחפש אותו */
      customFeatures: Object.keys(buyer.features).map((key) => ({
        key,
        label: key.slice("custom:".length).slice(0, 24),
        value: false,
      })),
    };
    const result = scoreMatch(property, buyer);
    const part = result.breakdown.find((p) => p.criterion === "features_must");
    /*
     * שער על הבדיקה עצמה: הפרה מפורשת מאפסת את הקריטריון ופוסלת
     * את ההתאמה. בלי זה הבדיקה יכולה לרוץ בענף „לא ידוע” ולדווח
     * הצלחה בלי לגעת בענף שהיא נכתבה בשבילו — וכך בדיוק קרה.
     */
    expect(part?.score).toBe(0);
    expect(result.excluded).toBe(true);
    expect(ScoreComponentSchema.safeParse(part).success).toBe(true);
    /* מה שקוצץ נספר — „ועוד N” הוא ההבדל בין שלושה חסרים לארבעים */
    expect(part?.note).toMatch(/ועוד \d+/);
  });
});

/*
 * ‎**„חסר בנכס” מול „הקונה לא ביקש”.**
 *
 * שני קריטריונים נעדרים מהפירוט מאותה סיבה נראית — אין להם ציון —
 * ומשתי סיבות הפוכות. רצועת ההסבר צבעה את שניהם באפור, ולכן שלחה
 * את המתווך למלא שדות בהתאמה שכבר מלאה (ביקורת Codex).
 */
describe("propertyEvaluableCriteria", () => {
  /*
   * ‎**השער שמגן על קונה-הבדיקה.**
   *
   * הפונקציה מודדת את הנכס בעזרת קונה שמבקש הכול. קריטריון חדש
   * שיתווסף למנוע ולא יתווסף לקונה הזה יימדד כ„הנכס אינו מסוגל
   * לו” — כלומר יוצג כחסר גם בנכס מלא, בשקט. כאן זה נופל.
   */
  /** נכס שכל נתון שקריטריון כלשהו זקוק לו קיים בו. */
  const completeProperty: PropertyFields = {
    ...baseProperty,
    latitude: 32.08,
    longitude: 34.83,
    entryType: "on_date",
    entryDate: new Date("2030-01-01"),
  };

  it("נכס מלא מסוגל לכל הקריטריונים — בלי יוצא מן הכלל", () => {
    expect([...propertyEvaluableCriteria(completeProperty)].sort()).toEqual(
      [...MATCH_CRITERIA].sort(),
    );
  });

  /*
   * ‎**הכיוון השני, וזה שנשבר.**
   *
   * הבדיקה למעלה בודקת שהכלי אינו **מחמיר** מדי — נכס מלא מסוגל
   * להכול. היא אינה יכולה לתפוס כלי **סלחני** מדי, כלומר כזה
   * שמכריז „מסוגל” על נכס שחסר בו הנתון. וזה מה שקרה: קונה-הבדיקה
   * היה `entryType: "flexible"`, ו-`scoreEntryFit` מחזיר לו ציון
   * ‎**לפני** שהוא בודק אם לנכס יש תאריך. נכס עם מצב כניסה ובלי
   * תאריך נמדד כ„מסוגל”, הצ'יפ נעלם, ולמתווך לא נאמר מה חסר
   * (ביקורת Codex).
   *
   * לכל קריטריון יש כאן נכס שחסר בו בדיוק הנתון שהוא זקוק לו, ומה
   * שנדרש הוא שהכלי **יפול** עליו. הטבלה עצמה נשמרת שלמה על ידי
   * הבדיקה שאחריה.
   */
  const MISSING_DATUM: Record<string, PropertyFields | null> = {
    /* בלי עיר ובלי קואורדינטות — אין משני מסלולי המיקום */
    location: (() => {
      const { city: _c, latitude: _lat, longitude: _lon, ...rest } = completeProperty;
      return rest;
    })(),
    budget: (() => {
      const { priceAgorot: _p, ...rest } = completeProperty;
      return rest;
    })(),
    rooms: (() => {
      const { rooms: _r, ...rest } = completeProperty;
      return rest;
    })(),
    property_type: (() => {
      const { propertyType: _t, ...rest } = completeProperty;
      return rest;
    })(),
    area: (() => {
      const { areaSqm: _a, ...rest } = completeProperty;
      return rest;
    })(),
    /*
     * ‎**המקרה שנמצא בביקורת.** מצב כניסה „בתאריך” בלי תאריך — מצב
     * שהסכמה והטופס מתירים. כל קונה עם אילוץ מקבל עליו `null`.
     */
    entry_date: (() => {
      const { entryDate: _d, ...rest } = completeProperty;
      return { ...rest, entryType: "on_date" as const };
    })(),
    /* אין שדה בנכס שחוסם מאפיינים — הם דרישה של הקונה בלבד */
    features_must: null,
    features_nice: null,
  };

  it.each(
    Object.entries(MISSING_DATUM).filter(
      (entry): entry is [string, PropertyFields] => entry[1] !== null,
    ),
  )("נכס שחסר בו הנתון של %s — אינו מסוגל לו", (criterion, property) => {
    expect(propertyEvaluableCriteria(property).has(criterion as never)).toBe(false);
    /* ושהנכס המלא כן מסוגל — אחרת הבדיקה עוברת מסיבה לא קשורה */
    expect(propertyEvaluableCriteria(completeProperty).has(criterion as never)).toBe(true);
  });

  /*
   * המאפיינים הם קריטריון של **הקונה**: אין שדה בנכס שחוסם אותם,
   * ולכן היעדרם לעולם אינו „חסר בנכס”. זה בדיוק המקרה ש-Codex
   * הצביע עליו בסבב הקודם — קונה שסימן הכול כ„לא רלוונטי”.
   */
  it("המאפיינים אינם נחסמים בנכס — גם נכס ריק מסוגל להם", () => {
    const bare: PropertyFields = { dealType: "sale" };
    const evaluable = propertyEvaluableCriteria(bare);
    expect(evaluable.has("features_must")).toBe(true);
    expect(evaluable.has("features_nice")).toBe(true);
  });

  /*
   * ‎**שער על הטבלה עצמה.** קריטריון חדש שיתווסף למנוע ולא יקבל
   * כאן שורה יעבור בלי שאיש יבדוק מה קורה כשהנתון שלו חסר —
   * וההשמטה תהיה שקטה, בדיוק כמו זו שנמצאה בביקורת.
   */
  it("לכל קריטריון יש שורה בטבלה — גם לזה שיתווסף מחר", () => {
    expect(Object.keys(MISSING_DATUM).sort()).toEqual([...MATCH_CRITERIA].sort());
  });
});

/*
 * ‎**שער אחד על כל ההערות, ולא בדיקה לכל ניסוח.**
 *
 * הבדיקות למעלה נוקבות במסלולי המאפיינים, כי שם היה הליקוי. הן
 * לא היו תופסות ניסוח **חדש** שיוסיף קלט חיצוני להערה — וזו
 * בדיוק הצורה שבה הליקוי הזה נולד: הערה שנכתבה בלי לדעת על התקרה.
 *
 * כאן מריצים את המנוע על הקלט הארוך ביותר שהסכמות מתירות משני
 * הצדדים, ומודדים **כל** רכיב שיצא מול הסכמה. הבדיקה אינה יודעת
 * אילו קריטריונים קיימים, ולכן היא מכסה גם את מה שיתווסף.
 */
describe("כל ההערות עומדות בסכמה, על הקלט המרבי", () => {
  const maxText = (n: number): string => "א".repeat(n);

  it("קלט מרבי משני הצדדים — כל רכיב עובר, וכולם נבחנו", () => {
    const property: PropertyFields = {
      city: maxText(80),
      neighborhood: maxText(80),
      propertyType: "apartment",
      dealType: "sale",
      rooms: 4,
      areaSqm: 95,
      priceAgorot: 265_000_000,
      entryType: "on_date",
      entryDate: new Date("2030-01-01"),
      customFeatures: Array.from({ length: 12 }, (_, i) => ({
        key: `custom:${maxText(50)}${i}`,
        label: maxText(24),
        value: false,
      })),
    };
    const buyer: BuyerRequirements = {
      cities: [maxText(80)],
      neighborhoods: [maxText(80)],
      searchAreas: [],
      dealType: "sale",
      propertyTypes: ["penthouse"],
      budgetMaxAgorot: 100_000_000,
      budgetMinAgorot: 90_000_000,
      roomsMin: 9,
      roomsMax: 10,
      areaSqmMin: 400,
      features: Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [
          `custom:${maxText(50)}${i}`,
          i % 2 === 0 ? "must" : "nice",
        ]),
      ),
      entryType: "by_date",
      entryBy: new Date("2026-01-01"),
    };

    const { breakdown } = scoreMatch(property, buyer);
    /*
     * שער על הבדיקה עצמה: בלעדיו היא יכולה לכסות שני קריטריונים
     * ולדווח הצלחה. הקלט למעלה בנוי כך שכולם ייבחנו.
     */
    expect(breakdown).toHaveLength(MATCH_CRITERIA.length);
    for (const part of breakdown) {
      expect(ScoreComponentSchema.safeParse(part).success).toBe(true);
    }
  });

  /*
   * אזור חיפוש נושא תווית עד 60 תווים, והיא נכנסת להערת המיקום.
   * מסלול נפרד מהעיר, ולכן נבדק בנפרד.
   */
  it("תווית אזור חיפוש באורך המרבי — הערת המיקום עומדת בסכמה", () => {
    const property: PropertyFields = {
      ...baseProperty,
      latitude: 32.08,
      longitude: 34.83,
    };
    const buyer: BuyerRequirements = {
      ...baseBuyer,
      searchAreas: [{ lat: 32.08, lon: 34.83, radiusKm: 5, label: maxText(60) }],
    };
    const part = scoreMatch(property, buyer).breakdown.find(
      (p) => p.criterion === "location",
    );
    expect(part?.note).toBeDefined();
    expect(ScoreComponentSchema.safeParse(part).success).toBe(true);
  });
});
