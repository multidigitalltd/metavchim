import { Worker, type Processor } from "bullmq";
import IORedis from "ioredis";
import { QUEUES, type QueueName } from "@metavchim/shared";

/**
 * תהליך ה-Workers — כל עבודה כבדה רצה כאן, לעולם לא ב-Request
 * (docs/07-performance.md §2, §6).
 *
 * כל Processor חייב להיות Idempotent: Job יכול לרוץ פעמיים (Retry),
 * והתוצאה חייבת להיות זהה.
 */

const connection = new IORedis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

/** מקבילות לפי אופי התור — תורי AI מוגבלים לפי מכסות הספק. */
const CONCURRENCY: Record<QueueName, number> = {
  [QUEUES.realtime]: 10,
  [QUEUES.ai]: 3,
  [QUEUES.matching]: 5,
  [QUEUES.notifications]: 10,
  [QUEUES.sync]: 3,
  [QUEUES.low]: 1,
};

const placeholderProcessor: Processor = (job) => {
  // המעבדים האמיתיים (תמלול, חילוץ, התאמות, שליחות) יירשמו כאן,
  // מודול-מודול, לפי מפת הדרכים.
  return Promise.resolve({ handled: false, jobName: job.name });
};

const workers = Object.values(QUEUES).map(
  (queue) =>
    new Worker(queue, placeholderProcessor, {
      connection,
      concurrency: CONCURRENCY[queue],
    }),
);

/** Graceful Shutdown — Jobs פעילים מסיימים לפני יציאה; אין עבודות קטועות. */
async function shutdown(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
