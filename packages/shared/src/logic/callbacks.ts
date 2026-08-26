import { hebrewElapsed } from "./lead-waiting.js";
import { UNANSWERED_OUTCOMES } from "./telephony.js";

/**
 * „למי אני צריך לחזור” — הרשימה שמתווך באמת מבקש.
 *
 * ## הבאג שזה מתקן
 *
 * המתווך ביקש מהסוכן מספרי טלפון שצריך לחזור אליהם, וקיבל רשימת
 * משימות פתוחות. זו לא הייתה טעות של המודל אלא של הקטלוג: לא הייתה
 * פעולה כזו, ולכן הוא בחר את הקרובה ביותר — `show_tasks`. ומשימה
 * מחזירה כותרת בלבד; **אין בה מספר טלפון**, וזה כל מה שהתבקש.
 *
 * ## למה שלושה מקורות ולא אחד
 *
 * „צריך לחזור אליו” אינו שדה במסד. הוא נגזר משלושה מצבים שונים
 * שמתווך חווה כאותה מטלה:
 *
 * 1. **שיחה נכנסת שלא נענתה** — הפירוש המילולי, והדחוף ביותר.
 *    הלקוח הרים טלפון ולא קיבל מענה.
 * 2. **ליד שממתין למענה ראשון** — פנייה שהגיעה בערוץ אחר (טופס,
 *    וואטסאפ, מייל) ואיש עוד לא חזר אליה.
 * 3. **משימה פתוחה שקשורה לאיש קשר** — „לחזור לרונית”. היא כבר
 *    הוצגה למתווך, אבל בלי מספר.
 *
 * המכנה המשותף הוא לא סוג הרשומה אלא **האדם**: אותו לקוח יכול
 * להופיע בשלושתם, והמתווך צריך להרים טלפון אחד.
 */

/** למה צריך לחזור לאדם הזה. הסדר כאן הוא סדר הדחיפות. */
export type CallbackReason = "missed_call" | "waiting_lead" | "task";

/** דחיפות לפי ותק ההמתנה — ה-UI צובע לפיה, וההודעה מקצרת לפיה. */
export type CallbackUrgency = "now" | "today" | "soon";

export interface CallbackCandidate {
  /** האדם. שתי סיבות לאותו איש קשר מתמזגות לשורה אחת. */
  contactId: string;
  name: string;
  /** `null` = אין מספר בכרטיס. השורה נשארת, עם אמירה מפורשת. */
  phone: string | null;
  reason: CallbackReason;
  /** מתי נוצרה הסיבה — הבסיס לוותק ולדחיפות */
  since: Date | string;
  /** לאן לקפוץ בדשבורד */
  href: string;
  /** כותרת המשימה, או סיכום השיחה — מה שהופך את השורה למובנת */
  detail?: string;
}

export interface CallbackRow {
  contactId: string;
  name: string;
  phone: string | null;
  reason: CallbackReason;
  /** ניסוח עברי מלא של הסיבה, מוכן להצגה */
  reasonText: string;
  /** „ממתין 3 שעות” */
  waitedText: string;
  urgency: CallbackUrgency;
  /**
   * מתי נוצרה הסיבה — נשמר על השורה ולא רק משמש לניסוח.
   *
   * בלעדיו המיון נפל לשם הלקוח בתוך אותה דרגת דחיפות, ושתי שיחות
   * שלא נענו — אחת לפני 5 שעות ואחת לפני 23 — יצאו בסדר שרירותי.
   * ההודעה מכריזה „הדחוף ביותר: X”, ולכן סדר שרירותי הוא הכרזה
   * שגויה (ביקורת Codex).
   */
  since: Date;
  href: string;
  detail?: string;
  /**
   * כמה סיבות נוספות יש לאותו אדם, מעבר לחזקה שהוצגה.
   *
   * לא מוצג כרשימה: מי שגם התקשר וגם יש עליו משימה עדיין דורש
   * שיחה **אחת**. המספר קיים כדי שהמתווך יידע שיש עוד הקשר בכרטיס.
   */
  alsoCount: number;
}

/** שיחה כפי שהיא מגיעה מיומן השיחות — רק מה שדרוש להכרעה. */
export interface CallbackCallRow {
  id: string;
  contactId?: string;
  contactName?: string;
  phone?: string;
  direction: "inbound" | "outbound";
  outcome: string;
  occurredAt: Date | string;
  summary?: string;
}

/**
 * תוצאות שמשמעותן „הלקוח ניסה ולא קיבל מענה”.
 *
 * הרשימה עברה ל-`telephony.ts`, לצד יתר משמעויות התוצאה, כשגם
 * מנגנון משיכת ההקלטות נזקק לה. עותק שני היה מסכים איתה ביום
 * שנכתב בלבד.
 */
const UNANSWERED = new Set<string>(UNANSWERED_OUTCOMES);

/** מעבר לזה זו כבר היסטוריה, לא מטלה. */
const MISSED_CALL_WINDOW_DAYS = 14;

/**
 * שיחות שלא נענו **ושעוד לא חזרו אליהן**.
 *
 * ## הכלל, ולמה דווקא הוא
 *
 * לא „כל שיחה שלא נענתה”, אלא „כל איש קשר שהדבר האחרון שקרה איתו
 * הוא שיחה שלא ענינו לה”. זו ההגדרה שמתאימה למציאות: אם אחרי
 * השיחה שפספסנו חייגנו אליו בחזרה — או שהוא התקשר שוב וענינו —
 * הטיפול הסתיים, גם אם איש לא סימן דבר במערכת.
 *
 * הבדיקה היא על **השיחה האחרונה בלבד** ולא על „האם קיימת שיחה
 * יוצאת כלשהי”: לקוח שחזר והתקשר שבוע אחרי שדיברנו איתו ממתין
 * עכשיו, והשיחה היוצאת הישנה אינה מבטלת זאת.
 *
 * שיחה בלי איש קשר מזוהה מדולגת — אין למי לחזור ואין למזג לפי מה.
 */
export function pendingMissedCalls(
  calls: readonly CallbackCallRow[],
  now: Date,
  options: { windowDays?: number } = {},
): CallbackCandidate[] {
  const windowMs = (options.windowDays ?? MISSED_CALL_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const latestByContact = new Map<string, CallbackCallRow>();

  for (const call of calls) {
    if (call.contactId === undefined || call.contactId === "") continue;
    const known = latestByContact.get(call.contactId);
    if (!known || millis(call.occurredAt) > millis(known.occurredAt)) {
      latestByContact.set(call.contactId, call);
    }
  }

  const out: CallbackCandidate[] = [];
  for (const [contactId, call] of latestByContact) {
    if (call.direction !== "inbound" || !UNANSWERED.has(call.outcome)) continue;
    if (now.getTime() - millis(call.occurredAt) > windowMs) continue;
    out.push({
      contactId,
      name: call.contactName ?? "מספר לא מזוהה",
      phone: call.phone ?? null,
      reason: "missed_call",
      since: call.occurredAt,
      href: `/calls?call=${call.id}`,
      ...(call.summary !== undefined && call.summary !== "" ? { detail: call.summary } : {}),
    });
  }
  return out;
}

/** ככל שהמספר קטן יותר — דחוף יותר. */
const REASON_RANK: Record<CallbackReason, number> = {
  missed_call: 0,
  waiting_lead: 1,
  task: 2,
};

const REASON_TEXT: Record<CallbackReason, string> = {
  missed_call: "התקשר ולא נענה",
  waiting_lead: "פנייה שממתינה למענה",
  task: "משימה פתוחה",
};

const HOUR_MS = 60 * 60 * 1000;
/** מעל זה — „היום”; מעל ליום — „עכשיו”. ה-KPI של המשרד הוא 24 שעות. */
const TODAY_AFTER_HOURS = 4;
const NOW_AFTER_HOURS = 24;

function urgencyOf(since: Date | string, now: Date): CallbackUrgency {
  const started = since instanceof Date ? since : new Date(since);
  const hours = Math.max(0, (now.getTime() - started.getTime()) / HOUR_MS);
  if (hours >= NOW_AFTER_HOURS) return "now";
  if (hours >= TODAY_AFTER_HOURS) return "today";
  return "soon";
}

function millis(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

/**
 * מיזוג לפי אדם, ומיון לפי מה שבאמת דוחק.
 *
 * ## למה הוותיק ביותר למעלה, ולא החדש
 *
 * זו רשימת מטלות ולא פיד. הלקוח שממתין הכי הרבה זמן הוא זה שהכי
 * קרוב ללכת למתווך אחר — הוא זה שצריך להיות ראשון. פיד לפי „מה
 * קרה עכשיו” היה קובר בדיוק אותו.
 *
 * ## למה סוג הסיבה קודם לוותק
 *
 * מי שהרים טלפון לפני שעה ולא קיבל מענה דוחק יותר ממשימה שנפתחה
 * אתמול: הוא ניסה ליצור קשר **וקיבל דלת סגורה**. הוותק מכריע רק
 * בתוך אותה קטגוריה.
 */
export function rankCallbacks(
  candidates: readonly CallbackCandidate[],
  now: Date,
): CallbackRow[] {
  const byContact = new Map<string, CallbackCandidate[]>();
  for (const candidate of candidates) {
    const list = byContact.get(candidate.contactId);
    if (list) list.push(candidate);
    else byContact.set(candidate.contactId, [candidate]);
  }

  const rows: CallbackRow[] = [];
  for (const [contactId, group] of byContact) {
    // הסיבה החזקה: קודם הקטגוריה הדחופה, ובתוכה הוותיקה
    const strongest = group.reduce((best, current) =>
      REASON_RANK[current.reason] !== REASON_RANK[best.reason]
        ? REASON_RANK[current.reason] < REASON_RANK[best.reason]
          ? current
          : best
        : millis(current.since) < millis(best.since)
          ? current
          : best,
    );
    rows.push({
      contactId,
      name: strongest.name,
      phone: strongest.phone,
      reason: strongest.reason,
      reasonText: REASON_TEXT[strongest.reason],
      waitedText: `ממתין ${hebrewElapsed(strongest.since, now)}`,
      urgency: urgencyOf(strongest.since, now),
      since: strongest.since instanceof Date ? strongest.since : new Date(strongest.since),
      href: strongest.href,
      ...(strongest.detail !== undefined && strongest.detail !== ""
        ? { detail: strongest.detail }
        : {}),
      alsoCount: group.length - 1,
    });
  }

  return rows.sort((a, b) => {
    if (REASON_RANK[a.reason] !== REASON_RANK[b.reason]) {
      return REASON_RANK[a.reason] - REASON_RANK[b.reason];
    }
    // בתוך אותה סיבה: מי שממתין יותר — למעלה. הזמן עצמו, ולא
    // הדרגה: „5 שעות” ו„23 שעות” הן אותה דרגה ולא אותה דחיפות.
    const byWait = a.since.getTime() - b.since.getTime();
    if (byWait !== 0) return byWait;
    return a.name.localeCompare(b.name, "he");
  });
}

/**
 * הרשימה כטקסט לוואטסאפ.
 *
 * ## למה המספר בשורה נפרדת
 *
 * וואטסאפ הופך מספר טלפון לקישור חיוג רק כשהוא עומד בפני עצמו.
 * מספר שנדחס לתוך משפט („דני כהן 050-1234567 — התקשר ולא נענה”)
 * נשאר טקסט, והמתווך צריך לסמן ולהעתיק. כאן הוא בשורה משלו, ולכן
 * לחיצה אחת מחייגת — וזה כל מה שהתבקש מלכתחילה.
 *
 * ## למה יש תקרה
 *
 * הודעת וואטסאפ ארוכה נחתכת אצל הנמען. עדיף עשר שורות שנקראות
 * ושורת „ועוד” מפורשת, מאשר שלושים שורות שנקטעות באמצע בלי שאיש
 * ידע מה נחתך.
 */
export function formatCallbacksForWhatsApp(
  rows: readonly CallbackRow[],
  options: { limit?: number } = {},
): string {
  if (rows.length === 0) return "אין כרגע אף אחד שממתין לחזרה. 🎉";

  const limit = options.limit ?? 10;
  const shown = rows.slice(0, limit);
  const lines: string[] = [`📞 ${rows.length} ממתינים לחזרה:`];

  for (const [index, row] of shown.entries()) {
    lines.push("");
    const also = row.alsoCount > 0 ? ` (+${row.alsoCount} בכרטיס)` : "";
    lines.push(`${index + 1}. *${row.name}* — ${row.reasonText}, ${row.waitedText}${also}`);
    // המספר לבדו בשורה: זה מה שהופך אותו לקישור חיוג
    lines.push(row.phone ?? "אין מספר בכרטיס");
    if (row.detail !== undefined) lines.push(`_${row.detail}_`);
  }

  if (rows.length > shown.length) {
    lines.push("", `ועוד ${rows.length - shown.length} — הרשימה המלאה במערכת.`);
  }
  return lines.join("\n");
}
