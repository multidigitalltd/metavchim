import "./env.js";
import { Queue, Worker, type Job } from "bullmq";
import {
  QUEUES,
  WORKERS_VERSION_KEY,
  WORKERS_VERSION_TTL_SECONDS,
  WORKERS_VERSION_INTERVAL_MS,
} from "@metavchim/shared";
import { processNotification } from "./notifications.js";
import { connection, prisma } from "./runtime.js";
import { processCleanup } from "./storage.js";
import { processAgentEventsRetention } from "./jobs/agent-events-retention.js";
import { transcribeOneCall } from "./jobs/calls.js";
import { processCustomAutomations } from "./jobs/custom-automations.js";
import {
  processDailyBrief,
  processViewingFeedbackDigest,
  processWeeklySummary,
} from "./jobs/digests.js";
import { processExclusivitySweep } from "./jobs/exclusivity.js";
import { processLeadSla, processLeadSlaSweep } from "./jobs/lead-sla.js";
import { processOfferFollowup } from "./jobs/offer-followup.js";
import { processPbxSilenceSweep } from "./jobs/pbx-silence.js";
import { processPriceDropReoffer, processPropertyDelisted } from "./jobs/property-market.js";
import { processPushSweep } from "./jobs/push.js";
import { processRecurringTasks } from "./jobs/recurring-tasks.js";
import {
  processQuietBuyerSweep,
  processStaleLeadSweep,
  processStalePropertySweep,
} from "./jobs/stale-sweeps.js";
import { processSubscriptionExpiry } from "./jobs/subscription-expiry.js";
import { processViewingFollowup } from "./jobs/viewing-followup.js";
import { processWhatsAppNotifySweep } from "./jobs/whatsapp-notify.js";

/**
 * תהליך ה-Workers — כל עבודה כבדה רצה כאן, לעולם לא ב-Request
 * (docs/07-performance.md §2, §6).
 *
 * כל Processor: Idempotent (jobId ייחודי פר-אירוע), רץ תחת RLS עם
 * tenant שמגיע מ-payload שנוצר בשרת (לא מקלט משתמש).
 */

/** תור low משותף — כל סוג Job ממוין לפי שמו. */
async function processLow(job: Job): Promise<void> {
  if (job.name === "push-sweep") return processPushSweep();
  if (job.name === "whatsapp-notify-sweep") return processWhatsAppNotifySweep();
  if (job.name === "call-transcribe") return transcribeOneCall();
  if (job.name === "delete-object") return processCleanup(job);
  if (job.name === "offer-followup") return processOfferFollowup(job);
  if (job.name === "property-delisted") return processPropertyDelisted(job);
  if (job.name === "price-drop-reoffer") return processPriceDropReoffer(job);
  if (job.name === "viewing-followup") return processViewingFollowup(job);
  if (job.name === "lead-sla") return processLeadSla(job);
  if (job.name === "lead-sla-sweep") return processLeadSlaSweep();
  if (job.name === "daily-brief") return processDailyBrief();
  if (job.name === "stale-lead-sweep") return processStaleLeadSweep();
  if (job.name === "stale-property-sweep") return processStalePropertySweep();
  if (job.name === "quiet-buyer-sweep") return processQuietBuyerSweep();
  if (job.name === "weekly-summary") return processWeeklySummary();
  if (job.name === "viewing-feedback-digest") return processViewingFeedbackDigest();
  if (job.name === "recurring-tasks") return processRecurringTasks();
  if (job.name === "subscription-expiry") return processSubscriptionExpiry();
  if (job.name === "exclusivity-sweep") return processExclusivitySweep();
  if (job.name === "custom-automations") return processCustomAutomations(job);
  if (job.name === "pbx-silence-sweep") return processPbxSilenceSweep();
  if (job.name === "agent-events-retention") return processAgentEventsRetention();
}

// רישום סריקת ה-SLA החוזרת (רבע שעה) — כולל ריצה מיידית בעלייה,
// שמכסה לידים שנוצרו לפני שהפיצ'ר נפרס
const lowQueue = new Queue(QUEUES.low, { connection });
void lowQueue
  .upsertJobScheduler(
    "lead-sla-sweep",
    { every: 15 * 60 * 1000 },
    { name: "lead-sla-sweep" },
  )
  .catch((error: unknown) => {
    console.error(
      `lead-sla-sweep scheduler registration failed: ${String(error)}`,
    );
  });
// סורק תמלול השיחות — כל דקה, שיחה אחת בכל פעם
void lowQueue
  .upsertJobScheduler(
    "call-transcribe",
    { every: 60 * 1000 },
    { name: "call-transcribe" },
  )
  .catch((error: unknown) => {
    console.error(
      `call-transcribe scheduler registration failed: ${String(error)}`,
    );
  });
// סורק הפוש — כל 30 שניות. השהיה של חצי דקה בהתראה מקובלת; סריקה
// תכופה יותר הייתה מייצרת עומס קבוע על כל דייר בלי רווח מורגש.
void lowQueue
  .upsertJobScheduler(
    "push-sweep",
    { every: 30 * 1000 },
    { name: "push-sweep" },
  )
  .catch((error: unknown) => {
    console.error(`push-sweep scheduler registration failed: ${String(error)}`);
  });
/*
 * סורק ההתראות לוואטסאפ — כל דקה, ולא כל 30 שניות כמו הפוש.
 *
 * הודעת וואטסאפ היא צלצול בטלפון: דחייה של עד דקה אינה מורגשת,
 * והרווח האמיתי הוא שכמה התראות שנוצרו ברצף (שיחה שלא נענתה ואחריה
 * הליד שנפתח ממנה) מתקבצות להודעה אחת במקום שתיים.
 */
void lowQueue
  .upsertJobScheduler(
    "whatsapp-notify-sweep",
    { every: 60 * 1000 },
    { name: "whatsapp-notify-sweep" },
  )
  .catch((error: unknown) => {
    console.error(
      `whatsapp-notify-sweep scheduler registration failed: ${String(error)}`,
    );
  });
// משימות אוטומטיות קבועות — כל 10 דקות. הרזולוציה של הכלל היא דקה,
// אבל איחור של עד עשר דקות במשימה יומית אינו מורגש, וסריקה תכופה
// יותר הייתה מייצרת עומס קבוע בלי רווח.
void lowQueue
  .upsertJobScheduler(
    "recurring-tasks",
    { every: 10 * 60 * 1000 },
    { name: "recurring-tasks" },
  )
  .catch((error: unknown) => {
    console.error(
      `recurring-tasks scheduler registration failed: ${String(error)}`,
    );
  });
// סריקת הבלעדיויות — פעם בשעה. הרזולוציה של הכלל היא יום, ושעה
// מספיקה כדי שהתראה על מועד השליש תגיע ביום שנקבע לה. תדירות גבוהה
// יותר רק הייתה סורקת את אותן שורות בלי שדבר השתנה בהן.
void lowQueue
  .upsertJobScheduler(
    "exclusivity-sweep",
    { every: 60 * 60 * 1000 },
    { name: "exclusivity-sweep" },
  )
  .catch((error: unknown) => {
    console.error(
      `exclusivity-sweep scheduler registration failed: ${String(error)}`,
    );
  });
// שתיקת מרכזייה — פעם בשעה. הסף הקטן ביותר שאפשר להגדיר הוא שעה,
// ולכן רזולוציה גבוהה יותר רק הייתה סורקת את אותם משרדים בלי שדבר
// השתנה. ההתראה עצמה יוצאת פעם ביום לכל היותר.
void lowQueue
  .upsertJobScheduler(
    "pbx-silence-sweep",
    { every: 60 * 60 * 1000 },
    { name: "pbx-silence-sweep" },
  )
  .catch((error: unknown) => {
    console.error(
      `pbx-silence-sweep scheduler registration failed: ${String(error)}`,
    );
  });
// תפוגת מנויים — פעם בשעה. הרזולוציה מספיקה: שער הגישה עצמו נבדק
// בכל אימות Session לפי tenants.paid_until, וזה כאן רק יישור התצוגה.
void lowQueue
  .upsertJobScheduler(
    "subscription-expiry",
    { every: 60 * 60 * 1000 },
    { name: "subscription-expiry" },
  )
  .catch((error: unknown) => {
    console.error(
      `subscription-expiry scheduler registration failed: ${String(error)}`,
    );
  });
// דו"ח בוקר — 07:00 שעון ישראל, כל יום
void lowQueue
  .upsertJobScheduler(
    "daily-brief",
    { pattern: "0 7 * * *", tz: "Asia/Jerusalem" },
    { name: "daily-brief" },
  )
  .catch((error: unknown) => {
    console.error(
      `daily-brief scheduler registration failed: ${String(error)}`,
    );
  });
// סריקת "ליד מתקרר" — 09:00 שעון ישראל, כל יום (אחרי דו"ח הבוקר)
void lowQueue
  .upsertJobScheduler(
    "stale-lead-sweep",
    { pattern: "0 9 * * *", tz: "Asia/Jerusalem" },
    { name: "stale-lead-sweep" },
  )
  .catch((error: unknown) => {
    console.error(
      `stale-lead-sweep scheduler registration failed: ${String(error)}`,
    );
  });
// „נכס תקוע” ו„קונה שקט” — 09:20 ו-09:40 שעון ישראל, כל יום, אחרי „ליד שהתקרר”
void lowQueue
  .upsertJobScheduler(
    "stale-property-sweep",
    { pattern: "20 9 * * *", tz: "Asia/Jerusalem" },
    { name: "stale-property-sweep" },
  )
  .catch((error: unknown) => {
    console.error(`stale-property-sweep scheduler registration failed: ${String(error)}`);
  });
void lowQueue
  .upsertJobScheduler(
    "quiet-buyer-sweep",
    { pattern: "40 9 * * *", tz: "Asia/Jerusalem" },
    { name: "quiet-buyer-sweep" },
  )
  .catch((error: unknown) => {
    console.error(`quiet-buyer-sweep scheduler registration failed: ${String(error)}`);
  });
// סיכום שבועי לבעל המשרד — ראשון 08:00 שעון ישראל
void lowQueue
  .upsertJobScheduler(
    "weekly-summary",
    { pattern: "0 8 * * 0", tz: "Asia/Jerusalem" },
    { name: "weekly-summary" },
  )
  .catch((error: unknown) => {
    console.error(
      `weekly-summary scheduler registration failed: ${String(error)}`,
    );
  });
// „הדוח למוכר מוכן” — ראשון 09:00 שעון ישראל, שעה אחרי הסיכום השבועי
void lowQueue
  .upsertJobScheduler(
    "viewing-feedback-digest",
    { pattern: "0 9 * * 0", tz: "Asia/Jerusalem" },
    { name: "viewing-feedback-digest" },
  )
  .catch((error: unknown) => {
    console.error(
      `viewing-feedback-digest scheduler registration failed: ${String(error)}`,
    );
  });
// ניקוי יומן הסוכן — 04:00 שעון ישראל, כשהמערכת שקטה. פעם ביום
// מספיק: חלון השמירה נמדד בחודשים, לא בשעות.
void lowQueue
  .upsertJobScheduler(
    "agent-events-retention",
    { pattern: "0 4 * * *", tz: "Asia/Jerusalem" },
    { name: "agent-events-retention" },
  )
  .catch((error: unknown) => {
    console.error(
      `agent-events-retention scheduler registration failed: ${String(error)}`,
    );
  });

/**
 * דיווח הגרסה של תהליך ה-Workers.
 *
 * **לא Job בתור.** תור הוא מנגנון חלוקת עבודה: עותק אחד היה מדווח
 * בשם כולם, ובדיוק מה שרוצים לגלות — עותק שנשאר על תמונה ישנה —
 * היה נעלם. כל תהליך מדווח על עצמו, מהזיכרון שלו.
 *
 * המפתח פג מעצמו. תהליך שנפל מפסיק להופיע במסך במקום להנציח שם
 * גרסה של שירות שאינו רץ.
 */
async function reportWorkersVersion(): Promise<void> {
  try {
    await connection.set(
      WORKERS_VERSION_KEY,
      JSON.stringify({
        version: process.env["APP_VERSION"] ?? "dev",
        at: new Date().toISOString(),
      }),
      "EX",
      WORKERS_VERSION_TTL_SECONDS,
    );
  } catch (error: unknown) {
    // דיווח גרסה אינו סיבה להפיל תהליך עיבוד. שתיקה נראית במסך.
    console.error(`workers version report failed: ${String(error)}`);
  }
}
void reportWorkersVersion();
const versionTimer = setInterval(
  () => void reportWorkersVersion(),
  WORKERS_VERSION_INTERVAL_MS,
);

const workers = [
  new Worker(QUEUES.notifications, processNotification, {
    connection,
    concurrency: 10,
  }),
  new Worker(QUEUES.low, processLow, { connection, concurrency: 2 }),
  // מעבדים נוספים (ai, matching, sync) יירשמו כאן מודול-מודול.
];

for (const worker of workers) {
  worker.on("failed", (job, error) => {
    console.error(
      `[${worker.name}] job ${job?.id ?? "?"} failed: ${error.message}`,
    );
  });
}

console.warn(`Workers up: ${workers.map((w) => w.name).join(", ")}`);

async function shutdown(): Promise<void> {
  clearInterval(versionTimer);
  await Promise.allSettled(workers.map((w) => w.close()));
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
