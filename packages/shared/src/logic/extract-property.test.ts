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
    expect(extractPropertyFromTranscript("3 וחצי חדרים בירושלים").fields.rooms).toBe(3.5);
    expect(extractPropertyFromTranscript("3.5 חדרים בירושלים").fields.rooms).toBe(3.5);
  });

  it("מספרים במילים: 'ארבעה חדרים'", () => {
    expect(extractPropertyFromTranscript("ארבעה חדרים בבית שמש").fields.rooms).toBe(4);
  });

  it("מחיר באלפים ובשקלים (שכירות)", () => {
    expect(extractPropertyFromTranscript("850 אלף בטבריה").fields.priceAgorot).toBe(85_000_000);
    const rent = extractPropertyFromTranscript("להשכרה 6,500 שקל בחיפה").fields;
    expect(rent.priceAgorot).toBe(650_000);
    expect(rent.dealType).toBe("rent");
  });

  it("'עם מעלית וחניה' ⇒ שניהם true; מה שלא הוזכר נשאר לא-ידוע", () => {
    const { fields } = extractPropertyFromTranscript("4 חדרים בבני ברק עם מעלית וחניה");
    expect(fields.hasElevator).toBe(true);
    expect(fields.hasParking).toBe(true);
    expect(fields.hasBalcony).toBeUndefined();
  });

  it("בלעדיות מזוהה", () => {
    expect(extractPropertyFromTranscript("יש לנו בלעדיות על הדירה").fields.exclusive).toBe(true);
  });

  it("evidence מסביר ממה הבנו כל שדה", () => {
    const { evidence } = extractPropertyFromTranscript("דירת 3 חדרים בבני ברק, מחיר 2 מיליון");
    expect(evidence.rooms).toContain("חדרים");
    expect(evidence.priceAgorot).toContain("מיליון");
  });

  it("תמלול ריק ⇒ שדות ריקים, בלי קריסה", () => {
    expect(extractPropertyFromTranscript("").fields).toEqual({});
  });
});
