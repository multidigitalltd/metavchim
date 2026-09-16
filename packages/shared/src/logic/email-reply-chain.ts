import { inboundDestination } from "./support-routing.js";
import { inboundToken, replyAddressFor } from "./email-inbound.js";

/**
 * ‎**„למה התשובה של הלקוח הגיעה לתמיכה?” — בדיקה שעונה על זה.**
 *
 * ## מה נשבר, ולמה אי אפשר לראות את זה
 *
 * ‏מייל שיוצא ללקוח נושא `Reply-To` בצורת `local+<ULID>@inbound…`.
 * ‏הלקוח משיב, הספק מוסר לנו את חלק ה-Plus כ-`MailboxHash`, והטוקן
 * ‏מזהה את המשרד ואת הלקוח. כשמשהו בשרשרת הזו נקטע — התשובה נופלת
 * ‏ל-`support_new`, כלומר **פנייה חדשה לתמיכה**, וזה בדיוק אותו מסך
 * ‏שבו נוחת גם מי שכותב אלינו לראשונה. אין שורת יומן שאומרת „הייתה
 * ‏כאן תשובה של לקוח ולא זיהינו אותה”; היא פשוט נראית כמו פנייה.
 *
 * ‏שלוש נקודות קטיעה, וכולן שקטות:
 *
 * | מה קורה | מה רואים |
 * |---|---|
 * | אין כתובת/סוד קליטה ⇒ `replyAddressFor` מחזיר `null` | מייל יוצא בלי `Reply-To` |
 * | החלק שלפני ה-@ ארוך מ-37 ⇒ חריגה מ-64 תווים | מייל יוצא בלי `Reply-To` |
 * | החלק שלפני ה-@ כבר מכיל `+` | הטוקן חוזר מעוות ואינו מזוהה |
 *
 * ‎**המקרה השלישי הוא הסיבה שהבדיקה אינה טאוטולוגיה.** כתובת כמו
 * ‏`reply+office@inbound…` נראית תקינה לגמרי, `replyAddressFor`
 * ‏מקבל אותה ומייצר `reply+office+<ULID>@…`, והספק מוסר
 * ‏`MailboxHash = "office+<ULID>"` — שאינו ULID, ולכן כל תשובה של
 * ‏כל לקוח בכל המשרדים נוחתת בתמיכה. שום שדה בהגדרות אינו נראה
 * ‏שגוי. רק הרצת המסלול מקצה לקצה מגלה את זה.
 *
 * ‏לכן הבדיקה כאן **מריצה את הכתובת האמיתית דרך אותן פונקציות**
 * ‏שרצות בשליחה ובקליטה, ומפרקת את התוצאה כפי שהספק מפרק אותה —
 * ‏פיצול על ה-`+` הראשון. היא אינה שואלת „האם השדה מלא”.
 */

/**
 * ‏טוקן לדוגמה — ULID תקין בן 26 תווים, כמו כל טוקן אמיתי.
 *
 * ‏קבוע ולא אקראי: בדיקה שתוצאתה משתנה בין הרצה להרצה אינה בדיקה,
 * ‏והאורך הוא כל מה שמשנה כאן (הוא זה שמכריע את גבול 64 התווים).
 */
export const REPLY_CHAIN_SAMPLE_TOKEN = "01JQZX4K7M8N9P0Q1R2S3T4V5W";

/** האורך המרבי של החלק שלפני ה-@, כדי שכתובת תשובה עדיין תיבנה. */
export const REPLY_LOCAL_MAX = 64 - 1 - REPLY_CHAIN_SAMPLE_TOKEN.length;

export type ReplyChainStepId = "address" | "reply_to" | "mailbox_hash" | "routing";

export interface ReplyChainStep {
  id: ReplyChainStepId;
  ok: boolean;
  /** מה נבדק, בשפה של מי שמגדיר את המערכת. */
  title: string;
  /** ‏מה **נמצא בפועל** — ערך, לא „תקין”. */
  detail: string;
  /** ‏מה לעשות. קיים רק כשהשלב נכשל. */
  fix?: string;
}

export interface ReplyChainResult {
  ok: boolean;
  steps: ReplyChainStep[];
  /** כתובת התשובה שנבנתה בפועל לטוקן הדוגמה — `null` אם לא נבנתה. */
  sampleReplyTo: string | null;
}

/**
 * ‏פירוק הכתובת כפי ש**הספק** מפרק אותה: הכל אחרי ה-`+` הראשון הוא
 * ‏`MailboxHash`. זה החלק שהופך את הבדיקה לאמיתית — קוד שיפצל על
 * ‏ה-`+` האחרון היה מסתיר בדיוק את התקלה שהוא בא למצוא.
 */
function mailboxHashOf(address: string): string {
  const at = address.indexOf("@");
  const local = at < 0 ? address : address.slice(0, at);
  const plus = local.indexOf("+");
  return plus < 0 ? "" : local.slice(plus + 1);
}

/**
 * ‏מריץ את שרשרת התשובה מקצה לקצה על הכתובת שמוגדרת בפועל.
 *
 * ‎`inboundAddress` — `null` כשאין הגדרה (כתובת או סוד חסרים).
 */
export function checkReplyChain(inboundAddress: string | null): ReplyChainResult {
  const steps: ReplyChainStep[] = [];

  if (inboundAddress === null || inboundAddress.trim() === "") {
    steps.push({
      id: "address",
      ok: false,
      title: "כתובת הקליטה והסוד",
      detail: "לא מוגדרים",
      fix: "מלאו „כתובת קליטה לדואר נכנס” ואת הסוד שלה בהגדרות הפלטפורמה. בלעדיהם כל מייל יוצא בלי כתובת תשובה, והתשובה חוזרת לכתובת השולח — כלומר לתמיכה.",
    });
    return { ok: false, steps, sampleReplyTo: null };
  }

  const address = inboundAddress.trim();
  const at = address.indexOf("@");
  const local = at <= 0 ? "" : address.slice(0, at);
  steps.push({
    id: "address",
    ok: true,
    title: "כתובת הקליטה והסוד",
    detail: address,
  });

  const replyTo = replyAddressFor(address, REPLY_CHAIN_SAMPLE_TOKEN);
  if (replyTo === null) {
    steps.push({
      id: "reply_to",
      ok: false,
      title: "בניית כתובת התשובה",
      detail:
        at <= 0 || at === address.length - 1
          ? "הכתובת אינה בצורת שם@דומיין"
          : `החלק שלפני ה-@ הוא ${local.length} תווים; עם טוקן בן ${REPLY_CHAIN_SAMPLE_TOKEN.length} הוא חורג מ-64`,
      fix:
        at <= 0 || at === address.length - 1
          ? "תקנו את כתובת הקליטה בהגדרות הפלטפורמה."
          : `קצרו את החלק שלפני ה-@ ל-${REPLY_LOCAL_MAX} תווים לכל היותר. מעבר לזה לא נוספת כתובת תשובה כלל, והמייל יוצא בשקט בלעדיה.`,
    });
    return { ok: false, steps, sampleReplyTo: null };
  }
  steps.push({
    id: "reply_to",
    ok: true,
    title: "בניית כתובת התשובה",
    detail: replyTo,
  });

  /*
   * ‏וכאן הבדיקה שאי אפשר לעשות במבט בהגדרות: מה הספק יחזיר לנו,
   * ‏והאם נזהה את זה. כתובת עם `+` בחלק המקומי עוברת את השלב הקודם
   * ‏ונופלת כאן — וזה בדיוק המצב שבו „הכל מוגדר” ושום תשובה לא
   * ‏מגיעה.
   */
  const hash = mailboxHashOf(replyTo);
  const parsed = inboundToken({
    MailboxHash: hash,
    From: "",
    FromName: "",
    Subject: "",
    StrippedTextReply: "",
    TextBody: "",
    MessageID: "",
    Headers: [],
    Attachments: [],
  });
  if (parsed !== REPLY_CHAIN_SAMPLE_TOKEN) {
    steps.push({
      id: "mailbox_hash",
      ok: false,
      title: "זיהוי הטוקן בתשובה החוזרת",
      /*
       * ‏ערך מול ערך, בלי פרוזה עברית ביניהם. משפט מעורב עברית-לטינית
       * ‏שנושא טוקן נשבר בתצוגה דו-כיוונית — הגרשיים והמספרים קופצים
       * ‏למקום אחר — ואז מי שבא להשוות מול הספק משווה מחרוזת אחרת.
       * ‏ההסבר בעברית יושב ב-`fix`, שם אין ערכים.
       */
      detail: `${hash} ≠ ${REPLY_CHAIN_SAMPLE_TOKEN}`,
      fix: local.includes("+")
        ? "כתובת הקליטה מכילה „+” בחלק שלפני ה-@. הספק מוסר את כל מה שאחרי ה-„+” הראשון, ולכן הטוקן חוזר מעוות וכל תשובה נופלת לתמיכה. השתמשו בכתובת בלי „+”."
        : "הטוקן החוזר אינו זהה לזה שנשלח. בדקו שהספק מוסר את חלק ה-Plus כפי שהוא, באותיות גדולות.",
    });
    return { ok: false, steps, sampleReplyTo: replyTo };
  }
  steps.push({
    id: "mailbox_hash",
    ok: true,
    title: "זיהוי הטוקן בתשובה החוזרת",
    detail: hash,
  });

  /*
   * ‏השלב האחרון הוא הכלל עצמו, ולא הגדרה: טוקן שמוכר כתשובת לקוח
   * ‏חייב להגיע לתיבת המשרד. הוא נבדק כאן ולא נלקח כמובן מאליו, כי
   * ‏הוא המשמעות של כל השלבים שמעליו.
   */
  const destination = inboundDestination({ supportThread: false, tenantToken: true });
  const routed = destination.kind === "tenant_reply";
  steps.push({
    id: "routing",
    ok: routed,
    title: "ניתוב התשובה",
    detail: routed ? "לתיבת המשרד" : `ל-${destination.kind}`,
    ...(routed ? {} : { fix: "כלל הניתוב השתנה — זו תקלת תוכנה ולא הגדרה." }),
  });

  return { ok: routed, steps, sampleReplyTo: replyTo };
}

/**
 * ‏מה המצב אומר — משפט אחד, ובמקום אחד.
 *
 * ‏שני הכשלים נראים זהה במסך התמיכה (פנייה חדשה) ודורשים פעולה
 * ‏הפוכה לגמרי, ולכן ההבחנה ביניהם אינה יכולה לחיות במסך:
 *
 * - ‎**אפס טוקנים** — שום מייל לא יצא עם כתובת תשובה. אין מה לתקן
 *   בקליטה; הבעיה היא שהשליחה לא מצרפת `Reply-To`.
 * - ‎**יש טוקנים והשרשרת שבורה** — המיילים כן נושאים כתובת תשובה,
 *   ומה שנשבר הוא הדרך חזרה.
 */
export function replyChainVerdict(input: { chainOk: boolean; tokensIssued: number }): string {
  if (!input.chainOk) {
    return input.tokensIssued === 0
      ? "השרשרת שבורה, וגם לא יצא מעולם מייל עם כתובת תשובה. תקנו את מה שמסומן למטה — עד אז כל תשובה של לקוח תיפתח כפנייה חדשה בתמיכה."
      : "המיילים יוצאים עם כתובת תשובה, אבל הדרך חזרה שבורה. כל תשובה של לקוח נפתחת כפנייה חדשה בתמיכה — ראו את השלב המסומן למטה.";
  }
  return input.tokensIssued === 0
    ? "השרשרת תקינה, אבל עוד לא יצא אף מייל עם כתובת תשובה. שלחו הצעה או הסכם ללקוח, ואז בדקו שוב."
    : "השרשרת תקינה: תשובה של לקוח על מייל שיצא מהמערכת מגיעה לתיבת המשרד ולא לתמיכה.";
}
