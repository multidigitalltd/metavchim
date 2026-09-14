import { BOARD_METRIC_LABELS, boardScore, type BoardCounts, type BoardGoal } from "./office-board.js";
import { jerusalemWallParts } from "./israel-time.js";

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

export type DigestSkip = "no_whatsapp" | "opted_out" | "nothing_to_report";

export const DIGEST_SKIP_LABELS: Record<DigestSkip, string> = {
  no_whatsapp: "אין וואטסאפ מקושר",
  opted_out: "ביקש לא לקבל",
  nothing_to_report: "לא הייתה פעילות בחודש",
};

/**
 * ‎**למה סוכן אינו מקבל — ושלוש הסיבות אינן שוות.**
 *
 * ‎`opted_out` היא בחירה שלו, ו-`no_whatsapp` היא פער שהמנהל יכול
 * ‏לסגור — ולכן שתיהן **מדווחות למנהל** ולא נבלעות. שתיקה כאן היא
 * ‏בדיוק מה שהכלל „אין בליעת כישלון” קיים כדי למנוע: מנהל שחושב
 * ‏שכולם קיבלו, ושבעה סוכנים שלא.
 *
 * ‎`nothing_to_report` אינה תקלה: „עשית 0 מכל דבר” אינה הודעה
 * ‏שמועילה למישהו, והיא הדבר היחיד שסוכן חדש שהצטרף אתמול היה
 * ‏מקבל.
 */
export function digestSkipReason(input: {
  hasWhatsapp: boolean;
  optedOut: boolean;
  counts: BoardCounts;
}): DigestSkip | null {
  if (input.optedOut) return "opted_out";
  if (!input.hasWhatsapp) return "no_whatsapp";
  if (boardScore(input.counts) === 0) return "nothing_to_report";
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
 * ‏מה המנהל רואה אחרי סבב — **כולל מי לא קיבל ולמה**.
 *
 * ‏„נשלח ל-5 סוכנים” לבדו הוא דיווח חלקי שנשמע שלם.
 */
export function digestManagerSummary(
  sent: number,
  skipped: readonly { name: string; reason: DigestSkip }[],
): string {
  const head = `הסיכום החודשי נשלח ל-${sent} סוכנים.`;
  if (skipped.length === 0) return head;
  const detail = skipped
    .map((s) => `${s.name} — ${DIGEST_SKIP_LABELS[s.reason]}`)
    .join("; ");
  return `${head} לא נשלח ל-${skipped.length}: ${detail}`;
}
