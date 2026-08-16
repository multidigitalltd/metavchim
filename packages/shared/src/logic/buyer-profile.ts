/**
 * שלמות פרופיל החיפוש — **מה עוד לא שאלנו את הלקוח.**
 *
 * כרטיס קונה מלא-למחצה נראה בדיוק כמו כרטיס מלא: שני המסכים מציגים
 * את מה שיש, ואף אחד מהם אינו מציג את מה שחסר. התוצאה היא סוכן
 * שמריץ התאמות על פרופיל שיש בו תקציב ועיר בלבד, מקבל שלושים נכסים,
 * ומסיק שהמנוע לא מדויק.
 *
 * הרשימה כאן היא **מה שמזיז את הניקוד**, ולא כל שדה בסכמה. שדה
 * שחסרונו אינו משנה את התוצאה אינו משימה לסוכן, והצגתו כחוסר היא
 * רעש שמלמד להתעלם מהמונה.
 *
 * ## למה זה מונה ולא אחוז מוכנות
 *
 * לנכס יש "ציון מוכנות" כי שם יש סף אובייקטיבי — נכס בלי מחיר אינו
 * ניתן לשיווק. לקונה אין סף כזה: פרופיל עם ארבעה שדות יכול להיות
 * מדויק לגמרי. לכן זה מונה שמזמין להשלים, ולא ציון שמאשים.
 */

import type { BuyerRequirements } from "../schemas/buyer.js";

/** שדה אחד שאפשר להשלים, עם התווית שהמסך מציג. */
export interface ProfileField {
  key: string;
  label: string;
  filled: boolean;
}

export interface ProfileCompleteness {
  filled: number;
  total: number;
  /** מה שחסר, בסדר שבו כדאי לשאול. */
  missing: ProfileField[];
  fields: ProfileField[];
}

/**
 * הסדר אינו שרירותי: הוא סדר השיחה עם הלקוח. אזור וחדרים הם השאלות
 * שפותחות שיחה, מאפייני חובה הם מה שמסנן בסוף, ומועד הכניסה הוא מה
 * שנשאל כשכבר מדברים על נכס מסוים.
 */
export function buyerProfileCompleteness(req: BuyerRequirements): ProfileCompleteness {
  const fields: ProfileField[] = [
    { key: "cities", label: "אזורים", filled: req.cities.length > 0 || (req.searchAreas ?? []).length > 0 },
    { key: "rooms", label: "חדרים", filled: req.roomsMin !== undefined || req.roomsMax !== undefined },
    { key: "propertyTypes", label: "סוג נכס", filled: req.propertyTypes.length > 0 },
    { key: "budgetMin", label: "תקציב מינימלי", filled: req.budgetMinAgorot !== undefined },
    { key: "areaSqmMin", label: "שטח", filled: req.areaSqmMin !== undefined },
    {
      key: "features",
      label: "מאפיינים",
      /* הרמות הן must/nice בלבד — כל ערך קיים הוא דרישה שהוזנה. */
      filled: Object.values(req.features ?? {}).some((v) => v !== undefined),
    },
    { key: "entryType", label: "מועד כניסה", filled: req.entryType !== undefined },
  ];

  return {
    filled: fields.filter((f) => f.filled).length,
    total: fields.length,
    missing: fields.filter((f) => !f.filled),
    fields,
  };
}
