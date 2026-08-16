/**
 * איזו גרסה רצה בפועל — **בכל שירות בנפרד**.
 *
 * המערכת רצה בשלושה קונטיינרים (api, web, workers) שמתעדכנים יחד אבל
 * לא בהכרח מצליחים יחד: משיכה שנכשלה לאחד מהם משאירה אותו על התמונה
 * הקודמת, והכול ממשיך לעבוד — פשוט לא כמו שחשבו.
 *
 * מסך העדכון הציג עד כה **מספר אחד**, של ה-API. זה נראה תמים עד
 * שקרה בדיוק מה שהוא מזמין: המסך אמר "גרסה מותקנת bfd8d0a", ולא
 * נראה שום שינוי — כי ה-web נשאר מאחור. מספר יחיד ששלושה שירותים
 * מיוצגים בו אינו "פשטות", הוא דיווח שגוי בהסתברות גבוהה.
 *
 * הקובץ הזה הוא רק ההשוואה. איסוף המספרים עצמם קורה בקצוות: ה-API
 * יודע את שלו, ה-Workers מדווחים ל-Redis, וה-web נשאל מהדפדפן.
 */

export type ServiceKey = "api" | "web" | "workers";

export const SERVICE_LABEL: Record<ServiceKey, string> = {
  api: "שרת (API)",
  web: "ממשק (Web)",
  workers: "עיבוד רקע (Workers)",
};

/**
 * המפתח שה-Workers כותבים אליו את גרסתם, וה-API קורא ממנו.
 *
 * דרך Redis ולא דרך המסד: הדיווח הוא סימן חיים, ורצוי שיפוג מעצמו.
 * שורה במסד הייתה שורדת כיבוי של התהליך ומדווחת גרסה של שירות שאינו
 * רץ כלל.
 */
export const WORKERS_VERSION_KEY = "mv:service:workers:version";

/**
 * תוקף הדיווח בשניות. ארוך פי שלושה ממחזור הדיווח, כדי שהחמצה של
 * פעימה אחת לא תיראה כמו נפילה.
 */
export const WORKERS_VERSION_TTL_SECONDS = 180;

/** מחזור הדיווח של ה-Workers, במילישניות. */
export const WORKERS_VERSION_INTERVAL_MS = 60_000;

export interface ServiceVersion {
  key: ServiceKey;
  /** `null` = השירות לא דיווח. ראו `silent` — זה אינו "גרסה ריקה". */
  version: string | null;
}

export interface VersionAlignment {
  state: "aligned" | "mismatch" | "unknown";
  /** שירותים שלא דיווחו כלל. */
  silent: ServiceKey[];
  /** כמה גרסאות שונות נמצאו בפועל. 1 = הכול מיושר. */
  distinct: number;
  message: string;
}

/** מזהה קומיט מקוצר לתצוגה. הקידומת מספיקה לזיהוי, והשאר רעש. */
export function shortVersion(version: string): string {
  return version.slice(0, 12);
}

function list(keys: ServiceKey[]): string {
  return keys.map((k) => SERVICE_LABEL[k]).join(", ");
}

/**
 * האם כל השירותים על אותה גרסה.
 *
 * שירות ששותק אינו נספר כפער — אי אפשר לדעת. הוא כן נאמר בנפרד,
 * כי "לא יודעים" ו"תקין" אינם אותו דבר, וזו בדיוק ההבחנה שהמסך
 * הקודם טשטש.
 */
export function versionAlignment(services: ServiceVersion[]): VersionAlignment {
  const silent = services.filter((s) => s.version === null).map((s) => s.key);
  const known = services.filter((s): s is ServiceVersion & { version: string } => s.version !== null);
  const distinct = new Set(known.map((s) => s.version)).size;

  const silentNote = silent.length === 0 ? "" : ` ${list(silent)} — אינו מדווח גרסה.`;

  if (known.length === 0) {
    return { state: "unknown", silent, distinct: 0, message: "אף שירות לא דיווח גרסה." };
  }
  if (distinct > 1) {
    return {
      state: "mismatch",
      silent,
      distinct,
      message: `השירותים אינם באותה גרסה — ${distinct} גרסאות שונות רצות במקביל. הריצו עדכון; אם הפער נשאר, אחת המשיכות נכשלה.${silentNote}`,
    };
  }
  if (silent.length > 0) {
    return {
      state: "unknown",
      silent,
      distinct,
      message: `השירותים שדיווחו נמצאים באותה גרסה.${silentNote} שירות ותיק שטרם עודכן אינו יודע לדווח — זה צפוי בעדכון הראשון.`,
    };
  }
  return { state: "aligned", silent, distinct, message: "כל השירותים רצים באותה גרסה." };
}
