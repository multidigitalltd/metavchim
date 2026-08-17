import { describe, expect, it } from "vitest";
import { extractPropertyFromTranscript } from "./extract-property.js";

describe("extractPropertyFromTranscript — קליטת נכס בקול", () => {
  it("הדוגמה המלאה מהאפיון (§6) מחולצת נכון", () => {
    const { fields } = extractPropertyFromTranscript(
      "דירת 3 חדרים בבני ברק, רחוב הרב שך, קומה 2 מתוך 4, בלי מעלית, 68 מטר, משופצת, מחיר 2.15 מיליון",
    );
    expect(fields.rooms).toBe(3);
    expect(fields.city).toBe("בני ברק");
    expect(fields.street).toBe("הרב שך");
    expect(fields.floor).toBe(2);
    expect(fields.totalFloors).toBe(4);
    expect(fields.hasElevator).toBe(false);
    expect(fields.areaSqm).toBe(68);
    expect(fields.condition).toBe("renovated");
    expect(fields.priceAgorot).toBe(215_000_000);
    expect(fields.propertyType).toBe("apartment");
    expect(fields.dealType).toBe("sale");
  });

  it("חצאי חדרים: '3 וחצי חדרים' ו-'3.5 חדרים'", () => {
    expect(
      extractPropertyFromTranscript("3 וחצי חדרים בירושלים").fields.rooms,
    ).toBe(3.5);
    expect(
      extractPropertyFromTranscript("3.5 חדרים בירושלים").fields.rooms,
    ).toBe(3.5);
  });

  it("מספרים במילים: 'ארבעה חדרים'", () => {
    expect(
      extractPropertyFromTranscript("ארבעה חדרים בבית שמש").fields.rooms,
    ).toBe(4);
  });

  it("מחיר באלפים ובשקלים (שכירות)", () => {
    expect(
      extractPropertyFromTranscript("850 אלף בטבריה").fields.priceAgorot,
    ).toBe(85_000_000);
    const rent = extractPropertyFromTranscript("להשכרה 6,500 שקל בחיפה").fields;
    expect(rent.priceAgorot).toBe(650_000);
    expect(rent.dealType).toBe("rent");
  });

  it("'עם מעלית וחניה' ⇒ שניהם true; מה שלא הוזכר נשאר לא-ידוע", () => {
    const { fields } = extractPropertyFromTranscript(
      "4 חדרים בבני ברק עם מעלית וחניה",
    );
    expect(fields.hasElevator).toBe(true);
    expect(fields.hasParking).toBe(true);
    expect(fields.hasBalcony).toBeUndefined();
  });

  it("בלעדיות מזוהה", () => {
    expect(
      extractPropertyFromTranscript("יש לנו בלעדיות על הדירה").fields.exclusive,
    ).toBe(true);
  });

  it("evidence מסביר ממה הבנו כל שדה", () => {
    const { evidence } = extractPropertyFromTranscript(
      "דירת 3 חדרים בבני ברק, מחיר 2 מיליון",
    );
    expect(evidence.rooms).toContain("חדרים");
    expect(evidence.priceAgorot).toContain("מיליון");
  });

  it("תמלול ריק ⇒ שדות ריקים, בלי קריסה", () => {
    expect(extractPropertyFromTranscript("").fields).toEqual({});
  });
});

/*
 * שלושת הממצאים מהבדיקה כמשתמשת: התיאור נבלע לתוך הכתובת, המחיר
 * לא הגיע לשדה שלו, והתיאור לא נשמר בשום מקום.
 */
describe("קליטה קולית — מה שנאמר מגיע לשדה הנכון", () => {
  it("התיאור אינו נבלע לתוך הכתובת", () => {
    const { fields } = extractPropertyFromTranscript(
      "ברחוב הרצל דירה מהממת משופצת עם נוף לים בבני ברק",
    );
    expect(fields.street).toBe("הרצל");
  });

  it("שם רחוב ארוך נחתך ואינו גורר משפט שלם", () => {
    const { fields } = extractPropertyFromTranscript(
      "ברחוב רבי עקיבא 10 קומה 2",
    );
    expect(fields.street).toBe("רבי עקיבא 10");
  });

  it("מחיר שנאמר כמספר מלא נכנס לשדה המחיר", () => {
    expect(
      extractPropertyFromTranscript("דירת 4 חדרים בבני ברק, מחיר 2,300,000")
        .fields.priceAgorot,
    ).toBe(230_000_000);
    expect(
      extractPropertyFromTranscript("דירה בחיפה במחיר 1750000").fields
        .priceAgorot,
    ).toBe(175_000_000);
  });

  it("מספר עם מפרידי אלפים נקרא כמחיר גם בלי מילה שמקדימה", () => {
    expect(
      extractPropertyFromTranscript("דירת 4 חדרים בבני ברק, 2,300,000").fields
        .priceAgorot,
    ).toBe(230_000_000);
  });

  /* שטח, קומה וחדרים אינם מחיר — הסף התחתון הוא מה שמונע את זה */
  it("מספרים קטנים אינם הופכים למחיר", () => {
    const { fields } = extractPropertyFromTranscript(
      "דירת 4 חדרים 68 מטר קומה 3 בבני ברק",
    );
    expect(fields.priceAgorot).toBeUndefined();
    expect(fields.areaSqm).toBe(68);
    expect(fields.floor).toBe(3);
  });

  it("מילת יחידה עדיין גוברת על מספר חשוף", () => {
    expect(
      extractPropertyFromTranscript("דירה בבני ברק 2.15 מיליון").fields
        .priceAgorot,
    ).toBe(215_000_000);
  });

  it("מה שנאמר נשמר כתוכן שיווקי", () => {
    const { marketingDescription } = extractPropertyFromTranscript(
      "דירה מהממת עם נוף לים בבני ברק",
    );
    expect(marketingDescription).toContain("נוף לים");
  });
});

/* ביקורת Codex: מספר טלפון ותאריך אינם מחיר */
describe("סכום חשוף — מה שאסור להיקרא כמחיר", () => {
  it("מספר טלפון אינו מחיר", () => {
    const { fields } = extractPropertyFromTranscript(
      "דירת 4 חדרים בבני ברק, לפרטים בטלפון ב-0501234567",
    );
    expect(fields.priceAgorot).toBeUndefined();
  });

  it("תאריך דחוס אינו מחיר", () => {
    const { fields } = extractPropertyFromTranscript(
      "דירה בחיפה, כניסה ב-15/03/2026",
    );
    expect(fields.priceAgorot).toBeUndefined();
  });

  it("מספר ארוך אינו נחתך לתשע ספרות", () => {
    const { fields } = extractPropertyFromTranscript(
      "דירה בחיפה מחיר 12345678901",
    );
    expect(fields.priceAgorot).toBeUndefined();
  });
});
