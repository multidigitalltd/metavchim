import { BOARD_METRIC_LABELS } from "./office-board.js";

/**
 * ‎**שת״פ בתוך המשרד — קרדיט על עסקה, ולא עוד רשימה.**
 *
 * ## ‏למה זה לא „שיתוף” במובן הרגיל
 *
 * ‏בתוך משרד כל הסוכנים כבר רואים את כל הנכסים; אין מה „לשתף”.
 * ‏מה שכן קורה בפועל הוא ששני סוכנים עובדים על אותה עסקה — אחד
 * ‏הביא את הנכס, השני הביא את הקונה — וזה לא נרשם בשום מקום.
 * ‏המנהל שואל „מי סגר את זה?” ומקבל שם אחד (בקשת בעל המוצר).
 *
 * ## ‎**והניקוד אינו נוגע בזה. בכוונה.**
 *
 * ‏זו ההכרעה המרכזית, והיא של בעל המוצר: הצ׳יפ מתעד ואינו מחשב.
 * ‏הניקוד בטבלה נשאר על `agentUserId` בדיוק כפי שהיה — לא נגרע
 * ‏מאיש ולא נכפל לאיש.
 *
 * ‏חשוב להבין מה זה קונה: **אין מה לריב עליו.** ברגע שהסימון משנה
 * ‏את הדירוג, כל סימון הוא ויכוח, וסוכן שיודע שהוא מפסיד נקודות
 * ‏פשוט לא מסמן — כלומר השדה שנועד לתעד שיתוף היה מייצר בדיוק את
 * ‏ההפך. שדה שאינו עולה כלום מתמלא.
 */

/**
 * ‎**שניים, ולא רשימה** (הכרעת בעל המוצר).
 *
 * ‏שני סוכנים הם מה שקורה בפועל — מי שהביא את הנכס ומי שהביא את
 * ‏הקונה — ולכן זו עמודה אחת על הנכס ולא טבלת משתתפים. טבלה
 * ‏הייתה מוסיפה הצטרפות, טופס וסדר תצוגה לכל שורה, בזמן שברוב
 * ‏המוחלט של השורות יש שם אדם אחד.
 */
export const PARTNER_LIMIT = 2;

/** ‏„עסקה” בלוח היא נכס שעבר לאחד משני אלה — אותה הגדרה בדיוק. */
export const DEAL_STATUSES = ["sold", "rented"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  sold: "נמכר",
  rented: "הושכר",
};

export interface PartnerPick {
  /** ‏הסוכן המטפל בנכס — מי שהעסקה נרשמת עליו. */
  agentUserId: string | null;
  /** ‏מי שנבחר כשותף. מחרוזת ריקה = ניקוי הסימון. */
  partnerUserId: string;
  /** ‏מזהי המשתמשים החיים במשרד. */
  officeUserIds: readonly string[];
}

export type PartnerRejection =
  | "same_agent"
  | "not_in_office"
  | "no_agent";

export const PARTNER_REJECTION_MESSAGES: Record<PartnerRejection, string> = {
  same_agent: "הסוכן השותף חייב להיות מישהו אחר",
  not_in_office: "אפשר לסמן רק סוכן מהמשרד",
  no_agent: "צריך קודם לשייך סוכן מטפל לנכס",
};

/**
 * ‏הכלל היחיד שמכריע אם סימון מתקבל — **גם המסך וגם השרת קוראים
 * ‏ממנו**, ולכן אין מצב שהטופס מציע מה שה-API דוחה.
 *
 * ‏שלוש הדחיות אינן קפדנות:
 *
 * - ‎`same_agent` — „שת״פ” של אדם עם עצמו אינו שת״פ, והוא היה
 *   ‏מציג שורה שקרית בסיכום המשרד.
 * - ‎`not_in_office` — מזהה שאינו במשרד הוא או טעות או ניסיון
 *   ‏להצביע על משתמש של משרד אחר. שם של אדם זר על עסקה הוא בדיוק
 *   ‏מה שאסור לחצות בין דיירים.
 * - ‎`no_agent` — נכס בלי סוכן מטפל אין לו „צד ראשון”, ולכן אין
 *   ‏למי לצרף שני.
 */
export function partnerRejection(pick: PartnerPick): PartnerRejection | null {
  /* ‏ניקוי מותר תמיד: זו חזרה למצב שהיה, ואינה טוענת דבר */
  if (pick.partnerUserId === "") return null;
  if (pick.agentUserId === null) return "no_agent";
  if (pick.partnerUserId === pick.agentUserId) return "same_agent";
  if (!pick.officeUserIds.includes(pick.partnerUserId)) return "not_in_office";
  return null;
}

export interface PartnerDeal {
  propertyId: string;
  address: string;
  status: DealStatus;
  closedAt: Date;
  agentName: string;
  partnerName: string;
}

/**
 * ‏שורת השת״פ כפי שהיא נקראת בסיכום המשרד.
 *
 * ‏הניסוח הוא „X עם Y” ולא „X ו-Y”: הראשון הוא הסוכן המטפל — מי
 * ‏שהעסקה רשומה עליו ומי שהניקוד הלך אליו — והסדר הזה הוא המידע.
 */
export function partnerDealLine(deal: PartnerDeal): string {
  return `${deal.agentName} עם ${deal.partnerName} — ${deal.address} (${DEAL_STATUS_LABELS[deal.status]})`;
}

/**
 * ‏„3 שת״פים מתוך 12 עסקאות” — המספר שהמנהל באמת רוצה.
 *
 * ‎`null` כשאין עסקאות כלל: „0%” על מכנה אפס הוא מספר שהומצא, ולא
 * ‏עובדה. זה אותו כלל שכבר קיים ב-`delta` של הלוח.
 */
export function partnerShare(
  partnered: number,
  deals: number,
): { partnered: number; deals: number; percent: number | null } {
  return {
    partnered,
    deals,
    percent: deals === 0 ? null : Math.round((partnered / deals) * 100),
  };
}

/** ‏כותרת המקטע — נגזרת מהתווית של „עסקאות” ואינה נכתבת שוב ביד. */
export function partnerSectionNote(): string {
  return `${BOARD_METRIC_LABELS.deals} שנסגרו בשיתוף שני סוכנים מהמשרד. הניקוד בטבלה אינו מושפע — הוא נשאר על הסוכן המטפל.`;
}
