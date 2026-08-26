import {
  PROPERTY_READINESS_FIELDS,
  type PropertyFields,
  type PropertyReadinessField,
} from "../schemas/property.js";

export interface ReadinessResult {
  /** 0–100 — „מוכנות הנכס 67%” */
  score: number;
  /** השדות החסרים, לרשת שבכרטיס ולספירה („חסרים 3 שדות”) */
  missingFields: PropertyReadinessField[];
}

/**
 * מה שאינו שדה תוכן — מדיה, טקסט שיווקי ואיש הקשר המקושר.
 *
 * שלושתם נספרים במוכנות (SPEC-3b §4) ואינם ב-`PropertyFields`, ולכן
 * הם נמסרים במפורש. `boolean` ולא הערך עצמו: לחישוב חשוב רק אם יש
 * או אין, והעברת הרשומות עצמן הייתה מכניסה לכאן תלות במודל הנתונים.
 */
export interface ReadinessExtras {
  hasImages: boolean;
  hasDescription: boolean;
  hasOwner: boolean;
}

/**
 * ציון מוכנות נכס — **שבר פשוט של תשעה שדות.**
 *
 * ## למה לא משוקלל
 *
 * הציון היה 80% לשדות החובה ועוד 10% לכותרת ו-10% לתיאור, ולכן
 * „10 מתוך 10 שדות מלאים” הופיע לצד „90%”. שתי שורות שסותרות זו את
 * זו על אותו כרטיס מזמינות את השאלה „אז מה חסר?”, וחבילת העיצוב
 * אוסרת זאת במפורש: „Never three numbers for one listing”
 * (SPEC-3b §4). עכשיו האחוז, השורה „N מתוך 9” והגלולות „חסר” הם
 * אותה ספירה בשלוש צורות.
 *
 * ## `false` הוא תשובה, לא חוסר
 *
 * „אין מעלית” הוא מידע מלא על הנכס בדיוק כמו „יש מעלית”, ולכן רק
 * ‎`undefined`/`null`‎ נחשבים חסרים. ספירת `false` כחוסר הייתה מורידה
 * ציון לנכס שהמתווך מילא במלואו, ומזמינה אותו „לתקן” שדה שאין בו
 * מה לתקן.
 */
export function computeReadiness(
  fields: PropertyFields,
  extras: ReadinessExtras,
): ReadinessResult {
  const present: Record<PropertyReadinessField, boolean> = {
    priceAgorot: fields.priceAgorot !== undefined && fields.priceAgorot !== null,
    areaSqm: fields.areaSqm !== undefined && fields.areaSqm !== null,
    rooms: fields.rooms !== undefined && fields.rooms !== null,
    floor: fields.floor !== undefined && fields.floor !== null,
    hasElevator: fields.hasElevator !== undefined && fields.hasElevator !== null,
    hasParking: fields.hasParking !== undefined && fields.hasParking !== null,
    images: extras.hasImages,
    marketingDescription: extras.hasDescription,
    owner: extras.hasOwner,
  };

  const missingFields = PROPERTY_READINESS_FIELDS.filter((key) => !present[key]);
  const filled = PROPERTY_READINESS_FIELDS.length - missingFields.length;
  return {
    score: Math.round((filled / PROPERTY_READINESS_FIELDS.length) * 100),
    missingFields,
  };
}
