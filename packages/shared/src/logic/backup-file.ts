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
 * db_2026-08-06_1900.dump             — גיבוי מסד יומי
 * db_2026-08-06_1900_pre-restore.dump — גיבוי הבטיחות שנלקח לפני שחזור
 * media_2026-08-06_1900_full.tar.gz   — ארכיון מדיה מלא
 * media_2026-08-07_1900_diff.tar.gz   — רק מה שהשתנה מאז המלא האחרון
 * media_2026-08-06_1900.tar.gz        — ארכיון מלא מהשיטה הישנה (עדיין נתמך)
 */
const DB_NAME = /^db_\d{4}-\d{2}-\d{2}_\d{4}(?:_[a-z][a-z-]{0,23})?\.dump$/;
const MEDIA_NAME = /^media_(\d{4}-\d{2}-\d{2}_\d{4})(?:_([a-z][a-z-]{0,23}))?\.tar\.gz$/;

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

/**
 * ‎**מלא או משלים.** ארכיון המדיה רץ כל יום, אבל רק אחת לכמה ימים הוא
 * סורק את כל האחסון; בין לבין נשמר רק מה שהשתנה מאז אותו ארכיון מלא.
 * ‎`diff`‎ הוא הפרשי — לא מצטבר — ולכן שחזור דורש בדיוק שני קבצים:
 * המלא שהוא נשען עליו, ואותו. זה מה שמאפשר למחוק ארכיון משלים אחד
 * באמצע בלי לשבור את כל מה שבא אחריו.
 *
 * שם ללא סיומת הוא ארכיון מלא מהשיטה הקודמת — הוא עומד בפני עצמו.
 */
export type MediaTier = "full" | "diff";

export function mediaTier(name: string): MediaTier | null {
  const match = MEDIA_NAME.exec(name);
  if (match === null) return null;
  return match[2] === "diff" ? "diff" : "full";
}

/** חותמת הזמן מתוך השם — משמשת לסידור כרונולוגי בלי לפענח אזור זמן. */
function mediaStamp(name: string): string | null {
  const match = MEDIA_NAME.exec(name);
  return match === null ? null : (match[1] ?? null);
}

/**
 * הארכיון המלא שארכיון משלים נשען עליו: המלא האחרון שנלקח לפניו.
 * null כשאין כזה — כלומר המשלים יתום ואי אפשר לשחזר ממנו.
 *
 * הלוגיקה הזאת משוכפלת בכוונה ב-infra/backup/restore.sh: הסקריפט רץ
 * בקונטיינר בלי Node, ואסור שהשחזור יסתמך על חבילה שצריך לבנות.
 */
export function mediaBaseFor(name: string, files: BackupFile[]): string | null {
  if (mediaTier(name) !== "diff") return null;
  const stamp = mediaStamp(name);
  if (stamp === null) return null;

  let base: { name: string; stamp: string } | null = null;
  for (const file of files) {
    if (mediaTier(file.name) !== "full") continue;
    const fullStamp = mediaStamp(file.name);
    if (fullStamp === null || fullStamp > stamp) continue;
    const better =
      base === null ||
      fullStamp > base.stamp ||
      (fullStamp === base.stamp && file.name > base.name);
    if (better) base = { name: file.name, stamp: fullStamp };
  }
  return base?.name ?? null;
}

export type BackupLevel = "ok" | "warn" | "danger";

export interface BackupHealth {
  count: number;
  totalBytes: number;
  /** הגיבוי האחרון של מסד הנתונים (ISO) — null אם אין אף אחד. */
  latestDbAt: string | null;
  /** ארכיון המדיה האחרון (ISO) — null כשאין אף אחד (למשל בפיתוח). */
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
 * חיווי מצב לגיבויים המקומיים.
 *
 * הרמה נגזרת בראש ובראשונה מגיל הגיבוי של **המסד** — מסד שלא גובה
 * 48 שעות פירושו שהמנגנון נפל. אבל גם המדיה רצה כל 24 שעות מאז
 * שהיא הפכה ליומית, ומה שיושב בה — הקלטות שיחה וחתימות על מסמכים —
 * אין לו מקור אחר לשחזור מתוכו. לכן ארכיון מדיה שנתקע מעלה אזהרה
 * במקום לעבור בשקט, כפי שקרה כשהוא היה שבועי.
 *
 * ‎**אין אף ארכיון מדיה** אינו אזהרה: כך נראית סביבת פיתוח בלי MinIO.
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

  const mediaAgeHours =
    latestMediaAt === null
      ? null
      : Math.max(0, (now.getTime() - new Date(latestMediaAt).getTime()) / MS_PER_HOUR);
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

  if (level === "ok" && mediaAgeHours !== null && mediaAgeHours >= DANGER_HOURS) {
    level = "warn";
    message = `${message} · ארכיון המדיה בן ${Math.round(mediaAgeHours)} שעות — הקלטות וחתימות אינן מגובות`;
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
 * למה אסור למחוק את הגיבוי הזה מהממשק — או null כשמותר.
 *
 * שתי סיבות, ושתיהן על אותו עיקרון: לחיצה אחת בממשק לא אמורה להשאיר
 * את המערכת בלי דרך לחזור אחורה.
 *   1. הדאמפ האחרון של המסד — בלעדיו אין רשת ביטחון מקומית כלל.
 *   2. ארכיון מדיה מלא שארכיונים משלימים עדיין נשענים עליו — מחיקתו
 *      הופכת כל אחד מהם לחסר-תועלת, וזה לא נראה בממשק בזמן הלחיצה.
 */
export function backupDeleteBlock(name: string, files: BackupFile[]): string | null {
  const dbFiles = files.filter((f) => f.kind === "db");
  const latestDb =
    dbFiles.length === 0 ? null : dbFiles.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).name;
  if (latestDb === name) {
    return "זהו הגיבוי האחרון של מסד הנתונים — לא ניתן למחוק אותו מהממשק";
  }

  if (mediaTier(name) === "full") {
    const dependents = files.filter((f) => mediaBaseFor(f.name, files) === name).length;
    if (dependents > 0) {
      return `${dependents} ארכיוני מדיה משלימים נשענים על הארכיון המלא הזה — מחקו אותם קודם`;
    }
  }

  return null;
}

/** אותה הכרעה, כרשימת שמות — זה מה שהמסך צריך כדי לסמן שורות. */
export function protectedBackupNames(files: BackupFile[]): string[] {
  return files.filter((f) => backupDeleteBlock(f.name, files) !== null).map((f) => f.name);
}
