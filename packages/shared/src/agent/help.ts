import { AGENT_ACTIONS } from "./actions";

/**
 * ‎**„מה את יודעת לעשות” — נגזר מהקטלוג, בלי קריאת מודל.**
 *
 * זו השאלה הראשונה של כל מתווך חדש. עד היום היא נענתה דרך המודל:
 * תשלום על ניסוח מחדש של אותה תשובה, עם סיכוי שהיא תזכיר פעולה
 * שלמשתמש הזה אין אליה הרשאה. כאן היא נגזרת מהפעולות שלו בפועל —
 * מדויקת, מיידית וחינם.
 *
 * הדוגמאות הן דוגמאות אמיתיות מהקטלוג, כלומר בדיוק הניסוחים שהמודל
 * מאומן עליהם: מי שמעתיק אותן מקבל תוצאה טובה כבר בפעם הראשונה.
 *
 * ## למה כאן ולא במודול הוואטסאפ
 *
 * התפריט נבנה בתוך `apps/api/src/modules/messaging`, ולכן הוא היה
 * של הוואטסאפ בלבד: הצ'אט במסך הציג שש דוגמאות קבועות מתוך שבעים
 * ושתיים פעולות, ולא הייתה שום דרך לגלות ממנו את השאר. הנחיית בעל
 * המוצר מפורשת — שיפור בסוכן אחד הוא שיפור בשניהם — ולכן החלוקה
 * יושבת כאן כ**נתונים**, וכל ערוץ מרנדר אותה בשפה שלו: הוואטסאפ
 * כטקסט עם כוכביות, המסך ככרטיסים.
 */

/**
 * הקבוצות לפי סדר השימוש בפועל, לא לפי סדר הקטלוג.
 *
 * ‎**כל פעולה בקטלוג חייבת להופיע כאן, ובקבוצה אחת בלבד.**
 *
 * זו רשימה מקבילה לקטלוג, וככזו היא נטתה ממנו: שש פעולות קיימות —
 * „מי צריך שיחה חוזרת”, „הכרטיס של”, „תשמיע לי”, קישור החתימה,
 * הבלעדיות ותיעוד השיווק — **לא הופיעו בתפריט כלל**. הן עבדו; פשוט
 * אי אפשר היה לדעת מהסוכן עצמו שהן קיימות, וזה גרוע במיוחד בתפריט
 * שכל תכליתו לענות „מה את יודעת לעשות”.
 *
 * ‎`agent-help.test.ts` אוכף את הכיסוי, ולכן פעולה חדשה שלא תשובץ
 * תפיל את הבדיקה במקום להיעלם בשקט.
 */
const GROUPS: { label: string; ids: readonly string[] }[] = [
  {
    label: "לשאול על המאגר",
    ids: ["find_buyers", "find_properties", "search", "show_matches", "show_card"],
  },
  {
    label: "היום שלי",
    ids: [
      "show_schedule",
      "show_tasks",
      "show_notifications",
      "mark_notifications_read",
      "show_callbacks",
      "show_leads",
      "show_calls",
      "log_call",
      "play_recording",
      "office_report",
      "agent_report",
      "show_recommendations",
    ],
  },
  {
    label: "להוסיף ולעדכן",
    ids: [
      "create_lead",
      "create_buyer",
      "create_property",
      "create_task",
      "convert_lead",
      "create_property_from_lead",
      "add_contact_detail",
      "schedule_appointment",
      "reschedule_appointment",
      "update_appointment",
      "update_buyer",
      "update_property",
      "update_lead_status",
      "complete_task",
      "update_task",
      "create_recurring_task",
      "assign_task",
      "add_note",
      "dismiss_match",
    ],
  },
  {
    label: "הצעות והחתמה",
    ids: [
      "send_offer",
      "send_offers_bulk",
      "send_agreement",
      "send_email",
      "send_message",
      "call_contact",
      "send_intake_form",
      "message_owner",
      "send_owner_update",
      "show_offers",
      "show_agreements",
      "show_retained_documents",
      "show_emails",
    ],
  },
  {
    label: "בלעדיות",
    ids: ["show_exclusivity", "start_exclusivity", "log_marketing_action"],
  },
  {
    label: "רשת המשרדים",
    ids: [
      "share_property",
      "create_landing_page",
      "share_buyer",
      "show_demands",
      "show_deals",
      "show_credits",
      "open_deal_room",
      "show_network_listings",
      "show_network_inbox",
      "offer_to_demand",
      "express_interest",
      "post_deal_message",
      "move_deal_stage",
      "show_payout_balance",
      "show_referral_board",
      "show_reach",
    ],
  },
  { label: "עזרה", ids: ["open_support_ticket", "show_support_tickets", "set_preference"] },
];

/** מיוצאת לבדיקת הכיסוי בלבד — התפריט עצמו נבנה מ-`agentHelpGroups`. */
export const AGENT_HELP_GROUP_IDS: readonly string[] = GROUPS.flatMap((group) => group.ids);

/** קבוצה אחת בתפריט, אחרי סינון למה שלמשתמש הזה מותר. */
export interface AgentHelpGroup {
  label: string;
  actions: { id: string; title: string; example?: string }[];
}

/**
 * התפריט של המשתמש הזה — רק פעולות שמותרות לו, בקבוצות שיש בהן
 * תוכן. קבוצה ריקה אינה מוצגת: כותרת בלי פעולות היא הבטחה למשהו
 * שאינו קיים אצלו.
 */
export function agentHelpGroups(allowedIds: readonly string[]): AgentHelpGroup[] {
  const allowed = new Set(allowedIds);
  const groups: AgentHelpGroup[] = [];
  for (const group of GROUPS) {
    const actions = group.ids.flatMap((id) => {
      if (!allowed.has(id)) return [];
      const action = AGENT_ACTIONS.find((candidate) => candidate.id === id);
      if (action === undefined) return [];
      const example = action.examples[0];
      return [{ id, title: action.title, ...(example === undefined ? {} : { example }) }];
    });
    if (actions.length > 0) groups.push({ label: group.label, actions });
  }
  return groups;
}

/**
 * הפעולות שמהן נלקחות דוגמאות הפתיחה, לפי סדר עדיפות.
 *
 * הסדר מייצר גיוון: שאלה על המאגר, הוספה, ומבט על היום — כך שמי
 * שקורא רואה את שלושת סוגי השימוש ולא שלוש וריאציות של אותו דבר.
 */
const WELCOME_PREFERRED: readonly string[] = [
  "find_buyers",
  "create_buyer",
  "show_schedule",
  "find_properties",
  "create_property",
  "show_tasks",
  "create_task",
  "search",
];

/**
 * דוגמאות הפתיחה — **מה שמותר למשתמש הזה, ותו לא.**
 *
 * הכרות שמלמדת „תוסיף קונה” משתמש שאינו רשאי להוסיף היא הכרות
 * שמסתיימת ב„אין לך הרשאה” בניסיון הראשון.
 *
 * ‎**וזו גזירה אחת לשני הערוצים.** הוואטסאפ בחר שלוש דוגמאות לפי
 * רשימת העדפה, והמסך בחר שש לפי רשימה משלו — שתי רשימות שנטו זו
 * מזו בשקט, ואף אחת מהן לא הייתה קשורה לקטלוג.
 */
export function agentWelcomeExamples(allowedIds: readonly string[], count: number): string[] {
  const allowed = new Set(allowedIds);
  const byPreference = [
    ...WELCOME_PREFERRED.filter((id) => allowed.has(id)),
    // פעולה מותרת שאינה ברשימת ההעדפה עדיפה על דוגמה חסרה
    ...allowedIds.filter((id) => !WELCOME_PREFERRED.includes(id)),
  ];
  return byPreference
    .flatMap((id) => {
      const example = AGENT_ACTIONS.find((action) => action.id === id)?.examples[0];
      return example === undefined ? [] : [example];
    })
    .slice(0, count);
}
