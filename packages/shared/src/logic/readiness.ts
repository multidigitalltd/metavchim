import {
  PROPERTY_REQUIRED_FOR_MARKETING,
  type PropertyFields,
} from "../schemas/property.js";

export interface ReadinessResult {
  /** 0–100 — "נכס מוכן לשיווק — 92%" */
  score: number;
  /** השדות החסרים, לסימון למתווך ("חסרים 4 פרטים להשלמה") */
  missingFields: (keyof PropertyFields)[];
}

/**
 * ציון מוכנות נכס (docs/01 §3, אפיון §7): שדות החובה לשיווק שווים 80%
 * מהציון; תיאור שיווקי וכותרת משלימים את היתר. undefined = חסר;
 * false הוא ערך לגיטימי ("אין מעלית") ולא נחשב חוסר.
 */
export function computeReadiness(
  fields: PropertyFields,
  marketing: { hasTitle: boolean; hasDescription: boolean },
): ReadinessResult {
  const missingFields = PROPERTY_REQUIRED_FOR_MARKETING.filter(
    (key) => fields[key] === undefined || fields[key] === null,
  );
  const filled = PROPERTY_REQUIRED_FOR_MARKETING.length - missingFields.length;
  const requiredPortion = (filled / PROPERTY_REQUIRED_FOR_MARKETING.length) * 80;
  const marketingPortion = (marketing.hasTitle ? 10 : 0) + (marketing.hasDescription ? 10 : 0);
  return {
    score: Math.round(requiredPortion + marketingPortion),
    missingFields,
  };
}
