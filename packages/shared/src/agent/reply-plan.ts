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
  /**
   * קישור חיצוני מוחלט — מוצג ואינו נשמר לזיכרון.
   *
   * ‎**לא רק wa.me.** ההערה כאן אמרה „(wa.me)”, והרינדור במסך
   * הצמיד ללא תנאי את התווית „פתיחה בוואטסאפ” — כלומר טופס קליטה
   * פתוח, שאין לו נמען בוואטסאפ כלל, היה מוצג כפעולת וואטסאפ
   * ‏(ביקורת Codex). התווית נגזרת עכשיו מהכתובת ב-`externalLinkLabel`.
   */
  link?: string;
  suggestion?: string;
  nextSteps?: readonly { text: string; label: string }[];
}

export type AgentReplySegment =
  | { kind: "headline"; text: string }
  | { kind: "insight"; text: string }
  | { kind: "data"; data: unknown }
  | { kind: "screen-link"; href: string }
  | { kind: "external-link"; url: string; label: string }
  | { kind: "steps"; steps: { text: string; label: string }[] }
  | { kind: "suggestion"; text: string };

/**
 * ‎**מה כתוב על הקישור** — נגזר מהכתובת, ולא קבוע במסך.
 *
 * ‏שני הערוצים מציגים את אותו `link`, ולכן התווית חייבת להיות אותה
 * ‏תווית. כשהיא ישבה במסך כמחרוזת קבועה, „פתיחה בוואטסאפ” נדבקה גם
 * ‏לקישורים שאינם וואטסאפ — ומי שביקש טופס ללקוח חדש קיבל כפתור
 * ‏שמבטיח וואטסאפ ופותח טופס.
 *
 * ‏הזיהוי לפי המארח ולא לפי „מכיל wa.me”: כתובת שכל מטרתה להיראות
 * ‏כמו וואטסאפ אינה הופכת לכזו. כתובת שאינה נפרסת אינה מסווגת.
 */
export function externalLinkLabel(url: string): string {
  /*
   * ‏פירוק ידני ולא `URL`: החבילה המשותפת רצה גם בדפדפן וגם בשרת,
   * ‏ואינה מצהירה על ספריות סביבה. הרכיבים כאן הם בדיוק אלה שקובעים
   * ‏לאן הדפדפן ילך — מה שאחרי ה-`@` האחרון ולפני הנקודתיים.
   */
  const authority = /^https?:\/\/([^/?#]*)/iu.exec(url)?.[1];
  if (authority === undefined || authority === "") return "פתיחת הקישור";
  const host = authority
    .slice(authority.lastIndexOf("@") + 1)
    .split(":")[0]!
    .toLowerCase();
  if (host === "wa.me" || host === "api.whatsapp.com" || host.endsWith(".whatsapp.com")) {
    return "פתיחה בוואטסאפ";
  }
  return "פתיחת הקישור";
}

export function agentReplySegments(result: AgentReplyInput): AgentReplySegment[] {
  const segments: AgentReplySegment[] = [];
  if (result.message !== "") segments.push({ kind: "headline", text: result.message });
  if (result.insight !== undefined && result.insight !== "") {
    segments.push({ kind: "insight", text: result.insight });
  }
  if (result.data !== undefined) segments.push({ kind: "data", data: result.data });
  if (result.href !== undefined) segments.push({ kind: "screen-link", href: result.href });
  if (result.link !== undefined) {
    segments.push({
      kind: "external-link",
      url: result.link,
      label: externalLinkLabel(result.link),
    });
  }
  const steps = [...(result.nextSteps ?? [])];
  if (steps.length > 0) {
    segments.push({ kind: "steps", steps });
  } else if (result.suggestion !== undefined && result.suggestion !== "") {
    segments.push({ kind: "suggestion", text: result.suggestion });
  }
  return segments;
}
