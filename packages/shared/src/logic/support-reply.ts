import type { EmailContent } from "./email-template.js";
import { formatSupportReference } from "./support-routing.js";
import { SUPPORT_KIND_LABEL, type SupportKind } from "./support.js";

/**
 * ‎**תשובת התמיכה נושאת איתה את השאלה.**
 *
 * ## מה היה שבור
 *
 * פנייה שנפתחה מכפתור התמיכה קיבלה מייל בנוסח קבוע — „תשובה לפנייה
 * שלך לתמיכה” — ובגוף רק מה שהתומך הקליד. הנמען פנה לפני שבוע, קיבל
 * פסקה יחפה, ואין בהודעה דבר שיזכיר לו על מה מדובר: לא מספר הפנייה,
 * לא מה הוא שאל, ולא באיזה מסך זה קרה.
 *
 * זה גם מה שהפך את המייל לחסר ערך כארכיון. הוא מגיע לתיבה של המשרד,
 * נשאר שם, ובעוד חודש איש אינו יודע למה הוא מתייחס.
 *
 * ## מה שנעשה כאן
 *
 * הבנייה יושבת בלוגיקה משותפת ולא בשירות, כי היא הכרעה על **נוסח**:
 * מה נכנס לנושא, מה מצוטט, ובאיזה סדר. זה נבדק בלי מסד נתונים ובלי
 * ספק דואר, וזה מה שמאפשר לנעול אותו — נוסח שנשבר בשקט הוא בדיוק
 * סוג התקלה שאיש אינו מדווח עליה, כי מי שקיבל אותה אינו יודע שהיה
 * אמור לקבל משהו אחר.
 *
 * שני מקורות הפניות משתמשים באותה פונקציה: פנייה שהגיעה במייל ופנייה
 * שנפתחה מהכפתור מקבלות תשובה בעלת אותה צורה. השוני היחיד הוא מה
 * שידוע — לפנייה מהכפתור יש סוג ומסך, ולשרשור מייל יש נושא.
 */

/** מה שידוע על הפנייה שעליה עונים. */
export interface SupportReplyContext {
  /** מספר הפנייה — אותו רצף לשני המקורות. */
  reference: number;
  /** מה שהפונה כתב במקור. */
  original: string;
  /** מתי נפתחה — כדי ש„הפנייה שלך” תדע להצביע על מתי. */
  openedAt: Date;
  /** נושא הפנייה, כשיש. לפנייה מהכפתור אין. */
  subject?: string | undefined;
  /** סוג הפנייה, לפניות מהכפתור. */
  kind?: SupportKind | undefined;
  /** המסך שממנו נפתחה, לפניות מהכפתור. */
  screen?: string | undefined;
}

/**
 * הנושא. **מספר הפנייה ראשון** ולא בסוף: הוא מה שמאפשר לחפש בתיבה,
 * והוא נחתך בתצוגה המקדימה של הנייד אם הוא יושב אחרי הכותרת.
 */
export function supportReplySubject(context: SupportReplyContext): string {
  const tag = `[${formatSupportReference(context.reference)}]`;
  const subject = (context.subject ?? "").trim();
  const head = subject === "" ? "תשובה מהתמיכה" : subject.replace(/^re:\s*/iu, "");
  return `${tag} Re: ${head}`.slice(0, 200);
}

/** תאריך קצר בעברית — „12 במרץ 2026”. */
function hebrewDate(at: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(at);
}

/** הגבול על הציטוט — פנייה ארוכה אינה קוברת את התשובה. */
export const SUPPORT_QUOTE_MAX = 1200;

/**
 * גוף התשובה.
 *
 * ‎`body` הוא מה שהתומך כתב. שורות ריקות נשמטות כי `paragraphs` הוא
 * רשימת פסקאות ולא טקסט חופשי, ופסקה ריקה מרנדרת `<p></p>` — רווח
 * שנראה כתקלה.
 */
export function supportReplyEmail(input: {
  body: string;
  context: SupportReplyContext;
  /** קישור לפנייה במערכת, כשיש לאן. */
  href?: string | undefined;
}): EmailContent {
  const { context } = input;
  const paragraphs = input.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const meta: string[] = [`פנייה ${formatSupportReference(context.reference)}`];
  if (context.kind !== undefined) meta.push(SUPPORT_KIND_LABEL[context.kind]);
  if (context.screen !== undefined && context.screen.trim() !== "") {
    meta.push(`מסך: ${context.screen.trim()}`);
  }

  /*
   * הציטוט נחתך ולא מושמט. פנייה של אלפי תווים היא נדירה, אבל
   * כשהיא קורית — תשובה שקבורה מתחתיה גרועה מציטוט חלקי, ושלוש
   * הנקודות אומרות במפורש שיש עוד.
   */
  const original = context.original.trim();
  const quoted =
    original.length > SUPPORT_QUOTE_MAX
      ? `${original.slice(0, SUPPORT_QUOTE_MAX)}…`
      : original;

  return {
    heading: "תשובה מהתמיכה",
    paragraphs: paragraphs.length > 0 ? paragraphs : ["מצורף:"],
    ...(input.href !== undefined ? { button: { label: "לפנייה במערכת", url: input.href } } : {}),
    ...(quoted === ""
      ? {}
      : {
          quote: {
            title: `הפנייה שלך מ-${hebrewDate(context.openedAt)}`,
            meta,
            body: quoted,
          },
        }),
    /*
     * ‎**„אפשר להשיב” ולא „אין צורך להשיב”.** התשובה יוצאת עם
     * ‎`Reply-To` שחוזר לאותה פנייה, וזו כל הנקודה — הערת שוליים
     * שאומרת את ההפך מכבה בדיוק את מה שנבנה.
     */
    footnote: `אפשר להשיב על המייל הזה והתשובה תיכנס לאותה פנייה (${formatSupportReference(context.reference)}).`,
  };
}
