/**
 * קבצי הגיבוי — ולידציית שם, סיווג וסיכום מצב.
 *
 * המודול הזה נוגע בנקודה רגישה: שם קובץ שמגיע מהדפדפן הופך בסופו של
 * דבר לנתיב על הדיסק של השרת (מחיקה) ולארגומנט של pg_restore (שחזור).
 * לכן הוולידציה כאן היא **רשימת היתר** — רק שמות שהסקריפטים שלנו
 * מייצרים עוברים; כל השאר נדחה, כולל ‎..‎ ולוכסנים. הלוגיקה יושבת
 * ב-shared כדי שגם ה-API וגם הבדיקות ישתמשו באותה הגדרה בדיוק.
 */

export type BackupKind = "db" | "media";

/** שורה אחת ברשימת הגיבויים, כפי שה-API מחזיר למסך הפלטפורמה. */
export interface BackupFile {
  name: string;
  kind: BackupKind;
  sizeBytes: number;
  /** זמן היצירה בפועל (mtime) — לא מפוענח מהשם, כדי לא לנחש אזור זמן. */
  createdAt: string;
}

/**
 * db_2026-08-06_1900.dump          — גיבוי מסד יומי
 * db_2026-08-06_1900_pre-restore.dump — גיבוי הבטיחות שנלקח לפני שחזור
 * media_2026-08-06_1900.tar.gz     — ארכיון התמונות השבועי
 */
const DB_NAME = /^db_\d{4}-\d{2}-\d{2}_\d{4}(?:_[a-z][a-z-]{0,23})?\.dump$/;
const MEDIA_NAME = /^media_\d{4}-\d{2}-\d{2}_\d{4}(?:_[a-z][a-z-]{0,23})?\.tar\.gz$/;

/** סיווג לפי השם, או null אם השם אינו שם גיבוי תקין. */
export function backupKind(name: string): BackupKind | null {
  if (DB_NAME.test(name)) return "db";
  if (MEDIA_NAME.test(name)) return "media";
  return null;
}

/**
 * השער היחיד לפני פעולה על קובץ בדיסק. `backupKind` כבר מעוגן בשני
 * הקצוות (‎^…$‎) ולכן חוסם לוכסן, ‎..‎ ותווי בקרה — הבדיקה כאן היא
 * העטיפה בעלת השם המפורש, כדי שקריאה בקוד תסגיר את הכוונה.
 */
export function isSafeBackupName(name: string): boolean {
  return backupKind(name) !== null;
}

export type BackupLevel = "ok" | "warn" | "danger";

export interface BackupHealth {
  count: number;
  totalBytes: number;
  /** הגיבוי האחרון של מסד הנתונים (ISO) — null אם אין אף אחד. */
  latestDbAt: string | null;
  /** ארכיון התמונות האחרון (ISO) — null אם עוד לא רץ יום ראשון. */
  latestMediaAt: string | null;
  /** גיל הגיבוי האחרון של המסד בשעות; null כשאין גיבוי. */
  ageHours: number | null;
  level: BackupLevel;
  message: string;
}

/** גיבוי המסד רץ כל 24 שעות; מעבר לחלון הזה משהו תקוע. */
const WARN_HOURS = 30;
const DANGER_HOURS = 48;

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * חיווי מצב לגיבויים המקומיים. הרמה נגזרת מגיל הגיבוי **של המסד**
 * בלבד: ארכיון התמונות רץ שבועית ולכן גיל של ימים בו הוא תקין,
 * ואילו מסד שלא גובה 48 שעות פירושו שהמנגנון נפל.
 */
export function summarizeBackups(files: BackupFile[], now: Date): BackupHealth {
  const latestOf = (kind: BackupKind): string | null => {
    const times = files.filter((f) => f.kind === kind).map((f) => f.createdAt);
    return times.length > 0 ? times.reduce((a, b) => (a > b ? a : b)) : null;
  };

  const latestDbAt = latestOf("db");
  const latestMediaAt = latestOf("media");
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  const ageHours =
    latestDbAt === null
      ? null
      : Math.max(0, (now.getTime() - new Date(latestDbAt).getTime()) / MS_PER_HOUR);

  let level: BackupLevel = "ok";
  let message = "";
  if (ageHours === null) {
    level = "danger";
    message = "אין אף גיבוי של מסד הנתונים — בדקו את הלוג של שירות הגיבוי";
  } else if (ageHours >= DANGER_HOURS) {
    level = "danger";
    message = `הגיבוי האחרון בן ${Math.round(ageHours)} שעות — הגיבוי היומי לא רץ`;
  } else if (ageHours >= WARN_HOURS) {
    level = "warn";
    message = `הגיבוי האחרון בן ${Math.round(ageHours)} שעות — צפוי גיבוי חדש בקרוב`;
  } else {
    message = `הגיבוי האחרון בן ${Math.round(ageHours)} שעות`;
  }

  return {
    count: files.length,
    totalBytes,
    latestDbAt,
    latestMediaAt,
    ageHours,
    level,
    message,
  };
}

/**
 * הגיבוי היחיד שאסור למחוק מהממשק: הדאמפ האחרון של המסד. בלעדיו
 * לחיצה אחת נוספת יכולה להשאיר את המערכת בלי רשת ביטחון מקומית.
 * מחזיר את שם הקובץ המוגן, או null כשאין גיבויי מסד כלל.
 */
export function protectedBackupName(files: BackupFile[]): string | null {
  const dbFiles = files.filter((f) => f.kind === "db");
  if (dbFiles.length === 0) return null;
  return dbFiles.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).name;
}
