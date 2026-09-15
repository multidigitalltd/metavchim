import { describe, expect, it } from "vitest";
import {
  bestAreaMatch,
  boundingBox,
  describeDistance,
  haversineKm,
  proximityScore,
  searchAreaRejectionReason,
  type SearchArea,
  searchAreaRing,
  DEFAULT_SEARCH_RADIUS_KM,
  MIN_SEARCH_RADIUS_KM,
  MAX_SEARCH_RADIUS_KM,
} from "./proximity.js";

/* נקודות אמיתיות, כדי שהמרחקים יהיו ניתנים לבדיקה מול המציאות. */
const TEL_AVIV = { lat: 32.0853, lon: 34.7818 };
const RAMAT_GAN = { lat: 32.0684, lon: 34.8248 };
const HAIFA = { lat: 32.794, lon: 34.9896 };

describe("haversineKm", () => {
  it("תל אביב–רמת גן ≈ 4 ק״מ", () => {
    expect(haversineKm(TEL_AVIV, RAMAT_GAN)).toBeGreaterThan(3.5);
    expect(haversineKm(TEL_AVIV, RAMAT_GAN)).toBeLessThan(4.5);
  });

  it("תל אביב–חיפה ≈ 82 ק״מ", () => {
    const km = haversineKm(TEL_AVIV, HAIFA);
    expect(km).toBeGreaterThan(78);
    expect(km).toBeLessThan(86);
  });

  it("אותה נקודה — אפס", () => {
    expect(haversineKm(TEL_AVIV, TEL_AVIV)).toBeCloseTo(0, 6);
  });

  it("סימטרי", () => {
    expect(haversineKm(TEL_AVIV, HAIFA)).toBeCloseTo(haversineKm(HAIFA, TEL_AVIV), 9);
  });
});

describe("proximityScore", () => {
  it("במרכז — ניקוד מלא", () => {
    expect(proximityScore(0, 3)).toBe(1);
  });

  it("בדיוק על הגבול — 0.8, ולא נפילה לאפס", () => {
    expect(proximityScore(3, 3)).toBeCloseTo(0.8, 9);
  });

  it("מעט מחוץ לרדיוס עדיין מנוקד — זה כל העניין", () => {
    // 50 מטר מחוץ לרדיוס של 3 ק״מ: קונה אמיתי לא היה פוסל
    expect(proximityScore(3.05, 3)).toBeGreaterThan(0.75);
  });

  it("פי שניים מהרדיוס — אפס", () => {
    expect(proximityScore(6, 3)).toBe(0);
    expect(proximityScore(9, 3)).toBe(0);
  });

  it("רציף — אין קפיצה סביב הגבול", () => {
    const before = proximityScore(2.99, 3);
    const at = proximityScore(3, 3);
    const after = proximityScore(3.01, 3);
    expect(before - at).toBeLessThan(0.01);
    expect(at - after).toBeLessThan(0.01);
  });

  it("מונוטוני יורד", () => {
    let previous = 1.1;
    for (let d = 0; d <= 6; d += 0.25) {
      const score = proximityScore(d, 3);
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it("רדיוס פגום אינו מפיל", () => {
    expect(proximityScore(1, 0)).toBe(0);
    expect(proximityScore(1, -5)).toBe(0);
  });
});

describe("bestAreaMatch", () => {
  const areas: SearchArea[] = [
    { lat: TEL_AVIV.lat, lon: TEL_AVIV.lon, radiusKm: 1, label: "ליד העבודה" },
    { lat: HAIFA.lat, lon: HAIFA.lon, radiusKm: 10, label: "ליד ההורים" },
  ];

  it("בוחר את האזור שהנכס מתאים לו", () => {
    const out = bestAreaMatch(RAMAT_GAN, areas)!;
    expect(out.area.label).toBe("ליד העבודה");
  });

  it("הטוב ביותר ולא הקרוב ביותר — רדיוס גדול מנצח קרבה", () => {
    /*
     * נקודה 3 ק״מ מת״א (רדיוס 1 ⇒ מחוץ לטווח החסד, 0) ו-80 ק״מ
     * מחיפה (רדיוס 10 ⇒ גם 0). שתיהן 0, ולכן נבדוק מקרה חד:
     * נקודה בתוך הרדיוס הגדול ומחוץ לקטן.
     */
    const nearHaifa = { lat: 32.75, lon: 34.99 };
    const out = bestAreaMatch(nearHaifa, areas)!;
    expect(out.area.label).toBe("ליד ההורים");
    expect(out.score).toBeGreaterThan(0.7);
  });

  it("רשימה ריקה — null", () => {
    expect(bestAreaMatch(TEL_AVIV, [])).toBeNull();
  });

  it("רחוק מכל האזורים — מוחזר עם ציון אפס ולא null", () => {
    // ההבחנה חשובה: "נמדד ונדחה" אינו "לא נמדד"
    const out = bestAreaMatch({ lat: 29.55, lon: 34.95 }, areas)!;
    expect(out.score).toBe(0);
    expect(out.distanceKm).toBeGreaterThan(100);
  });
});

describe("describeDistance", () => {
  it("מתחת לקילומטר — מטרים", () => {
    expect(describeDistance(0.35)).toBe("350 מ׳");
  });

  it("מעל קילומטר — עשירית ק״מ", () => {
    expect(describeDistance(4.23)).toBe("4.2 ק״מ");
  });
});

describe("searchAreaRejectionReason", () => {
  const ok: SearchArea = { lat: 32.08, lon: 34.78, radiusKm: 3 };

  it("אזור תקין", () => {
    expect(searchAreaRejectionReason(ok)).toBeNull();
  });

  it("רדיוס קטן או גדול מדי", () => {
    expect(searchAreaRejectionReason({ ...ok, radiusKm: 0.05 })).toContain("המזערי");
    expect(searchAreaRejectionReason({ ...ok, radiusKm: 500 })).toContain("המרבי");
  });

  it("קואורדינטה מחוץ לתחום", () => {
    expect(searchAreaRejectionReason({ ...ok, lat: 100 })).toContain("רוחב");
    expect(searchAreaRejectionReason({ ...ok, lon: -300 })).toContain("אורך");
  });

  it("NaN אינו עובר", () => {
    expect(searchAreaRejectionReason({ ...ok, radiusKm: Number.NaN })).not.toBeNull();
  });
});

describe("boundingBox", () => {
  it("כולל את טווח החסד ולא רק את הרדיוס", () => {
    // אחרת נכס בטווח החסד היה נופל בסינון הגס ולא מגיע לניקוד
    const box = boundingBox([{ lat: 32, lon: 34.8, radiusKm: 5 }])!;
    const spanKm = (box.maxLat - box.minLat) * 111;
    expect(spanKm).toBeGreaterThan(19); // 2 × (5 × 2)
  });

  it("מאחד כמה אזורים", () => {
    const box = boundingBox([
      { lat: 32.08, lon: 34.78, radiusKm: 1 },
      { lat: 32.79, lon: 34.99, radiusKm: 1 },
    ])!;
    expect(box.minLat).toBeLessThan(32.08);
    expect(box.maxLat).toBeGreaterThan(32.79);
  });

  it("רשימה ריקה — null", () => {
    expect(boundingBox([])).toBeNull();
  });
});

describe("searchAreaRing — הרדיוס כצורה, לא כמספר", () => {
  const LAT = 32.0853;
  const LON = 34.7818;

  /*
   * ‏זו כל הנקודה: העיגול חייב לייצג את **אותו** מרחק שההתאמה
   * ‏נמדדת בו. טבעת שמצוירת ב-1.2 ק״מ ליד שדה שאומר 1 היא שקר
   * ‏ויזואלי, וגרועה מלא לצייר כלום.
   */
  it("כל נקודה על הטבעת נמצאת בדיוק ברדיוס שהתבקש", () => {
    for (const km of [0.2, 0.9, 5, 50]) {
      for (const [lon, lat] of searchAreaRing(LAT, LON, km)) {
        expect(haversineKm({ lat: LAT, lon: LON }, { lat, lon })).toBeCloseTo(km, 2);
      }
    }
  });

  /* GeoJSON דורש טבעת סגורה — הנקודה האחרונה היא הראשונה. */
  it("הטבעת סגורה, ואורכה הוא הצעדים ועוד אחד", () => {
    const ring = searchAreaRing(LAT, LON, 1, 8);
    expect(ring).toHaveLength(9);
    expect(ring[8]).toEqual(ring[0]);
  });

  /*
   * ‎**מעלת אורך קצרה ממעלת רוחב בקו הרוחב של ישראל.** הזזה
   * ‏ליניארית הייתה מציירת אליפסה מתוחה מזרח-מערב; הפרש המעלות
   * ‏כאן הוא מה שמוכיח שהחישוב כדורי.
   */
  it("הצורה כדורית — פריסת האורך רחבה מפריסת הרוחב", () => {
    const ring = searchAreaRing(LAT, LON, 10, 4);
    const lonSpan = Math.abs(ring[1]![0] - ring[3]![0]);
    const latSpan = Math.abs(ring[0]![1] - ring[2]![1]);
    expect(lonSpan).toBeGreaterThan(latSpan * 1.1);
  });

  /* רדיוס אפס או שלילי אינו מפיל — הוא פשוט נקודה */
  it("רדיוס לא חוקי מצטמצם לנקודה ואינו זורק", () => {
    for (const [lon, lat] of searchAreaRing(LAT, LON, -3, 8)) {
      expect(lat).toBeCloseTo(LAT, 6);
      expect(lon).toBeCloseTo(LON, 6);
    }
  });
});

describe("ברירת המחדל של הרדיוס", () => {
  /* הכרעת בעל המוצר: 900 מטר, לא קילומטר עגול */
  it("900 מטר, ובתוך הטווח המותר", () => {
    expect(DEFAULT_SEARCH_RADIUS_KM).toBe(0.9);
    expect(DEFAULT_SEARCH_RADIUS_KM).toBeGreaterThanOrEqual(MIN_SEARCH_RADIUS_KM);
    expect(DEFAULT_SEARCH_RADIUS_KM).toBeLessThanOrEqual(MAX_SEARCH_RADIUS_KM);
    expect(describeDistance(DEFAULT_SEARCH_RADIUS_KM)).toBe("900 מ׳");
  });
});
