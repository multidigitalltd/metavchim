/**
 * ‎**קטגוריות ההתראות — מודול עלה, בלי ייבואים משלו.**
 *
 * ‏שלושה צדדים צריכים את הרשימה: `whatsapp-notify.ts` שמסווג התראה
 * ‏לקטגוריה, קטלוג הפעולות שמציע למתווך לכבות אחת מהשיחה, ו-`web-push.ts`
 * ‏שמנתב התראה בלי ישות למסך של הנושא שלה. הראשון מייבא את הקטלוג ואת
 * ‏השלישי, ולכן ייבוא שלהם ממנו הוא **מעגל** — ובזמן ריצה הרשימה חוזרת
 * ‏`undefined` בצד שנטען ראשון, כלומר קריסה בטעינה ולא שגיאת קומפילציה.
 *
 * ‏קובץ בלי ייבואים אינו יכול להיות חלק במעגל. זו כל תכליתו.
 */

/**
 * ‏קיבוץ סוגי ההתראות לקטגוריות שהמתווך מכיר.
 *
 * ‏המתווך אינו אמור להכיר שנים-עשר קודי התראה כדי לכבות רעש. הוא
 * ‏חושב במונחים של „שיחות” ו„לידים”, וזו גם היחידה שבה הוא מכבה.
 */
export type WhatsAppNotifyCategory =
  | "calls"
  | "leads"
  | "tasks"
  | "matches"
  | "network"
  | "forum"
  | "digests"
  | "system";

export const NOTIFY_CATEGORY_LABELS: Record<WhatsAppNotifyCategory, string> = {
  calls: "שיחות ותמלולים",
  leads: "לידים",
  tasks: "משימות, פגישות ותזכורות",
  matches: "התאמות, קונים ונכסים",
  network: "רשת השיתופים והתשלומים",
  forum: "הפורום המקצועי",
  digests: "סיכומים יומיים ושבועיים",
  system: "הודעות מערכת",
};

/**
 * ‏הקטגוריות כרשימה — **נגזרת מהתוויות ולא נכתבת שוב.**
 *
 * ‏כל מי שמציע לבחור קטגוריה (המסך, קטלוג הסוכן) צריך אותה,
 * ‏ורשימה שנייה הייתה מסכימה עם הטבלה רק עד הקטגוריה הבאה.
 */
export const NOTIFY_CATEGORIES = Object.keys(
  NOTIFY_CATEGORY_LABELS,
) as WhatsAppNotifyCategory[];

/** סוג ההתראה → הקטגוריה שלו. סוג שאינו כאן נחשב הודעת מערכת. */
const TYPE_CATEGORY: Record<string, WhatsAppNotifyCategory> = {
  incoming_call: "calls",
  call_missed: "calls",
  call_transcribed: "calls",
  call_follow_up: "calls",
  call_transcribe_failed: "calls",
  /* המרכזייה עצמה — אותה קטגוריה, כי מי שכיבה „שיחות” אינו רוצה גם את זה */
  pbx_silent: "calls",

  lead: "leads",
  lead_sla: "leads",
  lead_stale: "leads",
  lead_repeat_inquiry: "leads",
  /* ‏טופס שאדם זר מילא — אתר, פייסבוק, או דף נחיתה של נכס */
  lead_form_inquiry: "leads",
  lead_returned: "leads",
  lead_requires_human: "leads",
  intake_submitted: "leads",
  email_reply: "leads",
  whatsapp_bot_escalation: "leads",

  task: "tasks",
  task_reminder: "tasks",
  appointment_reminder: "tasks",
  viewing_followup: "tasks",
  /* ‏אוטומציות „נכס תקוע” ו„קונה שקט” — משימה לסוכן, ולכן בקטגוריית המשימות */
  property_stale: "tasks",
  buyer_quiet: "tasks",
  /** „הדוח למוכר מוכן” — משוב מביקורים שהצטבר השבוע על נכס */
  viewing_feedback_digest: "tasks",
  offer_followup: "tasks",
  custom_automation: "tasks",
  appointment_scheduled: "tasks",
  /*
   * ‏תזכורת ממשימה חוזרת (`apps/workers`). היחיד ששמו נושא נקודה,
   * ולכן במרכאות — וזה בדיוק מה שהחביא אותו: השער שנוסף כאן סינן
   * נקודות ולכן דילג עליו, והוא נפל ל-`system` כלומר הגיע גם למי
   * שכיבה „משימות” (ביקורת Codex).
   */
  "task.due": "tasks",

  buyer: "matches",
  property: "matches",
  property_delisted: "matches",
  /* ‏המחיר ירד — קונים שאמרו „גבוה” חזרו למשחק */
  price_drop_reoffer: "matches",
  matches_refreshed: "matches",
  match_weights_calibrated: "matches",
  /*
   * ‎**ההצעות וההתאמות — הסוגים ששקטו.**
   *
   * ‏שישה סוגים שנוצרים בפועל לא היו ברשימה, ולכן נפלו ל-`system`:
   * אייקון ℹ️ במקום 🎯, משפט סיום כללי במקום „יש התאמה”, וכפתור
   * שאינו קשור למה שכתוב מעליו. גרוע מכך — מי שכיבה „התאמות,
   * קונים ונכסים” המשיך לקבל אותם, כי הם נספרו כהודעת מערכת
   * שאי אפשר לכבות. סוג שאינו כאן אינו ניטרלי; הוא פשוט לא נשלט.
   */
  offer_opened: "matches",
  offer_interested: "matches",
  matches_found: "matches",
  opportunity_opened: "matches",

  coop_deal: "network",

  // המנטור האישי — הסיכום השבועי הוא סיכום; החגיגה היא אירוע, אבל
  // על עצמי ולא על לקוח, ולכן באותה קטגוריה שהמשתמש בוחר בה
  mentor_weekly: "digests",
  mentor_win: "digests",
  mentor_nudge: "digests",
  mentor_daily: "digests",
  mentor_monthly: "digests",
  coop_offer: "network",
  coop_offer_received: "network",
  coop_offer_declined: "network",
  payout_decision: "network",
  shared_lead_sold: "network",
  /*
   * ‏„נכנס נכס שמתאים לביקוש שאתה עוקב אחריו” — רשת, לא מערכת.
   * בלי השורה הזו הוא נפל ל-`system`, כלומר מי שכיבה „רשת” המשיך
   * לקבל אותו כהודעה שאי אפשר לכבות (ביקורת Codex) — בדיוק הכשל
   * שההערה על ההצעות למעלה מתארת, שוב.
   */
  coop_demand_match: "network",
  /*
   * ‏והכיוון השני — „נכנס קונה שמתאים לנכס שאתה עוקב אחריו”.
   * ‏אותה קטגוריה בדיוק: שורה שנשכחת כאן נופלת ל-`system`, כלומר
   * ‏מי שכיבה „רשת” ממשיך לקבל אותה כהודעה שאי אפשר לכבות.
   */
  coop_listing_match: "network",
  /*
   * ‏„הכרטיס לא פורסם אוטומטית לרשת” — הסוכן פתח נכס או קונה
   * ‏בזמן שהמתג דלוק, והפרסום נחסם. רשת ולא `system`: מי שכיבה
   * ‏„רשת” כיבה את כל הרעש של הרשת, והכישלון הזה שייך לה —
   * ‏והפעמון ממילא מציג אותו בכל מקרה, כי הקטגוריה שולטת בדחיפה
   * ‏לוואטסאפ בלבד.
   */
  network_autopublish_failed: "network",

  daily_brief: "digests",
  weekly_summary: "digests",
  /*
   * ‏הסיכום המשרדי — אותה משפחה בדיוק של הדוח היומי והשבועי.
   * ‏הוא נכתב דרך `notifyOnce`, שהשער לא סרק עד עכשיו, ולכן נפל
   * ‏ל-`system`: מנהל שכיבה „סיכומים” המשיך לקבל אותו בוואטסאפ
   * ‏כהודעה שאי אפשר לכבות.
   */
  office_digest: "digests",

  /*
   * ‏„סוכן סגר את היעד” הוא סיכום ביצועים ולא משימה: הוא אינו דורש
   * פעולה בשנייה הבאה, והוא שייך לאותה משפחה של הדוח היומי — מנהל
   * שכיבה „סיכומים” לא רוצה גם את זה.
   *
   * ‏הפידבק לסוכן, לעומת זאת, הוא **הודעה מאדם**: מנהל כתב לו משהו,
   * וזה מגיע גם למי שהשאיר רק את ההודעות החשובות דלוקות.
   */
  mentor_goal_reached: "digests",
  mentor_feedback: "system",

  /*
   * ‎**„החיבור של הוואטסאפ שלך פג” — `system` בכוונה, לא `leads`.**
   *
   * ‏התוצאה של הכשל היא שלידים מפסיקים להיכנס, ולכן `leads` נראה
   * המתבקש. אבל מי שכיבה „לידים” כיבה **התראות על לידים**, ולא
   * הסכים לאבד אותם בשקט: זו בדיוק ההתראה שאסור שתהיה ניתנת
   * להשתקה, כי בלעדיה אין שום סימן אחר שהקו מת — Meta אינה שולחת
   * דבר, והמסך ממשיך להראות ✓.
   *
   * ‏הרישום כאן מפורש ולא נשען על נפילת ברירת המחדל ל-`system`:
   * זו בדיוק ההבחנה שהשער `verify:notify` אוכף — סוג שאינו ברשימה
   * הוא סוג שאיש לא החליט עליו.
   */
  whatsapp_token_expired: "system",
  /** הגיליון נסגר מחר וההזמנה ממתינה לתשלום — כסף של המשרד, לא רעש */
  media_closing: "system",
  /*
   * ‏שאר שלבי הזמנת המדיה — שולם ונשלח, הפניה יצאה, המודעה פורסמה.
   * ‏`system` כמו הסגירה: מי שהזמין פרסום בכסף רוצה לדעת מה קרה
   * ‏איתו, ואין קטגוריה „פרסום” שמישהו היה מכבה בנפרד.
   */
  media_confirmed: "system",
  media_paid: "system",
  media_referred: "system",
  media_published: "system",
  // הפורום המקצועי — תגובה בשרשור שעוקבים אחריו, שרשור חדש למי
  // שעוקב אחרי הכול, ותגובה שסומנה כתשובה. קטגוריה משלו, כי זה
  // הרעש היחיד כאן שאינו על העבודה של המתווך אלא על הקהילה.
  forum_reply: "forum",
  forum_thread: "forum",
  forum_accepted: "forum",
};

export function notifyCategory(type: string): WhatsAppNotifyCategory {
  return TYPE_CATEGORY[type] ?? "system";
}
