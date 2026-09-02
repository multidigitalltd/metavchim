import { PropertyTypeSchema, type PropertyType } from "../schemas/property.js";

/**
 * ‎**משפחת הנכסים המסחריים — ולמה היא צריכה כלל התאמה משלה.**
 *
 * ## מה היה
 *
 * ‎`commercial` היה ערך יחיד. מתווך שיש לו חנות, משרד ומחסן רשם את
 * שלושתם „מסחרי”, ולקונה שמחפש משרד הוצגו גם החנות וגם המחסן.
 *
 * ## והמלכודת שנפתחת ברגע שמפצלים
 *
 * מנוע ההתאמות בודק `buyer.propertyTypes.includes(property.propertyType)`,
 * ‎**וסוג שאינו ברשימה פוסל את ההתאמה לגמרי** — לא גורע ניקוד.
 * כלומר ברגע שנוסף „חנות”, קונה קיים שסימן „מסחרי” היה מפסיק לראות
 * כל נכס מסחרי חדש במערכת. לא בגלל שינוי בדרישות שלו, אלא בגלל
 * שהמתווך נעשה מדויק יותר.
 *
 * זו הסיבה שהפיצול הזה אינו „עוד ערכים לרשימה”: בלי הכלל כאן הוא
 * שובר בשקט כל כרטיס קונה שכבר קיים.
 *
 * ## הכלל
 *
 * ‎`commercial` הוא **„מסחרי שלא נאמר איזה”**, ולכן הוא מתאים לכל
 * ענף — **בשני הכיוונים**:
 *
 * - קונה שביקש „מסחרי” מתאים לחנות, למשרד ולמחסן.
 * - נכס שנרשם „מסחרי” בלבד מתאים לקונה שמחפש חנות: המתווך פשוט
 *   טרם דייק, והסתרת הנכס מהקונה גרועה מהצגתו.
 *
 * שני ענפים **שונים** אינם מתאימים זה לזה: חנות אינה תחנת דלק.
 */

export const COMMERCIAL_PROPERTY_TYPES = [
  "commercial_shop",
  "commercial_office",
  "commercial_warehouse",
  "commercial_industrial",
  "commercial_basement",
  "commercial_building",
  "commercial_logistics",
  "commercial_parking",
  "commercial_gas_station",
] as const satisfies readonly PropertyType[];

export type CommercialPropertyType = (typeof COMMERCIAL_PROPERTY_TYPES)[number];

/** הענף עצמו, או „מסחרי” הכללי. */
export function isCommercialType(type: string): boolean {
  return type === "commercial" || (COMMERCIAL_PROPERTY_TYPES as readonly string[]).includes(type);
}

/**
 * האם סוג הנכס עונה על אחד הסוגים שהקונה ביקש.
 *
 * ‎**רשימה ריקה = לא ביקש**, וזה אינו „לא מתאים”: הקריטריון פשוט
 * אינו נבחן, בדיוק כמו בשאר השדות. הקורא הוא זה שמחליט אם לבחון —
 * הפונקציה מניחה שכבר הוחלט.
 */
export function propertyTypeMatches(
  wanted: readonly string[],
  actual: string,
): boolean {
  if (wanted.includes(actual)) return true;
  /*
   * ‎**„מסחרי” משני הצדדים.** הקונה ביקש „מסחרי” והנכס הוא חנות,
   * או שהקונה ביקש חנות והנכס נרשם „מסחרי” בלי דיוק — שניהם
   * התאמה. ראו ההסבר בראש הקובץ.
   */
  if (actual === "commercial") return wanted.some(isCommercialType);
  if (!isCommercialType(actual)) return false;
  return wanted.includes("commercial");
}

/**
 * ‎**שער על הרשימה עצמה.** ענף שיתווסף לסכימה ולא יופיע כאן ייראה
 * כמו סוג עצמאי: קונה שביקש „מסחרי” לא היה מקבל אותו, וההשמטה
 * הייתה שקטה. הבדיקה נגזרת מהסכימה ולא מרשימה מקבילה.
 */
export const COMMERCIAL_TYPES_FROM_SCHEMA: readonly string[] =
  PropertyTypeSchema.options.filter((value) => value.startsWith("commercial_"));
