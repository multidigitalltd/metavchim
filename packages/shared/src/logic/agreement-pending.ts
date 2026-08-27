/**
 * ‎**„מי לא חתם” — ארבעה מצבים, ולא רשימה אחת.**
 *
 * ## מה זה פותר
 *
 * ‎`hasSigned` חוסמת שליחת הצעה ללקוח בלי הזמנה בכתב חתומה, כנדרש
 * בחוק המתווכים §9. החסימה נכונה, והיא גם **בלתי נראית**: המתווך
 * אינו מקבל שגיאה, ההצעות פשוט אינן יוצאות. עד כה אפשר היה לשאול
 * על **לקוח אחד** בכל פעם, כלומר רק אם כבר ידעת את מי לבדוק.
 *
 * ## ולמה ארבעה ולא שניים
 *
 * „חתם / לא חתם” נשמע בינארי, והתשובה הבינארית מטעה: לכל אחד
 * מהארבעה יש **פעולה אחרת**, ורשימה שמערבבת אותם שולחת את המתווך
 * לשלוח קישור חדש למי שכבר אמר „לא”.
 *
 * ‎**`opened`** — נפתח ולא נחתם. האות היקר ברשימה: מי שפתח מתעניין
 * ומתלבט, בדיוק כמו „קונה פתח את ההצעה ארבע פעמים”. שיחה, לא תזכורת.
 *
 * ‎**`expired`** — הקישור פג. זה הכשל השקט: הלקוח נשאר חסום להצעות,
 * והסיבה היא טוקן שפג לפני חודש. כאן שולחים שוב.
 *
 * ‎**`sent`** — נשלח וממתין. תזכורת.
 *
 * ‎**`declined`** — סירב. **נשאר ברשימה בכוונה:** הוא באמת „לא חתם”,
 * והשמטתו הייתה מסתירה את התשובה היחידה שיש לה משמעות סופית.
 */

export const PENDING_AGREEMENT_STATES = ["opened", "expired", "sent", "declined"] as const;

export type PendingAgreementState = (typeof PENDING_AGREEMENT_STATES)[number];

export const PENDING_AGREEMENT_LABEL: Record<PendingAgreementState, string> = {
  opened: "נפתח ולא נחתם",
  expired: "הקישור פג",
  sent: "ממתין לחתימה",
  declined: "סירב לחתום",
};

/** מה עושים עם זה — ולא רק מה זה. */
export const PENDING_AGREEMENT_MEANING: Record<PendingAgreementState, string> = {
  opened: "התלבטות — שיחה עדיפה על תזכורת",
  expired: "יש לשלוח קישור חדש; עד אז ההצעות חסומות",
  sent: "אפשר להזכיר",
  declined: "לא ממתין — דורש החלטה מחודשת מול הלקוח",
};

/**
 * ‎**סדר הקדימה הוא כל הפונקציה.**
 *
 * ‎**סירוב גובר על הכול** — הוא הכרעה של הלקוח ולא שלב בתהליך, וטוקן
 * שפג אחריו אינו הופך אותו ל„צריך לשלוח שוב”.
 *
 * ‎**ופקיעה גוברת על „נפתח”** — הסכם שנפתח ואז פג הוא הסכם שאי אפשר
 * לחתום עליו יותר. סימונו כ„נפתח ולא נחתם” היה שולח את המתווך
 * להתקשר ולבקש לחתום על קישור מת, כלומר לשיחה שנגמרת ב„הקישור לא
 * עובד”.
 *
 * ‎`status` מגיע מהמסד כמחרוזת (`pending | viewed | signed | declined |
 * expired`). `signed` אינו מגיע לכאן — הוא אינו ממתין — ומחרוזת שאינה
 * מוכרת נופלת ל-`sent`, שהוא המצב הפחות טוען מבין הארבעה.
 */
export function pendingAgreementState(
  status: string,
  tokenExpires: Date,
  now: Date,
): PendingAgreementState {
  if (status === "declined") return "declined";
  if (tokenExpires.getTime() <= now.getTime()) return "expired";
  return status === "viewed" ? "opened" : "sent";
}

/**
 * דירוג לפי מה שדורש פעולה, ולא לפי תאריך.
 *
 * ‎„נפתח ולא נחתם” ראשון כי הוא הלקוח החם ביותר ברשימה; „פג” אחריו
 * כי הוא הכשל השקט; „סירב” אחרון כי אינו ממתין לדבר.
 */
export function pendingAgreementRank(state: PendingAgreementState): number {
  return PENDING_AGREEMENT_STATES.indexOf(state);
}
