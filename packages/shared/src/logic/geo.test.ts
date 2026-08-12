import { describe, expect, it } from "vitest";
import { isPointInPolygon, isWithinIsrael, itmToWgs84, wgs84ToItm } from "./geo.js";

/*
 * המרת קואורדינטות היא בדיוק סוג הקוד שנראה נכון ואינו: טעות של
 * שבר בפרמטר מזיזה נכס בקילומטרים בלי לזרוק שום שגיאה. לכן שתי
 * בדיקות עוגן שאינן תלויות בשום נתון חיצוני — ראשית הרשת והלוך-חזור.
 */
describe("רשת ישראל ⇄ קו רוחב/אורך", () => {
  it("נקודת ההיסט חוזרת בדיוק לראשית הרשת", () => {
    // ההיסטים מוגדרים כך שהם *הם* ראשית הרשת — בדיקה מתמטית, לא מדידה
    const origin = itmToWgs84({ x: 219529.584, y: 626907.39 });
    expect(origin.lat).toBeCloseTo(31 + 44 / 60 + 3.817 / 3600, 9);
    expect(origin.lon).toBeCloseTo(35 + 12 / 60 + 16.261 / 3600, 9);
  });

  it("כתובת אמיתית ממפ״י נוחתת במקום הנכון", () => {
    // "רבי עקיבא 1, בני ברק" כפי שהוחזר מ-GovMap
    const { lat, lon } = itmToWgs84({ x: 183669.276, y: 666485.3988 });
    expect(lat).toBeCloseTo(32.0907, 3);
    expect(lon).toBeCloseTo(34.8246, 3);
    expect(isWithinIsrael({ lat, lon })).toBe(true);
  });

  it("הלוך-חזור משחזר את המוצא", () => {
    for (const point of [
      { lat: 32.0907, lon: 34.8246 }, // בני ברק
      { lat: 31.7683, lon: 35.2137 }, // ירושלים
      { lat: 32.794, lon: 34.9896 }, // חיפה
      { lat: 31.2518, lon: 34.7913 }, // באר שבע
    ]) {
      const back = itmToWgs84(wgs84ToItm(point));
      expect(back.lat).toBeCloseTo(point.lat, 7);
      expect(back.lon).toBeCloseTo(point.lon, 7);
    }
  });

  it("היפוך בין רוחב לאורך נתפס", () => {
    // הטעות הנפוצה: [lon, lat] במקום [lat, lon]
    expect(isWithinIsrael({ lat: 32.09, lon: 34.82 })).toBe(true);
    expect(isWithinIsrael({ lat: 34.82, lon: 32.09 })).toBe(false);
  });
});

describe("נקודה בתוך אזור מסומן", () => {
  /** ריבוע קטן סביב מרכז בני ברק. */
  const square = [
    { lat: 32.08, lon: 34.82 },
    { lat: 32.1, lon: 34.82 },
    { lat: 32.1, lon: 34.84 },
    { lat: 32.08, lon: 34.84 },
  ];

  it("בפנים ובחוץ", () => {
    expect(isPointInPolygon({ lat: 32.09, lon: 34.83 }, square)).toBe(true);
    expect(isPointInPolygon({ lat: 32.07, lon: 34.83 }, square)).toBe(false);
    expect(isPointInPolygon({ lat: 32.09, lon: 34.9 }, square)).toBe(false);
  });

  it("מצולע לא תקין אינו מכיל דבר", () => {
    expect(isPointInPolygon({ lat: 32.09, lon: 34.83 }, [])).toBe(false);
    expect(isPointInPolygon({ lat: 32.09, lon: 34.83 }, square.slice(0, 2))).toBe(false);
  });

  it("צורה קעורה — נקודה במפרץ נשארת בחוץ", () => {
    /*
     * זה מה שמבדיל ריבוע תוחם ממצולע אמיתי: אזור בצורת U מוציא את
     * מה שביניהם, וזו בדיוק הסיבה לתת למתווך לצייר ולא לבחור רדיוס.
     */
    const u = [
      { lat: 32.08, lon: 34.82 },
      { lat: 32.1, lon: 34.82 },
      { lat: 32.1, lon: 34.83 },
      { lat: 32.085, lon: 34.83 },
      { lat: 32.085, lon: 34.84 },
      { lat: 32.1, lon: 34.84 },
      { lat: 32.1, lon: 34.85 },
      { lat: 32.08, lon: 34.85 },
    ];
    expect(isPointInPolygon({ lat: 32.082, lon: 34.835 }, u)).toBe(true); // בבסיס ה-U
    expect(isPointInPolygon({ lat: 32.095, lon: 34.835 }, u)).toBe(false); // במפרץ
  });
});
