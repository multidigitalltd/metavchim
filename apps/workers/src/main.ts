import { createDecipheriv } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient, type Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import webpush from "web-push";
import {
  NotificationJobSchema,
  QUEUES,
  AutomationActionSchema,
  AutomationConditionSchema,
  automationTrigger,
  conditionsMatch,
  DEFAULT_PLANS,
  effectiveFeatures,
  diarizeTimeoutMs,
  formatDiarizedTranscript,
  nextOccurrenceUtc,
  sanitizeFeatures,
  subscriptionGrantsAccess,
  type SubscriptionStatus,
  type PlanFeature,
  type RecurrenceRule,
  pushOutcome,
  pushPayload,
  shouldPush,
  shouldRetireAfterFailure,
  followUpFromCall,
  summarizeCall,
  WORKERS_VERSION_KEY,
  WORKERS_VERSION_TTL_SECONDS,
  WORKERS_VERSION_INTERVAL_MS,
  EXCLUSIVITY_WARNING_DAYS,
  EXCLUSIVITY_THIRD_WARNING_DAYS,
  MIN_MARKETING_ACTIONS,
  describeExclusivity,
  exclusivityState,
  type ExclusivitySubject,
  type MarketingActionKind,
  type SpeakerTurn,
  type TranscriptSegment,
  assistantMemoryTurn,
  conversationLockKey,
  dailyBriefBody,
  mergeStoredTurns,
  parseStoredTurns,
  formatNotifyMessage,
  inQuietHours,
  type AgentHistoryTurn,
  fitsInteractive,
  normalizePhoneForWhatsapp,
  replyButtonsPayload,
  splitForWhatsApp,
  parseWhatsAppNotifyPrefs,
  sessionWindowOpen,
  shouldNotifyByWhatsApp,
  templateParams,
  resolveAutomationSettings,
  automationThresholdMs,
  type AutomationKey,
  type AutomationSettings,
} from "@metavchim/shared";

for (const candidate of [
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), ".env"),
]) {
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

const connection = new IORedis(
  process.env["REDIS_URL"] ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);
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
        select: { status: true, dueAt: true, assignedToUserId: true },
      });
      if (!task || task.status !== "open") return;
      const scheduledFor = data.scheduledFor
        ? new Date(data.scheduledFor).getTime()
        : null;
      if (scheduledFor === null || task.dueAt === null) return;
      if (task.dueAt.getTime() !== scheduledFor) return;
      /*
       * גם **מי אחראי** נבדק, לא רק הסטטוס והמועד.
       *
       * מאז שאפשר להעביר משימה לסוכן אחר, העברה בלי שינוי מועד
       * משאירה את ה-Job הישן תקף לגמרי לפי שתי הבדיקות שמעליו —
       * ואז שני אנשים מקבלים תזכורת, כולל מי שכבר אינו אחראי, עם
       * הכותרת המעודכנת של המשימה (ביקורת Codex).
       *
       * הבדיקה כאן ולא בשליחה: `task.created` נשלח גם ביצירה וגם
       * בהעברה, וה-Job הישן כבר יושב בתור ואי אפשר לבטלו.
       */
      if (
        data.recipientUserId &&
        task.assignedToUserId !== data.recipientUserId
      )
        return;
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
const CleanupJobSchema = z.object({
  tenantId: z.string(),
  s3Key: z.string().max(512),
});

/** קריאת אובייקט מהאחסון אל הזיכרון — להזנת שירות התמלול. */
async function storageGet(key: string): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: process.env["S3_BUCKET"] ?? "metavchim",
      Key: key,
    }),
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
    new DeleteObjectCommand({
      Bucket: process.env["S3_BUCKET"] ?? "metavchim",
      Key: s3Key,
    }),
  );
}

const FollowupJobSchema = z.object({
  tenantId: z.string(),
  offerId: z.string(),
});
const FOLLOWUP_TITLE = "פולו-אפ: הקונה פתח את ההצעה ולא הגיב";

/**
 * פולו-אפ הצעה (docs/01 — "כלום לא נשכח"): ה-Job תוזמן בפתיחה הראשונה
 * ויורה אחרי N שעות. אם הקונה עדיין לא הגיב — משימה לסוכן בעל הקונה
 * + התראה. אידמפוטנטי: משימת פולו-אפ פתוחה קיימת לאותו קונה — לא
 * נוצרת שנייה (ניסיון חוזר אחרי כשל חלקי בטוח).
 */
/*
 * הבדיקה גם בזמן הירייה ולא רק בתזמון.
 *
 * ה-Job מתוזמן עם השהיה של שעות; משרד שכיבה את האוטומציה בינתיים לא
 * ביקש לקבל את המשימה שנקבעה לפני יומיים, וביטול Job שכבר יושב בתור
 * אינו אפשרי. אותו דפוס בדיוק כמו תזכורת משימה שנבדקת מחדש בירייה.
 */
async function processOfferFollowup(job: Job): Promise<void> {
  const { tenantId, offerId } = FollowupJobSchema.parse(job.data);
  if (!(await automationOn(tenantId, "offer_followup"))) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const offer = await tx.offer.findFirst({
      where: { id: offerId, tenantId },
    });
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
      where: {
        tenantId,
        entityType: "buyer",
        entityId: buyer.id,
        title: FOLLOWUP_TITLE,
        status: "open",
      },
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

const DelistedJobSchema = z.object({
  tenantId: z.string(),
  propertyId: z.string(),
});
const ALTERNATIVE_TITLE = "הנכס ירד מהשיווק — הציעו חלופה לקונה המעוניין";

/**
 * סגירת מעגל בנכס שירד משיווק (docs/01 — "שום עסקה לא נופלת בין
 * הכיסאות"): קונה שסימן "מעוניין" בנכס שנמכר/הוקפא הוא לקוח חם שנשאר
 * בלי נכס — לכל אחד כזה נוצרת משימת חלופה לסוכן, התראה, ורשומה בציר
 * הקונה. אידמפוטנטי פר קונה (נעילה + בדיקת משימה פתוחה, כמו בפולו-אפ).
 */
async function processPropertyDelisted(job: Job): Promise<void> {
  const { tenantId, propertyId } = DelistedJobSchema.parse(job.data);
  if (!(await automationOn(tenantId, "property_delisted"))) return;

  const interested = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const matches = await tx.match.findMany({
      where: { tenantId, propertyId },
      select: { id: true, buyerId: true },
    });
    if (matches.length === 0) return [];
    const offers = await tx.offer.findMany({
      where: {
        tenantId,
        matchId: { in: matches.map((m) => m.id) },
        status: "interested",
      },
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
        where: {
          tenantId,
          entityType: "buyer",
          entityId: buyer.id,
          sourceKey,
          status: "open",
        },
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

const ViewingFollowupJobSchema = z.object({
  tenantId: z.string(),
  appointmentId: z.string(),
});
const VIEWING_FOLLOWUP_TITLE = "פולו-אפ אחרי סיור — איך היה?";

/**
 * פולו-אפ אחרי סיור (docs/09 שלב 2): שעה אחרי סיום הסיור, אם הסוכן
 * עוד לא רשם תוצאה — נוצרת משימת "איך היה?" + התראה. עדכון הסטטוס
 * לקונה מיד אחרי סיור הוא ההבדל בין עסקה מתקדמת לליד שמתקרר.
 * אידמפוטנטי: sourceKey לפי הפגישה, ונעילת שורת הישות כמו בשאר.
 */
/* גם כאן — הכיבוי חייב לתפוס Job שכבר ממתין בתור */
async function processViewingFollowup(job: Job): Promise<void> {
  const { tenantId, appointmentId } = ViewingFollowupJobSchema.parse(job.data);
  if (!(await automationOn(tenantId, "viewing_followup"))) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    // נעילת שורת הפגישה: PATCH של סיכום/ביטול שרץ במקביל מסתדר בתור —
    // או שה-Worker רואה את המצב החדש ומדלג, או שסגירת המשימות של ה-PATCH
    // רצה אחרי שהמשימה כבר קיימת וסוגרת אותה (ביקורת Codex)
    await tx.$executeRaw`SELECT id FROM appointments WHERE id = ${appointmentId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const appt = await tx.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });
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
/*
 * בלי המילה SLA: המתווך שקורא את המשימה לא חי את הז'רגון הזה,
 * ו"חלון ה-SLA חלף" נקרא כמו תקלה טכנית (דיווח המשתמש). אומרים
 * את הדבר עצמו — עבר יותר מדי זמן בלי מענה.
 */
const LEAD_SLA_TITLE = "לחזור לליד — מחכה יותר מדי זמן בלי מענה";

/**
 * SLA לליד (docs/01 — "כל ליד מקבל מענה"): ליד שנשאר "חדש" בלי מענה
 * ראשון אחרי N שעות. משויך לסוכן — המשימה וההתראה אליו; ליד יתום
 * (וואטסאפ נכנס) — המשימה לבעלים הוותיק וההתראה לכל הבעלים הפעילים.
 * נעילת שורת הליד + sourceKey: מרוץ מול טיפול בליד לא מייצר רעש.
 */
async function escalateLeadSla(
  tenantId: string,
  leadId: string,
): Promise<void> {
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
      ? (await tx.user.findFirst({
          where: { id: lead.assignedToUserId, tenantId, isActive: true },
          select: { id: true },
        })) !== null
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
        notes:
          'הליד עדיין בסטטוס "חדש" ללא מענה ראשון — לקוח שמחכה עובר למתווך הבא. חזרו אליו עכשיו.',
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
          body: "עבר יותר מדי זמן והליד עדיין ללא טיפול — נוצרה משימה לחזור ללקוח.",
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
        content:
          "עבר יותר מדי זמן בלי מענה ראשון — נוצרה משימת תזכורת לחזור ללקוח",
        createdBy: null,
      },
    });
  });
}

async function processLeadSla(job: Job): Promise<void> {
  const { tenantId, leadId } = LeadSlaJobSchema.parse(job.data);
  /*
   * הכיבוי נבדק גם כאן ולא רק בסוויפ.
   *
   * ההסלמה רצה בשני מסלולים: Job מושהה שנוצר מ-`lead.created`,
   * וסריקת רשת-ביטחון. כיסוי הסוויף בלבד הותיר את המסלול **הראשי**
   * פתוח — משרד שכיבה את האוטומציה היה ממשיך לקבל בדיוק את המשימות
   * שביקש לא לקבל, כי ה-Job כבר ישב בתור (ביקורת Codex).
   */
  if (!(await automationOn(tenantId, "lead_sla"))) return;
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
/**
 * מנויים שתקופתם הסתיימה ⟵ `past_due`.
 *
 * **הסורק הזה אינו שער האבטחה.** הגישה נחסמת ב-`tenantCanOperate`
 * לפי `tenants.paid_until`, בכל אימות Session, בלי תלות בכך שמשהו
 * ירוץ — סורק שנפל היה אחרת נותן גישה חינם לכל מי ששילם פעם אחת.
 * מה שהסורק עושה הוא ליישר את מצב המנוי לתצוגה: בלעדיו מסך החיוב
 * היה מציג "מנוי פעיל" למשרד שתקופתו נגמרה.
 *
 * מבוטל שתקופתו נגמרה נכנס גם הוא — הוא כבר לא "בוטל, זמין עד",
 * הוא פשוט נגמר.
 */
async function processSubscriptionExpiry(): Promise<void> {
  const now = new Date();
  const candidates = await prisma.subscription.findMany({
    where: {
      status: { in: ["active", "cancelled"] },
      currentPeriodEnd: { not: null, lte: now },
    },
    select: { tenantId: true, status: true, currentPeriodEnd: true },
    take: 500,
  });

  let expired = 0;
  for (const row of candidates) {
    // אותו כלל שהמסך מציג, ולא העתק שלו
    if (
      subscriptionGrantsAccess(
        row.status as SubscriptionStatus,
        row.currentPeriodEnd,
        now,
      )
    ) {
      continue;
    }
    // מותנה בסטטוס שנקרא: תשלום שנכנס בין הקריאה לכתיבה לא נדרס
    const changed = await prisma.subscription.updateMany({
      where: {
        tenantId: row.tenantId,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd,
      },
      data: { status: "past_due" },
    });
    expired += changed.count;
  }
  if (expired > 0)
    console.warn(`[subscription-expiry] ${expired} מנויים סומנו כהסתיימו`);
}

/**
 * סריקת הבלעדיויות — **המקום היחיד שבו כלל השליש מדבר.**
 *
 * סעיף 9(ב2) מסיים בלעדיות בתום שליש מהתקופה כשלא בוצעו פעולות
 * השיווק. זה קורה בשקט: אין אירוע, אין הודעה, ואיש לא נדרש לעשות
 * דבר — הבלעדיות פשוט כבר לא בתוקף. משרד מגלה את זה כשהמוכר מוכר
 * לבד, וזה מאוחר בחודשיים.
 *
 * הסריקה עושה שני דברים: **מתריעה לפני** מועד השליש כשחסרות פעולות,
 * ו**סוגרת** תקופה שהגיעה לסופה כדי שהמסך לא יציג בלעדיות שאיננה.
 *
 * כל אבן דרך מתריעה **פעם אחת בלבד**, לפי `type` ייחודי שמעוגן
 * במזהה התקופה — אחרת אותה הודעה הייתה חוזרת בכל שעה במשך שבועות,
 * וזו הדרך הבטוחה להרגיל את המשרד להתעלם.
 */
async function processExclusivitySweep(): Promise<void> {
  const now = new Date();
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let closed = 0;
  let notified = 0;

  for (const tenant of tenants) {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.propertyExclusivity.findMany({
        where: { tenantId: tenant.id, endedAt: null },
        take: 500,
      });
    });
    if (rows.length === 0) continue;

    for (const row of rows) {
      try {
        const result = await sweepOneExclusivity(tenant.id, row.id, now);
        if (result.closed) closed += 1;
        notified += result.notified;
      } catch (error: unknown) {
        console.error(`[exclusivity-sweep] ${row.id}: ${String(error)}`);
      }
    }
  }
  if (closed > 0 || notified > 0) {
    console.warn(
      `[exclusivity-sweep] ${closed} תקופות נסגרו, ${notified} התראות נשלחו`,
    );
  }
}

async function sweepOneExclusivity(
  tenantId: string,
  exclusivityId: string,
  now: Date,
): Promise<{ closed: boolean; notified: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const row = await tx.propertyExclusivity.findFirst({
      where: { id: exclusivityId, tenantId, endedAt: null },
    });
    if (!row) return { closed: false, notified: 0 };

    const actions = await tx.marketingAction.findMany({
      where: { exclusivityId, tenantId },
      select: { kind: true, performedAt: true, brokerCount: true },
    });
    const state = exclusivityState(
      {
        subject: row.subject as ExclusivitySubject,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        agreedCustomAction: row.agreedCustomAction,
      },
      actions.map((a) => ({
        kind: a.kind as MarketingActionKind,
        performedAt: a.performedAt,
        ...(a.brokerCount === null ? {} : { brokerCount: a.brokerCount }),
      })),
      now,
    );

    const owners = await tx.user.findMany({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    /** התראה אחת לכל אבן דרך, אי פעם. */
    const notifyOnce = async (
      type: string,
      title: string,
      body: string,
    ): Promise<number> => {
      const already = await tx.notification.findFirst({
        where: {
          tenantId,
          type,
          entityType: "exclusivity",
          entityId: exclusivityId,
        },
        select: { id: true },
      });
      if (already || owners.length === 0) return 0;
      for (const owner of owners) {
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId,
            userId: owner.id,
            type,
            title,
            body,
            entityType: "exclusivity",
            entityId: exclusivityId,
          },
        });
      }
      return 1;
    };

    let notified = 0;

    if (state.phase === "ended_by_third_rule") {
      notified += await notifyOnce(
        "exclusivity_ended_third",
        "הבלעדיות הסתיימה במועד השליש",
        describeExclusivity(state),
      );
    } else if (state.phase === "expired") {
      notified += await notifyOnce(
        "exclusivity_expired",
        "תקופת הבלעדיות הסתיימה",
        describeExclusivity(state),
      );
    } else if (state.phase === "at_risk" && state.daysToThird !== null) {
      if (state.daysToThird <= EXCLUSIVITY_THIRD_WARNING_DAYS) {
        notified += await notifyOnce(
          "exclusivity_third_risk",
          `⚠️ הבלעדיות בסיכון — נותרו ${state.daysToThird} ימים`,
          `${describeExclusivity(state)} נדרשות ${MIN_MARKETING_ACTIONS} פעולות שיווק שונות; תועדו ${state.counted.length}.`,
        );
      }
    } else if (state.phase === "active") {
      /*
       * הסף הקטן ביותר שמתאים, ולא כל מי שגדול מ-`daysLeft`.
       * סריקה שרצה לראשונה כשנותרו חמישה ימים אמורה לשלוח הודעה
       * אחת ("נותר שבוע"), ולא גם את זו של שלושים היום שחלפו.
       */
      const threshold = EXCLUSIVITY_WARNING_DAYS.filter(
        (d) => state.daysLeft <= d,
      ).pop();
      // סף שגדול מהתקופה כולה אינו רלוונטי: בלעדיות של 30 יום לא
      // מתחילה בהודעה "נותרו 30 יום" ביום שנחתמה
      const spanDays = Math.round(
        (row.endsAt.getTime() - row.startsAt.getTime()) / 86_400_000,
      );
      if (threshold !== undefined && threshold < spanDays) {
        notified += await notifyOnce(
          `exclusivity_ending_${threshold}`,
          `הבלעדיות מסתיימת בעוד ${state.daysLeft} ימים`,
          `${describeExclusivity(state)} זה הזמן לדבר עם בעל הנכס על חידוש.`,
        );
      }
    }

    /*
     * סגירה אוטומטית — אבל רק על תקופה שהגיעה לסופה **בלוח השנה**.
     *
     * בלעדיות שכלל השליש סיים אינה נסגרת כאן בכוונה: זו מסקנה
     * משפטית שנויה במחלוקת אפשרית (המשרד עשוי לטעון שפעולה בוצעה
     * ולא תועדה), וסגירה אוטומטית שלה הייתה מוחקת מהמערכת בלעדיות
     * שאולי בתוקף. המערכת אומרת את מה שהיא רואה, ומשאירה את
     * ההכרעה לאדם.
     */
    let closedNow = false;
    if (now.getTime() >= row.endsAt.getTime()) {
      const changed = await tx.propertyExclusivity.updateMany({
        where: { id: exclusivityId, endedAt: null },
        data: { endedAt: now, endReason: "expired" },
      });
      if (changed.count > 0) {
        closedNow = true;
        await tx.property.updateMany({
          where: { id: row.propertyId, tenantId },
          data: { exclusive: false, exclusiveUntil: null },
        });
      }
    }

    return { closed: closedNow, notified };
  });
}

async function processLeadSlaSweep(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    /*
     * הסף הוא של המשרד ולא של המערכת.
     *
     * קודם הוא היה משתנה סביבה אחד לכל המשרדים: משרד שמעדיף שעה
     * ומשרד שמעדיף יום קיבלו את אותה התנהגות, ואף אחד מהם לא ידע
     * שיש כאן הגדרה בכלל (`AUTOMATIONS.lead_sla`).
     */
    const settings = await automationSettings(tenant.id);
    if (!settings.lead_sla.enabled) continue;
    const cutoff = new Date(
      Date.now() -
        (automationThresholdMs("lead_sla", settings) ??
          LEAD_SLA_HOURS * 60 * 60 * 1000),
    );
    // עימוד cursor: הטיפול לא משנה את שורת הליד, כך ש-take בודד היה
    // מחזיר את אותם 200 לנצח ומרעיב את השאר (ביקורת Codex)
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        return tx.lead.findMany({
          where: {
            tenantId: tenant.id,
            status: "new",
            firstResponseAt: null,
            createdAt: { lte: cutoff },
          },
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
async function warmStaleLead(
  tenantId: string,
  leadId: string,
  cutoff: Date,
): Promise<void> {
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
      Math.max(
        lead.updatedAt.getTime(),
        lastInteraction?.createdAt.getTime() ?? 0,
      ),
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
      ? (await tx.user.findFirst({
          where: { id: lead.assignedToUserId, tenantId, isActive: true },
          select: { id: true },
        })) !== null
      : false;
    const owners = await tx.user.findMany({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const assignee = assignedActive ? lead.assignedToUserId! : owners[0]?.id;
    if (!assignee) return;
    const notifyUserIds = assignedActive ? [assignee] : owners.map((o) => o.id);

    const staleDays = Math.floor(
      (Date.now() - lastActivity.getTime()) / (24 * 60 * 60 * 1000),
    );
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
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    const settings = await automationSettings(tenant.id);
    if (!settings.stale_lead.enabled) continue;
    const cutoff = new Date(
      Date.now() -
        (automationThresholdMs("stale_lead", settings) ??
          STALE_LEAD_DAYS * 24 * 60 * 60 * 1000),
    );
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
  const wallAsUtc = new Date(
    at.toLocaleString("en-US", { timeZone: JERUSALEM_TZ }),
  );
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
  for (let i = 0; i < 2; i++)
    guess = new Date(wallMs - jerusalemOffsetMs(guess));
  return guess;
}

/** גבולות היום הנוכחי בשעון ישראל, כערכי UTC לשאילתות — כל גבול בהיסט שלו. */
function jerusalemDayRange(): { start: Date; end: Date } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: JERUSALEM_TZ,
  }).format(new Date());
  const start = jerusalemWallToUtc(`${today}T00:00:00.000`);
  // 30 שעות אחרי תחילת היום נופלות תמיד בתוך היום המקומי הבא (גם ביום של 25 שעות)
  const nextDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: JERUSALEM_TZ,
  }).format(new Date(start.getTime() + 30 * 60 * 60 * 1000));
  const end = new Date(  // נושא-שעת-קיר
    jerusalemWallToUtc(`${nextDay}T00:00:00.000`).getTime() - 1,
  );
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
    updatedAt: Date;
  }[] = [];
  for (const tenant of tenants) {
    /*
     * זכאות המסלול נבדקת **בסריקה** ולא רק בשמירה. משרד שירד מסלול
     * נשאר עם הכללים שהגדיר, ובלי הבדיקה הזו הוא היה ממשיך לקבל
     * משימות אוטומטיות בחינם לנצח. הכללים נשארים גלויים וניתנים
     * לכיבוי ומחיקה — רק ההרצה נעצרת (ביקורת Codex).
     */
    if (!(await tenantHasFeature(tenant.id, "automations"))) continue;

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
        /*
         * התפיסה מותנית גם ב-`updatedAt` וגם ב-`isActive`.
         *
         * הסריקה מחזיקה עותק בזיכרון, וכל שינוי בין הקריאה לתפיסה —
         * השהיה, שעה חדשה, נמען אחר, כותרת אחרת — לא נוגע ב-lastRunAt
         * ולכן לא היה נתפס. התוצאה: משימה שנוצרת לפי לוח שכבר לא
         * קיים, ולפעמים לאדם הלא נכון (ביקורת Codex).
         *
         * כלל שהשתנה פשוט יידחה כאן ויטופל בסריקה הבאה עם הערכים
         * המעודכנים — עשר דקות איחור, ולא משימה שגויה.
         */
        const claimed = await tx.taskRecurrence.updateMany({
          where: {
            id: rule.id,
            lastRunAt: rule.lastRunAt,
            updatedAt: rule.updatedAt,
            isActive: true,
          },
          data: { lastRunAt: dueAt },
        });
        if (claimed.count === 0) return;

        /*
         * גם נמען מפורש חייב להיות פעיל.
         *
         * סוכן שהושבת מאבד את ה-Sessions שלו, ולכן משימות שנוצרות לו
         * אינן נראות לאיש ואי אפשר לסמן אותן — הכלל היה ממשיך להתקדם
         * ולצבור שורות שלא ניתנות להשלמה (ביקורת Codex). אותה שאילתה
         * בדיוק של הענף הקבוצתי, רק מצומצמת לנמען אחד.
         */
        const targets = await tx.user.findMany({
          where: {
            tenantId: rule.tenantId,
            isActive: true,
            ...(rule.assignedToUserId ? { id: rule.assignedToUserId } : {}),
          },
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

        /*
         * התראה לכל נמען — אחרת המשימה מופיעה בשקט.
         *
         * משימה שנוצרת ידנית רושמת אירוע Outbox שהופך לתזכורת במועד,
         * אבל משימה חוזרת נוצרת **כשהמועד כבר הגיע** — אין למה
         * לתזמן. בלי ההתראה כאן היא פשוט מופיעה ברשימה, והסוכן מגלה
         * אותה רק כשהוא נכנס לבדוק (ביקורת Codex).
         *
         * createMany באותה טרנזקציה של המשימות: אם היצירה נכשלת, גם
         * ההתראה לא נשלחת, ואין תזכורת למשימה שלא קיימת.
         */
        await tx.notification.createMany({
          data: targets.map((user) => ({
            id: ulid(),
            tenantId: rule.tenantId,
            userId: user.id,
            type: "task.due",
            title: rule.title,
            body: rule.notes,
            entityType: "task",
          })),
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
    if (!(await automationOn(tenant.id, "daily_brief"))) continue;
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
          where: {
            tenantId: tenant.id,
            type: "daily_brief",
            createdAt: { gte: start },
          },
          select: { userId: true },
        }),
        /*
         * ‎**היומן של מי — `ownerUserId`, לא מי שהקליד.**
         *
         * הספירה הקודמת קיבצה לפי `createdBy`, והסכימה עצמה מזהירה
         * שזה אינו אותו דבר: פגישה שמנהל קובע לסוכן שייכת ליומן של
         * הסוכן — והדו"ח שלה הופיע אצל המנהל. שורות ולא groupBy,
         * כי הדו"ח אומר עכשיו גם **מתי הראשונה ומה היא** — תדריך,
         * לא מונה. היום של משרד אחד קטן ממילא, והמיון מהמסד.
         */
        /*
         * בלי תקרה, בכוונה: `take` היה משמיט בשקט את הפגישות
         * המאוחרות של יום עמוס — ספירה חסרה, ומי שכל פגישותיו אחרי
         * החיתוך נשאר בלי דו"ח (ביקורת Codex). התוצאה תחומה ממילא
         * ביום אחד של משרד אחד, והשדות מינימליים.
         */
        tx.appointment.findMany({
          where: {
            tenantId: tenant.id,
            status: "scheduled",
            startsAt: { gte: start, lte: end },
          },
          orderBy: { startsAt: "asc" },
          select: { ownerUserId: true, createdBy: true, startsAt: true, kind: true },
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
      const meetingsBy = new Map<
        string | null,
        { count: number; first?: { startsAt: Date; kind: string } }
      >();
      for (const row of meetingRows) {
        const owner = row.ownerUserId ?? row.createdBy;
        const entry = meetingsBy.get(owner) ?? { count: 0 };
        entry.count += 1;
        // הרשימה ממוינת עולה — הראשונה שנראית היא המוקדמת ביותר
        if (entry.first === undefined) {
          entry.first = { startsAt: row.startsAt, kind: row.kind };
        }
        meetingsBy.set(owner, entry);
      }
      const tasksBy = new Map(
        taskRows.map((r) => [r.assignedToUserId, r._count._all]),
      );
      const leadsBy = new Map(
        leadRows.map((r) => [r.assignedToUserId, r._count._all]),
      );
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
        const meetings = meetingsBy.get(user.id) ?? { count: 0 };
        const tasks = tasksBy.get(user.id) ?? 0;
        // לידים יתומים מוצגים לבעלים — הם האחראים כשאין משויך
        const waitingLeads =
          (leadsBy.get(user.id) ?? 0) +
          (user.role === "owner" ? orphanLeads : 0);
        // הניסוח בחבילה המשותפת — טקסט של הסוכן חי במקום אחד
        const brief = dailyBriefBody({ meetings, tasks, waitingLeads });
        if (brief === null) continue;

        rows.push({
          id: ulid(),
          tenantId: tenant.id,
          userId: user.id,
          type: "daily_brief",
          title: brief.title,
          body: brief.body,
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
    if (!(await automationOn(tenant.id, "weekly_summary"))) continue;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      // נעילת advisory פר-דייר: התור רץ ב-concurrency: 2, ושני Jobs
      // כפולים היו עוברים שניהם את בדיקת הקיום לפני שאחד כותב (ביקורת Codex)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-summary:${tenant.id}`}))`;
      const managers = await tx.user.findMany({
        where: {
          tenantId: tenant.id,
          isActive: true,
          role: { in: ["owner", "admin"] },
        },
        select: { id: true },
      });
      if (managers.length === 0) return;
      // כבר נשלח סיכום עבור השבוע הקלנדרי הנוכחי
      const already = await tx.notification.findFirst({
        where: {
          tenantId: tenant.id,
          type: "weekly_summary",
          createdAt: { gte: weekAnchor },
        },
        select: { id: true },
      });
      if (already) return;

      const [
        newLeads,
        answered,
        converted,
        offersSent,
        offersOpened,
        offersInterested,
        viewingsHeld,
      ] = await Promise.all([
        tx.lead.count({
          where: { tenantId: tenant.id, createdAt: { gte: weekAgo } },
        }),
        tx.lead.count({
          where: {
            tenantId: tenant.id,
            createdAt: { gte: weekAgo },
            firstResponseAt: { not: null },
          },
        }),
        tx.lead.count({
          where: {
            tenantId: tenant.id,
            status: "converted",
            updatedAt: { gte: weekAgo },
          },
        }),
        tx.offer.count({
          where: { tenantId: tenant.id, sentAt: { gte: weekAgo } },
        }),
        tx.offer.count({
          where: { tenantId: tenant.id, firstOpenedAt: { gte: weekAgo } },
        }),
        // ל-Offer אין updatedAt — "מעוניינים" נספרים מתוך הצעות שנשלחו השבוע
        tx.offer.count({
          where: {
            tenantId: tenant.id,
            status: "interested",
            sentAt: { gte: weekAgo },
          },
        }),
        tx.appointment.count({
          where: {
            tenantId: tenant.id,
            kind: "viewing",
            status: "completed",
            startsAt: { gte: weekAgo, lte: now },
          },
        }),
      ]);
      // משרד שקט לגמרי — אין מה לסכם, אין רעש
      if (newLeads + offersSent + offersOpened + viewingsHeld + converted === 0)
        return;

      const parts: string[] = [];
      const answeredPct =
        newLeads > 0 ? Math.round((answered / newLeads) * 100) : null;
      parts.push(
        `${newLeads} לידים חדשים${answeredPct === null ? "" : ` (${answeredPct}% נענו)`}`,
      );
      if (offersSent + offersOpened + offersInterested > 0)
        parts.push(
          `הצעות: ${offersSent} נשלחו · ${offersOpened} נפתחו · ${offersInterested} מעוניינים`,
        );
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

const CALL_TRANSCRIBE_TIMEOUT_MS = Number(
  process.env["STT_TIMEOUT_MS"] ?? 180_000,
);

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
async function fetchSpeakerTurns(
  audio: Uint8Array,
  audioSeconds: number,
): Promise<SpeakerTurn[]> {
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

/**
 * זכאות המסלול — בתוך ה-Worker.
 *
 * השער בשרת חוסם העלאת הקלטה חדשה, אבל הסורק ממשיך לעבוד על מה
 * שכבר בתור. משרד שהפיצ'ר בוטל אצלו היה ממשיך לקבל תמלולים —
 * ולצרוך STT ו-diarization — עד שהתור מתרוקן (ביקורת Codex).
 *
 * הקטלוג נקרא ישירות מהטבלה (היא ברמת הפלטפורמה, בלי RLS) ונופל
 * לברירות המחדל שבקוד, בדיוק כמו PlanCatalogService בשרת. מטמון קצר
 * כדי לא לשאול בכל סריקה.
 */
/**
 * הגדרת האוטומציות של משרד.
 *
 * נקראת בכל סוויפ ובכל Job, ולכן היא במטמון קצר: הסוויפים עוברים על
 * כל המשרדים בלופ, וקריאה לכל משרד בכל סבב הייתה שאילתה מיותרת על
 * נתון שמשתנה פעם בשבוע. חצי דקה קצרה מכדי שמישהו ישים לב, וארוכה
 * מספיק כדי לחסוך את הלופ.
 *
 * חוסר או שגיאה נופלים לברירת המחדל דרך `resolveAutomationSettings` —
 * אוטומציה שנכבית בגלל תקלת קריאה היא בדיוק התקלה שאי אפשר לאבחן.
 */
const AUTOMATION_CACHE_TTL_MS = 30_000;
const automationCache = new Map<
  string,
  { settings: AutomationSettings; until: number }
>();

async function automationSettings(
  tenantId: string,
): Promise<AutomationSettings> {
  const now = Date.now();
  const hit = automationCache.get(tenantId);
  if (hit && hit.until > now) return hit.settings;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const raw = (tenant?.settings ?? {}) as Record<string, unknown>;
  const settings = resolveAutomationSettings(raw["automations"]);
  automationCache.set(tenantId, {
    settings,
    until: now + AUTOMATION_CACHE_TTL_MS,
  });
  return settings;
}

/** האם האוטומציה פועלת אצל המשרד. */
async function automationOn(
  tenantId: string,
  key: AutomationKey,
): Promise<boolean> {
  return (await automationSettings(tenantId))[key].enabled;
}

const PLAN_CACHE_TTL_MS = 30_000;
let planCache: { features: Map<string, PlanFeature[]>; until: number } | null =
  null;

async function planFeatures(): Promise<Map<string, PlanFeature[]>> {
  const now = Date.now();
  if (planCache && planCache.until > now) return planCache.features;
  const rows = await prisma.plan.findMany({
    select: { code: true, features: true },
  });
  const features = new Map<string, PlanFeature[]>();
  for (const plan of DEFAULT_PLANS) features.set(plan.code, [...plan.features]);
  for (const row of rows)
    features.set(row.code, sanitizeFeatures(row.features));
  planCache = { features, until: now + PLAN_CACHE_TTL_MS };
  return features;
}

/**
 * מסלול שאינו נפתר אינו מזכה בכלום — אותו כיוון בטוח כמו בשרת.
 *
 * חריגי הפלטפורמה נקראים **גם כאן** ולא רק ב-API. תמלול שנפתח
 * למשרד מעבר למסלול היה נראה פתוח במסך ולא רץ בפועל, ותכונה
 * שנסגרה הייתה ממשיכה לרוץ ברקע — שתי תקלות שאיש אינו מדווח עליהן
 * כי שום מסך אינו סותר אותן.
 */
async function tenantHasFeature(
  tenantId: string,
  feature: PlanFeature,
): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, featureGrants: true, featureDenials: true },
  });
  if (!tenant) return false;
  const planCodes = (await planFeatures()).get(tenant.plan);
  if (!planCodes) return false;
  return effectiveFeatures(planCodes, {
    grants: tenant.featureGrants,
    denials: tenant.featureDenials,
  }).includes(feature);
}

async function transcribeOneCall(): Promise<void> {
  const sttUrl = process.env["STT_URL"];
  const sttSecret = process.env["STT_SECRET"];
  if (!sttUrl || !sttSecret) return;

  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    // המסלול נבדק לפני התפיסה: תור קיים אינו עוקף ביטול של הפיצ'ר
    if (!(await tenantHasFeature(tenant.id, "transcription"))) continue;
    const pending = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      const row = await tx.call.findFirst({
        where: { tenantId: tenant.id, transcriptionStatus: "pending" },
        orderBy: { occurredAt: "asc" },
        select: {
          id: true,
          recordingKey: true,
          leadId: true,
          contactId: true,
          // מי תיעד את השיחה — עליו תיפול משימת ההמשך
          createdBy: true,
        },
      });
      if (!row?.recordingKey) return null;
      // תפיסה אטומית: שני סבבים חופפים לא ייקחו את אותה שיחה
      const claimed = await tx.call.updateMany({
        where: {
          id: row.id,
          tenantId: tenant.id,
          transcriptionStatus: "pending",
        },
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
      const audioSeconds =
        body.durationSeconds ?? segments[segments.length - 1]?.end ?? 0;
      const turns =
        segments.length > 0 ? await fetchSpeakerTurns(audio, audioSeconds) : [];
      const diarized = formatDiarizedTranscript(segments, turns);
      // נפילה חזרה ל-text כשהשירות הישן עדיין לא מחזיר segments
      const transcript = (diarized.text || body.text || "").trim();
      // הסיכום מחולץ מהטקסט הנקי, בלי תוויות הדובר וחותמות הזמן —
      // ביטויי המפתח שהוא מחפש היו נשברים על "[01:15] דובר 2:"
      const parsedCall = summarizeCall((body.text ?? "").trim() || transcript);
      const { summary, highlights } = parsedCall;
      const followUp = followUpFromCall(parsedCall, new Date());
      /** המשימה שנוצרה, אם נוצרה — קובעת את נוסח ההתראה היחידה. */
      let followUpNotice:
        | {
            reason: string;
            entity: { entityType: "lead" | "buyer"; entityId: string };
          }
        | undefined;

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        await tx.call.updateMany({
          where: { id: pending.id, tenantId: tenant.id },
          data: {
            transcript,
            // הסיכום נכתב רק כשלא נרשם אחד ידנית — מה שהמתווך
            // כתב בעצמו גובר תמיד על החילוץ האוטומטי
            ...(summary ? { summary } : {}),
            /*
             * ‎**השדות שחולצו נשמרים, ולא רק השורה שנבנתה מהם.**
             *
             * ‎`summarizeCall` מחזיר גם `highlights` — תקציב, חדרים,
             * אזור ומועד חזרה — ועד כה הם נזרקו כאן, כך שמה שנשאר
             * היה מחרוזת אחת שאי אפשר לסנן לפיה או להזין ממנה שדה
             * בכרטיס. הם נכתבים תמיד, גם ריקים: „לא זוהה דבר” הוא
             * עובדה על השיחה, ולא היעדר עדכון.
             */
            highlights,
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
        /*
         * הכרטיס שהשיחה שייכת אליו. שיחה שאינה קשורה לליד אך כן
         * לאיש קשר מוצגת בכרטיס הקונה שלו, ושם ציר הזמן לפי buyerId.
         * החיפוש נעשה פעם אחת ומשמש גם את ציר הזמן וגם את משימת
         * ההמשך — קודם הוא ישב בתוך בלוק ציר הזמן, ומשימה לא הייתה
         * יכולה להיתלות על אותו כרטיס.
         */
        const buyerForCall =
          !pending.leadId && pending.contactId
            ? await tx.buyer.findFirst({
                where: {
                  tenantId: tenant.id,
                  contactId: pending.contactId,
                  deletedAt: null,
                },
                select: { id: true },
              })
            : null;
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
          if (buyerForCall) {
            await tx.interaction.create({
              data: {
                id: ulid(),
                tenantId: tenant.id,
                buyerId: buyerForCall.id,
                kind: "system",
                content,
                createdBy: null,
              },
            });
          }
        }

        /*
         * משימת ההמשך שהשיחה מחייבת.
         *
         * עד כה התמלול נכתב לציר הזמן ונגמר שם — ההבטחה "אחזור אליך
         * ביום ראשון" נשמרה כטקסט ואיש לא הזכיר אותה ביום ראשון.
         * הכללים (מתי כן ומתי בשום אופן לא) יושבים ב-`followUpFromCall`
         * ומכוסים בבדיקות; כאן רק הכתיבה.
         *
         * בתוך אותה טרנזקציה של הסיכום: משימה בלי הסיכום שהצדיק
         * אותה, או סיכום בלי המשימה שהובטחה בו, הם שני מצבים גרועים
         * יותר מלנסות שוב.
         */
        /*
         * המשימה נתלית על כרטיס שאפשר לפתוח — ליד או קונה. שיחה עם
         * איש קשר שאין לו כרטיס קונה אינה מייצרת משימה: משימה שאי
         * אפשר ללחוץ עליה כדי להגיע ללקוח היא תזכורת בלי כתובת.
         */
        const followUpEntity = pending.leadId
          ? ({ entityType: "lead", entityId: pending.leadId } as const)
          : buyerForCall
            ? ({ entityType: "buyer", entityId: buyerForCall.id } as const)
            : null;
        if (followUp && pending.createdBy && followUpEntity) {
          const entity = followUpEntity;
          /*
           * מפתח לפי השיחה ולא לפי הכרטיס: תמלול רץ פעם אחת לשיחה,
           * ולקוח שדיבר פעמיים ראוי לשתי משימות. הבדיקה מגנה מפני
           * ריצה חוזרת של אותה שיחה.
           */
          const sourceKey = `call-followup:${pending.id}`;
          const already = await tx.task.findFirst({
            where: { tenantId: tenant.id, sourceKey },
            select: { id: true },
          });
          const assigneeActive =
            (await tx.user.findFirst({
              where: {
                id: pending.createdBy,
                tenantId: tenant.id,
                isActive: true,
              },
              select: { id: true },
            })) !== null;
          if (!already && assigneeActive) {
            await tx.task.create({
              data: {
                id: ulid(),
                tenantId: tenant.id,
                assignedToUserId: pending.createdBy,
                title: followUp.title,
                notes: followUp.reason,
                priority: followUp.priority,
                dueAt: followUp.dueAt,
                ...entity,
                sourceKey,
              },
            });
            followUpNotice = { reason: followUp.reason, entity };
          }
        }

        /*
         * **התראה אחת לכל תמלול**, ולא אחת לתמלול ואחת למשימה.
         *
         * עד כה התראה נשלחה **רק** כשהתמלול הניב משימת המשך, ורק
         * כשהיו לה גם מתעד וגם כרטיס מקושר. כלומר רוב התמלולים
         * הסתיימו בלי שאיש ידע — ומסך השיחות אינו מרענן את עצמו,
         * אז הדרך היחידה לגלות הייתה לטעון אותו מחדש ולנחש.
         *
         * שתי התראות על אותה שיחה היו שני צלצולים על אירוע אחד;
         * לכן ההודעה אחת, והיא מספרת גם על המשימה כשנוצרה.
         */
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: tenant.id,
            /*
             * ‎`createdBy`‎ ריק בשיחה שהגיעה מהמרכזייה ולא תועדה
             * ביד. `null` פירושו התראה לכל המשרד — עדיף מהתראה
             * שאיש אינו מקבל.
             */
            userId: pending.createdBy ?? null,
            type: followUpNotice ? "call_follow_up" : "call_transcribed",
            title: followUpNotice
              ? "התמלול מוכן — ונוצרה משימת המשך"
              : "התמלול מוכן",
            // התקרה היא 500 בסכמה; חיתוך כאן ולא שגיאת כתיבה שם
            body: (followUpNotice?.reason ?? summary ?? "").slice(0, 500) || undefined,
            /*
             * כשנוצרה משימה ההתראה מצביעה על הכרטיס — שם מטפלים
             * בה. אחרת על השיחה עצמה, שהיא מה שההתראה מדברת עליו.
             */
            ...(followUpNotice?.entity ?? {
              entityType: "call",
              entityId: pending.id,
            }),
          },
        });
      });
    } catch (error) {
      console.error(`[call-transcribe] ${pending.id} failed: ${String(error)}`);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        await tx.call.updateMany({
          where: { id: pending.id, tenantId: tenant.id },
          data: { transcriptionStatus: "failed" },
        });
        /*
         * גם כישלון הוא סיום, וגם עליו מודיעים.
         *
         * תמלול שנכשל בשקט נראה בדיוק כמו תמלול שעוד רץ: הסטטוס
         * במסך משתנה מ"מתמלל" ל"נכשל", ואיש אינו מסתכל. מי
         * שהמתין להקלטה של שיחה ממתין לשווא.
         */
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: tenant.id,
            userId: pending.createdBy ?? null,
            type: "call_transcribe_failed",
            title: "תמלול השיחה נכשל",
            body: "אפשר לנסות שוב מכרטיס השיחה, או להאזין להקלטה.",
            entityType: "call",
            entityId: pending.id,
          },
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
    webpush.setVapidDetails(
      subject as string,
      publicKey as string,
      privateKey as string,
    );
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
        where: {
          tenantId: tenant.id,
          pushedAt: null,
          createdAt: { gte: since },
        },
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
          createdAt: true,
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
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
          succeeded.push(sub.id);
        } catch (error: unknown) {
          const status =
            typeof error === "object" && error !== null && "statusCode" in error
              ? Number((error as { statusCode: unknown }).statusCode)
              : 0;
          const outcome = pushOutcome(status);
          if (
            outcome === "retire" ||
            shouldRetireAfterFailure(sub.failureCount + 1)
          ) {
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
const CustomAutomationJobSchema = z.object({
  tenantId: z.string(),
  /** מזהה האירוע ב-outbox — מפתח האי-כפילות. */
  eventId: z.string(),
  event: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.union([z.string(), z.date()]).optional(),
});

/**
 * הרצת האוטומציות שהמשרד בנה בעצמו.
 *
 * המפיץ שולח Job אחד לכל אירוע שיש לו טריגר בקטלוג, **בלי לקרוא את
 * הכללים** — הטבלה תחת FORCE RLS והמפיץ רץ בלי הקשר דייר, כך
 * ששאילתה משם הייתה מחזירה אפס שורות בשקט. כאן יש הקשר, ולכן כאן
 * הכללים נטענים, מסוננים ומבוצעים.
 *
 * **כלל שנכשל אינו מפיל את השאר.** משרד עם חמישה כללים שאחד מהם
 * מפנה לסוכן שהושבת אינו אמור לאבד את ארבעת האחרים, ובוודאי לא
 * שהאירוע כולו יסומן ככישלון וינסה שוב בלולאה.
 */
async function processCustomAutomations(job: Job): Promise<void> {
  const data = CustomAutomationJobSchema.parse(job.data);
  const trigger = automationTrigger(data.event);
  if (!trigger) return;

  /*
   * זכאות המסלול נבדקת **בהרצה** ולא רק בשמירה.
   *
   * משרד שירד מסלול נשאר עם הכללים שהגדיר, ובלי הבדיקה הזו הוא היה
   * ממשיך לקבל את התכונה בחינם לנצח. הכללים עצמם נשארים גלויים
   * וניתנים לכיבוי ומחיקה — רק ההרצה נעצרת (ביקורת Codex).
   */
  if (!(await tenantHasFeature(data.tenantId, "automations"))) return;

  // שלב הקריאה — טרנזקציה אחת קצרה, בלי כתיבה
  const { rules, activeUsers } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${data.tenantId}, true)`;
    const [ruleRows, userRows] = await Promise.all([
      tx.automationRule.findMany({
        where: { tenantId: data.tenantId, trigger: data.event, enabled: true },
        select: { id: true, name: true, conditions: true, action: true },
      }),
      /*
       * הנמענים נבדקים **בזמן הריצה** ולא רק בשמירה.
       *
       * כלל חי חודשים, וסוכן שהושבת בינתיים ימשיך לקבל משימות שאיש
       * אינו רואה: ה-Session שלו בוטל, והתראה אישית גלויה רק לו.
       * הבדיקה בשמירה אינה יכולה להגן על כלל ארוך-חיים (ביקורת Codex).
       */
      tx.user.findMany({
        where: { tenantId: data.tenantId, isActive: true },
        select: { id: true },
      }),
    ]);
    return { rules: ruleRows, activeUsers: new Set(userRows.map((u) => u.id)) };
  });
  if (rules.length === 0) return;

  /*
   * **מועד היעד נמדד מרגע האירוע ולא מרגע העיבוד.**
   *
   * המפיץ שולח `occurredAt` בדיוק לשם כך: תור שהצטבר, תקלה או
   * ניסיון חוזר היו דוחים משימה של "מחר" לשעות מאוחרות יותר, בלי
   * שאיש ביקש זאת.
   */
  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date();

  for (const rule of rules) {
    const conditions = z.array(AutomationConditionSchema).safeParse(rule.conditions);
    if (!conditions.success) continue;
    if (!conditionsMatch(trigger, conditions.data, data.payload)) continue;

    const action = AutomationActionSchema.safeParse(rule.action);
    if (!action.success) continue;

    const recipient =
      action.data.kind === "task" ? action.data.assignedToUserId : action.data.userId;
    if (!activeUsers.has(recipient)) {
      console.warn(`[custom-automations] כלל ${rule.id} מדולג — הנמען אינו פעיל`);
      continue;
    }

    /*
     * **טרנזקציה לכל כלל, ולא אחת לכולם.**
     *
     * try/catch בתוך טרנזקציה משותפת אינו מבודד: שגיאה אחת מעבירה
     * את הטרנזקציה ב-Postgres למצב aborted, וכל מה שאחריה נכשל
     * ממילא. כאן כלל שנכשל מתגלגל לבדו, והשאר ממשיכים — וגם ה"תפיסה"
     * והפעולה נכתבות יחד או בכלל לא.
     */
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${data.tenantId}, true)`;

        /*
         * ספר הריצות **לפני** הפעולה ובאותה טרנזקציה.
         *
         * `jobId` מונע הכנסה כפולה לתור אך לא עיבוד כפול: Job שנתקע
         * נמסר שוב, והכלל היה רץ פעם שנייה ופותח משימה זהה. שורה
         * שנדחתה על המפתח הראשי פירושה "כבר רץ", והריצה מדולגת.
         */
        const claimed = await tx.automationRun.createMany({
          data: { ruleId: rule.id, eventId: data.eventId, tenantId: data.tenantId },
          skipDuplicates: true,
        });
        if (claimed.count === 0) return;

        /*
         * מזהה הישות שהאירוע נוגע בה — כדי שהמשימה וההתראה יובילו
         * לכרטיס ולא ל"איפשהו". אם אין מזהה מובהק, הפעולה עדיין
         * מתבצעת — פשוט בלי קישור.
         */
        const link = entityFromPayload(data.payload);

        if (action.data.kind === "task") {
          const dueAt = new Date(occurredAt);
          dueAt.setUTCDate(dueAt.getUTCDate() + action.data.dueInDays);
          const taskId = ulid();
          await tx.task.create({
            data: {
              id: taskId,
              tenantId: data.tenantId,
              assignedToUserId: action.data.assignedToUserId,
              title: action.data.title,
              notes: `נוצר אוטומטית על ידי "${rule.name}".`,
              dueAt,
              ...(link ?? {}),
            },
          });
          /*
           * `task.created` נכתב גם כאן ולא רק ב-TasksService.
           *
           * תזכורת מועד היעד מתוזמנת **מהאירוע הזה בלבד**, ולכן
           * משימה שנוצרה ישירות הייתה מופיעה ברשימה ולעולם לא
           * מזכירה על עצמה — כלומר ההבטחה שהמשימה אמורה לקיים
           * נשברת בשקט (ביקורת Codex).
           */
          await tx.outboxEvent.create({
            data: {
              id: ulid(),
              tenantId: data.tenantId,
              name: "task.created",
              payload: {
                taskId,
                tenantId: data.tenantId,
                assignedToUserId: action.data.assignedToUserId,
                title: action.data.title,
                dueAt: dueAt.toISOString(),
              },
            },
          });
        } else {
          await tx.notification.create({
            data: {
              id: ulid(),
              tenantId: data.tenantId,
              userId: action.data.userId,
              type: "custom_automation",
              title: action.data.title,
              body: action.data.body,
              ...(link ?? {}),
            },
          });
        }
      });
    } catch (error) {
      console.warn(`[custom-automations] כלל ${rule.id} נכשל: ${String(error)}`);
    }
  }
}

/** הישות שהאירוע נוגע בה, אם אפשר לזהות אותה חד-משמעית. */
function entityFromPayload(
  payload: Record<string, unknown>,
): { entityType: string; entityId: string } | null {
  const map: [string, string][] = [
    ["leadId", "lead"],
    ["propertyId", "property"],
    ["buyerId", "buyer"],
    ["offerId", "offer"],
    ["appointmentId", "appointment"],
  ];
  for (const [key, entityType] of map) {
    const value = payload[key];
    if (typeof value === "string" && value !== "") return { entityType, entityId: value };
  }
  return null;
}

/*
 * הערך נבדק, לא רק נקרא: משתנה ריק או שלילי היה הופך את קו החיתוך
 * ל"עכשיו" — והסריקה הבאה הייתה מוחקת את היומן כולו במקום לשמור
 * חצי שנה (ביקורת Codex). ערך לא-תקין נופל לברירת המחדל.
 */
const AGENT_EVENTS_RETENTION_DAYS = (() => {
  const parsed = Number(process.env["AGENT_EVENTS_RETENTION_DAYS"]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 180;
})();

/**
 * ניקוי יומן משימות הסוכן — שמירת נתונים מינימלית (ISO 27001 A.5.33).
 *
 * היומן צובר תמלולים עם שמות ופרטי לקוחות קצה, ושתי המטרות שלו —
 * מדידת עלות ודאטה לאימון — לא דורשות היסטוריה אינסופית: חצי שנה
 * של פקודות היא גם מדגם אימון מספק וגם חלון עלות רלוונטי. מה
 * שמעבר לכך הוא PII שנשמר בלי תכלית. מי שרוצה לשמר את הדאטה מוריד
 * את קובץ הייצוא מהמסך לפני שהחלון נסגר.
 *
 * דייר-דייר תחת RLS, כמו שאר הסורקים כאן ומאותה סיבה — שאילתה בלי
 * הקשר דייר מוחקת אפס שורות בלי שגיאה.
 */
async function processAgentEventsRetention(): Promise<void> {
  const cutoff = new Date(
    Date.now() - AGENT_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let removed = 0;
  for (const tenant of tenants) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        return tx.agentEvent.deleteMany({
          where: { tenantId: tenant.id, createdAt: { lt: cutoff } },
        });
      });
      removed += result.count;
    } catch (error: unknown) {
      // דייר אחד שנכשל לא עוצר את הניקוי אצל השאר
      console.error(`[agent-events-retention] ${tenant.id}: ${String(error)}`);
    }
  }
  if (removed > 0) {
    console.warn(
      `[agent-events-retention] נמחקו ${removed} אירועי סוכן ישנים מ-${AGENT_EVENTS_RETENTION_DAYS} ימים`,
    );
  }
}

/* ==================== דחיפת התראות לוואטסאפ ==================== */

/**
 * הסוכן בוואטסאפ נבנה כדי שמתווך יוכל לעבוד **בלי להיכנס למערכת**.
 * כל עוד הוא רק עונה, מי שאינו פותח את הדשבורד אינו יודע ששיחה לא
 * נענתה, שנכנס ליד או שתמלול הסתיים — כלומר הוא חייב להיכנס.
 * הסורק הזה סוגר את המעגל: אותן שורות `notifications` שכבר מזינות
 * את הפעמון ואת פוש הדפדפן, יוצאות גם לוואטסאפ.
 *
 * מדוע עמודה נפרדת (`whatsapp_at`) ולא שימוש ב-`pushed_at`: הערוצים
 * עצמאיים. פוש מושבת בלי מפתחות VAPID, וואטסאפ מושבת בלי טוקן של
 * Meta — סימון משותף היה גורם לערוץ אחד לבלוע התראות שהשני לא ראה.
 *
 * ההחלטות עצמן (מה נשלח, למי, מתי שקט, ואיך זה נראה) יושבות
 * ב-`packages/shared/logic/whatsapp-notify` ומכוסות בבדיקות.
 */
const WA_GRAPH_BASE = "https://graph.facebook.com/v23.0";
const WA_SEND_TIMEOUT_MS = 15_000;
const WA_NOTIFY_BATCH = 200;
/**
 * מעבר לזה לא דוחפים — הגבול שמונע מהתראות שנדחו (שעות שקט, חלון
 * סגור) להצטבר לנצח: הן פשוט יוצאות מהחלון שהשאילתה סורקת.
 *
 * יממה ולא חצי יום: טווח השקט המרבי שההעדפות מתירות הוא 18 שעות,
 * והחלון חייב לכסות אותו — אחרת התראה שנוצרה בתחילת השקט הייתה
 * מתיישנת לפני שהוא נגמר, כלומר לא נשלחת לעולם למרות שהמסך מבטיח
 * שהיא תגיע בבוקר (ביקורת Codex).
 */
const WA_NOTIFY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WA_CONFIG_TTL_MS = 60_000;

interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  /** שם תבנית מאושרת לשליחה מחוץ לחלון 24 השעות; ריק = אין */
  template: string | null;
  templateLang: string;
}

let waConfigCache: { config: WhatsAppConfig | null; until: number } | null = null;

/**
 * פענוח הגדרת פלטפורמה.
 *
 * מימוש מקוצר של `CryptoService.decrypt` שב-API: התהליכים נפרדים,
 * ולפתוח ערוץ HTTP פנימי בין העובדים ל-API רק כדי לקרוא שני מפתחות
 * היה מוסיף שטח תקיפה על משהו שהוא בסך הכול AES-GCM מוסכם.
 * הפורמט חייב להישאר זהה לשני הצדדים — הוא מתועד בסכימה.
 */
function decryptSetting(stored: string): string | null {
  const key = process.env["DATA_ENCRYPTION_KEY"];
  if (!key) return null;
  try {
    const raw = Buffer.from(stored, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "base64"),
      raw.subarray(0, 12),
    );
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** ההגדרות ממסך הפלטפורמה, עם משתני הסביבה כ-Fallback — כמו ב-API. */
async function whatsappConfig(): Promise<WhatsAppConfig | null> {
  const now = Date.now();
  if (waConfigCache && now < waConfigCache.until) return waConfigCache.config;

  const rows = await prisma.platformSetting.findMany({
    where: {
      key: {
        in: [
          "whatsappAccessToken",
          "whatsappPhoneNumberId",
          "whatsappNotifyTemplate",
          "whatsappNotifyTemplateLang",
        ],
      },
    },
    select: { key: true, valueEncrypted: true },
  });
  const stored = new Map(
    rows.map((row) => [row.key, decryptSetting(row.valueEncrypted)] as const),
  );

  const token = stored.get("whatsappAccessToken") ?? process.env["WHATSAPP_ACCESS_TOKEN"] ?? null;
  const phoneNumberId =
    stored.get("whatsappPhoneNumberId") ?? process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? null;
  const template = stored.get("whatsappNotifyTemplate") ?? null;
  const config: WhatsAppConfig | null =
    token && phoneNumberId
      ? {
          token,
          phoneNumberId,
          template: template !== null && template.trim() !== "" ? template.trim() : null,
          templateLang: stored.get("whatsappNotifyTemplateLang")?.trim() || "he",
        }
      : null;
  waConfigCache = { config, until: now + WA_CONFIG_TTL_MS };
  return config;
}

/** שליחה אחת ל-Graph. false = לא יצא; הסורק ינסה שוב בסבב הבא. */
async function sendWhatsApp(
  config: WhatsAppConfig,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`${WA_GRAPH_BASE}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WA_SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      // גוף השגיאה מוגבל — בלי להדפיס טוקנים או תוכן הודעה ליומן
      console.error(
        `[whatsapp-notify] Meta דחתה: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[whatsapp-notify] שליחה נכשלה: ${String(error)}`);
    return false;
  }
}

/** השעה בישראל — לשעות השקט. נכשל ⇒ שעת UTC, ולא קריסה. */
function jerusalemHour(date: Date): number {
  try {
    return Number.parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Jerusalem",
        hour: "numeric",
        hour12: false,
      }).format(date),
      10,
    );
  } catch {
    return date.getUTCHours();
  }
}

interface WaRecipient {
  userId: string;
  /** מנורמל לצורה הבינלאומית — היחידה ש-Meta מקבלת */
  phone: string;
  prefs: ReturnType<typeof parseWhatsAppNotifyPrefs>;
  windowOpen: boolean;
  /**
   * „שקט לשעתיים” פעיל — דחייה, לא ויתור.
   *
   * הנמען נשאר ברשימה בכוונה: הוצאתו ממנה הייתה מוציאה אותו גם
   * מחשבון הסגירה של ההתראה, ההתראה הייתה נסגרת כאילו הגיעה לכולם,
   * ומה שהצטבר בשעתיים היה נמחק במקום להישלח אחריהן (ביקורת Codex).
   */
  snoozed: boolean;
  /** עד מתי כבר קיבל — מונע כפילות כשנמען אחר של אותה התראה נכשל */
  notifiedThrough: Date | null;
}

async function processWhatsAppNotifySweep(): Promise<void> {
  const config = await whatsappConfig();
  if (!config) return; // הצד היוצא אינו מוגדר — אין מה לדחוף
  const webOrigin = process.env["WEB_ORIGIN"] ?? "";
  const now = new Date();
  const since = new Date(now.getTime() - WA_NOTIFY_MAX_AGE_MS);
  const hour = jerusalemHour(now);
  const tenants = await prisma.tenant.findMany({ select: { id: true } });

  for (const tenant of tenants) {
    // אותו שער כמו הסוכן עצמו: הדחיפה היא חלק מהפיצ'ר, לא תוספת חינם
    if (!(await tenantHasFeature(tenant.id, "voice_intake"))) continue;

    const pending = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.notification.findMany({
        where: { tenantId: tenant.id, whatsappAt: null, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: WA_NOTIFY_BATCH,
        select: {
          id: true,
          userId: true,
          type: true,
          title: true,
          body: true,
          entityType: true,
          entityId: true,
          // החותמת פר-משתמש נשענת עליו — בלעדיו אין ממה למדוד
          createdAt: true,
        },
      });
    });
    if (pending.length === 0) continue;

    /*
     * הנמענים: מי שהמנוי שלו פעיל (בעל המשרד תמיד), יש לו טלפון,
     * והוא הדליק את ההתראות. אותם שערים בדיוק כמו במענה של הסוכן —
     * דחיפה למי שאינו מנוי הייתה מוצר בחינם, ולמי שכיבה היא ספאם.
     */
    const users = await prisma.user.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
        phone: { not: null },
        OR: [{ whatsappAccess: true }, { role: "owner" }],
      },
      select: { id: true, phone: true, preferences: true },
    });
    if (users.length === 0) continue;

    const chats = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.whatsAppChat.findMany({
        where: { tenantId: tenant.id, userId: { in: users.map((u) => u.id) } },
        select: {
          userId: true,
          lastInboundAt: true,
          notifiedThrough: true,
          notifySnoozeUntil: true,
        },
      });
    });
    const chatOf = new Map(chats.map((chat) => [chat.userId, chat]));

    const recipients = new Map<string, WaRecipient>();
    for (const user of users) {
      const prefs = parseWhatsAppNotifyPrefs(user.preferences);
      if (!prefs.enabled) continue;
      /*
       * המספר מנורמל לצורה הבינלאומית שהיא היחידה ש-Meta מקבלת.
       * בפרופיל הוא נשמר כפי שהוקלד ("050-123-4567"), ושליחה שלו
       * כמו שהוא נדחית (ביקורת Codex). מספר שאינו ניתן לנרמול
       * אינו נמען.
       */
      const phone = normalizePhoneForWhatsapp(user.phone ?? "");
      if (phone === "") continue;
      const chat = chatOf.get(user.id);
      recipients.set(user.id, {
        userId: user.id,
        phone,
        prefs,
        windowOpen: sessionWindowOpen(chat?.lastInboundAt ?? null, now),
        snoozed: chat?.notifySnoozeUntil ? chat.notifySnoozeUntil > now : false,
        notifiedThrough: chat?.notifiedThrough ?? null,
      });
    }
    if (recipients.size === 0) continue;

    /*
     * החלוקה היא **פר-נמען**, וכל נמען מסונן מול החותמת שלו.
     *
     * זה מה שמונע כפילות: התראה משרדית שנשלחה בהצלחה לסוכן א' ונכשלה
     * אצל ב' נשארת בלי סימון, וא' לא יקבל אותה שוב כי החותמת שלו כבר
     * עברה אותה. שוויון חותמת נחשב „כבר נשלח” — עדיף לאבד התראה
     * בודדת במרוץ נדיר מלשלוח מאות כפילויות.
     */
    const delivered = new Map<string, Date>();
    /** תור הזיכרון של הסוכן על מה ששלח, פר-נמען */
    const remembered = new Map<string, AgentHistoryTurn>();
    for (const recipient of recipients.values()) {
      const watermark = recipient.notifiedThrough?.getTime() ?? 0;
      const items = pending.filter(
        (notification) =>
          (!notification.userId || notification.userId === recipient.userId) &&
          shouldNotifyByWhatsApp(notification.type, recipient.prefs) &&
          notification.createdAt.getTime() > watermark,
      );
      if (items.length === 0) continue;

      /*
       * „שקט לשעתיים”, שעות שקט, וחלון 24 השעות של Meta — שלושתם
       * *דחייה*, לא ויתור. החותמת אינה זזה, והסבב הבא ירים את אותם
       * פריטים: בתום ההשתקה, בבוקר, או ברגע שהמתווך יכתוב לסוכן
       * ויפתח את החלון.
       */
      if (recipient.snoozed) continue;
      if (inQuietHours(hour, recipient.prefs)) continue;
      if (!recipient.windowOpen && config.template === null) continue;

      let ok: boolean;
      if (recipient.windowOpen) {
        /*
         * חיתוך לפי תקרת 4096 התווים של Meta — הודעה ארוכה יותר
         * נדחית כולה, כלומר הסוכן שותק דווקא ביום העמוס (ביקורת
         * Codex). אותה פונקציה שמשרתת את מענה הסוכן.
         */
        /*
         * כפתורים כשהגוף נכנס ב-1024 התווים שהודעה אינטראקטיבית
         * מתירה — הרבה פחות מ-4096 של טקסט. הודעה ארוכה יורדת
         * לטקסט מפוצל: עדיף עדכון מלא בלי כפתורים מאשר הודעה
         * שנדחית כולה.
         */
        const message = formatNotifyMessage(items, webOrigin);
        if (fitsInteractive(message)) {
          ok = await sendWhatsApp(
            config,
            replyButtonsPayload(recipient.phone, message, [
              { action: "cmd", arg: "urgent", title: "📋 מה דחוף היום?" },
              { action: "snooze", arg: "120", title: "🔕 שקט לשעתיים" },
            ]),
          );
        } else {
          ok = true;
          for (const chunk of splitForWhatsApp(message)) {
            ok = await sendWhatsApp(config, {
              messaging_product: "whatsapp",
              to: recipient.phone,
              type: "text",
              text: { body: chunk, preview_url: false },
            });
            if (!ok) break;
          }
        }
      } else {
        ok = await sendWhatsApp(config, {
          messaging_product: "whatsapp",
          to: recipient.phone,
          type: "template",
          template: {
            name: config.template,
            language: { code: config.templateLang },
            components: [
              {
                type: "body",
                parameters: templateParams(items).map((text) => ({ type: "text", text })),
              },
            ],
          },
        });
      }
      if (!ok) continue;

      const through = items.reduce(
        (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
        items[0]!.createdAt,
      );
      delivered.set(recipient.userId, through);
      /*
       * מה שנשלח נרשם גם כתור בשיחה — זה מה שנותן ל„תזכיר לי
       * להתקשר אליו” על מה לחול. `assistantMemoryTurn` גוזר את
       * הניסוח מסוג ההתראה ולא מכותרתה, ולכן שום טלפון אינו נכנס
       * לזיכרון שנשלח למודל.
       */
      const turn = assistantMemoryTurn(items);
      if (turn !== null) remembered.set(recipient.userId, turn);
    }

    /*
     * החותמות נשמרות **לפני** סימון ההתראות: אם התהליך ייפול כאן,
     * מה שכבר נשלח לא יישלח שוב. הסדר ההפוך היה מסמן התראה שנשלחה
     * ומאבד את החותמת — כלומר כפילות בסבב הבא.
     */
    if (delivered.size > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        /*
         * ההיסטוריה נקראת ונכתבת כאן, ולא נבנית מאפס: המתווך יכול
         * לכתוב לסוכן בדיוק בין הקריאה לכתיבה, ודריסה עיוורת הייתה
         * מוחקת את מה שהוא אמר.
         *
         * **הנעילה היא מה שסוגר את החלון.** ‎`wa-chat:{משרד}:{משתמש}`
         * היא אותה נעילה ש-`claimMessage` ו-`saveChat` ב-API נוטלים,
         * ולכן שלושת הכותבים לעמודה הזו מסודרים בתור. בלעדיה
         * הקריאה כאן והשמירה בצד ה-API יכלו לדרוס זו את זו, ותור
         * שיחה שלם היה נעלם (ביקורת Codex).
         *
         * הנעילה נלקחת לכל משתמש בנפרד ולפי סדר קבוע — מיון לפי
         * מזהה — כדי ששני סבבים מקבילים לא ייתפסו זה בזה.
         */
        for (const userId of [...remembered.keys()].sort()) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${conversationLockKey(tenant.id, userId)}, 0))`;
        }
        const existing =
          remembered.size === 0
            ? []
            : await tx.whatsAppChat.findMany({
                where: { tenantId: tenant.id, userId: { in: [...remembered.keys()] } },
                select: { userId: true, history: true },
              });
        const historyOf = new Map(
          existing.map((row) => [
            row.userId,
            parseStoredTurns(row.history),
          ]),
        );

        for (const [userId, through] of delivered) {
          const turn = remembered.get(userId);
          const history =
            turn === undefined
              ? null
              : (mergeStoredTurns(historyOf.get(userId) ?? [], [turn]) as unknown);
          await tx.whatsAppChat.upsert({
            where: { tenantId_userId: { tenantId: tenant.id, userId } },
            create: {
              id: ulid(),
              tenantId: tenant.id,
              userId,
              notifiedThrough: through,
              ...(history === null ? {} : { history: history as Prisma.InputJsonValue }),
            },
            update: {
              notifiedThrough: through,
              ...(history === null ? {} : { history: history as Prisma.InputJsonValue }),
            },
          });
        }
      });
    }

    /*
     * סימון ההתראה עצמה הוא ניקיון בלבד: היא נסגרת כשכל נמעניה
     * האפשריים כבר מעבר לחותמת שלהם — או שאין לה נמענים כלל.
     * הדחיות (שקט, חלון סגור) נשארות פתוחות עד שיישלחו או יתיישנו.
     */
    const settled = pending
      .filter((notification) => {
        const targets = [...recipients.values()].filter(
          (recipient) =>
            (!notification.userId || notification.userId === recipient.userId) &&
            shouldNotifyByWhatsApp(notification.type, recipient.prefs),
        );
        return targets.every((recipient) => {
          const through = delivered.get(recipient.userId) ?? recipient.notifiedThrough;
          return through !== null && through !== undefined && through >= notification.createdAt;
        });
      })
      .map((notification) => notification.id);
    if (settled.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.notification.updateMany({
        where: { tenantId: tenant.id, id: { in: settled } },
        data: { whatsappAt: new Date() },
      });
    });
  }
}

async function processLow(job: Job): Promise<void> {
  if (job.name === "push-sweep") return processPushSweep();
  if (job.name === "whatsapp-notify-sweep") return processWhatsAppNotifySweep();
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
  if (job.name === "subscription-expiry") return processSubscriptionExpiry();
  if (job.name === "exclusivity-sweep") return processExclusivitySweep();
  if (job.name === "custom-automations") return processCustomAutomations(job);
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
