import { BOARD_METRIC_LABELS, boardScore, type BoardCounts, type BoardGoal } from "./office-board.js";
import { jerusalemWallIsoToUtc, jerusalemWallParts } from "./israel-time.js";

/**
 * ‎**הסיכום החודשי של הסוכן — מה הוא עשה, ואיפה הוא עומד.**
 *
 * ## ‏מה כל סוכן מקבל, ומה לא
 *
 * ‏עמוד „המשרד שלנו” מנהלי בלבד (`users.manage`), וזו הפעם הראשונה
 * ‏שסוכן רואה משהו ממנו. ההכרעה של בעל המוצר היא **השורה שלו
 * ‏והמיקום שלו** — „3 מתוך 7” — ו**בלי המספרים של האחרים**.
 *
 * ‏זה נותן את התחושה התחרותית בלי לחשוף כמה כל אחד מכר, וזה גם מה
 * ‏שמתיישב עם הכלל שסוכן אינו רואה נתונים של סוכן אחר. „הדירוג
 * ‏המלא לכולם” היה הופך הודעה חודשית להשפלה פומבית של מי שאחרון.
 *
 * ## ‏למה חודש, ולמה רק הוא
 *
 * ‏בטבלה יש חודש, רבעון ושנה. שליחה על שלושתם פירושה שלוש הודעות
 * ‏באותה דקה בסוף דצמבר — כלומר רעש שמלמד להתעלם. החודש נבחר
 * ‏(הכרעת בעל המוצר) גם כי הוא התקופה שהיעדים במנטור מוגדרים לפיה,
 * ‏ולכן „הגעת ליעד” בהודעה מדבר על אותו יעד שהסוכן מכיר.
 */

/** ‏סוג ההתראה — מפתח אחד לכתיבה, לדדופ ולבדיקות. */
export const OFFICE_DIGEST_NOTIFICATION_TYPE = "office_digest";

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

/**
 * ‎**החודש שמסוכם הוא הקודם, לא הנוכחי.**
 *
 * ‏הסבב רץ בתחילת החודש החדש, ולכן „ספטמבר” נשלח באוקטובר: סיכום
 * ‏של חודש שעוד לא נגמר הוא מספר שישתנה, והודעה שמצהירה „עשית 3”
 * ‏ביום האחרון של החודש מזמינה את השאלה „ומה עם היום?”.
 *
 * ‏שעון ירושלים ולא UTC: „החודש שנגמר” נקבע לפי הלוח שהמתווך חי
 * ‏בו, ובראשון בחודש בשעה שתיים בלילה ההפרש הוא חודש שלם.
 */
export function digestMonthKey(now: Date): string {
  const { date } = jerusalemWallParts(now);
  const [year, month] = date.split("-").map(Number);
  if (year === undefined || month === undefined) throw new Error("תאריך לא תקין");
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/** ‏„ספטמבר 2026” — מה שנקרא בהודעה. */
export function digestMonthTitle(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const name = month === undefined ? undefined : MONTHS[month - 1];
  if (name === undefined || year === undefined) return monthKey;
  return `${name} ${year}`;
}

/** ‏מפתח הדדופ — התראה אחת לסוכן לחודש, גם אם הסבב רץ שוב. */
export function digestDedupeKey(monthKey: string, userId: string): string {
  return `${OFFICE_DIGEST_NOTIFICATION_TYPE}:${monthKey}:${userId}`;
}

/**
 * ‎**נקודת זמן בתוך החודש שמסוכם — נגזרת מהמפתח עצמו.**
 *
 * ## מה היה קודם, ולמה זה נשבר פעם בשנה
 *
 * ‏הקורא חישב „היום האחרון של החודש הקודם” ב-UTC, בעוד
 * ‏`digestMonthKey` עובד לפי שעון ירושלים. בשלוש השעות
 * ‏הראשונות של חודש ישראלי השניים חלוקים: ב-1.10 ב-00:30
 * ‏בירושלים (30.9 ב-21:30 UTC) המפתח אמר „ספטמבר” והעוגן נחת
 * ‏באוגוסט — כלומר מספרי אוגוסט תחת כותרת ספטמבר, ומפתח
 * ‏דדופ שנועל את הטעות לצמיתות (ביקורת Codex, P1).
 *
 * ## למה מהמפתח ולא מ-`now`
 *
 * ‏שני חישובים נפרדים מאותו רגע יכולים להיפרד; גזירה
 * ‏מהמחרוזת שכבר נקבעה אינה יכולה. הכותרת, מפתח הדדופ
 * ‏והנתונים מדברים מעכשיו על אותו חודש בהגדרה.
 *
 * ‏ה-15 בצהריים ולא הראשון או האחרון: נקודה בלב החודש
 * ‏רחוקה מכל גבול, ולכן אינה רגישה למעבר שעון קיץ\/חורף
 * ‏ולא לאורכו של חודש מסוים.
 */
export function digestMonthAnchor(monthKey: string): Date {
  return jerusalemWallIsoToUtc(`${monthKey}-15T12:00:00.000`);
}

export type DigestSkip = "no_whatsapp" | "opted_out";

export const DIGEST_SKIP_LABELS: Record<DigestSkip, string> = {
  no_whatsapp: "אין וואטסאפ מקושר",
  opted_out: "ביקש לא לקבל בוואטסאפ",
};

/**
 * ‎**האם יש בכלל מה לסכם — וזו שאלה אחת בלבד.**
 *
 * ‏„עשית 0 מכל דבר” אינה הודעה שמועילה למישהו, והיא הדבר
 * ‏היחיד שסוכן שהצטרף אתמול היה מקבל. זה גם אינו דיווח
 * ‏למנהל: הוא כבר כתוב בטבלה מולו.
 *
 * ## למה זה נפרד מ-`digestWhatsappSkip`
 *
 * ‏קודם שתי השאלות היו פונקציה אחת, וכיוון שהוויתור
 * ‏נבדק ראשון — סוכן שביקש לא לקבל בוואטסאפ איבד גם את
 * ‏ההתראה בפעמון (ביקורת Codex). המסך ותיעוד העמודה
 * ‏שניהם אומרים במפורש שהוויתור משתיק את הטלפון בלבד.
 * ‏שתי שאלות נפרדות אינן יכולות להיבלע זו בזו.
 */
export function digestSkipReason(input: { counts: BoardCounts }): "nothing_to_report" | null {
  return boardScore(input.counts) === 0 ? "nothing_to_report" : null;
}

/**
 * ‎**האם אפשר לדחוף את הסיכום לטלפון — וזה הכל.**
 *
 * ‏הסיכום עצמו כבר נכתב בהתראה; מה שנשאל כאן הוא אם
 * ‏לשלוח אותו גם בוואטסאפ.
 *
 * ‏שתי הסיבות **מדווחות למנהל** ואינן נבלעות: `no_whatsapp`
 * ‏הוא פער שהוא יכול לסגור, ו-`opted_out` מסביר למה אין טעם
 * ‏לנסות. שתיקה כאן היא בדיוק מה שהכלל „אין בליעת כישלון”
 * ‏קיים כדי למנוע.
 */
export function digestWhatsappSkip(input: {
  hasWhatsapp: boolean;
  optedOut: boolean;
}): DigestSkip | null {
  if (input.optedOut) return "opted_out";
  if (!input.hasWhatsapp) return "no_whatsapp";
  return null;
}

export interface DigestVars {
  name: string;
  monthKey: string;
  counts: BoardCounts;
  /** ‏מקומו בדירוג ומספר הסוכנים — „3 מתוך 7”. */
  rank: number;
  total: number;
  /** ‏היעד החודשי שלו, אם הוגדר לו אחד. */
  goal?: BoardGoal | undefined;
}

/**
 * ‏גוף ההודעה.
 *
 * ‎**רק המספרים שלו.** אין כאן שם של סוכן אחר ואין מספר של סוכן
 * ‏אחר — המיקום הוא המידע היחיד שמגיע מהשוואה, והוא אינו מסגיר
 * ‏כלום על מי שמעליו.
 */
export function officeDigestText(vars: DigestVars): string {
  const lines = [
    `${vars.name}, הנה הסיכום שלך ל${digestMonthTitle(vars.monthKey)}:`,
    "",
    `${BOARD_METRIC_LABELS.leads}: ${vars.counts.leads}`,
    `${BOARD_METRIC_LABELS.properties}: ${vars.counts.properties}`,
    `${BOARD_METRIC_LABELS.viewings}: ${vars.counts.viewings}`,
    `${BOARD_METRIC_LABELS.deals}: ${vars.counts.deals}`,
    "",
    `המקום שלך במשרד: ${vars.rank} מתוך ${vars.total}`,
  ];
  if (vars.goal !== undefined) {
    lines.push(
      vars.goal.actual >= vars.goal.target
        ? `והיעד שלך (${vars.goal.label}) הושג — ${vars.goal.actual} מתוך ${vars.goal.target}. כל הכבוד!`
        : `היעד שלך (${vars.goal.label}): ${vars.goal.actual} מתוך ${vars.goal.target}`,
    );
  }
  return lines.join("\n");
}

/** ‏כותרת ההתראה בפעמון — קצרה, כי היא נקראת ברשימה. */
export function officeDigestTitle(monthKey: string): string {
  return `הסיכום שלך ל${digestMonthTitle(monthKey)}`;
}

/**
 * ‎**מה המנהל רואה אחרי סבב — כולל מי לא קיבל ולמה.**
 *
 * ‏„נשלח ל-5 סוכנים” לבדו הוא דיווח חלקי שנשמע שלם.
 *
 * ‏הנוסח אומר **בוואטסאפ** ולא סתם „נשלח”: הסיכום עצמו
 * ‏מגיע לכל סוכן שהיתה לו פעילות — בפעמון, תמיד — ומה שנספר
 * ‏כאן הוא הדחיפה לטלפון בלבד. דיווח שאומר „לא קיבל” על מי
 * ‏שהסיכום שלו מחכה לו במערכת הוא דיווח שגוי.
 */
export function digestManagerSummary(
  sent: number,
  skipped: readonly { name: string; reason: DigestSkip }[],
): string {
  const head = `הסיכום החודשי נשלח בוואטסאפ ל-${sent} סוכנים.`;
  if (skipped.length === 0) return head;
  const detail = skipped
    .map((s) => `${s.name} — ${DIGEST_SKIP_LABELS[s.reason]}`)
    .join("; ");
  return `${head} לא נשלח ל-${skipped.length}: ${detail} (הסיכום עצמו מחכה להם בהתראות).`;
}

/** ‏כותרת ההתראה למנהל — קצרה, כי היא נקראת ברשימה. */
export function digestManagerTitle(monthKey: string): string {
  return `סיכום ${digestMonthTitle(monthKey)} יצא לסוכנים`;
}

/**
 * ‎**מפתח הדדופ של דיווח המנהל** — אחד למנהל לחודש.
 *
 * ‏מרחב שמות נפרד (`:manager:`) כדי שמנהל שהוא גם סוכן
 * ‏יקבל את שניהם: הסיכום שלו, והדיווח על הצוות. מפתח אחד
 * ‏לשניהם היה משאיר אותו עם הראשון שנכתב בלבד.
 */
export function digestManagerDedupeKey(monthKey: string, userId: string): string {
  return `${OFFICE_DIGEST_NOTIFICATION_TYPE}:manager:${monthKey}:${userId}`;
}

/**
 * ‎**הערכים שהתבנית המאושרת מקבלת.**
 *
 * ‏טקסט חופשי עובד רק בתוך חלון 24 השעות של Meta, וסיכום
 * ‏חודשי הוא פנייה יזומה מובהקת — לכן התבנית היא מה שמגיע
 * ‏לרוב הסוכנים בפועל. הערכים מוגדרים כאן, לצד הטקסט החופשי,
 * ‏כדי ששני הנוסחים לא יוכלו לספר שני דברים שונים.
 */
export function officeDigestTemplateValues(
  vars: DigestVars,
): readonly [string, string, string] {
  return [
    vars.name,
    digestMonthTitle(vars.monthKey),
    `${vars.rank} מתוך ${vars.total}`,
  ];
}
