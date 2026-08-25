import { toCsv } from "./csv-export.js";
import { formatJerusalemDate, formatJerusalemTime } from "./israel-time.js";

/**
 * דוח פעילות לבעל הנכס — מה נעשה כדי לשווק את הנכס שלו.
 *
 * המסמך הזה יוצא מהמשרד אל אדם שאינו משתמש במערכת, ולעתים ממנו
 * הלאה — לבן משפחה, לעורך דין, לקבוצת ווטסאפ. מכאן נגזר הכלל
 * היחיד: **הוא מתאר פעולות, לא אנשים.** מי בא לראות את הדירה, מה
 * מספר הטלפון שלו ומה נאמר בשיחה אינם עניינו של בעל הנכס.
 *
 * האכיפה היא **במבנה ולא בזהירות**: שורות הקלט כאן מקבלות תאריך,
 * סוג ותוצאה בלבד. אין שדה שאפשר לשכוח לנקות, כי אין שדה שיכול
 * להכיל שם — גם אם מחר מישהו יוסיף עמודה לשאילתה שמזינה אותן.
 * זה אותו עיקרון של `describeProviderResponse`.
 */

/* ---------- הקלט: מה שמותר לשאילתה להביא ---------- */

/**
 * פגישה או ביקור בנכס.
 *
 * ‎`title` ו-`notes` של הפגישה **אינם כאן במכוון**: הכותרת נכתבת
 * חופשית ומכילה כמעט תמיד את שם הלקוח ("ביקור — משפחת כהן"),
 * וההערות הן יומן פנימי של הסוכן.
 */
export interface OwnerAppointmentRow {
  /** viewing | meeting | call */
  kind: string;
  startsAt: Date;
  /** scheduled | completed | cancelled | no_show */
  status: string;
  /** liked | not_fit | negotiating | needs_other */
  outcome: string | null;
}

/**
 * שיחת טלפון שקשורה לנכס.
 *
 * בלי `summary` ובלי תמלול: הסיכום האוטומטי מכיל את תוכן השיחה על
 * כל מה שנאמר בה, ובכלל זה מה הקונה מוכן לשלם — בדיוק המידע שאסור
 * שיגיע לצד השני של המשא ומתן.
 */
export interface OwnerCallRow {
  /** inbound | outbound */
  direction: string;
  occurredAt: Date;
  /** answered | missed | no_answer | voicemail */
  outcome: string;
  durationMinutes: number | null;
}

/* ---------- הפלט: רשומה אחת בדוח ---------- */

export type OwnerActivityKind =
  | "viewing"
  | "meeting"
  | "phone_meeting"
  | "inquiry"
  | "callback";

export type OwnerActivityResult =
  | "scheduled"
  | "held"
  | "cancelled"
  | "no_show"
  | "liked"
  | "not_fit"
  | "negotiating"
  | "needs_other"
  | "answered"
  | "unanswered"
  | "voicemail"
  /*
   * ‎**שיחה שהמרכזייה לא מסרה עליה אם נענתה.**
   *
   * בלי הערך הזה השיחה נושרת מהדוח כולו: המיפוי מדלג על תוצאה שאינה
   * מוכרת, ולכן שיחה שקרתה באמת נעלמת מהטבלה, מהייצוא, מהסיכומים
   * ומחישוב „פעילות אחרונה” (ביקורת Codex). לבעל הנכס זו פגיעה
   * כפולה — גם הפעילות נעלמת וגם הדוח מציג פחות ממה שנעשה עבורו.
   */
  | "unknown";

export interface OwnerActivityEntry {
  at: Date;
  kind: OwnerActivityKind;
  result: OwnerActivityResult;
  /** דקות — רק לשיחה שנענתה ונמדדה. */
  durationMinutes?: number;
}

export const OWNER_ACTIVITY_KIND_LABELS: Record<OwnerActivityKind, string> = {
  viewing: "ביקור בנכס",
  meeting: "פגישה",
  phone_meeting: "שיחה מתואמת",
  inquiry: "פניית מתעניין",
  callback: "חזרה למתעניין",
};

export const OWNER_ACTIVITY_RESULT_LABELS: Record<OwnerActivityResult, string> = {
  scheduled: "נקבע",
  held: "התקיים",
  cancelled: "בוטל",
  no_show: "הלקוח לא הגיע",
  liked: "הלקוח אהב",
  not_fit: "לא התאים ללקוח",
  negotiating: "במשא ומתן",
  needs_other: "הלקוח מחפש משהו אחר",
  answered: "נענתה",
  unanswered: "לא נענתה",
  /* לבעל הנכס: התקשרו, ואיננו יודעים אם נענה. עדיף על טענה שגויה */
  unknown: "לא ידוע אם נענתה",
  voicemail: "הועברה לתא קולי",
};

/** הסוגים שמתארים מפגש — להבדיל משיחת טלפון. */
const MEETING_KINDS: readonly OwnerActivityKind[] = ["viewing", "meeting", "phone_meeting"];

/** תוצאות שמשמעותן "המפגש התקיים בפועל". */
const HELD_RESULTS: readonly OwnerActivityResult[] = [
  "held",
  "liked",
  "not_fit",
  "negotiating",
  "needs_other",
];

/* ---------- התרגום ---------- */

const APPOINTMENT_KINDS: Record<string, OwnerActivityKind> = {
  viewing: "viewing",
  meeting: "meeting",
  call: "phone_meeting",
};

const APPOINTMENT_OUTCOMES: Record<string, OwnerActivityResult> = {
  liked: "liked",
  not_fit: "not_fit",
  negotiating: "negotiating",
  needs_other: "needs_other",
};

/**
 * ‎`missed` ו-`no_answer` מתמזגים ל"לא נענתה" **במכוון**: ההבדל
 * ביניהם הוא היכן במרכזייה נפלה השיחה, וזה ז'רגון פנימי. לבעל
 * הנכס יש עובדה אחת — מישהו התקשר ולא נענה.
 */
const CALL_OUTCOMES: Record<string, OwnerActivityResult> = {
  answered: "answered",
  missed: "unanswered",
  no_answer: "unanswered",
  voicemail: "voicemail",
  unknown: "unknown",
};

function appointmentResult(row: OwnerAppointmentRow): OwnerActivityResult {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "no_show") return "no_show";
  if (row.status === "completed") {
    return (row.outcome === null ? undefined : APPOINTMENT_OUTCOMES[row.outcome]) ?? "held";
  }
  /*
   * ‎"נקבע" הוא גם ברירת המחדל לסטטוס שאיננו מכירים. הוא הטענה
   * החלשה ביותר שאפשר לומר על פגישה — היא נקבעה — ולכן סטטוס חדש
   * שיתווסף בעתיד ייראה בדוח כמעט-נכון במקום להמציא "התקיים".
   */
  return "scheduled";
}

/**
 * בניית הדוח משתי הרשימות, ממוין מהחדש לישן.
 *
 * שורה שסוגה אינו מוכר **נופלת** ואינה מגיעה לדוח: מוטב שיחסר
 * ממנו פריט מאשר שיוצג לבעל הנכס פריט שאיננו יודעים לתאר.
 */
export function buildOwnerActivity(input: {
  appointments: readonly OwnerAppointmentRow[];
  calls: readonly OwnerCallRow[];
}): OwnerActivityEntry[] {
  const entries: OwnerActivityEntry[] = [];

  for (const row of input.appointments) {
    const kind = APPOINTMENT_KINDS[row.kind];
    if (kind === undefined) continue;
    entries.push({ at: row.startsAt, kind, result: appointmentResult(row) });
  }

  for (const row of input.calls) {
    const result = CALL_OUTCOMES[row.outcome];
    if (result === undefined) continue;
    const kind: OwnerActivityKind = row.direction === "outbound" ? "callback" : "inquiry";
    entries.push({
      at: row.occurredAt,
      kind,
      result,
      // משך מוצג רק לשיחה שנענתה — "0 דקות" על שיחה שלא נענתה הוא רעש
      ...(result === "answered" && row.durationMinutes !== null && row.durationMinutes > 0
        ? { durationMinutes: row.durationMinutes }
        : {}),
    });
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/* ---------- התקציר ---------- */

export interface OwnerActivitySummary {
  total: number;
  /** מפגשים שהתקיימו בפועל */
  held: number;
  /** מפגשים שנקבעו ומועדם עוד לא הגיע */
  upcoming: number;
  /** פניות של מתעניינים */
  inquiries: number;
  /** מועד הפעילות האחרונה שנרשמה */
  lastAt?: Date;
}

/**
 * ‎`now` מתקבל במפורש ואינו נקרא מבפנים — "עוד לא התקיים" הוא
 * הכרעה מול רגע, ובדיקה שאינה יכולה לקבוע את הרגע אינה בדיקה.
 */
export function summarizeOwnerActivity(
  entries: readonly OwnerActivityEntry[],
  now: Date,
): OwnerActivitySummary {
  let held = 0;
  let upcoming = 0;
  let inquiries = 0;
  let lastAt: Date | undefined;

  for (const entry of entries) {
    const isMeeting = MEETING_KINDS.includes(entry.kind);
    if (isMeeting && HELD_RESULTS.includes(entry.result)) held += 1;
    if (isMeeting && entry.result === "scheduled" && entry.at.getTime() > now.getTime()) {
      upcoming += 1;
    }
    if (entry.kind === "inquiry") inquiries += 1;
    if (lastAt === undefined || entry.at.getTime() > lastAt.getTime()) lastAt = entry.at;
  }

  return { total: entries.length, held, upcoming, inquiries, ...(lastAt ? { lastAt } : {}) };
}

/* ---------- הקובץ ---------- */

export const OWNER_ACTIVITY_CSV_HEADERS = ["תאריך", "שעה", "פעולה", "תוצאה", "משך (דקות)"];

/** הנוסח שמסמן קובץ חלקי — במקום אחד, כי מבחן מצביע עליו. */
export const OWNER_ACTIVITY_TRUNCATED_NOTE =
  "הדוח חלקי — הוצגו הפעולות האחרונות בלבד. לתקופה ארוכה יש לייצא בטווחים קצרים יותר.";

/**
 * CSV לבעל הנכס — אותן עמודות בדיוק שמוצגות במסך, בלי שדה נוסף.
 *
 * ‎`truncated` נכתב **לתוך הקובץ** ולא רק מוצג במסך: הקובץ הוא מה
 * שנשלח לבעל הנכס, והאזהרה שנשארת במערכת אינה נוסעת איתו. קובץ
 * שנראה שלם ואינו שלם הוא בדיוק השקר שהדוח הזה נועד לא לספר
 * (ביקורת Codex).
 */
export function ownerActivityCsv(
  entries: readonly OwnerActivityEntry[],
  options: { truncated?: boolean } = {},
): string {
  const rows: (string | number | undefined)[][] = entries.map((entry) => [
    formatJerusalemDate(entry.at),
    formatJerusalemTime(entry.at),
    OWNER_ACTIVITY_KIND_LABELS[entry.kind],
    OWNER_ACTIVITY_RESULT_LABELS[entry.result],
    entry.durationMinutes,
  ]);
  if (options.truncated === true) {
    rows.push([OWNER_ACTIVITY_TRUNCATED_NOTE, undefined, undefined, undefined, undefined]);
  }
  return toCsv(OWNER_ACTIVITY_CSV_HEADERS, rows);
}

/** מפרידי נתיב ותווים האסורים בשם קובץ; תווי בקרה נסרקים לפי קוד ולא בביטוי רגיל. */
const FORBIDDEN = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\u007f"]);

/**
 * שם הקובץ שיישמר אצל המתווך — "פעילות - רבי עקיבא 12.csv".
 *
 * מנוקה ולא מאומת: הכתובת מגיעה מקלט חופשי, ותו נתיב או תו בקרה
 * בתוך שם הורדה הוא בדיוק מה שהופך שם קובץ לכלי. מה שנשאר אחרי
 * הניקוי הוא טקסט להצגה בלבד.
 */
export function ownerActivityFileName(propertyLabel: string): string {
  const clean = [...propertyLabel]
    .map((ch) => (FORBIDDEN.has(ch) || (ch.codePointAt(0) ?? 0) < 0x20 ? " " : ch))
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 60);
  return clean === "" ? "פעילות בנכס.csv" : `פעילות - ${clean}.csv`;
}

/**
 * מקסימום שורות בהודעה — מעבר לזה מציינים כמה נשמטו ומפנים לקובץ.
 *
 * הודעת ווטסאפ בת מאתיים שורות אינה נקראת, אבל קיטום שקט הופך דוח
 * לשקר. לכן נאמר בפירוש כמה לא נכנסו.
 */
export const OWNER_ACTIVITY_TEXT_LINES = 40;

/**
 * אותו דוח כהודעה לשליחה — ווטסאפ, SMS, גוף אימייל.
 *
 * קיים לצד ה-CSV כי בעל נכס אינו פותח אקסל. הוא מקבל הודעה, ולכן
 * מה שנשלח בפועל צריך להיקרא כמו הודעה ולא כמו קובץ שהודבק.
 */
export function ownerActivityText(input: {
  propertyLabel: string;
  officeName: string;
  /** "כל התקופה" / "‏30 הימים האחרונים" — מה שנבחר במסך. */
  periodLabel: string;
  entries: readonly OwnerActivityEntry[];
  /**
   * המסד החזיר יותר שורות מהתקרה, והרשימה כאן חלקית מלכתחילה.
   *
   * בלי זה השורה האחרונה הייתה מחשבת „ועוד N פעולות” מתוך המערך
   * שבידה — כלומר מוסרת ללקוח מספר מדויק שהוא שגוי, ומשמיטה את
   * העובדה שיש עוד (ביקורת Codex).
   */
  truncated?: boolean;
  now: Date;
}): string {
  const summary = summarizeOwnerActivity(input.entries, input.now);
  const lines = [
    `דוח פעילות — ${input.propertyLabel}`,
    `${input.officeName} · ${input.periodLabel}`,
    "",
  ];

  if (input.entries.length === 0) {
    lines.push("לא נרשמה פעילות בתקופה זו.");
    return lines.join("\n");
  }

  const headline = [
    summary.held > 0 ? `${summary.held} מפגשים התקיימו` : null,
    summary.upcoming > 0 ? `${summary.upcoming} נקבעו וטרם התקיימו` : null,
    summary.inquiries > 0 ? `${summary.inquiries} פניות של מתעניינים` : null,
  ].filter((part): part is string => part !== null);
  if (headline.length > 0) lines.push(headline.join(" · "), "");

  const shown = input.entries.slice(0, OWNER_ACTIVITY_TEXT_LINES);
  for (const entry of shown) {
    lines.push(
      `• ${formatJerusalemDate(entry.at)} ${formatJerusalemTime(entry.at)} — ` +
        `${OWNER_ACTIVITY_KIND_LABELS[entry.kind]} · ${OWNER_ACTIVITY_RESULT_LABELS[entry.result]}`,
    );
  }

  const omitted = input.entries.length - shown.length;
  if (input.truncated === true) {
    lines.push("", "ועוד פעולות נוספות — ברשימה המלאה בקובץ.");
  } else if (omitted > 0) {
    lines.push("", `ועוד ${omitted} פעולות — ברשימה המלאה בקובץ.`);
  }
  return lines.join("\n");
}
