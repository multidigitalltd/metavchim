import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import webpush from "web-push";
import {
  NotificationJobSchema,
  QUEUES,
  diarizeTimeoutMs,
  formatDiarizedTranscript,
  nextOccurrenceUtc,
  type RecurrenceRule,
  pushOutcome,
  pushPayload,
  shouldPush,
  shouldRetireAfterFailure,
  summarizeCall,
  type SpeakerTurn,
  type TranscriptSegment,
} from "@metavchim/shared";

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

/** קריאת אובייקט מהאחסון אל הזיכרון — להזנת שירות התמלול. */
async function storageGet(key: string): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: process.env["S3_BUCKET"] ?? "metavchim", Key: key }),
  );
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`empty object: ${key}`);
  return Buffer.from(bytes);
}

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

const DelistedJobSchema = z.object({ tenantId: z.string(), propertyId: z.string() });
const ALTERNATIVE_TITLE = "הנכס ירד מהשיווק — הציעו חלופה לקונה המעוניין";

/**
 * סגירת מעגל בנכס שירד משיווק (docs/01 — "שום עסקה לא נופלת בין
 * הכיסאות"): קונה שסימן "מעוניין" בנכס שנמכר/הוקפא הוא לקוח חם שנשאר
 * בלי נכס — לכל אחד כזה נוצרת משימת חלופה לסוכן, התראה, ורשומה בציר
 * הקונה. אידמפוטנטי פר קונה (נעילה + בדיקת משימה פתוחה, כמו בפולו-אפ).
 */
async function processPropertyDelisted(job: Job): Promise<void> {
  const { tenantId, propertyId } = DelistedJobSchema.parse(job.data);

  const interested = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const matches = await tx.match.findMany({
      where: { tenantId, propertyId },
      select: { id: true, buyerId: true },
    });
    if (matches.length === 0) return [];
    const offers = await tx.offer.findMany({
      where: { tenantId, matchId: { in: matches.map((m) => m.id) }, status: "interested" },
      select: { matchId: true, presentation: true },
    });
    const byMatch = new Map(matches.map((m) => [m.id, m.buyerId]));
    return offers.map((o) => ({
      buyerId: byMatch.get(o.matchId) ?? "",
      title: (o.presentation as { title?: string } | null)?.title ?? "הנכס",
    }));
  });

  // טרנזקציה נפרדת פר קונה: כשל באחד לא מפיל את השאר, וניסיון חוזר
  // של ה-Job מדלג על מי שכבר טופל (בדיקת המשימה הפתוחה)
  for (const { buyerId, title } of interested) {
    if (buyerId === "") continue;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, tenantId, deletedAt: null },
        select: { id: true, ownerUserId: true },
      });
      if (!buyer?.ownerUserId) return;
      await tx.$executeRaw`SELECT id FROM buyers WHERE id = ${buyer.id} AND tenant_id = ${tenantId} FOR UPDATE`;
      // הדדופ ממופתח לנכס הספציפי: קונה שהתעניין בשני נכסים שירדו —
      // שתי משימות; רק ניסיון חוזר על אותו נכס נבלם (ביקורת Codex)
      const sourceKey = `delisted:${propertyId}`;
      const existing = await tx.task.findFirst({
        where: { tenantId, entityType: "buyer", entityId: buyer.id, sourceKey, status: "open" },
        select: { id: true },
      });
      if (existing) return;

      await tx.task.create({
        data: {
          id: ulid(),
          tenantId,
          assignedToUserId: buyer.ownerUserId,
          title: ALTERNATIVE_TITLE,
          notes: `"${title}" כבר לא זמין, והקונה סימן שהוא מעוניין — לקוח חם שנשאר בלי נכס. שווה להציע חלופות עוד היום.`,
          dueAt: new Date(),
          entityType: "buyer",
          entityId: buyer.id,
          sourceKey,
        },
      });
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId,
          userId: buyer.ownerUserId,
          type: "property_delisted",
          title: "🏠 קונה מעוניין נשאר בלי נכס",
          body: `"${title}" ירד מהשיווק — נוצרה משימה להציע חלופות לקונה שסימן עניין.`,
          entityType: "buyer",
          entityId: buyer.id,
        },
      });
      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId,
          buyerId: buyer.id,
          kind: "system",
          content: `הנכס "${title}" ירד מהשיווק אחרי שהקונה סימן עניין — נדרשת חלופה`,
          createdBy: null,
        },
      });
    });
  }
}

const ViewingFollowupJobSchema = z.object({ tenantId: z.string(), appointmentId: z.string() });
const VIEWING_FOLLOWUP_TITLE = "פולו-אפ אחרי סיור — איך היה?";

/**
 * פולו-אפ אחרי סיור (docs/09 שלב 2): שעה אחרי סיום הסיור, אם הסוכן
 * עוד לא רשם תוצאה — נוצרת משימת "איך היה?" + התראה. עדכון הסטטוס
 * לקונה מיד אחרי סיור הוא ההבדל בין עסקה מתקדמת לליד שמתקרר.
 * אידמפוטנטי: sourceKey לפי הפגישה, ונעילת שורת הישות כמו בשאר.
 */
async function processViewingFollowup(job: Job): Promise<void> {
  const { tenantId, appointmentId } = ViewingFollowupJobSchema.parse(job.data);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    // נעילת שורת הפגישה: PATCH של סיכום/ביטול שרץ במקביל מסתדר בתור —
    // או שה-Worker רואה את המצב החדש ומדלג, או שסגירת המשימות של ה-PATCH
    // רצה אחרי שהמשימה כבר קיימת וסוגרת אותה (ביקורת Codex)
    await tx.$executeRaw`SELECT id FROM appointments WHERE id = ${appointmentId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const appt = await tx.appointment.findFirst({ where: { id: appointmentId, tenantId } });
    if (!appt || appt.kind !== "viewing") return;
    // בוטל / לא הגיע — אין סיכום סיור; תוצאה כבר נרשמה — אין מה לדחוף
    if (appt.status === "cancelled" || appt.status === "no_show") return;
    if (appt.outcome !== null) return;
    if (!appt.createdBy) return;

    // גם סיור בלי קונה/ליד מקבל פולו-אפ — זה מסלול היצירה הנפוץ מהיומן;
    // מקשרים למה שיש: קונה → ליד → נכס → בלי קישור (ביקורת Codex, P1)
    const entity =
      appt.buyerId !== null
        ? { type: "buyer", id: appt.buyerId }
        : appt.leadId !== null
          ? { type: "lead", id: appt.leadId }
          : appt.propertyId !== null
            ? { type: "property", id: appt.propertyId }
            : null;

    const sourceKey = `viewing:${appointmentId}`;
    // הדדופ לפי sourceKey בלבד — ייחודי פר פגישה גם בלי ישות מקושרת
    const existing = await tx.task.findFirst({
      where: { tenantId, sourceKey, status: "open" },
      select: { id: true },
    });
    if (existing) return;

    const what = appt.title ?? "הסיור";
    await tx.task.create({
      data: {
        id: ulid(),
        tenantId,
        assignedToUserId: appt.createdBy,
        title: VIEWING_FOLLOWUP_TITLE,
        notes: `"${what}" הסתיים — התקשרו ללקוח ("איך היה?") ורשמו תוצאה בפגישה: אהב / לא מתאים / במשא-ומתן / צריך נכס אחר.`,
        dueAt: new Date(),
        entityType: entity?.type ?? null,
        entityId: entity?.id ?? null,
        sourceKey,
      },
    });
    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId,
        userId: appt.createdBy,
        type: "viewing_followup",
        title: "🚶 סיור הסתיים — איך היה?",
        body: `"${what}" הסתיים ועדיין אין סיכום — נוצרה משימה לחזור ללקוח ולרשום תוצאה.`,
        entityType: entity?.type ?? null,
        entityId: entity?.id ?? null,
      },
    });
  });
}

const LeadSlaJobSchema = z.object({ tenantId: z.string(), leadId: z.string() });
const LEAD_SLA_TITLE = "ליד ממתין למענה — חלון ה-SLA חלף";

/**
 * SLA לליד (docs/01 — "כל ליד מקבל מענה"): ליד שנשאר "חדש" בלי מענה
 * ראשון אחרי N שעות. משויך לסוכן — המשימה וההתראה אליו; ליד יתום
 * (וואטסאפ נכנס) — המשימה לבעלים הוותיק וההתראה לכל הבעלים הפעילים.
 * נעילת שורת הליד + sourceKey: מרוץ מול טיפול בליד לא מייצר רעש.
 */
async function escalateLeadSla(tenantId: string, leadId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.$executeRaw`SELECT id FROM leads WHERE id = ${leadId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) return;
    // טופל: הסטטוס זז או שנרשם מענה ראשון — אין אסקלציה
    if (lead.status !== "new" || lead.firstResponseAt !== null) return;

    const sourceKey = `lead-sla:${leadId}`;
    const existing = await tx.task.findFirst({
      where: { tenantId, sourceKey, status: "open" },
      select: { id: true },
    });
    if (existing) return;

    // סוכן משויך שהושבת בינתיים לא רואה משימות — נופלים לבעלים (ביקורת Codex)
    const assignedActive = lead.assignedToUserId
      ? ((await tx.user.findFirst({
          where: { id: lead.assignedToUserId, tenantId, isActive: true },
          select: { id: true },
        })) !== null)
      : false;
    const owners = await tx.user.findMany({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const assignee = assignedActive ? lead.assignedToUserId! : owners[0]?.id;
    if (!assignee) return;
    const notifyUserIds = assignedActive ? [assignee] : owners.map((o) => o.id);

    await tx.task.create({
      data: {
        id: ulid(),
        tenantId,
        assignedToUserId: assignee,
        title: LEAD_SLA_TITLE,
        notes: "הליד עדיין בסטטוס \"חדש\" ללא מענה ראשון — לקוח שמחכה עובר למתווך הבא. חזרו אליו עכשיו.",
        dueAt: new Date(),
        entityType: "lead",
        entityId: leadId,
        sourceKey,
      },
    });
    for (const userId of notifyUserIds) {
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          type: "lead_sla",
          title: "⏳ ליד ממתין למענה",
          body: "חלון ה-SLA חלף והליד עדיין ללא טיפול — נוצרה משימה לחזור ללקוח.",
          entityType: "lead",
          entityId: leadId,
        },
      });
    }
    await tx.interaction.create({
      data: {
        id: ulid(),
        tenantId,
        leadId,
        kind: "system",
        content: "חלון ה-SLA חלף — הליד עדיין ללא מענה ראשון; נוצרה משימת אסקלציה",
        createdBy: null,
      },
    });
  });
}

async function processLeadSla(job: Job): Promise<void> {
  const { tenantId, leadId } = LeadSlaJobSchema.parse(job.data);
  await escalateLeadSla(tenantId, leadId);
}

const LEAD_SLA_HOURS = Number(process.env.LEAD_SLA_HOURS ?? 2);

/**
 * סריקת רשת-ביטחון ל-SLA: ה-Job המושהה נוצר רק מאירוע lead.created
 * חדש — לידים שקדמו לפריסה (או שה-Job שלהם אבד ב-Redis) לא מכוסים
 * (ביקורת Codex). כל רבע שעה: לכל דייר, כל ליד "חדש" בלי מענה ראשון
 * שחלון ה-SLA שלו חלף עובר את אותה אסקלציה — האידמפוטנטיות של
 * escalateLeadSla (sourceKey + נעילה) מונעת כפילויות מול ה-Job המתוזמן.
 */
async function processLeadSlaSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - LEAD_SLA_HOURS * 60 * 60 * 1000);
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    // עימוד cursor: הטיפול לא משנה את שורת הליד, כך ש-take בודד היה
    // מחזיר את אותם 200 לנצח ומרעיב את השאר (ביקורת Codex)
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        return tx.lead.findMany({
          where: { tenantId: tenant.id, status: "new", firstResponseAt: null, createdAt: { lte: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take: 200,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
      });
      for (const lead of batch) await escalateLeadSla(tenant.id, lead.id);
      if (batch.length < 200) break;
      cursor = batch[batch.length - 1]!.id;
    }
  }
}

const STALE_LEAD_DAYS = Number(process.env.STALE_LEAD_DAYS ?? 7);
const OPEN_IN_PROGRESS_STATUSES = ["in_progress", "waiting_customer"];

/**
 * חימום ליד בודד שהתקרר: משימה + התראה, עם שתי הגנות כפילות —
 * משימת חימום פתוחה קיימת, או משימת חימום (גם סגורה) שנוצרה אחרי
 * הפעילות האחרונה בליד. כך סוכן שסגר משימה בלי לתעד פעילות לא
 * מקבל נדנוד יומי, אבל ליד שטופל ושוב התקרר — כן יקבל משימה חדשה.
 */
async function warmStaleLead(tenantId: string, leadId: string, cutoff: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx.$executeRaw`SELECT id FROM leads WHERE id = ${leadId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead || !OPEN_IN_PROGRESS_STATUSES.includes(lead.status)) return;

    const lastInteraction = await tx.interaction.findFirst({
      where: { tenantId, leadId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const lastActivity = new Date(
      Math.max(lead.updatedAt.getTime(), lastInteraction?.createdAt.getTime() ?? 0),
    );
    if (lastActivity > cutoff) return;

    const sourceKey = `lead-stale:${leadId}`;
    const existing = await tx.task.findFirst({
      where: {
        tenantId,
        sourceKey,
        OR: [{ status: "open" }, { createdAt: { gte: lastActivity } }],
      },
      select: { id: true },
    });
    if (existing) return;

    // סוכן משויך שהושבת בינתיים לא רואה משימות — נופלים לבעלים
    const assignedActive = lead.assignedToUserId
      ? ((await tx.user.findFirst({
          where: { id: lead.assignedToUserId, tenantId, isActive: true },
          select: { id: true },
        })) !== null)
      : false;
    const owners = await tx.user.findMany({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const assignee = assignedActive ? lead.assignedToUserId! : owners[0]?.id;
    if (!assignee) return;
    const notifyUserIds = assignedActive ? [assignee] : owners.map((o) => o.id);

    const staleDays = Math.floor((Date.now() - lastActivity.getTime()) / (24 * 60 * 60 * 1000));
    await tx.task.create({
      data: {
        id: ulid(),
        tenantId,
        assignedToUserId: assignee,
        title: "🧊 הליד מתקרר — חזרו ללקוח",
        notes: `לא נרשמה שום פעילות בליד כבר ${staleDays} ימים. שיחה קצרה עכשיו שווה יותר מהתנצלות אחר כך.`,
        dueAt: new Date(),
        entityType: "lead",
        entityId: leadId,
        sourceKey,
      },
    });
    for (const userId of notifyUserIds) {
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          type: "lead_stale",
          title: "🧊 ליד מתקרר",
          body: `ליד בטיפול ללא פעילות ${staleDays} ימים — נוצרה משימת חימום.`,
          entityType: "lead",
          entityId: leadId,
        },
      });
    }
    await tx.interaction.create({
      data: {
        id: ulid(),
        tenantId,
        leadId,
        kind: "system",
        content: `הליד ללא פעילות ${staleDays} ימים — נוצרה משימת חימום`,
        createdBy: null,
      },
    });
  });
}

/**
 * סריקת "ליד מתקרר" (docs/09 שלב 1 — "כלום לא נשכח"): ה-SLA מכסה רק
 * מענה ראשון לליד חדש; ליד שכבר בטיפול ופשוט נשכח לא היה מכוסה.
 * פעם ביום: כל ליד פתוח שלא הייתה בו פעילות STALE_LEAD_DAYS ימים
 * מקבל משימת חימום. סינון גס לפי updated_at (זול, באינדקס) ואימות
 * מדויק מול האינטראקציה האחרונה בתוך הטרנזקציה.
 */
async function processStaleLeadSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_LEAD_DAYS * 24 * 60 * 60 * 1000);
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    // עימוד cursor: החימום לא משנה את שורת הליד, כך ש-take בודד היה
    // מחזיר את אותם 200 לנצח ומרעיב את השאר (ביקורת Codex)
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        return tx.lead.findMany({
          where: {
            tenantId: tenant.id,
            status: { in: OPEN_IN_PROGRESS_STATUSES },
            updatedAt: { lte: cutoff },
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take: 200,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
      });
      for (const lead of batch) await warmStaleLead(tenant.id, lead.id, cutoff);
      if (batch.length < 200) break;
      cursor = batch[batch.length - 1]!.id;
    }
  }
}

const JERUSALEM_TZ = "Asia/Jerusalem";

/** ההיסט של שעון ישראל מ-UTC ברגע נתון (מ"ש) — תלוי-רגע, לא קבוע. */
function jerusalemOffsetMs(at: Date): number {
  const wallAsUtc = new Date(at.toLocaleString("en-US", { timeZone: JERUSALEM_TZ }));
  return wallAsUtc.getTime() - at.getTime();
}

/**
 * הרגע (UTC) שבו שעת-קיר מקומית מתרחשת: ניחוש ותיקון כפול, כי ההיסט
 * הנכון הוא זה שבתוקף ברגע המבוקש עצמו — ביום מעבר שעון ההיסט של
 * חצות שונה מההיסט של שעת ריצת ה-Job (ביקורת Codex).
 */
function jerusalemWallToUtc(wallIso: string): Date {
  const wallMs = new Date(`${wallIso}Z`).getTime();
  let guess = new Date(wallMs);
  for (let i = 0; i < 2; i++) guess = new Date(wallMs - jerusalemOffsetMs(guess));
  return guess;
}

/** גבולות היום הנוכחי בשעון ישראל, כערכי UTC לשאילתות — כל גבול בהיסט שלו. */
function jerusalemDayRange(): { start: Date; end: Date } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: JERUSALEM_TZ }).format(new Date());
  const start = jerusalemWallToUtc(`${today}T00:00:00.000`);
  // 30 שעות אחרי תחילת היום נופלות תמיד בתוך היום המקומי הבא (גם ביום של 25 שעות)
  const nextDay = new Intl.DateTimeFormat("en-CA", { timeZone: JERUSALEM_TZ }).format(
    new Date(start.getTime() + 30 * 60 * 60 * 1000),
  );
  const end = new Date(jerusalemWallToUtc(`${nextDay}T00:00:00.000`).getTime() - 1);
  return { start, end };
}


/**
 * משימות אוטומטיות קבועות — יצירת המופע שהגיע זמנו.
 *
 * הכלל שייך למשרד, המשימה שנוצרת ממנו שייכת לסוכן. כלל בלי סוכן
 * מוגדר מייצר משימה **לכל סוכן פעיל** — "לעבור על הקונים החמים" הוא
 * משימה של כל אחד בנפרד, לא משימה אחת שמישהו יסמן בשביל כולם.
 *
 * ## שעון
 *
 * `nextOccurrence` עובד על שדות מקומיים של ה-Date. תהליך ה-Worker רץ
 * ב-UTC, ולכן "09:00" היה נופל ב-12:00 בישראל. הפתרון הוא לעבוד
 * כולו ב"מרחב שעון-קיר": ממירים את נקודת הייחוס לשעת קיר ירושלמית,
 * מריצים את החישוב שם, וממירים את התוצאה בחזרה ל-UTC. אותה תבנית
 * שכבר משרתת את דו"ח הבוקר.
 *
 * ## אידמפוטנטיות
 *
 * `sourceKey` נגזר מהכלל ומהמופע, ו-`lastRunAt` מתעדכן באותה
 * טרנזקציה. ריצה כפולה של הסורק — או שתי מכונות Worker — לא תיצור
 * את אותה משימה פעמיים.
 */
const RECURRING_PAGE = 50;

async function processRecurringTasks(): Promise<void> {
  const now = new Date();
  /*
   * הכללים נשלפים דייר-דייר ולא בשאילתה אחת.
   *
   * `task_recurrences` תחת FORCE RLS: שאילתה בלי `app.tenant_id`
   * מחזירה אפס שורות **בלי שגיאה**, כלומר הסורק היה רץ כל עשר דקות
   * ולא עושה דבר, בלי לוג ובלי כשל. זו אותה תבנית של שאר הסורקים
   * כאן, ומאותה סיבה בדיוק.
   */
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const rules: {
    id: string;
    tenantId: string;
    title: string;
    notes: string | null;
    frequency: string;
    weekdays: number[];
    dayOfMonth: number | null;
    hour: number;
    minute: number;
    assignedToUserId: string | null;
    lastRunAt: Date | null;
    createdAt: Date;
  }[] = [];
  for (const tenant of tenants) {
    /*
     * עימוד cursor ולא take בודד.
     *
     * הכללים לא משנים סדר בין הסריקות, ולכן `take: 50` היה מחזיר
     * לנצח את אותם חמישים הראשונים — וכלל מספר 51 של משרד גדול לא
     * היה נוצר אף פעם, בלי שגיאה ובלי שאיש ישים לב (ביקורת Codex).
     */
    let cursor: string | undefined;
    for (;;) {
      const page = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        return tx.taskRecurrence.findMany({
          where: { tenantId: tenant.id, isActive: true },
          orderBy: { id: "asc" },
          take: RECURRING_PAGE,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
      });
      rules.push(...page);
      if (page.length < RECURRING_PAGE) break;
      cursor = page[page.length - 1]!.id;
    }
  }

  for (const rule of rules) {
    const spec: RecurrenceRule = {
      frequency: rule.frequency as RecurrenceRule["frequency"],
      weekdays: rule.weekdays,
      ...(rule.dayOfMonth !== null ? { dayOfMonth: rule.dayOfMonth } : {}),
      hour: rule.hour,
      minute: rule.minute,
    };
    const since = rule.lastRunAt ?? rule.createdAt;
    // ההמרה לשעון ישראל ובחזרה נעשית ב-shared, באותה פונקציה שהמסך
    // משתמש בה לתצוגת "המופע הבא" — אחרת השתיים היו נפרדות
    const dueAt = nextOccurrenceUtc(spec, since);
    if (dueAt === null || dueAt > now) continue;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${rule.tenantId}, true)`;

        /*
         * העדכון המותנה הוא המנעול.
         * שתי מכונות Worker שסורקות במקביל יגיעו לאותו כלל; רק זו
         * שה-lastRunAt שראתה עדיין תקף תצליח לעדכן, והשנייה תצא
         * בלי ליצור כלום.
         */
        const claimed = await tx.taskRecurrence.updateMany({
          where: { id: rule.id, lastRunAt: rule.lastRunAt },
          data: { lastRunAt: dueAt },
        });
        if (claimed.count === 0) return;

        const targets = rule.assignedToUserId
          ? [{ id: rule.assignedToUserId }]
          : await tx.user.findMany({
              where: { tenantId: rule.tenantId, isActive: true },
              select: { id: true },
            });
        if (targets.length === 0) return;

        const sourceKey = `recurrence:${rule.id}:${dueAt.toISOString()}`;
        await tx.task.createMany({
          data: targets.map((user) => ({
            id: ulid(),
            tenantId: rule.tenantId,
            assignedToUserId: user.id,
            title: rule.title,
            notes: rule.notes,
            dueAt,
            sourceKey,
          })),
          skipDuplicates: true,
        });
      });
    } catch (error) {
      // כלל אחד שנכשל לא עוצר את השאר — הוא ינוסה בסריקה הבאה
      console.error(`recurring-task ${rule.id} failed: ${String(error)}`);
    }
  }
}

/**
 * דו"ח בוקר יומי (docs/09 שלב 1 — "תזכורות למתווך"): כל בוקר ב-07:00
 * שעון ישראל, כל סוכן פעיל מקבל התראה אחת עם תמונת היום שלו —
 * פגישות היום, משימות להיום/באיחור, ולידים שממתינים למענה.
 * בלי רעש: אין כלום — אין התראה. אידמפוטנטי פר יום (בדיקת קיים).
 */
async function processDailyBrief(): Promise<void> {
  const { start, end } = jerusalemDayRange();
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    // מספר שאילתות קבוע פר דייר (groupBy + createMany), לא פר סוכן —
    // כדי שהטרנזקציה תישאר הרחק מתחת ל-timeout של Prisma (ביקורת Codex)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      const users = await tx.user.findMany({
        where: { tenantId: tenant.id, isActive: true },
        select: { id: true, role: true },
      });
      if (users.length === 0) return;

      const [sentToday, meetingRows, taskRows, leadRows] = await Promise.all([
        tx.notification.findMany({
          where: { tenantId: tenant.id, type: "daily_brief", createdAt: { gte: start } },
          select: { userId: true },
        }),
        tx.appointment.groupBy({
          by: ["createdBy"],
          where: { tenantId: tenant.id, status: "scheduled", startsAt: { gte: start, lte: end } },
          _count: { _all: true },
        }),
        tx.task.groupBy({
          by: ["assignedToUserId"],
          where: { tenantId: tenant.id, status: "open", dueAt: { lte: end } },
          _count: { _all: true },
        }),
        tx.lead.groupBy({
          by: ["assignedToUserId"],
          where: { tenantId: tenant.id, status: "new", firstResponseAt: null },
          _count: { _all: true },
        }),
      ]);
      const alreadySent = new Set(sentToday.map((n) => n.userId));
      const meetingsBy = new Map(meetingRows.map((r) => [r.createdBy, r._count._all]));
      const tasksBy = new Map(taskRows.map((r) => [r.assignedToUserId, r._count._all]));
      const leadsBy = new Map(leadRows.map((r) => [r.assignedToUserId, r._count._all]));
      const orphanLeads = leadsBy.get(null) ?? 0;

      const rows: {
        id: string;
        tenantId: string;
        userId: string;
        type: string;
        title: string;
        body: string;
      }[] = [];
      for (const user of users) {
        if (alreadySent.has(user.id)) continue;
        const meetings = meetingsBy.get(user.id) ?? 0;
        const tasks = tasksBy.get(user.id) ?? 0;
        // לידים יתומים מוצגים לבעלים — הם האחראים כשאין משויך
        const waitingLeads = (leadsBy.get(user.id) ?? 0) + (user.role === "owner" ? orphanLeads : 0);
        if (meetings === 0 && tasks === 0 && waitingLeads === 0) continue;

        const parts: string[] = [];
        if (meetings > 0) parts.push(meetings === 1 ? "פגישה אחת היום" : `${meetings} פגישות היום`);
        if (tasks > 0) parts.push(tasks === 1 ? "משימה אחת להיום" : `${tasks} משימות להיום`);
        if (waitingLeads > 0)
          parts.push(waitingLeads === 1 ? "ליד אחד ממתין למענה" : `${waitingLeads} לידים ממתינים למענה`);

        rows.push({
          id: ulid(),
          tenantId: tenant.id,
          userId: user.id,
          type: "daily_brief",
          title: "☀️ דו\"ח בוקר",
          body: `${parts.join(" · ")} — הדשבורד מחכה לכם.`,
        });
      }
      if (rows.length > 0) await tx.notification.createMany({ data: rows });
    });
  }
}

/**
 * סיכום שבועי לבעל המשרד — ראשון 08:00 שעון ישראל, על 7 הימים שחלפו:
 * לידים חדשים ושיעור מענה, הצעות (נשלחו/נפתחו/מעוניינים), סיורים
 * שהתקיימו והמרות. משלים את דו"ח הבוקר של הסוכן ברמה העסקית.
 * הולך רק ל-owner/admin (בעלי view_all). אידמפוטנטי פר שבוע.
 */
async function processWeeklySummary(): Promise<void> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // עוגן לוח-שנה יציב — יום ראשון 00:00 UTC האחרון: חלון 6 ימים מתגלגל
  // היה משתיק את השבוע העוקב אחרי ריצה שהתעכבה ליום שני (ביקורת Codex)
  const weekAnchor = new Date(now);
  weekAnchor.setUTCHours(0, 0, 0, 0);
  weekAnchor.setUTCDate(weekAnchor.getUTCDate() - weekAnchor.getUTCDay());
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      // נעילת advisory פר-דייר: התור רץ ב-concurrency: 2, ושני Jobs
      // כפולים היו עוברים שניהם את בדיקת הקיום לפני שאחד כותב (ביקורת Codex)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-summary:${tenant.id}`}))`;
      const managers = await tx.user.findMany({
        where: { tenantId: tenant.id, isActive: true, role: { in: ["owner", "admin"] } },
        select: { id: true },
      });
      if (managers.length === 0) return;
      // כבר נשלח סיכום עבור השבוע הקלנדרי הנוכחי
      const already = await tx.notification.findFirst({
        where: { tenantId: tenant.id, type: "weekly_summary", createdAt: { gte: weekAnchor } },
        select: { id: true },
      });
      if (already) return;

      const [newLeads, answered, converted, offersSent, offersOpened, offersInterested, viewingsHeld] =
        await Promise.all([
          tx.lead.count({ where: { tenantId: tenant.id, createdAt: { gte: weekAgo } } }),
          tx.lead.count({
            where: { tenantId: tenant.id, createdAt: { gte: weekAgo }, firstResponseAt: { not: null } },
          }),
          tx.lead.count({ where: { tenantId: tenant.id, status: "converted", updatedAt: { gte: weekAgo } } }),
          tx.offer.count({ where: { tenantId: tenant.id, sentAt: { gte: weekAgo } } }),
          tx.offer.count({ where: { tenantId: tenant.id, firstOpenedAt: { gte: weekAgo } } }),
          // ל-Offer אין updatedAt — "מעוניינים" נספרים מתוך הצעות שנשלחו השבוע
          tx.offer.count({
            where: { tenantId: tenant.id, status: "interested", sentAt: { gte: weekAgo } },
          }),
          tx.appointment.count({
            where: { tenantId: tenant.id, kind: "viewing", status: "completed", startsAt: { gte: weekAgo, lte: now } },
          }),
        ]);
      // משרד שקט לגמרי — אין מה לסכם, אין רעש
      if (newLeads + offersSent + offersOpened + viewingsHeld + converted === 0) return;

      const parts: string[] = [];
      const answeredPct = newLeads > 0 ? Math.round((answered / newLeads) * 100) : null;
      parts.push(`${newLeads} לידים חדשים${answeredPct === null ? "" : ` (${answeredPct}% נענו)`}`);
      if (offersSent + offersOpened + offersInterested > 0)
        parts.push(`הצעות: ${offersSent} נשלחו · ${offersOpened} נפתחו · ${offersInterested} מעוניינים`);
      if (viewingsHeld > 0) parts.push(`${viewingsHeld} סיורים התקיימו`);
      if (converted > 0) parts.push(`${converted} לידים הפכו ללקוחות 🎉`);

      await tx.notification.createMany({
        data: managers.map((m) => ({
          id: ulid(),
          tenantId: tenant.id,
          userId: m.id,
          type: "weekly_summary",
          title: "📊 סיכום שבועי",
          body: parts.join(" | ").slice(0, 500),
        })),
      });
    });
  }
}


/* ==================== תמלול וסיכום שיחות ==================== */

/**
 * סורק השיחות שממתינות לתמלול (docs/09 שלב 2).
 *
 * אותה תבנית של סורק הפוש ומאותה סיבה: העלאת ההקלטה רק מסמנת
 * `pending`, והעבודה הכבדה קורית כאן. תמלול של שיחה בת עשר דקות
 * אורך דקות על CPU — בקשת HTTP שממתינה לו נופלת על timeout
 * ומשאירה את המתווך בלי מושג מה קרה.
 *
 * אחת בכל סבב, לא בקבוצה: שירות התמלול מוגבל במקבילות (STT_CONCURRENCY),
 * ושליחת חמש הקלטות במקביל רק תייצר 429 ותאט את כולן.
 */
/** תקרת שדה התוכן של ציר הזמן; הטקסט המלא נשאר על כרטיס השיחה. */
const INTERACTION_CONTENT_LIMIT = 4000;

const CALL_TRANSCRIBE_TIMEOUT_MS = Number(process.env["STT_TIMEOUT_MS"] ?? 180_000);

/**
 * מבקש את תורי הדיבור מהשירות האופציונלי של זיהוי הדוברים.
 *
 * חלון הזמן נגזר מאורך ההקלטה ולא מקבוע: קבוע קצר היה מפיל *כל*
 * שיחה ארוכה אחרי שהשרת כבר עשה את העבודה, וקבוע ארוך היה משאיר
 * כשל אמיתי תוקע את התור (המקבילות היא 1). ראו diarizeTimeoutMs.
 *
 * מחזיר מערך ריק בכל כשל — וזו החלטה מכוונת: שיחה מתומללת בלי
 * תוויות דובר עדיפה בהרבה על שיחה שנופלת ל-failed בגלל שירות
 * שהוא ממילא תוספת. הכשל נרשם ללוג ולא מגיע למתווך.
 */
async function fetchSpeakerTurns(audio: Uint8Array, audioSeconds: number): Promise<SpeakerTurn[]> {
  const diarizeUrl = process.env["DIARIZE_URL"];
  const sttSecret = process.env["STT_SECRET"];
  if (!diarizeUrl || !sttSecret) return [];

  try {
    const form = new FormData();
    form.append("file", new Blob([audio]), "call.webm");
    const res = await fetch(`${diarizeUrl}/diarize`, {
      method: "POST",
      headers: { "x-stt-secret": sttSecret },
      body: form,
      signal: AbortSignal.timeout(diarizeTimeoutMs(audioSeconds)),
    });
    if (!res.ok) throw new Error(`diarize ${res.status}`);
    const body = (await res.json()) as { turns?: SpeakerTurn[] };
    return body.turns ?? [];
  } catch (error) {
    console.error(`[call-transcribe] diarization skipped: ${String(error)}`);
    return [];
  }
}

async function transcribeOneCall(): Promise<void> {
  const sttUrl = process.env["STT_URL"];
  const sttSecret = process.env["STT_SECRET"];
  if (!sttUrl || !sttSecret) return;

  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    const pending = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      const row = await tx.call.findFirst({
        where: { tenantId: tenant.id, transcriptionStatus: "pending" },
        orderBy: { occurredAt: "asc" },
        select: { id: true, recordingKey: true, leadId: true, contactId: true },
      });
      if (!row?.recordingKey) return null;
      // תפיסה אטומית: שני סבבים חופפים לא ייקחו את אותה שיחה
      const claimed = await tx.call.updateMany({
        where: { id: row.id, tenantId: tenant.id, transcriptionStatus: "pending" },
        data: { transcriptionStatus: "running" },
      });
      return claimed.count === 1 ? row : null;
    });
    if (!pending?.recordingKey) continue;

    try {
      const audio = new Uint8Array(await storageGet(pending.recordingKey));
      const form = new FormData();
      form.append("file", new Blob([audio]), "call.webm");
      const res = await fetch(`${sttUrl}/transcribe`, {
        method: "POST",
        headers: { "x-stt-secret": sttSecret },
        body: form,
        signal: AbortSignal.timeout(CALL_TRANSCRIBE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`stt ${res.status}`);
      const body = (await res.json()) as {
        text?: string;
        segments?: TranscriptSegment[];
        durationSeconds?: number;
      };
      /*
       * זיהוי הדוברים רץ *אחרי* התמלול ולא במקביל לו — שני המודלים
       * מתחרים על אותן ליבות, והרצה במקביל רק מאריכה את שניהם.
       */
      const segments = body.segments ?? [];
      // אורך ההקלטה מגיע מהתמלול עצמו; כשהוא חסר נגזר מהמקטע האחרון
      const audioSeconds = body.durationSeconds ?? segments[segments.length - 1]?.end ?? 0;
      const turns = segments.length > 0 ? await fetchSpeakerTurns(audio, audioSeconds) : [];
      const diarized = formatDiarizedTranscript(segments, turns);
      // נפילה חזרה ל-text כשהשירות הישן עדיין לא מחזיר segments
      const transcript = (diarized.text || body.text || "").trim();
      // הסיכום מחולץ מהטקסט הנקי, בלי תוויות הדובר וחותמות הזמן —
      // ביטויי המפתח שהוא מחפש היו נשברים על "[01:15] דובר 2:"
      const { summary } = summarizeCall((body.text ?? "").trim() || transcript);

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        await tx.call.updateMany({
          where: { id: pending.id, tenantId: tenant.id },
          data: {
            transcript,
            // הסיכום נכתב רק כשלא נרשם אחד ידנית — מה שהמתווך
            // כתב בעצמו גובר תמיד על החילוץ האוטומטי
            ...(summary ? { summary } : {}),
            transcriptionStatus: "done",
            transcribedAt: new Date(),
          },
        });
        /*
         * ציר הזמן של הלקוח מקבל את הסיכום **ואת התמלול המלא**.
         *
         * הסיכום לבדו לא מספיק: מתווך שחוזר לשיחה מלפני חודש רוצה
         * לדעת מה בדיוק נאמר, לא רק "הביע עניין · 4 חדרים". התמלול
         * נחתך לתקרת השדה כדי שלא ייחסם בכתיבה — הטקסט המלא נשאר
         * תמיד על כרטיס השיחה.
         */
        const timelineText = summary
          ? `סיכום שיחה: ${summary}${transcript ? `\n\n${transcript}` : ""}`
          : transcript;
        if (timelineText) {
          const content = timelineText.slice(0, INTERACTION_CONTENT_LIMIT);
          if (pending.leadId) {
            await tx.interaction.create({
              data: {
                id: ulid(),
                tenantId: tenant.id,
                leadId: pending.leadId,
                kind: "system",
                content,
                createdBy: null,
              },
            });
          }
          // שיחה שאינה קשורה לליד אך כן לאיש קשר — הכרטיס שלו הוא
          // כרטיס הקונה, ושם ציר הזמן מוצג לפי buyerId
          if (!pending.leadId && pending.contactId) {
            const buyer = await tx.buyer.findFirst({
              where: { tenantId: tenant.id, contactId: pending.contactId, deletedAt: null },
              select: { id: true },
            });
            if (buyer) {
              await tx.interaction.create({
                data: {
                  id: ulid(),
                  tenantId: tenant.id,
                  buyerId: buyer.id,
                  kind: "system",
                  content,
                  createdBy: null,
                },
              });
            }
          }
        }
      });
    } catch (error) {
      console.error(`[call-transcribe] ${pending.id} failed: ${String(error)}`);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        await tx.call.updateMany({
          where: { id: pending.id, tenantId: tenant.id },
          data: { transcriptionStatus: "failed" },
        });
      });
    }
    // שיחה אחת לסבב — הסבב הבא בעוד דקה ייקח את הבאה בתור
    return;
  }
}

/* ==================== התראות פוש בדפדפן ==================== */

/**
 * סורק ההתראות שטרם נדחפו.
 *
 * למה סורק ולא שליחה בכל מקום שיוצר התראה: שורות `notifications`
 * נכתבות מתריסר מקומות שונים בקובץ הזה וב-API, וכל מקום חדש היה
 * צריך לזכור גם לדחוף. סורק על `pushed_at IS NULL` מכסה את כולם —
 * גם את מי שייכתב בעתיד — והוא אידמפוטנטי מטבעו: סריקה שנפלה
 * באמצע פשוט תרים את מה שנשאר בפעם הבאה.
 *
 * הסימון `pushed_at` נכתב **גם** להתראה שאין לה נמענים ולזו שסוננה
 * ע"י `shouldPush`. אחרת כל סריקה הייתה שולפת אותן מחדש לנצח.
 */
const PUSH_BATCH = 100;
/** לא מנסים לדחוף התראה ישנה — פוש שמגיע יום אחרי האירוע הוא רעש. */
const PUSH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

let pushConfigured: boolean | null = null;

function configurePush(): boolean {
  if (pushConfigured !== null) return pushConfigured;
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"];
  pushConfigured = Boolean(publicKey && privateKey && subject);
  if (pushConfigured) {
    webpush.setVapidDetails(subject as string, publicKey as string, privateKey as string);
  }
  return pushConfigured;
}

async function processPushSweep(): Promise<void> {
  if (!configurePush()) return;
  const since = new Date(Date.now() - PUSH_MAX_AGE_MS);
  const tenants = await prisma.tenant.findMany({ select: { id: true } });

  for (const tenant of tenants) {
    // השליחה עצמה יוצאת החוצה לרשת ולכן אינה יושבת בתוך טרנזקציה:
    // עשרות בקשות HTTP בתוך טרנזקציה אחת היו מחזיקות חיבור DB פתוח
    // לשניות ארוכות. קוראים בטרנזקציה, שולחים מחוצה לה, מסמנים בשנייה.
    const pending = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.notification.findMany({
        where: { tenantId: tenant.id, pushedAt: null, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: PUSH_BATCH,
        select: {
          id: true,
          userId: true,
          type: true,
          title: true,
          body: true,
          entityType: true,
          entityId: true,
        },
      });
    });
    if (pending.length === 0) continue;

    const subscriptions = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.pushSubscription.findMany({ where: { tenantId: tenant.id } });
    });

    const byUser = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions) {
      const list = byUser.get(sub.userId) ?? [];
      list.push(sub);
      byUser.set(sub.userId, list);
    }

    const retire: string[] = [];
    const bumpFailure: string[] = [];
    const succeeded: string[] = [];

    for (const notification of pending) {
      if (!shouldPush(notification)) continue;
      // התראה משרדית (userId ריק) הולכת לכל מי שנרשם במשרד
      const targets = notification.userId
        ? (byUser.get(notification.userId) ?? [])
        : subscriptions;
      const payload = JSON.stringify(pushPayload(notification));

      for (const sub of targets) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          succeeded.push(sub.id);
        } catch (error: unknown) {
          const status =
            typeof error === "object" && error !== null && "statusCode" in error
              ? Number((error as { statusCode: unknown }).statusCode)
              : 0;
          const outcome = pushOutcome(status);
          if (outcome === "retire" || shouldRetireAfterFailure(sub.failureCount + 1)) {
            retire.push(sub.id);
          } else if (outcome !== "delivered") {
            bumpFailure.push(sub.id);
          }
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      // כולן מסומנות, גם המסוננות — אחרת הן יישלפו שוב בכל סריקה
      await tx.notification.updateMany({
        where: { tenantId: tenant.id, id: { in: pending.map((n) => n.id) } },
        data: { pushedAt: new Date() },
      });
      if (succeeded.length > 0) {
        await tx.pushSubscription.updateMany({
          where: { tenantId: tenant.id, id: { in: succeeded } },
          data: { failureCount: 0, lastSuccessAt: new Date() },
        });
      }
      if (bumpFailure.length > 0) {
        await tx.pushSubscription.updateMany({
          where: { tenantId: tenant.id, id: { in: bumpFailure } },
          data: { failureCount: { increment: 1 } },
        });
      }
      if (retire.length > 0) {
        await tx.pushSubscription.deleteMany({
          where: { tenantId: tenant.id, id: { in: retire } },
        });
      }
    });
  }
}

/** תור low משותף — כל סוג Job ממוין לפי שמו. */
async function processLow(job: Job): Promise<void> {
  if (job.name === "push-sweep") return processPushSweep();
  if (job.name === "call-transcribe") return transcribeOneCall();
  if (job.name === "delete-object") return processCleanup(job);
  if (job.name === "offer-followup") return processOfferFollowup(job);
  if (job.name === "property-delisted") return processPropertyDelisted(job);
  if (job.name === "viewing-followup") return processViewingFollowup(job);
  if (job.name === "lead-sla") return processLeadSla(job);
  if (job.name === "lead-sla-sweep") return processLeadSlaSweep();
  if (job.name === "daily-brief") return processDailyBrief();
  if (job.name === "stale-lead-sweep") return processStaleLeadSweep();
  if (job.name === "weekly-summary") return processWeeklySummary();
  if (job.name === "recurring-tasks") return processRecurringTasks();
}

// רישום סריקת ה-SLA החוזרת (רבע שעה) — כולל ריצה מיידית בעלייה,
// שמכסה לידים שנוצרו לפני שהפיצ'ר נפרס
const lowQueue = new Queue(QUEUES.low, { connection });
void lowQueue
  .upsertJobScheduler("lead-sla-sweep", { every: 15 * 60 * 1000 }, { name: "lead-sla-sweep" })
  .catch((error: unknown) => {
    console.error(`lead-sla-sweep scheduler registration failed: ${String(error)}`);
  });
// סורק תמלול השיחות — כל דקה, שיחה אחת בכל פעם
void lowQueue
  .upsertJobScheduler("call-transcribe", { every: 60 * 1000 }, { name: "call-transcribe" })
  .catch((error: unknown) => {
    console.error(`call-transcribe scheduler registration failed: ${String(error)}`);
  });
// סורק הפוש — כל 30 שניות. השהיה של חצי דקה בהתראה מקובלת; סריקה
// תכופה יותר הייתה מייצרת עומס קבוע על כל דייר בלי רווח מורגש.
void lowQueue
  .upsertJobScheduler("push-sweep", { every: 30 * 1000 }, { name: "push-sweep" })
  .catch((error: unknown) => {
    console.error(`push-sweep scheduler registration failed: ${String(error)}`);
  });
// משימות אוטומטיות קבועות — כל 10 דקות. הרזולוציה של הכלל היא דקה,
// אבל איחור של עד עשר דקות במשימה יומית אינו מורגש, וסריקה תכופה
// יותר הייתה מייצרת עומס קבוע בלי רווח.
void lowQueue
  .upsertJobScheduler("recurring-tasks", { every: 10 * 60 * 1000 }, { name: "recurring-tasks" })
  .catch((error: unknown) => {
    console.error(`recurring-tasks scheduler registration failed: ${String(error)}`);
  });
// דו"ח בוקר — 07:00 שעון ישראל, כל יום
void lowQueue
  .upsertJobScheduler("daily-brief", { pattern: "0 7 * * *", tz: "Asia/Jerusalem" }, { name: "daily-brief" })
  .catch((error: unknown) => {
    console.error(`daily-brief scheduler registration failed: ${String(error)}`);
  });
// סריקת "ליד מתקרר" — 09:00 שעון ישראל, כל יום (אחרי דו"ח הבוקר)
void lowQueue
  .upsertJobScheduler("stale-lead-sweep", { pattern: "0 9 * * *", tz: "Asia/Jerusalem" }, { name: "stale-lead-sweep" })
  .catch((error: unknown) => {
    console.error(`stale-lead-sweep scheduler registration failed: ${String(error)}`);
  });
// סיכום שבועי לבעל המשרד — ראשון 08:00 שעון ישראל
void lowQueue
  .upsertJobScheduler("weekly-summary", { pattern: "0 8 * * 0", tz: "Asia/Jerusalem" }, { name: "weekly-summary" })
  .catch((error: unknown) => {
    console.error(`weekly-summary scheduler registration failed: ${String(error)}`);
  });

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
