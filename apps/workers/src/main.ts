import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Queue, Worker, type Job } from "bullmq";
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
    const stale = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.lead.findMany({
        where: { tenantId: tenant.id, status: "new", firstResponseAt: null, createdAt: { lte: cutoff } },
        select: { id: true },
        take: 200,
      });
    });
    for (const lead of stale) await escalateLeadSla(tenant.id, lead.id);
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

/** תור low משותף — כל סוג Job ממוין לפי שמו. */
async function processLow(job: Job): Promise<void> {
  if (job.name === "delete-object") return processCleanup(job);
  if (job.name === "offer-followup") return processOfferFollowup(job);
  if (job.name === "property-delisted") return processPropertyDelisted(job);
  if (job.name === "viewing-followup") return processViewingFollowup(job);
  if (job.name === "lead-sla") return processLeadSla(job);
  if (job.name === "lead-sla-sweep") return processLeadSlaSweep();
  if (job.name === "daily-brief") return processDailyBrief();
}

// רישום סריקת ה-SLA החוזרת (רבע שעה) — כולל ריצה מיידית בעלייה,
// שמכסה לידים שנוצרו לפני שהפיצ'ר נפרס
const lowQueue = new Queue(QUEUES.low, { connection });
void lowQueue
  .upsertJobScheduler("lead-sla-sweep", { every: 15 * 60 * 1000 }, { name: "lead-sla-sweep" })
  .catch((error: unknown) => {
    console.error(`lead-sla-sweep scheduler registration failed: ${String(error)}`);
  });
// דו"ח בוקר — 07:00 שעון ישראל, כל יום
void lowQueue
  .upsertJobScheduler("daily-brief", { pattern: "0 7 * * *", tz: "Asia/Jerusalem" }, { name: "daily-brief" })
  .catch((error: unknown) => {
    console.error(`daily-brief scheduler registration failed: ${String(error)}`);
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
