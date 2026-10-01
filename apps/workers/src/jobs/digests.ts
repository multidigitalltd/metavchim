import { ulid } from "ulid";
import {
  dailyBriefBody,
  jerusalemDayRange,
  summarizeViewingFeedback,
  viewingFeedbackSentences,
} from "@metavchim/shared";
import { prisma } from "../runtime.js";
import { automationOn } from "../tenant-settings.js";

/**
 * דו"ח בוקר יומי (docs/09 שלב 1 — "תזכורות למתווך"): כל בוקר ב-07:00
 * שעון ישראל, כל סוכן פעיל מקבל התראה אחת עם תמונת היום שלו —
 * פגישות היום, משימות להיום/באיחור, ולידים שממתינים למענה.
 * בלי רעש: אין כלום — אין התראה. אידמפוטנטי פר יום (בדיקת קיים).
 */
export async function processDailyBrief(): Promise<void> {
  // הגבולות מהחבילה המשותפת: start כולל, end בלעדי (חצות היום הבא)
  const { start, end } = jerusalemDayRange(new Date());
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
            startsAt: { gte: start, lt: end },
          },
          orderBy: { startsAt: "asc" },
          select: { ownerUserId: true, createdBy: true, startsAt: true, kind: true },
        }),
        tx.task.groupBy({
          by: ["assignedToUserId"],
          where: { tenantId: tenant.id, status: "open", dueAt: { lt: end } },
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
/**
 * „הדוח למוכר מוכן” — פעם בשבוע, לכל נכס שהצטבר עליו משוב מביקורים
 * (docs/03 — appointments). התראה לסוכן של הנכס עם המשפטים שיוצאו
 * למוכר, ולא שליחה למוכר: דוח שאומר „המחיר גבוה” צריך סוכן שיודע
 * לנהל את השיחה אחריו. אידמפוטנטי לשבוע הקלנדרי, כמו הסיכום השבועי.
 */
export async function processViewingFeedbackDigest(): Promise<void> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAnchor = new Date(now);
  weekAnchor.setUTCHours(0, 0, 0, 0);
  weekAnchor.setUTCDate(weekAnchor.getUTCDate() - weekAnchor.getUTCDay());
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ["active", "trial"] } },
    select: { id: true },
  });
  for (const tenant of tenants) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`viewing-feedback:${tenant.id}`}))`;
      const rows = await tx.appointment.findMany({
        where: {
          tenantId: tenant.id,
          kind: "viewing",
          status: "completed",
          propertyId: { not: null },
          startsAt: { gte: weekAgo },
          OR: [
            { feedbackPrice: { not: null } },
            { feedbackCondition: { not: null } },
            { feedbackFit: { not: null } },
          ],
        },
        select: { propertyId: true, createdBy: true, feedbackPrice: true, feedbackCondition: true, feedbackFit: true },
      });
      const byProperty = new Map<string, typeof rows>();
      for (const row of rows) {
        if (row.propertyId === null) continue;
        byProperty.set(row.propertyId, [...(byProperty.get(row.propertyId) ?? []), row]);
      }
      for (const [propertyId, viewings] of byProperty) {
        const property = await tx.property.findFirst({
          where: { id: propertyId, tenantId: tenant.id, deletedAt: null },
          select: { agentUserId: true, marketingTitle: true, street: true, houseNumber: true, city: true },
        });
        if (!property) continue;
        const recipient = property.agentUserId ?? viewings.find((v) => v.createdBy !== null)?.createdBy ?? null;
        if (recipient === null) continue;
        const already = await tx.notification.findFirst({
          where: { tenantId: tenant.id, type: "viewing_feedback_digest", entityId: propertyId, createdAt: { gte: weekAnchor } },
          select: { id: true },
        });
        if (already) continue;
        const sentences = viewingFeedbackSentences(
          summarizeViewingFeedback(viewings.map((v) => ({ price: v.feedbackPrice, condition: v.feedbackCondition, fit: v.feedbackFit }))),
        );
        if (sentences.length === 0) continue;
        const address = [[property.street, property.houseNumber].filter(Boolean).join(" "), property.city].filter((p) => p).join(", ");
        const label = property.marketingTitle || address || "הנכס";
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: tenant.id,
            userId: recipient,
            type: "viewing_feedback_digest",
            title: `🗣️ ${viewings.length === 1 ? "ביקור אחד עם משוב" : `${viewings.length} ביקורים עם משוב`} השבוע — ${label}`,
            body: `${sentences.join(" · ")}. הדוח למוכר מוכן: בכרטיס הנכס, לשונית „בעל הנכס”, „שלח דוח”.`,
            entityType: "property",
            entityId: propertyId,
          },
        });
      }
    });
  }
}

export async function processWeeklySummary(): Promise<void> {
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
