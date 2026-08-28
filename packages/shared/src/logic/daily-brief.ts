import { APPOINTMENT_KIND_LABELS } from "../agent/result-lines.js";
import { formatJerusalemTime } from "./israel-time.js";

/**
 * דו"ח הבוקר — **תדריך של עוזר, לא מונה של מערכת.**
 *
 * הנוסח הקודם ספר: „3 פגישות היום · 2 משימות — הדשבורד מחכה לכם”.
 * מתווך שמתחיל את היום צריך את מה שעוזר אנושי היה אומר: מתי
 * הפגישה **הראשונה** ומה היא, מה ממתין, ומה אפשר לשאול עכשיו.
 * ההודעה נשלחת לוואטסאפ ולפעמון, וכפתור „מה דחוף היום?” כבר מוצמד
 * אליה בערוץ — המשפט האחרון מזמין את מי שאין לו כפתור.
 *
 * הניסוח יושב בחבילה המשותפת ולא בוורקר: זה טקסט שהסוכן אומר,
 * וניסוחי הסוכן חיים במקום אחד (הנחיית בעל המוצר — ליבה אחת).
 *
 * `null` = אין מה לומר. בוקר ריק אינו הודעה — דו"ח שמגיע גם כשאין
 * כלום מלמד למחוק אותו בלי לקרוא.
 */
export interface DailyBriefInput {
  meetings: { count: number; first?: { startsAt: Date; kind: string } };
  tasks: number;
  waitingLeads: number;
}

export function dailyBriefBody(input: DailyBriefInput): { title: string; body: string } | null {
  const { meetings, tasks, waitingLeads } = input;
  if (meetings.count === 0 && tasks === 0 && waitingLeads === 0) return null;

  const parts: string[] = [];
  if (meetings.count > 0) {
    const first =
      meetings.first === undefined
        ? ""
        : ` — ${APPOINTMENT_KIND_LABELS[meetings.first.kind] ?? "פגישה"} ב-${formatJerusalemTime(meetings.first.startsAt)}`;
    parts.push(
      meetings.count === 1
        ? `פגישה אחת היום${first}`
        : `${meetings.count} פגישות היום, הראשונה${first === "" ? " בהמשך" : first}`,
    );
  }
  if (tasks > 0) parts.push(tasks === 1 ? "משימה אחת להיום" : `${tasks} משימות להיום`);
  if (waitingLeads > 0) {
    parts.push(
      waitingLeads === 1 ? "ליד אחד ממתין למענה" : `${waitingLeads} לידים ממתינים למענה`,
    );
  }
  return {
    title: '☀️ דו"ח בוקר',
    body: `בוקר טוב! ${parts.join(" · ")}. אפשר לשאול אותי „מה יש לי היום?” ואפרט.`,
  };
}
