/**
 * ‎**מה הסוכן עדיין יודע לעשות כשמנוע ההבנה נפל.**
 *
 * ## התקלה שזה נולד ממנה
 *
 * כשספק ההבנה אינו זמין, הפירוש נופל למנוע החוקים — התאמת ביטויים
 * מוכרים, שמגיעה ל-19 פעולות מתוך 71. עבור 52 הפעולות האחרות
 * המתווך בוואטסאפ קיבל „לא הצלחתי להבין מה לעשות — נסו לנסח
 * אחרת”, בלי הצעות (מנוע החוקים אינו יודע „מה כמעט התאים”, ובצדק).
 *
 * כלומר **הוראה לנסח אחרת, על בקשה שאף ניסוח לא יצליח** עד שהספק
 * יחזור. זו בדיוק אותה תקלה שנמצאה במסך חיבור הוואטסאפ („נסו
 * שוב” על 403 קבוע), רק שכאן המתווך מנסח שוב ושוב ומסיק שהסוכן
 * לא מבין אותו.
 *
 * ## ולמה זה ב-shared
 *
 * המסך כתב את ההסבר הזה בשורה משלו; בוואטסאפ הוא פשוט לא היה.
 * דרישת הזהות בין הערוצים אינה נשמרת בשכפול נוסח — נוסח שיושב
 * בצד אחד בלבד הוא נוסח שהצד השני ימציא מחדש, או ישכח.
 *
 * ## ולמה הרשימה נגזרת ולא נכתבת
 *
 * „מה שכן עובד עכשיו” חייב להיות **בדיוק** מה שמנוע החוקים מכיר.
 * רשימה שנכתבת ביד לצד המפה נכונה ביום שנכתבה: הבטחה לפעולה שאינה
 * במפה מחזירה את המתווך בדיוק לקיר שממנו ניסינו להוציא אותו.
 * לכן המפה עצמה יושבת כאן, והרשימה נגזרת ממנה.
 */

import { AGENT_ACTION_IDS, agentAction, type AgentActionId } from "./actions.js";
import type { VoiceAction } from "../logic/voice-command.js";

/**
 * הכוונות של מנוע החוקים ⟵ מזהי הקטלוג.
 *
 * ‎**`Record<VoiceAction, …>` ולא `Record<string, …>`.** בטיפוס
 * הרופף כוונה חדשה ב-`VoiceAction` הייתה נכנסת בשקט ומחזירה
 * ‎`undefined` — כלומר „לא הבנתי” על ביטוי שהמנוע דווקא זיהה.
 * עכשיו חוסר מיפוי הוא שגיאת קומפילציה, ו-`null` הוא הצהרה
 * מפורשת „אין פעולה מתאימה”.
 */
export const RULE_ACTION_MAP: Record<VoiceAction, AgentActionId | null> = {
  add_property: "create_property",
  add_buyer: "create_buyer",
  add_lead: "create_lead",
  schedule_appointment: "schedule_appointment",
  add_task: "create_task",
  query_buyers: "find_buyers",
  query_properties: "find_properties",
  show_schedule: "show_schedule",
  show_tasks: "show_tasks",
  show_callbacks: "show_callbacks",
  show_calls: "show_calls",
  show_deals: "show_deals",
  office_report: "office_report",
  complete_task: "complete_task",
  add_note: "add_note",
  update_lead_status: "update_lead_status",
  share_property: "share_property",
  share_buyer: "share_buyer",
  send_offer: "send_offer",
  search: "search",
  /*
   * ‎**שאלות „תראה לי” — שמן זהה למזהה בקטלוג.**
   *
   * מיפוי זהות ולא שכבת תרגום: הכוונות הוותיקות נקראו אחרת
   * מהפעולות (`add_property` ⟵ `create_property`) והשם הכפול הוא
   * מקור טעויות בלי שום תמורה. לחדשות אין סיבה לחזור על זה.
   */
  show_matches: "show_matches",
  show_leads: "show_leads",
  show_offers: "show_offers",
  show_demands: "show_demands",
  show_notifications: "show_notifications",
  show_emails: "show_emails",
  show_credits: "show_credits",
  show_payout_balance: "show_payout_balance",
  show_referral_board: "show_referral_board",
  show_reach: "show_reach",
  show_recommendations: "show_recommendations",
  show_exclusivity: "show_exclusivity",
  show_agreements: "show_agreements",
  show_retained_documents: "show_retained_documents",
  show_network_listings: "show_network_listings",
  show_network_inbox: "show_network_inbox",
  show_support_tickets: "show_support_tickets",
  show_card: "show_card",
  play_recording: "play_recording",
  agent_report: "agent_report",
  unknown: null,
};

/**
 * הפעולות שמנוע החוקים מסוגל להגיע אליהן — נגזר מהמפה.
 *
 * הסדר הוא סדר הקטלוג ולא סדר המפה: הקטלוג מסודר לפי מה שמתווך
 * עושה קודם, וזה הסדר שההצעות צריכות להופיע בו.
 */
export const AGENT_RULE_ACTION_IDS: readonly AgentActionId[] = AGENT_ACTION_IDS.filter(
  (id): id is AgentActionId => Object.values(RULE_ACTION_MAP).includes(id),
);

/** משפט המצב — נכון גם כשהספק נפל וגם כשלא הוגדר מפתח כלל. */
export const AGENT_DEGRADED_REASON =
  "שירות ההבנה החכמה אינו זמין כרגע, ולכן אני מזהה רק ניסוחים מוכרים.";

/**
 * ‎**מה שכן עובד עכשיו** — ההסבר יחד עם דוגמאות אמיתיות.
 *
 * ‎`allowedIds` הוא מה שמותר למתווך הזה בפועל: הצעה לפעולה שהמסלול
 * שלו אינו כולל, או שתפקידו אינו מרשה, היא קיר שני מיד אחרי
 * הראשון.
 *
 * מחזיר מערך שורות ולא מחרוזת אחת — לכל ערוץ יש דרך משלו לחבר
 * שורות (‏`\n` בוואטסאפ, פסקאות במסך), והחיבור אינו החלטה של
 * הנוסח.
 */
export function agentDegradedNotice(
  allowedIds: readonly string[],
  limit = 3,
): string[] {
  const allowed = new Set(allowedIds);
  const examples = AGENT_RULE_ACTION_IDS.filter((id) => allowed.has(id)).flatMap((id) => {
    const action = agentAction(id);
    const example = action?.examples[0];
    // מובטח בשער הקטלוג — הצרת הטיפוס, ולא מקרה שצפוי לקרות
    return action === undefined || example === undefined ? [] : [`• ${action.title} — „${example}”`];
  });

  /*
   * בלי דוגמאות אין מה להבטיח.
   *
   * זה קורה כשכל מה שמנוע החוקים מכיר חסום למתווך הזה — ואז
   * „מה שכן עובד עכשיו:” מעל רשימה ריקה גרוע מכלום.
   */
  if (examples.length === 0) return [AGENT_DEGRADED_REASON];
  return [AGENT_DEGRADED_REASON, "מה שכן עובד עכשיו:", ...examples.slice(0, limit)];
}
