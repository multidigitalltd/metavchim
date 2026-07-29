import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { NotificationJobSchema, QUEUES } from "@metavchim/shared";

for (const candidate of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* קובץ פגום — נסמוך על משתני הסביבה הקיימים */
    }
  }
}

/**
 * תהליך ה-Workers — כל עבודה כבדה רצה כאן, לעולם לא ב-Request
 * (docs/07-performance.md §2, §6).
 *
 * כל Processor: Idempotent (jobId ייחודי פר-אירוע), רץ תחת RLS עם
 * tenant שמגיע מ-payload שנוצר בשרת (לא מקלט משתמש).
 */

const connection = new IORedis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const prisma = new PrismaClient();

/** כתיבת התראה תחת הקשר הדייר — פוליסות ה-RLS חלות גם על ה-Worker. */
async function processNotification(job: Job): Promise<void> {
  const data = NotificationJobSchema.parse(job.data);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${data.tenantId}, true)`;

    // תזכורת מושהית נבדקת בזמן הריצה: פגישה שבוטלה/הסתיימה בינתיים —
    // אין תזכורת מטעה (ביקורת Codex, PR #2).
    if (data.type === "appointment_reminder" && data.entityId) {
      const appointment = await tx.appointment.findFirst({
        where: { id: data.entityId, tenantId: data.tenantId },
        select: { status: true },
      });
      if (!appointment || appointment.status !== "scheduled") {
        return;
      }
    }

    // תזכורת משימה: יורה רק אם המשימה עדיין פתוחה ומועד היעד הנוכחי הוא
    // בדיוק המועד שה-Job תוזמן אליו — דחייה/הסרת מועד מבטלות את ה-Job
    // הישן, ו-Worker שהתעכב עדיין מוסר תזכורת תקפה (ביקורת Codex, PR #13).
    if (data.type === "task_reminder" && data.entityId) {
      const task = await tx.task.findFirst({
        where: { id: data.entityId, tenantId: data.tenantId },
        select: { status: true, dueAt: true },
      });
      if (!task || task.status !== "open") return;
      const scheduledFor = data.scheduledFor ? new Date(data.scheduledFor).getTime() : null;
      if (scheduledFor === null || task.dueAt === null) return;
      if (task.dueAt.getTime() !== scheduledFor) return;
    }

    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId: data.tenantId,
        userId: data.recipientUserId ?? null, // NULL = התראה משרדית
        type: data.type,
        title: data.title,
        body: data.body ?? null,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
      },
    });
  });
}

const s3 = new S3Client({
  endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9000",
  region: process.env["S3_REGION"] ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env["S3_ACCESS_KEY"] ?? "",
    secretAccessKey: process.env["S3_SECRET_KEY"] ?? "",
  },
});
const CleanupJobSchema = z.object({ tenantId: z.string(), s3Key: z.string().max(512) });

/**
 * ניקוי אובייקט אחסון שמחיקתו נכשלה ב-Request (ביקורת Codex, PR #12):
 * DeleteObject אידמפוטנטי — מפתח שכבר נמחק מסתיים בהצלחה; BullMQ מנסה
 * שוב עם Backoff עד 10 פעמים.
 */
async function processCleanup(job: Job): Promise<void> {
  const { s3Key } = CleanupJobSchema.parse(job.data);
  await s3.send(
    new DeleteObjectCommand({ Bucket: process.env["S3_BUCKET"] ?? "metavchim", Key: s3Key }),
  );
}

const FollowupJobSchema = z.object({ tenantId: z.string(), offerId: z.string() });
const FOLLOWUP_TITLE = "פולו-אפ: הקונה פתח את ההצעה ולא הגיב";

/**
 * פולו-אפ הצעה (docs/01 — "כלום לא נשכח"): ה-Job תוזמן בפתיחה הראשונה
 * ויורה אחרי N שעות. אם הקונה עדיין לא הגיב — משימה לסוכן בעל הקונה
 * + התראה. אידמפוטנטי: משימת פולו-אפ פתוחה קיימת לאותו קונה — לא
 * נוצרת שנייה (ניסיון חוזר אחרי כשל חלקי בטוח).
 */
async function processOfferFollowup(job: Job): Promise<void> {
  const { tenantId, offerId } = FollowupJobSchema.parse(job.data);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const offer = await tx.offer.findFirst({ where: { id: offerId, tenantId } });
    if (!offer) return;
    // הקונה כבר הגיב (מעוניין/לא רלוונטי) — אין מה לרדוף
    if (offer.status === "interested" || offer.status === "declined") return;

    const match = await tx.match.findFirst({
      where: { id: offer.matchId, tenantId },
      select: { buyerId: true },
    });
    if (!match) return;
    const buyer = await tx.buyer.findFirst({
      where: { id: match.buyerId, tenantId, deletedAt: null },
      select: { id: true, ownerUserId: true },
    });
    if (!buyer?.ownerUserId) return;

    // נעילת שורת הקונה: שני פולו-אפים על הצעות שונות של אותו קונה
    // מסתדרים בתור — בדיקת הכפילות אטומית (ביקורת Codex)
    await tx.$executeRaw`SELECT id FROM buyers WHERE id = ${buyer.id} AND tenant_id = ${tenantId} FOR UPDATE`;
    const existing = await tx.task.findFirst({
      where: { tenantId, entityType: "buyer", entityId: buyer.id, title: FOLLOWUP_TITLE, status: "open" },
      select: { id: true },
    });
    if (existing) return;

    const presentation = offer.presentation as { title?: string } | null;
    const offerTitle = presentation?.title ?? "ההצעה";
    await tx.task.create({
      data: {
        id: ulid(),
        tenantId,
        assignedToUserId: buyer.ownerUserId,
        title: FOLLOWUP_TITLE,
        notes: `"${offerTitle}" נפתחה ולא נענתה — שווה שיחה קצרה לפני שהעניין מתקרר.`,
        dueAt: new Date(),
        entityType: "buyer",
        entityId: buyer.id,
      },
    });
    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId,
        userId: buyer.ownerUserId,
        type: "offer_followup",
        title: "⏰ הצעה ממתינה לפולו-אפ",
        body: `"${offerTitle}" נפתחה ולא נענתה — נוצרה משימה לחזור לקונה.`,
        entityType: "buyer",
        entityId: buyer.id,
      },
    });
  });
}

/** תור low משותף — כל סוג Job ממוין לפי שמו. */
async function processLow(job: Job): Promise<void> {
  if (job.name === "delete-object") return processCleanup(job);
  if (job.name === "offer-followup") return processOfferFollowup(job);
}

const workers = [
  new Worker(QUEUES.notifications, processNotification, { connection, concurrency: 10 }),
  new Worker(QUEUES.low, processLow, { connection, concurrency: 2 }),
  // מעבדים נוספים (ai, matching, sync) יירשמו כאן מודול-מודול.
];

for (const worker of workers) {
  worker.on("failed", (job, error) => {
    console.error(`[${worker.name}] job ${job?.id ?? "?"} failed: ${error.message}`);
  });
}

console.warn(`Workers up: ${workers.map((w) => w.name).join(", ")}`);

async function shutdown(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
