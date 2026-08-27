/**
 * ‎**תוכנית התשובה — הרכב וסדר אחד, שני מרנדרים.**
 *
 * הנחיית בעל המוצר: ליבת הסוכן אחידה, וכל שיפור מגיע לשני הערוצים
 * בלי לתחזק כפילות. עד עכשיו ההרכב של תשובת הפעולה — מה מופיע,
 * באיזה סדר, ומתי — נבנה פעמיים: שורות טקסט בוואטסאפ ו-JSX במסך,
 * ושערים מבניים רק **השוו** ביניהם (המשפט לפני הרשימה, `suggestion`
 * רק בהיעדר צעדים). השוואה תופסת סטייה אחרי שקרתה; מקור אחד מונע
 * אותה.
 *
 * הפונקציה מחזירה את מקטעי התשובה לפי הסדר, והערוץ מרנדר כל מקטע
 * בצורתו — טקסט או בועה. מה ש**אינו** כאן, בכוונה:
 *
 * - עיצוב הנתונים עצמם (`data`) — לכל ערוץ מנסח משלו (טקסט מול
 *   טבלה), ושניהם כבר יונקים מ-`result-lines` המשותף.
 * - מקטעים ערוציים טהורים — סייג הבעלות בוואטסאפ, נגן ההקלטה — הם
 *   רשאים להשתבץ בין המקטעים, אבל אינם חלק מההרכב המשותף.
 *
 * הסדר: המסקנה לפני הפירוט (עוזר פותח במסקנה; מערכת פותחת בטבלה),
 * הקישורים אחרי התוכן, והצעדים אחרונים — הם ההזמנה לתור הבא.
 * `suggestion` הוא רשת הביטחון המנוסחת ומופיע **רק** כשאין אף צעד
 * נגזר — שני המקורות יחד היו אותה עצה פעמיים בניסוחים שונים.
 */

export interface AgentReplyInput {
  message: string;
  insight?: string;
  data?: unknown;
  /** קישור פנימי — הערוץ מרכיב את המקור (origin) שלו */
  href?: string;
  /** קישור חיצוני (wa.me) — מוצג ואינו נשמר לזיכרון */
  link?: string;
  suggestion?: string;
  nextSteps?: readonly { text: string; label: string }[];
}

export type AgentReplySegment =
  | { kind: "headline"; text: string }
  | { kind: "insight"; text: string }
  | { kind: "data"; data: unknown }
  | { kind: "screen-link"; href: string }
  | { kind: "external-link"; url: string }
  | { kind: "steps"; steps: { text: string; label: string }[] }
  | { kind: "suggestion"; text: string };

export function agentReplySegments(result: AgentReplyInput): AgentReplySegment[] {
  const segments: AgentReplySegment[] = [];
  if (result.message !== "") segments.push({ kind: "headline", text: result.message });
  if (result.insight !== undefined && result.insight !== "") {
    segments.push({ kind: "insight", text: result.insight });
  }
  if (result.data !== undefined) segments.push({ kind: "data", data: result.data });
  if (result.href !== undefined) segments.push({ kind: "screen-link", href: result.href });
  if (result.link !== undefined) segments.push({ kind: "external-link", url: result.link });
  const steps = [...(result.nextSteps ?? [])];
  if (steps.length > 0) {
    segments.push({ kind: "steps", steps });
  } else if (result.suggestion !== undefined && result.suggestion !== "") {
    segments.push({ kind: "suggestion", text: result.suggestion });
  }
  return segments;
}
