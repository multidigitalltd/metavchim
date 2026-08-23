/**
 * לאן מובילה התראה — מקור אמת אחד לפעמון ולמסך ההתראות.
 *
 * שתי רשימות נפרדות היו מתפצלות ביום שמתווסף סוג ישות: ההתראה
 * הייתה לחיצה במסך אחד ומתה בשני.
 */
export function notificationHref(entityType?: string, entityId?: string): string | null {
  /*
   * `null` = „אין יעד ספציפי”, וזו תשובה אמיתית ולא חוסר.
   *
   * הפעמון הופך אותה למסך ההתראות המלא, כדי שכל שורה בו תהיה
   * לחיצה (בקשת המשתמש); מסך ההתראות עצמו מסתיר את הקישור, כי
   * הפניה מהמסך אל עצמו אינה עוזרת לאיש. ההחלטה הזו שייכת לכל
   * מסך בנפרד, ולכן היא אינה נאפית לתוך המפה.
   */
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
    /*
     * להצעה אין מסך משלה — היא נצפית דרך כרטיס הנכס — אבל מזהה
     * ההצעה אינו מזהה הנכס, ולכן אי אפשר לקפוץ ישירות. רשימת
     * ההצעות היא הקרובה ביותר: ההצעה שההתראה מדברת עליה נמצאת בה.
     */
    case "offer":
      return "/offers";
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
