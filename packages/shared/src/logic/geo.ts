/**
 * המרות בין רשת ישראל (ITM) לקו רוחב/אורך (WGS84).
 *
 * **למה זה כאן ולא בספרייה:** המערכת שומרת קואורדינטות בפורמט אחד
 * בלבד — WGS84 — וממירה בקצה. מקורות ישראליים (מפ"י/GovMap) מדברים
 * ITM, ספקים בינלאומיים מדברים WGS84, והחלטה לשמור "מה שהספק
 * החזיר" הייתה מחייבת המרת מסד שלם ביום שמחליפים ספק.
 *
 * ITM = EPSG:2039, טרנסברס מרקטור על אליפסואיד GRS80:
 *   ראשית 31°44′03.817″N, 35°12′16.261″E · קנה מידה 1.0000067
 *   היסט מזרחה 219,529.584 · היסט צפונה 626,907.390
 *
 * הנוסחאות הן ההיפוך הסטנדרטי של טרנסברס מרקטור. בדיקת השפיות
 * החזקה ביותר עליהן: נקודת ההיסט חייבת לחזור בדיוק לראשית הרשת,
 * והלוך-חזור חייב לשחזר את המוצא — שתיהן בבדיקות.
 */

const A = 6378137.0; // חצי הציר הראשי, GRS80
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const LAT0 = ((31 + 44 / 60 + 3.817 / 3600) * Math.PI) / 180;
const LON0 = ((35 + 12 / 60 + 16.261 / 3600) * Math.PI) / 180;
const K0 = 1.0000067;
const FALSE_EASTING = 219529.584;
const FALSE_NORTHING = 626907.39;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface ItmPoint {
  /** מזרחה — הערך הקטן מהשניים בישראל (כ-120–280 אלף). */
  x: number;
  /** צפונה. */
  y: number;
}

/** אורך הקשת המרידיונלית עד קו הרוחב הנתון. */
function meridionalArc(lat: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * lat -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * lat) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * lat) -
      ((35 * e6) / 3072) * Math.sin(6 * lat))
  );
}

/** רשת ישראל → קו רוחב/אורך. */
export function itmToWgs84({ x, y }: ItmPoint): LatLon {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const m = (y - FALSE_NORTHING) / K0 + meridionalArc(LAT0);
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const lat1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const ep2 = E2 / (1 - E2);
  const c1 = ep2 * Math.cos(lat1) ** 2;
  const t1 = Math.tan(lat1) ** 2;
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(lat1) ** 2);
  const r1 = (A * (1 - E2)) / (1 - E2 * Math.sin(lat1) ** 2) ** 1.5;
  const d = (x - FALSE_EASTING) / (n1 * K0);

  const lat =
    lat1 -
    ((n1 * Math.tan(lat1)) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon =
    LON0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) /
      Math.cos(lat1);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** קו רוחב/אורך → רשת ישראל. */
export function wgs84ToItm({ lat, lon }: LatLon): ItmPoint {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const ep2 = E2 / (1 - E2);
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = ep2 * Math.cos(phi) ** 2;
  const aa = Math.cos(phi) * (lambda - LON0);
  const m = meridionalArc(phi);

  const x =
    FALSE_EASTING +
    K0 *
      n *
      (aa +
        ((1 - t + c) * aa ** 3) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * aa ** 5) / 120);
  const y =
    FALSE_NORTHING +
    K0 *
      (m -
        meridionalArc(LAT0) +
        n *
          Math.tan(phi) *
          ((aa * aa) / 2 +
            ((5 - t + 9 * c + 4 * c * c) * aa ** 4) / 24 +
            ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * aa ** 6) / 720));
  return { x, y };
}

/**
 * האם הנקודה בתחום ישראל, בגבולות רחבים.
 *
 * לא בדיקת גבולות מדינית אלא רשת ביטחון מפני בלבול בין קו רוחב לאורך
 * — טעות שנראית תמימה ומציבה נכס בבני ברק אי־שם בים. הגבולות רחבים
 * בכוונה: עדיף לקבל נקודה בשולי הטווח מאשר לדחות נכס אמיתי.
 */
export function isWithinIsrael({ lat, lon }: LatLon): boolean {
  return lat >= 29.0 && lat <= 33.6 && lon >= 33.9 && lon <= 35.95;
}

/**
 * האם הנקודה בתוך מצולע — אלגוריתם ray casting.
 *
 * זה הלב של "אזור שהמתווך סימן": במקום להשוות שמות שכונה, בודקים
 * אם הנכס בתוך הצורה. שמות משתנים בכתיב ובפי אנשים; גיאומטריה לא.
 *
 * המצולע הוא רשימת נקודות; הראשונה והאחרונה אינן חייבות להיסגר.
 */
export function isPointInPolygon(point: LatLon, polygon: readonly LatLon[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;
    const crossLon = ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (point.lon < crossLon) inside = !inside;
  }
  return inside;
}
