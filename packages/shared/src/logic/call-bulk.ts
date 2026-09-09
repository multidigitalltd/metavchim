/**
 * ‎**פעולות מרוכזות ברשימת השיחות.**
 *
 * ## ‏למה זה כלל משותף ולא טקסט במסך
 *
 * ‏שלוש הפעולות נראות דומות ואינן דומות: אחת **מוחקת לצמיתות**,
 * ‏אחת **מעבירה לקוח בין סוכנים**, ואחת רק פותחת ליד. האישור שלפני
 * ‏כל אחת, התקרה שמעליה אי אפשר, וניסוח התוצאה — כולם חיים כאן,
 * ‏כדי שהמסך והשרת יסכימו על אותו מספר ועל אותה משמעות.
 *
 * ‏זה גם מה שמונע את התקלה שכבר קרתה ברשימות אחרות: „נכשל” שנאמר
 * ‏על פעולה שהצליחה חלקית, ומזמין לחיצה שנייה.
 */

export const CALL_BULK_ACTIONS = ["delete", "assign", "open_lead"] as const;
export type CallBulkAction = (typeof CALL_BULK_ACTIONS)[number];

/**
 * ‎**התקרה היא מה שהמסך יכול להציג, ולא מספר עגול.**
 *
 * ‎`GET /calls` מוגבל ל-200 שורות, ולכן אי אפשר לסמן יותר מזה
 * ‏מלכתחילה. תקרה גבוהה יותר הייתה מבטיחה מה שאין דרך לבקש;
 * ‏נמוכה יותר הייתה דוחה בחירה חוקית של „הכול”.
 */
export const CALL_BULK_LIMIT = 200;

/**
 * ‏מה שמונע שליחה — או `null` כשאפשר.
 *
 * ‏מוחזר משפט ולא בוליאני: המסך אומר **למה**, ולא רק מסרב.
 */
export function callBulkRejectionReason(count: number): string | null {
  if (count <= 0) return "לא נבחרו שיחות.";
  if (count > CALL_BULK_LIMIT) {
    return `אפשר לטפל ב-${CALL_BULK_LIMIT} שיחות בבת אחת לכל היותר. צמצמו את הבחירה.`;
  }
  return null;
}

/**
 * ‎**מה שהאישור אומר לפני שהפעולה קורית.**
 *
 * ‏מחיקת שיחה כאן היא **קשה** — לא ארכיון כמו בנכסים — ולכן המשפט
 * ‏אומר „לצמיתות” במפורש. „סימון לא רלוונטי” הוא השם שהמתווך בחר
 * ‏לפעולה, והוא נשמע הפיך; האישור הוא המקום היחיד שבו אפשר לתקן
 * ‏את הרושם הזה לפני שהוא עולה בנתונים.
 *
 * ‎`null` = אין מה לאשר. פתיחת ליד אינה הרסנית ואינה מוציאה דבר
 * ‏מידיו של איש — אישור עליה הוא רק לחיצה נוספת.
 */
export function callBulkConfirm(
  action: CallBulkAction,
  count: number,
  agentName?: string,
): string | null {
  switch (action) {
    case "delete":
      return `למחוק ${count} שיחות? הן יימחקו לצמיתות, ואי אפשר לשחזר אותן.`;
    /*
     * ‎**האישור אומר מי מפסיד את הכרטיס, ולא רק מי מקבל אותו.**
     *
     * ‏העברה כאן אינה תווית: היא מזיזה את הליד, ומי שהיה עליו עד
     * ‏עכשיו מפסיק לראות אותו. מנהל שמעביר עשרים שיחות בלחיצה
     * ‏צריך לדעת את זה לפני הלחיצה ולא אחריה.
     */
    case "assign":
      return `להעביר ${count} שיחות${agentName === undefined ? "" : ` ל${agentName}`}? הלקוח שמאחורי כל שיחה יעבור אליו, ומי שמטפל בו היום יפסיק לראות אותו.`;
    case "open_lead":
      return null;
  }
}

/**
 * ‏תוצאת פעולה מרוכזת — **שלושה מספרים, ולא „הצליח/נכשל”.**
 *
 * ‏„כבר היה כך” אינו כישלון ואינו שינוי, ובלי המספר הזה הוא נספר
 * ‏באחד מהם ומשקר: „0 נפתחו” על עשרים שיחות שכולן כבר נשאו ליד
 * ‏נקרא ככישלון מלא.
 */
export interface CallBulkResult {
  /** ‏מה שהפעולה באמת שינתה. */
  done: number;
  /** ‏מה שכבר היה במצב המבוקש. */
  already?: number;
  /** ‏מה שלא נגענו בו — נעלם, אין הרשאה, או נכשל. */
  skipped?: number;
}

const DONE_WORD: Record<CallBulkAction, string> = {
  delete: "נמחקו",
  assign: "הועברו",
  open_lead: "לידים נפתחו",
};

/*
 * ‎**„כבר היה כך” נשמע אחרת בכל פעולה.** ניסוח אחד לשלושתן היה
 * ‏אומר „כבר” על מחיקה — מצב שאין לו משמעות כאן, כי שיחה שנמחקה
 * ‏אינה ברשימה מלכתחילה.
 */
const ALREADY_WORD: Record<CallBulkAction, string> = {
  delete: "כבר לא היו שם",
  assign: "כבר היו אצלו",
  open_lead: "כבר היה להן ליד",
};

/** ‏משפט התוצאה — אותו ניסוח בכל שלוש הפעולות. */
export function callBulkOutcome(action: CallBulkAction, result: CallBulkResult): string {
  const parts = [`${result.done} ${DONE_WORD[action]}`];
  if (result.already !== undefined && result.already > 0) {
    parts.push(`${result.already} ${ALREADY_WORD[action]}`);
  }
  if (result.skipped !== undefined && result.skipped > 0) {
    parts.push(`${result.skipped} דולגו`);
  }
  return parts.join(", ");
}
