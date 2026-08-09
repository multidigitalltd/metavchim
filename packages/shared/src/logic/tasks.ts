/**
 * משימות — עדיפות, וקיבוץ לפי דחיפות.
 *
 * רשימת משימות שטוחה ממוינת לפי תאריך היא רשימה שמפסיקים להסתכל בה:
 * מה שבאיחור נראה בדיוק כמו מה שבעוד שבועיים, רק גבוה יותר. הקיבוץ
 * כאן הוא מה שהופך את המסך לסדר עבודה — "מה נשרף", "מה היום",
 * "מה השבוע", והשאר.
 *
 * הלוגיקה יושבת ב-shared ולא במסך כי גם השרת סופר לפיה (הבאדג'
 * בסרגל הצד), ושני חישובים שאמורים להסכים הם שני חישובים שיפסיקו
 * להסכים.
 *
 * **הגבולות נחתכים בשעון ישראל, לא בשעון התהליך.** ה-API רץ ב-UTC
 * והדפדפן בשעון המשתמש; חצות היא נקודה שונה בכל אחד מהם, ולכן משימה
 * ל-01:00 בלילה הופיעה בדלי "היום" במסך ונעדרה מהמונה בסרגל — אותה
 * משימה, שתי תשובות. אותה בעיה בדיוק שנפתרה ב-recurrence.ts, ואותם
 * כלים פותרים אותה גם כאן.
 *
 * החישוב הוא **על תאריכי לוח** ולא על הפרשי מילישניות: הוספת 24 שעות
 * שוברת ביום מעבר השעון, שבו יום אחד ארוך או קצר בשעה.
 */

/** נמוכה | רגילה | גבוהה. שלוש רמות — ארבע כבר אף אחד לא מבדיל. */
export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "נמוכה",
  normal: "רגילה",
  high: "דחוף",
};

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

/** משקל למיון. גבוה קודם, ולכן המספר גדול יותר. */
const PRIORITY_WEIGHT: Record<TaskPriority, number> = { high: 2, normal: 1, low: 0 };

/**
 * הדליים, לפי סדר הופעה.
 *
 * `someday` הוא משימה בלי מועד — היא אינה "מאוחר יותר", היא פשוט לא
 * מתוזמנת, ולכן היא בסוף ולא בין התאריכים.
 */
export const TASK_BUCKETS = ["overdue", "today", "week", "later", "someday"] as const;
export type TaskBucket = (typeof TASK_BUCKETS)[number];

export const TASK_BUCKET_LABELS: Record<TaskBucket, string> = {
  overdue: "באיחור",
  today: "היום",
  week: "השבוע",
  later: "בהמשך",
  someday: "בלי מועד",
};

const JERUSALEM_TZ = "Asia/Jerusalem";

/**
 * מספר היום בלוח הירושלמי — ימים שלמים מאז 1970, לפי שעון ישראל.
 *
 * זה מה שמאפשר להשוות "איזה יום זה" בלי לגעת בשעות: ההפרש בין שני
 * מספרים כאלה הוא מספר הימים שביניהם, גם כשאחד מהם הוא יום מעבר
 * שעון בן 23 או 25 שעות.
 */
function jerusalemDayNumber(at: Date): number {
  // sv-SE נותן YYYY-MM-DD; קריאתו כ-UTC הופכת אותו למספר יום יציב
  const ymd = new Intl.DateTimeFormat("sv-SE", {
    timeZone: JERUSALEM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return Math.floor(new Date(`${ymd}T00:00:00.000Z`).getTime() / 86_400_000);
}

/**
 * לאיזה דלי המשימה שייכת.
 *
 * "היום" נמדד מול חצות ולא מול `now + 24h`: משימה ל-08:00 מחר אינה
 * "היום" בשמונה בערב, וזו בדיוק הטעות שגורמת לרשימה של היום להתמלא
 * במה שעוד לא הגיע.
 *
 * משימה שמועדה עבר היום היא **באיחור** ולא "היום" — 09:00 שחלף
 * בשעה 11:00 הוא איחור, וזו כל הנקודה של הדלי הראשון.
 *
 * ההשוואה בין הדליים היא על **תאריכי לוח ירושלמיים**, ולכן היא
 * מחזירה את אותה תשובה בשרת שרץ ב-UTC ובדפדפן בכל אזור זמן.
 */
export function taskBucket(dueAt: Date | string | null | undefined, now: Date): TaskBucket {
  if (dueAt === null || dueAt === undefined) return "someday";
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "someday";

  // "באיחור" הוא רגע ולא יום — כאן ההשוואה נכונה בכל אזור זמן
  if (due.getTime() < now.getTime()) return "overdue";

  const daysAhead = jerusalemDayNumber(due) - jerusalemDayNumber(now);
  if (daysAhead <= 0) return "today";
  // שבעה ימי לוח קדימה — "השבוע" במובן של טווח, לא של שבוע קלנדרי
  // שנגמר במוצאי שבת ומרוקן את הדלי ביום ראשון
  return daysAhead < 7 ? "week" : "later";
}

/** האם המשימה דורשת תשומת לב עכשיו — הבסיס לבאדג' בסרגל. */
export function isTaskUrgent(
  task: { status: string; dueAt?: Date | string | null },
  now: Date,
): boolean {
  if (task.status !== "open") return false;
  const bucket = taskBucket(task.dueAt, now);
  return bucket === "overdue" || bucket === "today";
}

export interface SortableTask {
  priority?: string;
  dueAt?: Date | string | null;
  createdAt?: Date | string;
}

function time(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * מיון בתוך דלי: קודם עדיפות, אחר כך מועד, ולבסוף סדר היצירה.
 *
 * העדיפות **לפני** המועד ולא אחריו — בתוך "היום" כבר אין הבדל של
 * ממש בין 10:00 ל-14:00, ומה שדחוף צריך להיות למעלה. בין דליים
 * המועד גובר, כי הדלי עצמו הוא כבר החלוקה לפי זמן.
 *
 * משימה בלי מועד יורדת מתחת למתוזמנות באותה עדיפות: קבעו לה תאריך
 * או שהיא תמתין.
 */
export function compareTasks(a: SortableTask, b: SortableTask): number {
  const priorityA = PRIORITY_WEIGHT[isTaskPriority(a.priority ?? "") ? (a.priority as TaskPriority) : "normal"];
  const priorityB = PRIORITY_WEIGHT[isTaskPriority(b.priority ?? "") ? (b.priority as TaskPriority) : "normal"];
  if (priorityA !== priorityB) return priorityB - priorityA;

  const dueA = time(a.dueAt);
  const dueB = time(b.dueAt);
  if (dueA !== dueB) {
    if (dueA === null) return 1;
    if (dueB === null) return -1;
    return dueA - dueB;
  }

  const createdA = time(a.createdAt) ?? 0;
  const createdB = time(b.createdAt) ?? 0;
  return createdA - createdB;
}

/**
 * חלוקה לדליים, ממוינת בתוך כל אחד.
 *
 * מחזירה **את כל** הדליים לפי הסדר, כולל ריקים — המסך מחליט אם
 * להציג כותרת ריקה, והקורא לא צריך לזכור את הסדר בעצמו.
 */
export function groupTasksByBucket<T extends SortableTask & { status?: string }>(
  tasks: readonly T[],
  now: Date,
): { bucket: TaskBucket; label: string; tasks: T[] }[] {
  const byBucket = new Map<TaskBucket, T[]>(TASK_BUCKETS.map((bucket) => [bucket, []]));
  for (const task of tasks) {
    byBucket.get(taskBucket(task.dueAt, now))?.push(task);
  }
  return TASK_BUCKETS.map((bucket) => ({
    bucket,
    label: TASK_BUCKET_LABELS[bucket],
    tasks: (byBucket.get(bucket) ?? []).sort(compareTasks),
  }));
}

/** הישויות שמשימה יכולה להיתלות עליהן, והמסך שאליו מקשרים. */
export const TASK_ENTITY_LABELS: Record<string, string> = {
  lead: "ליד",
  buyer: "קונה",
  property: "נכס",
};

export function taskEntityHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "lead":
      return `/leads/${entityId}`;
    case "buyer":
      return `/buyers/${entityId}`;
    case "property":
      return `/properties/${entityId}`;
    default:
      return null;
  }
}
