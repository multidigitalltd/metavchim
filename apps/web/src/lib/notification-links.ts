/**
 * לאן מובילה התראה — מקור אמת אחד לפעמון ולמסך ההתראות.
 *
 * שתי רשימות נפרדות היו מתפצלות ביום שמתווסף סוג ישות: ההתראה
 * הייתה לחיצה במסך אחד ומתה בשני.
 */
export function notificationHref(entityType?: string, entityId?: string): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "property":
      return `/properties/${entityId}`;
    case "lead":
      return `/leads/${entityId}`;
    case "appointment":
      return "/calendar";
    case "task":
      return "/calendar";
    case "buyer":
      return `/buyers/${entityId}`;
    case "offer":
      return null; // הצעה נצפית דרך כרטיס הנכס
    case "coop_offer":
      return "/collaboration";
    case "shared_lead":
      return "/collaboration"; // "נקלטה" מוצג בלשונית ההפניות
    default:
      return null;
  }
}
