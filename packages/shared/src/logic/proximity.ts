/**
 * קרבה גיאוגרפית — **מה שהקונה באמת מחפש, במקום שם עיר.**
 *
 * קריטריון המיקום עבד עד כה על השוואת שמות ערים, וזו הפשטה שגויה
 * פעמיים: נכס 300 מטר מעבר לגבול מוניציפלי היה בלתי נראה, וקונה
 * ש"מחפש בבני ברק" בעצם מחפש ליד ההורים שלו ברחוב מסוים.
 *
 * ## למה לא שער קשיח
 *
 * הדרך המקובלת היא רדיוס שחוסם: בפנים או בחוץ. זה מייצר צוק בדיוק
 * במקום שבו הוא הכי מזיק — נכס 50 מטר מחוץ לרדיוס נעלם לגמרי, בעוד
 * שאף קונה אמיתי לא היה פוסל אותו. הניקוד כאן **רציף**:
 *
 * ```
 *  1.0 ┤●───────╮
 *      │         ╰──╮  0.8 בדיוק על הגבול
 *  0.5 ┤            ╰────╮
 *      │                  ╰────╮
 *  0.0 ┤                        ●  פי שניים מהרדיוס
 *      └───────┬────────┬────────┬──
 *              r       1.5r      2r
 * ```
 *
 * בתוך הרדיוס הציון יורד לאט (1.0 → 0.8): הקונה ביקש את האזור הזה,
 * והיכן בדיוק בתוכו משנה מעט. מחוץ לרדיוס הוא יורד מהר עד אפס בפי
 * שניים ממנו — טווח החסד. מעבר לזה ההתאמה נפסלת, כמו עיר שאינה
 * ברשימה.
 *
 * ## רדיוס לכל אזור בנפרד
 *
 * ולא הגדרה אחת למשתמש: קונה יכול לחפש "רק בשכונה הזאת" (600 מטר)
 * **וגם** "או בכל מקום ליד העבודה" (5 ק"מ), ולכל אחד מהם טווח
 * סבירות אחר. אזור הוא נקודה, רדיוס ושם — לא יותר.
 */

import type { LatLon } from "./geo.js";

export interface SearchArea {
  lat: number;
  lon: number;
  radiusKm: number;
  /** מה הקונה קרא לאזור — "ליד ההורים", "רדיוס הליכה מהעבודה". */
  label?: string;
}

/*
 * 900 מטר ולא 3 ק״מ: קונה שמסמן נקודה מתכוון בדרך כלל לשכונה —
 * מרחק הליכה — ורדיוס רחב כברירת מחדל הציף את ההתאמות בנכסים
 * "ליד". מי שבאמת גמיש מרחיב את הרדיוס בשדה שליד המפה.
 *
 * ‎**ולמה 0.9 ולא 1** (הכרעת בעל המוצר): קילומטר עגול נקרא כערך
 * ‏שהמערכת בחרה כי הוא נוח, ו-900 מטר נקרא כמידה. ההבדל בשטח הוא
 * ‏כ-20% פחות שטח — ובשכונה צפופה זה בדיוק ההבדל בין „השכונה” לבין
 * ‏„השכונה ועוד שתיים”.
 */
export const DEFAULT_SEARCH_RADIUS_KM = 0.9;
export const MIN_SEARCH_RADIUS_KM = 0.2;
export const MAX_SEARCH_RADIUS_KM = 50;
/** יותר מזה אינו "כמה אזורים" אלא רשימת משאלות. */
export const MAX_SEARCH_AREAS = 6;

const EARTH_RADIUS_KM = 6371;

/**
 * ‎**הטבעת שמציירת את הרדיוס על המפה — ‏`[lon, lat]`, סגורה.**
 *
 * ## למה זה נחוץ
 *
 * ‏השדה אמר „רדיוס (ק״מ)” ותו לא. מתווך אינו יודע ש-1.5 ק״מ מבני
 * ‏ברק מגיע עד רמת גן, והמספר לבדו אינו אומר **אילו רחובות** ייכנסו
 * ‏להתאמות (דיווח מהשטח). עיגול על המפה אומר את זה בלי לקרוא דבר.
 *
 * ## למה מצולע ולא עיגול של MapLibre
 *
 * ‎`circle-radius` של MapLibre נמדד ב**פיקסלים**, ולכן עיגול כזה
 * ‏אינו משנה את גודלו בזום — כלומר הוא אינו מייצג מרחק קרקעי אלא
 * ‏כתם על המסך. מצולע בקואורדינטות הוא השטח האמיתי, והוא מתכווץ
 * ‏ומתרחב עם המפה כמו שהעין מצפה.
 *
 * ## הנוסחה
 *
 * ‏נקודת יעד על כדור (`destination point`), אותו מודל של `haversine`
 * ‏למטה — ולא הזזה ליניארית בקו רוחב ואורך. בקו הרוחב של ישראל
 * ‏מעלת אורך קצרה ממעלת רוחב בכ-20%, והזזה ליניארית הייתה מציירת
 * ‏אליפסה מתוחה מזרח-מערב: עיגול שמבטיח שטח אחד ומתאים לאחר.
 */
export function searchAreaRing(
  lat: number,
  lon: number,
  radiusKm: number,
  steps = 64,
): [number, number][] {
  const points: [number, number][] = [];
  const angular = Math.max(0, radiusKm) / EARTH_RADIUS_KM;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const sinLat = Math.sin(latRad) * Math.cos(angular);
  const cosLat = Math.cos(latRad) * Math.sin(angular);
  for (let i = 0; i <= steps; i += 1) {
    /* הצעד האחרון חוזר לראשון — טבעת סגורה, כפי ש-GeoJSON דורש. */
    const bearing = (2 * Math.PI * (i % steps)) / steps;
    const pointLat = Math.asin(sinLat + cosLat * Math.cos(bearing));
    const pointLon =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * cosLat,
        Math.cos(angular) - Math.sin(latRad) * Math.sin(pointLat),
      );
    points.push([(pointLon * 180) / Math.PI, (pointLat * 180) / Math.PI]);
  }
  return points;
}

/** מעבר לכפולה הזו של הרדיוס ההתאמה נפסלת. */
const GRACE_FACTOR = 2;
/** הציון בדיוק על הגבול — ראו התרשים למעלה. */
const EDGE_SCORE = 0.8;


/**
 * מרחק בקו אווירי בין שתי נקודות, בקילומטרים.
 *
 * Haversine ולא Vincenty: בטווחים של עשרות קילומטרים ההפרש בין
 * כדור לאליפסואיד הוא מטרים בודדים, ואילו הקלט עצמו — סיכה שאדם
 * גרר על מפה — מדויק פחות מכך בסדר גודל.
 */
export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * ניקוד הקרבה לאזור בודד: 1 במרכז, 0.8 על הגבול, 0 בפי שניים ממנו.
 *
 * רדיוס אפס או שלילי מוחזר כ-0 ולא מפיל — אזור פגום אינו אמור
 * להוציא את כל ההתאמה מכלל פעולה.
 */
export function proximityScore(distanceKm: number, radiusKm: number): number {
  if (radiusKm <= 0 || distanceKm < 0) return 0;
  if (distanceKm <= radiusKm) {
    return 1 - (1 - EDGE_SCORE) * (distanceKm / radiusKm);
  }
  const grace = radiusKm * (GRACE_FACTOR - 1);
  const beyond = distanceKm - radiusKm;
  if (beyond >= grace) return 0;
  return EDGE_SCORE * (1 - beyond / grace);
}

export interface AreaMatch {
  /** המרחק לאזור הטוב ביותר, בקילומטרים. */
  distanceKm: number;
  score: number;
  area: SearchArea;
}

/**
 * האזור שהנכס מתאים לו הכי טוב.
 *
 * **הטוב ביותר ולא הקרוב ביותר**: אזור רחוק יותר עם רדיוס גדול יכול
 * לתת ציון גבוה מאזור קרוב עם רדיוס זעיר, וזה נכון — הקונה הוא זה
 * שהגדיר כמה כל אזור סובלני.
 */
export function bestAreaMatch(
  point: LatLon,
  areas: readonly SearchArea[],
): AreaMatch | null {
  let best: AreaMatch | null = null;
  for (const area of areas) {
    const distanceKm = haversineKm(point, { lat: area.lat, lon: area.lon });
    const score = proximityScore(distanceKm, area.radiusKm);
    if (best === null || score > best.score) best = { distanceKm, score, area };
  }
  return best;
}

/** תיאור המרחק בעברית — מטרים מתחת לקילומטר, כי "0.3 ק״מ" לא נקרא. */
export function describeDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} מ׳`;
  return `${km.toFixed(1)} ק״מ`;
}

/** למה האזור נדחה, או `null` כשהוא תקין. */
export function searchAreaRejectionReason(area: SearchArea): string | null {
  if (!Number.isFinite(area.lat) || area.lat < -90 || area.lat > 90) return "קו הרוחב אינו תקין";
  if (!Number.isFinite(area.lon) || area.lon < -180 || area.lon > 180) {
    return "קו האורך אינו תקין";
  }
  if (!Number.isFinite(area.radiusKm)) return "הרדיוס אינו תקין";
  if (area.radiusKm < MIN_SEARCH_RADIUS_KM) {
    return `הרדיוס המזערי הוא ${MIN_SEARCH_RADIUS_KM} ק״מ`;
  }
  if (area.radiusKm > MAX_SEARCH_RADIUS_KM) {
    return `הרדיוס המרבי הוא ${MAX_SEARCH_RADIUS_KM} ק״מ`;
  }
  if (area.label !== undefined && area.label.length > 60) return "שם האזור ארוך מדי";
  return null;
}

/**
 * תיבה תוחמת סביב כל האזורים — לסינון גס ב-SQL לפני החישוב המדויק.
 *
 * המרה גסה בכוונה: מעלת רוחב היא ~111 ק״מ בכל מקום, ומעלת אורך
 * מתכווצת עם קו הרוחב. בישראל (~31–33°) ההפרש קטן, והתיבה ממילא
 * **רחבה מדי ולא צרה מדי** — היא מסננת מועמדים רחוקים, ומי שנשאר
 * נמדד בהוורסין. תיבה שתחטא בצד הצר הייתה מפילה התאמות אמיתיות.
 */
export function boundingBox(
  areas: readonly SearchArea[],
): { minLat: number; maxLat: number; minLon: number; maxLon: number } | null {
  if (areas.length === 0) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const area of areas) {
    // טווח החסד נכלל: נכס בתוכו עדיין מנוקד, ולכן חייב לעבור את הסינון
    const reach = area.radiusKm * GRACE_FACTOR;
    const dLat = reach / 111;
    const cosLat = Math.max(0.1, Math.cos((area.lat * Math.PI) / 180));
    const dLon = reach / (111 * cosLat);
    minLat = Math.min(minLat, area.lat - dLat);
    maxLat = Math.max(maxLat, area.lat + dLat);
    minLon = Math.min(minLon, area.lon - dLon);
    maxLon = Math.max(maxLon, area.lon + dLon);
  }
  return { minLat, maxLat, minLon, maxLon };
}
