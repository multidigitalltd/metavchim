/**
 * ‎**אוצר המונחים — תוויות הערכים, פעם אחת לכל המערכת.**
 *
 * ‏ישב בתוך קטלוג הפעולות, וזה היה נכון כל עוד הקטלוג היה הקורא
 * ‏היחיד. עכשיו יש שני קוראים: הקטלוג, וחילוץ הפרטים ממודעה
 * ‏מצולמת (`logic/recruitment-ad.ts`) — שנותן למודל את אותה
 * ‏רשימת ערכים בדיוק ומאמת מולה את מה שחזר.
 *
 * ‏שתי רשימות היו מסכימות רק ביום שנכתבו: סוג נכס שנוסף בקטלוג
 * ‏ולא ברשימה של החילוץ פשוט לא ייבחר לעולם מתמונה, בלי שאיש
 * ‏ישים לב.
 */

import type { PropertyType } from "../schemas/property.js";

export const DEAL_TYPE_LABELS = { sale: "מכירה", rent: "השכרה" } as const;

export const PROPERTY_TYPE_LABELS = {
  apartment: "דירה",
  garden_apartment: "דירת גן",
  penthouse: "פנטהאוז",
  duplex: "דופלקס",
  private_house: "בית פרטי",
  two_family: "דו משפחתי",
  studio: "סטודיו",
  unit: "יחידת דיור",
  shared_tabu: "טאבו משותף",
  divisible_apartment: "דירה מתאימה לחלוקה",
  accessible_apartment: "דירת נכה",
  plot: "מגרש",
  commercial: "מסחרי (לא צוין)",
  commercial_shop: "חנות",
  commercial_office: "משרד",
  commercial_warehouse: "מחסן",
  commercial_industrial: "תעשייה",
  commercial_basement: "מרתף",
  commercial_building: "בניין",
  commercial_logistics: 'מרלו"ג',
  commercial_parking: "חניה",
  commercial_gas_station: "תחנת דלק",
  other: "אחר",
  /*
   * ‎`satisfies` ולא רק `as const`: הקטלוג הזה הוא מה שהסוכן הקולי
   * מקבל כרשימת הערכים החוקיים, וסוג שחסר בו פשוט אינו קיים בשבילו
   * — המתווך אומר „דירת נכה” והסוכן עונה שאינו מכיר סוג כזה. השגיאה
   * הזו שייכת להידור ולא לשיחה עם לקוח.
   */
} as const satisfies Record<PropertyType, string>;
