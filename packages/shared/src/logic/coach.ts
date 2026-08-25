/**
 * עוזר המכירות החכם (אפיון §14) — כללים דטרמיניסטיים שהופכים דאטה
 * גולמי להמלצות פעולה. פונקציה טהורה: ה-API אוסף את המדדים, זו
 * מייצרת את ההמלצות המדורגות, ה-UI מציג. שדרוג ל-LLM בעתיד = מקור
 * המלצות נוסף לצד הכללים, לא במקומם.
 */

import { formatJerusalemTime } from "./israel-time.js";
import type { Capability } from "../rbac.js";

export interface CoachSignals {
  /** קונים חמים/חמים-מאוד שלא קיבלו הצעה כלל */
  hotBuyersWithoutOffer: number;
  /** נכסים פעילים עם התאמות מוצעות שטרם נשלחו */
  propertiesWithUnsentMatches: { propertyId: string; title: string; matchCount: number }[];
  /** הצעות שנפתחו 3+ פעמים ולא הביעו עניין — הקונה מתלבט */
  hesitatingOffers: { offerId: string; propertyTitle: string; openCount: number }[];
  /** לידים "דורש טיפול אנושי" שממתינים */
  urgentLeads: { leadId: string; contactName: string }[];
  /** נכסים לא-מושלמים שחוסמים התאמות */
  incompleteProperties: { propertyId: string; title: string; missingCount: number }[];
  /** פגישות סיור שהסתיימו בלי סיכום תוצאה */
  pastViewingsWithoutOutcome: { appointmentId: string; title: string }[];

  /*
   * ------- מה שקורה **היום** -------
   *
   * הכללים שמעל עונים על "מה כדאי לעשות"; אלה עונים על "מה בוער
   * עכשיו". ההבחנה חשובה כי סוכן פותח את המסך בבוקר ורוצה לדעת במה
   * להתחיל, לא לקבל רשימת שיפורים.
   */
  /** לידים שלא נגעו בהם מעל ה-SLA של המשרד — השעות בפועל, לכל ליד */
  staleLeads: { leadId: string; contactName: string; hoursWaiting: number }[];
  /** פגישות של היום שטרם התקיימו */
  todayAppointments: { appointmentId: string; title: string; startsAt: Date }[];
  /** משימות פתוחות שתאריך היעד שלהן עבר */
  overdueTasks: { taskId: string; title: string; daysLate: number }[];
  /** הצעות שת"פ שהתקבלו וממתינות לתגובה — משרד אחר ממתין לי */
  pendingCoopOffers: number;
}

export interface CoachRecommendation {
  /** דירוג: ככל שגבוה יותר — דחוף יותר */
  priority: number;
  type: string;
  title: string;
  body: string;
  /** יעד לניווט */
  entityType?: "property" | "lead" | "buyer" | "offer" | "appointment";
  entityId?: string;
}

/** "מעל שעתיים" / "מאתמול" — זמן שאפשר להרגיש, לא מספר גולמי. */
function describeWait(hours: number): string {
  if (hours < 1) return "פחות משעה";
  if (hours < 24) return `מעל ${Math.floor(hours)} שעות`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "מאתמול" : `${days} ימים`;
}

export function buildRecommendations(signals: CoachSignals): CoachRecommendation[] {
  const recs: CoachRecommendation[] = [];

  /*
   * ליד שממתין הוא הדבר הדחוף ביותר שיש, ולכן מעל הכול — כולל מעל
   * "דורש טיפול אנושי". ליד מתקרר בשעות, וכל שאר ההמלצות ימתינו.
   * הזמן שהוא כבר ממתין נאמר במפורש: "מעל שעתיים" מזיז אחרת מ"ליד
   * ממתין".
   */
  for (const lead of signals.staleLeads) {
    recs.push({
      priority: 110,
      type: "stale_lead",
      title: `${lead.contactName} ממתין ${describeWait(lead.hoursWaiting)}`,
      body: "ליד שלא נענה מתקרר מהר, ובדרך כלל פונה למשרד הבא. זו השיחה הראשונה להיום.",
      entityType: "lead",
      entityId: lead.leadId,
    });
  }

  for (const appointment of signals.todayAppointments) {
    recs.push({
      priority: 105,
      type: "today_appointment",
      title: `היום ${formatJerusalemTime(appointment.startsAt)} — ${appointment.title}`,
      body: "כדאי לוודא מול הלקוח שהפגישה בתוקף, ולהגיע עם הנכסים המתאימים בהישג יד.",
      entityType: "appointment",
      entityId: appointment.appointmentId,
    });
  }

  if (signals.pendingCoopOffers > 0) {
    recs.push({
      priority: 95,
      type: "pending_coop_offers",
      title:
        signals.pendingCoopOffers === 1
          ? "הצעת שיתוף פעולה ממתינה לתגובה"
          : `${signals.pendingCoopOffers} הצעות שיתוף פעולה ממתינות לתגובה`,
      body: "משרד אחר הציע נכס על אחד הביקושים שלכם ומחכה לתשובה.",
    });
  }

  for (const task of signals.overdueTasks) {
    recs.push({
      priority: 85,
      type: "overdue_task",
      title: `${task.title} — באיחור של ${task.daysLate === 1 ? "יום" : `${task.daysLate} ימים`}`,
      body: "משימה שעבר זמנה. אם היא כבר לא רלוונטית — עדיף לסגור אותה מלהשאיר אותה פתוחה.",
    });
  }

  for (const lead of signals.urgentLeads) {
    recs.push({
      priority: 100,
      type: "urgent_lead",
      title: `לחזור ל${lead.contactName} — דורש טיפול אנושי`,
      body: "הפנייה סומנה כרגישה. לידים חמים מתקררים מהר — כדאי לחזור עכשיו.",
      entityType: "lead",
      entityId: lead.leadId,
    });
  }

  for (const offer of signals.hesitatingOffers) {
    recs.push({
      priority: 90,
      type: "hesitating_buyer",
      title: `קונה פתח ${offer.openCount} פעמים ולא הגיב`,
      body: `${offer.propertyTitle} — הקונה מתלבט. מומלץ לשלוח הודעת המשך או להתקשר.`,
      entityType: "offer",
      entityId: offer.offerId,
    });
  }

  // הנכס עם הכי הרבה קונים ממתינים — ההזדמנות הגדולה ביותר לשליחת הצעות
  const topProperty = [...signals.propertiesWithUnsentMatches].sort(
    (a, b) => b.matchCount - a.matchCount,
  )[0];
  if (topProperty && topProperty.matchCount >= 1) {
    recs.push({
      priority: 80,
      type: "unsent_matches",
      title: `${topProperty.title} מתאים ל-${topProperty.matchCount} קונים`,
      body: "כדאי לשלוח הצעות — לחיצה אחת שולחת לכל המתאימים.",
      entityType: "property",
      entityId: topProperty.propertyId,
    });
  }

  if (signals.hotBuyersWithoutOffer > 0) {
    recs.push({
      priority: 70,
      type: "hot_buyers_idle",
      title: `${signals.hotBuyersWithoutOffer} קונים חמים לא קיבלו הצעה`,
      body: "קונים חמים בלי הצעה = הזדמנויות שמתפספסות. עברו על ההתאמות שלהם.",
      entityType: undefined,
    });
  }

  for (const viewing of signals.pastViewingsWithoutOutcome) {
    recs.push({
      priority: 60,
      type: "viewing_followup",
      title: `איך היה הסיור? — ${viewing.title}`,
      body: "עדכון תוצאת הסיור מקדם את הליד ומזין את ההתאמות הבאות.",
      entityType: "appointment",
      entityId: viewing.appointmentId,
    });
  }

  const topIncomplete = [...signals.incompleteProperties].sort(
    (a, b) => a.missingCount - b.missingCount,
  )[0];
  if (topIncomplete) {
    recs.push({
      priority: 40,
      type: "incomplete_property",
      title: `להשלים פרטים: ${topIncomplete.title}`,
      body: `חסרים ${topIncomplete.missingCount} פרטים — נכס מושלם מוצא יותר קונים.`,
      entityType: "property",
      entityId: topIncomplete.propertyId,
    });
  }

  return recs.sort((a, b) => b.priority - a.priority);
}

/*
 * ‎**היעד של המלצה — כאן ולא במסך.**
 *
 * הכלל הזה נשבר ארבע פעמים בזו אחר זו, כל פעם בסוג אחר: שלוש
 * המלצות מצרפות נכתבות בלי `entityId` ולכן החזירו `null`, ו-
 * `hesitating_buyer` נושא `entityType: "offer"` שלא היה לו ענף.
 * כל אחת מהן דחופה מספיק כדי לקבל את השורה הראשונה, כלומר להיבחר
 * כ„הדבר לעשות עכשיו” ולהופיע **בלי דרך לפעול**.
 *
 * תיקון נקודתי במסך היה מזמין את החמישית. כלל שנשבר שוב ושוב הוא
 * כלל שמקומו כאן — ליד הפונקציה שמייצרת את הסוגים, עם בדיקה
 * שמונה אותם. `recommendationHref` מחזיר `null` רק לסוג שבאמת אין
 * לו יעד, ובדיקה אחת מוודאת שאין כזה.
 */
const AGGREGATE_HREF: Record<string, string> = {
  pending_coop_offers: "/collaboration",
  overdue_task: "/tasks",
  hot_buyers_idle: "/buyers",
};

/*
 * ‎**היכולת שהיעד דורש.**
 *
 * ‎`/coach/recommendations` נשמר מאחורי `matches.view`, אבל היעדים
 * שהוא מפנה אליהם יושבים מאחורי יכולות אחרות: סוכן רגיל עם
 * ‎`matches.view` יכול לקבל המלצה על הצעת שת"פ בלי שיש לו
 * ‎`collaboration.offer`, ואז הכפתור מוביל למסך שמחזיר 403
 * (ביקורת Codex).
 *
 * המפה יושבת כאן ולא במסך מאותה סיבה שהיעד עצמו יושב כאן: הכלל
 * נשבר פעם אחר פעם כשהוא מפוזר, ומי שמוסיף סוג המלצה חדש צריך
 * למצוא את שתי השאלות באותו מקום.
 *
 * ‎**שתי שאלות, ושתיהן חייבות להתקיים** — לפתוח את המסך, ולבצע
 * בו את מה שביקשנו. הן נראות כאחת רק כשההמלצה מזמינה לקרוא;
 * ברגע שהיא מבקשת לשלוח או לערוך, הן נפרדות, ואפשר להיכשל בכל
 * אחת מהן בנפרד.
 *
 * ‎**הגרסה הראשונה** נגזרה מקידומת ה-href בלבד, כלומר שאלה רק
 * „האם מותר לו לראות את המסך”: `unsent_matches` מוביל
 * ל-`/properties/…` וקיבל `properties.view`, בעוד שגוף ההמלצה אומר
 * „כדאי לשלוח הצעות” וכפתור „שלח הצעה” שבמסך יורה `POST /offers`
 * שדורש `offers.send`. אותה טעות ישבה גם ב-`incomplete_property`:
 * „להשלים פרטים” היא `properties.edit` (ביקורת Codex).
 *
 * ‎**הגרסה השנייה החליפה** את שאלת המסך בשאלת הפעולה — ובכך פתחה
 * את הכיוון ההפוך: משרד ששולל `properties.view` מסוכן מסוים ומשאיר
 * לו `offers.send` היה מקבל את ההמלצה, ונופל על `GET /properties/:id`
 * עוד לפני שראה כפתור (ביקורת Codex). „במקום” היה תיקון של צד אחד.
 *
 * לכן `recommendationCapabilities` מחזירה **קבוצה**, והמסך דורש את
 * כולה. סוג שאינו במפת הפעולות אינו מוסיף דרישה — ולכן הבדיקה מונה
 * את הסוגים ונופלת על סוג חדש שנשכח, בדיוק כמו הבדיקה של
 * ‎`recommendationHref` שמעל.
 */
/** מה שדרוש כדי **לפתוח** את היעד — הנתיב שהמסך טוען בכניסה. */
function destinationCapability(href: string | null): Capability | null {
  if (href === null) return null;
  if (href.startsWith("/collaboration")) return "collaboration.offer";
  if (href.startsWith("/tasks") || href.startsWith("/calendar")) return "calendar.manage";
  if (href.startsWith("/offers")) return "offers.send";
  if (href.startsWith("/properties")) return "properties.view";
  if (href.startsWith("/buyers")) return "buyers.view_own";
  if (href.startsWith("/leads")) return "leads.view_own";
  return null;
}

/** מה שדרוש כדי **לבצע** את מה שההמלצה מבקשת, אחרי שהמסך נפתח. */
const ACTION_CAPABILITY: Record<string, Capability> = {
  /* „זו השיחה הראשונה להיום” — לפתוח את הליד ולהתקשר. */
  stale_lead: "leads.view_own",
  urgent_lead: "leads.view_own",
  /* „לוודא מול הלקוח שהפגישה בתוקף” — נגיעה ביומן. */
  today_appointment: "calendar.manage",
  /* „עדיף לסגור אותה” — שינוי סטטוס המשימה. */
  overdue_task: "calendar.manage",
  /* „עדכון תוצאת הסיור” — כתיבה על הפגישה. */
  viewing_followup: "calendar.manage",
  /* „משרד אחר… מחכה לתשובה” — מענה להצעת שת"פ. */
  pending_coop_offers: "collaboration.offer",
  /* „מומלץ לשלוח הודעת המשך” — שליחה על הצעה קיימת. */
  hesitating_buyer: "offers.send",
  /* „כדאי לשלוח הצעות — לחיצה אחת שולחת לכל המתאימים”. */
  unsent_matches: "offers.send",
  /* „להשלים פרטים” — עריכת הנכס, לא צפייה בו. */
  incomplete_property: "properties.edit",
  /* „עברו על ההתאמות שלהם” — קריאה בכרטיסי הקונים. */
  hot_buyers_idle: "buyers.view_own",
};

export function recommendationCapabilities(rec: CoachRecommendation): Capability[] {
  const destination = destinationCapability(recommendationHref(rec));
  const action = ACTION_CAPABILITY[rec.type];
  const out: Capability[] = [];
  if (destination !== undefined && destination !== null) out.push(destination);
  if (action !== undefined && action !== destination) out.push(action);
  return out;
}

export function recommendationHref(rec: CoachRecommendation): string | null {
  if (rec.entityId === undefined) return AGGREGATE_HREF[rec.type] ?? null;
  switch (rec.entityType) {
    case "property":
      return `/properties/${rec.entityId}`;
    case "lead":
      return `/leads/${rec.entityId}`;
    case "buyer":
      return `/buyers/${rec.entityId}`;
    /* אין מסך לפגישה בודדת ואין להצעה בודדת — הרשימה היא היעד. */
    case "appointment":
      return "/calendar";
    case "offer":
      return "/offers";
    default:
      return AGGREGATE_HREF[rec.type] ?? null;
  }
}
