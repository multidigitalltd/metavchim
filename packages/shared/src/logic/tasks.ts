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

const DAY_MS = 24 * 60 * 60 * 1000;

/** תחילת היום המקומי — הגבול בין "היום" ל"מחר" הוא חצות, לא 24 שעות. */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
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
 */
export function taskBucket(dueAt: Date | string | null | undefined, now: Date): TaskBucket {
  if (dueAt === null || dueAt === undefined) return "someday";
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "someday";

  if (due.getTime() < now.getTime()) return "overdue";

  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  if (due.getTime() < tomorrowStart.getTime()) return "today";

  // שבעה ימים קדימה מתחילת היום — "השבוע" במובן של טווח, לא של
  // שבוע קלנדרי שנגמר במוצאי שבת ומרוקן את הדלי ביום ראשון
  const weekEnd = new Date(todayStart.getTime() + 7 * DAY_MS);
  return due.getTime() < weekEnd.getTime() ? "week" : "later";
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
