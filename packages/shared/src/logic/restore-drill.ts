/**
 * תרגיל שחזור — **ההוכחה שהגיבוי שווה משהו.**
 *
 * `pg_dump` שהחזיר 0 אומר שהתהליך הסתיים, לא שהקובץ ניתן לשחזור.
 * דיסק שהתמלא אחרי הכתיבה, volume שנפגם, ארכיון שנקטע — כולם
 * מייצרים קובץ שנראה תקין ברשימה, במשקל סביר ובשם הנכון, ושנכשל
 * בדיוק ברגע שבו הוא נחוץ.
 *
 * לכן הבקרה אינה "יש גיבוי" אלא "הגיבוי שוחזר בהצלחה למסד זמני".
 * זו גם הראיה שמבקר ISO 27001 מבקש לבקרה A.8.13: לא צילום מסך של
 * תיקיית הגיבויים, אלא רישום של שחזור שבוצע.
 *
 * ## למה גם הוותק נחשב, ולא רק התוצאה
 *
 * תרגיל שהצליח לפני שלושה חודשים אומר על הגיבוי של היום כמעט כלום:
 * מאז השתנתה הסכמה, גדל המסד, אולי התחלף הדיסק. "הצליח" ו"הצליח
 * לאחרונה" הם שני דברים שונים, והמסך צריך להבחין ביניהם — אחרת
 * ✓ ירוק ישן ייקרא כמו ביטחון.
 */

import type { BackupLevel } from "./backup-file.js";

/** תוצאת התרגיל האחרון, כפי שסקריפט הגיבוי כותב אותה. */
export interface RestoreDrill {
  /** `never` = מעולם לא רץ. זו אינה שגיאה, אבל היא גם אינה בקרה. */
  state: "ok" | "failed" | "never";
  /** מתי הסתיים התרגיל (ISO). */
  at: string | null;
  /** איזה קובץ גיבוי נבדק בפועל. */
  file: string | null;
  /** כמה טבלאות נמצאו במסד המשוחזר. */
  tables: number | null;
  /** כמה משרדים — הבדיקה שהנתונים ולא רק המבנה שרדו. */
  tenants: number | null;
  durationMs: number | null;
  message: string;
}

/** התרגיל רץ שבועית; יומיים חסד לפני שמסמנים אותו כמתיישן. */
export const DRILL_WARN_DAYS = 9;
/** מעבר לזה אין ראיה עדכנית שהגיבוי בר-שחזור. */
export const DRILL_DANGER_DAYS = 16;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface RestoreDrillSummary {
  level: BackupLevel;
  /** ימים מאז התרגיל האחרון; `null` כשמעולם לא רץ. */
  ageDays: number | null;
  /** משפט אחד למסך — מה המצב ולמה אכפת. */
  headline: string;
}

/**
 * חיווי המצב לתרגיל השחזור.
 *
 * שלוש דרגות ולא שתיים: **כשל** הוא הדחוף, אבל **מעולם לא רץ** אינו
 * "תקין" — הוא היעדר ידיעה, וצריך להיראות אחרת מ-✓.
 */
export function summarizeRestoreDrill(drill: RestoreDrill, now: Date): RestoreDrillSummary {
  if (drill.state === "never" || drill.at === null) {
    return {
      level: "warn",
      ageDays: null,
      headline: "תרגיל שחזור מעולם לא רץ — אין ראיה שהגיבוי בר-שחזור.",
    };
  }

  const ageDays = Math.floor((now.getTime() - new Date(drill.at).getTime()) / MS_PER_DAY);

  if (drill.state === "failed") {
    return {
      level: "danger",
      ageDays,
      headline: `תרגיל השחזור האחרון נכשל — ${drill.message}`,
    };
  }

  /*
   * הצליח, אבל מזמן. הדירוג יורד לפי הוותק ולא לפי התוצאה: מה
   * שנבדק אז אינו הקובץ שישוחזר היום.
   */
  if (ageDays >= DRILL_DANGER_DAYS) {
    return {
      level: "danger",
      ageDays,
      headline: `התרגיל האחרון הצליח לפני ${ageDays} ימים — ישן מכדי להעיד על הגיבוי הנוכחי.`,
    };
  }
  if (ageDays >= DRILL_WARN_DAYS) {
    return {
      level: "warn",
      ageDays,
      headline: `התרגיל האחרון הצליח לפני ${ageDays} ימים — התרגיל השבועי כנראה אינו רץ.`,
    };
  }

  const detail =
    drill.tables !== null && drill.tenants !== null
      ? ` ${drill.tables} טבלאות, ${drill.tenants} משרדים.`
      : "";
  return {
    level: "ok",
    ageDays,
    headline: `הגיבוי שוחזר בהצלחה למסד בדיקה${ageDays === 0 ? " היום" : ` לפני ${ageDays} ימים`}.${detail}`,
  };
}

/** ברירת מחדל כשאין קובץ מצב — מבדיל "לא רץ" מ"נכשל". */
export const NEVER_RAN: RestoreDrill = {
  state: "never",
  at: null,
  file: null,
  tables: null,
  tenants: null,
  durationMs: null,
  message: "טרם בוצע",
};
