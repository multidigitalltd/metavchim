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
      // הלשונית מפורשת: בלעדיה ההתראה נחתה על "ביקושים ברשת", וההצעה
      // שההתראה דיברה עליה נראתה כאילו איננה
      return "/collaboration?tab=incoming";
    case "shared_lead":
      return "/collaboration"; // "נקלטה" מוצג בלשונית ההפניות
    /*
     * שיחה נבחרת בתוך הרשימה ואין לה נתיב משלה, ולכן פרמטר ולא
     * קטע נתיב. בלי זה ההתראה על סיום תמלול הייתה נוחתת על רשימת
     * השיחות בלי לבחור את השיחה שהיא מדברת עליה.
     */
    case "call":
      return `/calls?call=${entityId}`;
    default:
      return null;
  }
}
