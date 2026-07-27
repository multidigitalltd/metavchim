/**
 * שמות התורים — מופרדים לפי אופי העומס (docs/07-performance.md §6).
 * כל Job חייב להיות Idempotent; Retry/Backoff מוגדרים ברמת התור.
 */
export const QUEUES = {
  /** וואטסאפ נכנס, סיכומי שיחה — רגישים להשהיה */
  realtime: "realtime",
  /** תמלול/חילוץ/ניסוח — מוגבל מקבילות לפי מכסות ספק */
  ai: "ai",
  /** חישובי התאמות */
  matching: "matching",
  /** התראות והודעות יוצאות */
  notifications: "notifications",
  /** סנכרונים: יומן, Kanko */
  sync: "sync",
  /** ניקויים ותחזוקה */
  low: "low",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Job ייחודי-לישות: שינויים מרובים ברצף מתמזגים לחישוב אחד (Debounce). */
export const jobIdForEntity = (queue: QueueName, entityId: string): string =>
  `${queue}:${entityId}`;
