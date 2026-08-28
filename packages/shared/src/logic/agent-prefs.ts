/**
 * העדפות הסוכן — **מה שנאמר פעם אחת עם „תמיד” ונזכר לתמיד.**
 *
 * „תמיד תציג נכסים מהזול ליקר” הוא לא בקשה לתשובה אחת — זו הוראת
 * קבע. ההעדפה נשמרת תחת `preferences.agent` בפרופיל המשתמש (אותו
 * שדה JSON של שאר העדפות המשתמש), ונקראת בכל ביצוע רלוונטי — בשני
 * הערוצים, כי הביצוע אחד.
 *
 * הפירוק כאן ולא אצל הקוראים: העמודה היא JSON חופשי שגם מסכים
 * אחרים כותבים אליו, וערך לא מוכר חייב ליפול לברירת המחדל — לא
 * להפיל את התשובה.
 */

export const PROPERTY_ORDER_VALUES = ["newest", "price_asc", "price_desc"] as const;
export type PropertyOrder = (typeof PROPERTY_ORDER_VALUES)[number];

export const PROPERTY_ORDER_LABELS: Record<PropertyOrder, string> = {
  newest: "החדשים קודם",
  price_asc: "מהזול ליקר",
  price_desc: "מהיקר לזול",
};

export interface AgentPrefs {
  /** סדר תוצאות הנכסים — undefined = ברירת המחדל (חדשים קודם) */
  propertiesOrder?: PropertyOrder;
}

/** ‎`preferences.agent` ⟵ העדפות. צורה לא מוכרת = ברירות מחדל. */
export function parseAgentPrefs(preferences: unknown): AgentPrefs {
  if (typeof preferences !== "object" || preferences === null) return {};
  const agent = (preferences as Record<string, unknown>)["agent"];
  if (typeof agent !== "object" || agent === null) return {};
  const order = (agent as Record<string, unknown>)["propertiesOrder"];
  return (PROPERTY_ORDER_VALUES as readonly unknown[]).includes(order)
    ? { propertiesOrder: order as PropertyOrder }
    : {};
}
