import { describe, expect, it } from "vitest";
import {
  parseCsvLine,
  parsePropertiesCsv,
  parseRecruitmentCsv,
  parseShekelsToAgorot,
} from "./csv-import.js";

describe("parseShekelsToAgorot", () => {
  it("שומר על נקודה עשרונית ומפריד אלפים", () => {
    expect(parseShekelsToAgorot("6,000.00")).toBe(600_000); // 6,000₪
    expect(parseShekelsToAgorot("2,650,000")).toBe(265_000_000);
    expect(parseShekelsToAgorot("₪ 1,234.5")).toBe(123_450);
    expect(parseShekelsToAgorot("2650000")).toBe(265_000_000);
  });

  it("דוחה ערכים לא מספריים או אפס — עדיף לדלג מלייבא סכום שגוי", () => {
    expect(parseShekelsToAgorot("אין")).toBeUndefined();
    expect(parseShekelsToAgorot("0")).toBeUndefined();
    expect(parseShekelsToAgorot("1.234.567")).toBeUndefined();
  });
});

describe("parseCsvLine", () => {
  it("מפרק פסיקים פשוטים", () => {
    expect(parseCsvLine("בני ברק,רבי עקיבא,4")).toEqual(["בני ברק", "רבי עקיבא", "4"]);
  });

  it("תומך בגרשיים עם פסיק בתוך שדה", () => {
    expect(parseCsvLine('"דירה, משופצת",100')).toEqual(["דירה, משופצת", "100"]);
  });
});

describe("parsePropertiesCsv", () => {
  it("ממפה כותרות עבריות ומחלץ נכסים", () => {
    const csv = [
      "עיר,שכונה,רחוב,חדרים,מחיר,סוג",
      "בני ברק,פרדס כץ,רבי עקיבא,4,2650000,דירה",
      "ירושלים,רמות,הרב שך,3.5,3200000,דירת גן",
    ].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.fields.city).toBe("בני ברק");
    expect(rows[0]?.fields.rooms).toBe(4);
    expect(rows[0]?.fields.priceAgorot).toBe(265_000_000); // ₪→אגורות
    expect(rows[0]?.fields.propertyType).toBe("apartment");
    expect(rows[0]?.fields.dealType).toBe("sale"); // נגזר מהמחיר
    expect(rows[1]?.fields.rooms).toBe(3.5);
    expect(rows[1]?.fields.propertyType).toBe("garden_apartment");
  });

  it("מדווח על כותרות לא מזוהות", () => {
    const { unmappedHeaders } = parsePropertiesCsv("עיר,בלגן,מחיר\nחיפה,x,100");
    expect(unmappedHeaders).toContain("בלגן");
  });

  it("CSV ריק ⇒ אפס שורות", () => {
    expect(parsePropertiesCsv("").rows).toHaveLength(0);
    expect(parsePropertiesCsv("עיר,מחיר").rows).toHaveLength(0); // רק כותרת
  });

  it("שדות ריקים בשורה מדולגים בלי קריסה", () => {
    const { rows } = parsePropertiesCsv("עיר,חדרים,מחיר\nחיפה,,");
    expect(rows[0]?.fields.city).toBe("חיפה");
    expect(rows[0]?.fields.rooms).toBeUndefined();
  });
});

/**
 * ההרחבה הגדולה של מפת הכותרות — הסיבה שהייבוא "לא עבד מספיק טוב":
 * גיליון אמיתי מדבר על כתובת, סוג עסקה, מעלית ובעל הנכס, והמפה
 * הישנה הכירה תשע כותרות בלבד. כל עמודה כזו נזרקה בשקט.
 */
describe("parsePropertiesCsv — הכותרות המורחבות", () => {
  it("כתובת מלאה מתפצלת לרחוב ומספר בית", () => {
    const csv = ["כתובת,עיר,חדרים", "רבי עקיבא 10,בני ברק,4"].join("\n");
    const { rows, unmappedHeaders } = parsePropertiesCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]?.fields).toMatchObject({
      street: "רבי עקיבא",
      houseNumber: "10",
      city: "בני ברק",
      rooms: 4,
    });
  });

  it("סוג עסקה, מצב ומאפיינים בכן/לא", () => {
    const csv = [
      "עיר,סוג עסקה,מצב,מעלית,חניה,ממד,מחסן",
      "רמת גן,השכרה,משופץ,כן,יש,לא,אין",
    ].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]?.fields).toMatchObject({
      dealType: "rent",
      condition: "renovated",
      hasElevator: true,
      hasParking: true,
      hasSafeRoom: false,
      hasStorage: false,
    });
  });

  it("בעל הנכס, תיאור והערות פנימיות", () => {
    const csv = [
      "עיר,בעל הנכס,טלפון בעלים,תיאור,הערות",
      'חולון,ישראל ישראלי,050-1234567,"נוף פתוח","המפתח אצל השכן"',
    ].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]).toMatchObject({
      ownerName: "ישראל ישראלי",
      ownerPhone: "+972501234567",
      marketingDescription: "נוף פתוח",
      internalNotes: "המפתח אצל השכן",
    });
  });

  it("כותרות באנגלית ועם רעש (כוכבית, מרכאות, אותיות גדולות)", () => {
    const csv = ['City,"*Rooms",PRICE', "חיפה,3.5,1200000"].join("\n");
    const { rows, unmappedHeaders } = parsePropertiesCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]?.fields).toMatchObject({ city: "חיפה", rooms: 3.5, priceAgorot: 120_000_000 });
  });

  it("קומת קרקע ומתוך קומות", () => {
    const csv = ["עיר,קומה,מתוך קומות", "בת ים,קרקע,6"].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]?.fields).toMatchObject({ floor: 0, totalFloors: 6 });
  });

  it("מיפוי ידני גובר על הזיהוי האוטומטי", () => {
    const csv = ["מקום,עלות", "נתניה,2000000"].join("\n");
    expect(parsePropertiesCsv(csv).unmappedHeaders).toHaveLength(2);
    const { rows, unmappedHeaders } = parsePropertiesCsv(csv, {
      מקום: "city",
      עלות: "priceAgorot",
    });
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]?.fields).toMatchObject({ city: "נתניה", priceAgorot: 200_000_000 });
  });
});

describe("parsePropertiesCsv — טלפון בעל הנכס", () => {
  it("מנורמל ל-E.164 כמו כל טלפון מיובא", () => {
    const csv = ["עיר,בעל הנכס,טלפון בעלים", "חולון,ישראל,050-1234567"].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]?.ownerPhone).toBe("+972501234567");
  });

  it("ערך שאינו טלפון מועבר גולמי — ההכרעה בשרת", () => {
    const csv = ["עיר,טלפון בעלים", "חולון,אין"].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]?.ownerPhone).toBe("אין");
  });
});

describe("ייבוא נכסים לגיוס", () => {
  it("מפרק את העמודות של הגיוס, כולל מקור וקישור", () => {
    const csv = [
      "עיר,רחוב,חדרים,מחיר,מקור,קישור למודעה,שלב,בעל הנכס,הערות",
      'רעננה,אחוזה,4,2650000,יד2,https://www.yad2.co.il/item/1,קיבל שיחה,ישראל ישראלי,"אמר שיחזור"',
    ].join("\n");
    const { rows, unmappedHeaders } = parseRecruitmentCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      city: "רעננה",
      street: "אחוזה",
      rooms: 4,
      // ‏אגורות, לא שקלים — אחרת 2,650,000 היה מופיע ככרטיס של 26,500
      priceAgorot: 265_000_000,
      source: "yad2",
      sourceUrl: "https://www.yad2.co.il/item/1",
      status: "called",
      ownerName: "ישראל ישראלי",
      notes: "אמר שיחזור",
    });
  });

  /**
   * ‏סכימת הגיוס בשרת היא `.strict()`. עמודה שאינה שייכת חייבת
   * ‏להופיע כ„לא זוהתה” במסך — אחרת המתווך רואה „זוהתה”, השרת
   * ‏זורק את הערך, והוא מגלה רק מהכרטיס שמשהו חסר.
   */
  it("עמודה שאינה של גיוס מדווחת כלא-מזוהה ואינה נקלטת", () => {
    const csv = ["עיר,כותרת שיווקית,מעלית", "חיפה,דירה מרווחת,כן"].join("\n");
    const { rows, unmappedHeaders } = parseRecruitmentCsv(csv);
    expect(unmappedHeaders).toEqual(["כותרת שיווקית", "מעלית"]);
    expect(rows[0]).toEqual({ city: "חיפה" });
  });

  it("מקבל גם את הקוד עצמו, לא רק את התווית העברית", () => {
    const csv = ["עיר,מקור,שלב", "לוד,madlan,recruited"].join("\n");
    const { rows } = parseRecruitmentCsv(csv);
    expect(rows[0]?.source).toBe("madlan");
    expect(rows[0]?.status).toBe("recruited");
  });

  it("ערך מקור או שלב שאינו מוכר מושמט ואינו מפיל את השורה", () => {
    const csv = ["עיר,מקור,שלב", "אילת,מקור מומצא,שלב מומצא"].join("\n");
    const { rows } = parseRecruitmentCsv(csv);
    expect(rows[0]).toEqual({ city: "אילת" });
  });

  it("מיפוי ידני גובר על הזיהוי האוטומטי", () => {
    const csv = ["עמודה משונה", "נתניה"].join("\n");
    const { rows } = parseRecruitmentCsv(csv, { "עמודה משונה": "city" });
    expect(rows[0]?.city).toBe("נתניה");
  });

  it("קובץ בלי שורות נתונים מחזיר ריק", () => {
    expect(parseRecruitmentCsv("עיר,רחוב").rows).toEqual([]);
    expect(parseRecruitmentCsv("").rows).toEqual([]);
  });
});
