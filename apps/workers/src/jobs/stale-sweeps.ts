import { type Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  automationThresholdMs,
  summarizeViewingFeedback,
  averagePerSqmAgorot,
  perSqmGapPercent,
  pricePerSqmAgorot,
  normalizeLocationName,
  neighborhoodSame,
  viewingFeedbackSentences,
} from "@metavchim/shared";
import { prisma, withTenant } from "../runtime.js";
import { automationSettings } from "../tenant-settings.js";

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
  await withTenant(tenantId, async (tx) => {
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

const DAY_MS = 24 * 60 * 60 * 1000;
/** ‏קונה „פעיל” — לא בשל אינו נספר: אין למי לחזור עדיין. */
const ACTIVE_BUYER_MATURITIES = ["very_hot", "hot", "interested"];
/** ‏כמה נכסים השוואתיים לכל היותר לממוצע למ״ר בסריקה — תקרה, לא מדיניות. */
const STALE_PROPERTY_BENCHMARK_SCAN = 300;

/**
 * ‏מי מקבל את המשימה: הסוכן המשויך אם עדיין פעיל, אחרת בעלי המשרד.
 * ‏אותו כלל כמו „ליד שהתקרר”: סוכן שהושבת אינו רואה משימות, ומשימה
 * ‏שאיש אינו רואה היא לא-כלום.
 */
async function assigneeFor(
  tx: Prisma.TransactionClient,
  tenantId: string,
  preferredUserId: string | null,
): Promise<{ assignee: string; notifyUserIds: string[] } | null> {
  const preferredActive =
    preferredUserId !== null &&
    (await tx.user.findFirst({ where: { id: preferredUserId, tenantId, isActive: true }, select: { id: true } })) !== null;
  if (preferredActive) return { assignee: preferredUserId!, notifyUserIds: [preferredUserId!] };
  const owners = await tx.user.findMany({
    where: { tenantId, role: "owner", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (owners.length === 0) return null;
  return { assignee: owners[0]!.id, notifyUserIds: owners.map((o) => o.id) };
}

/** ‏משימה מאותו מקור שעדיין פתוחה, או שנוצרה אחרי הפעילות האחרונה — לא מכפילים. */
async function taskAlreadyRaised(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sourceKey: string,
  lastActivity: Date,
): Promise<boolean> {
  const existing = await tx.task.findFirst({
    where: { tenantId, sourceKey, OR: [{ status: "open" }, { createdAt: { gte: lastActivity } }] },
    select: { id: true },
  });
  return existing !== null;
}

function propertyLabelOf(p: { marketingTitle: string | null; street: string | null; houseNumber: string | null; city: string | null }): string {
  const address = [[p.street, p.houseNumber].filter(Boolean).join(" "), p.city].filter((part) => part).join(", ");
  return p.marketingTitle || address || "הנכס";
}

/**
 * ‏„נכס תקוע” — נכס בשיווק שלא קרה בו דבר X ימים.
 *
 * ‏„דבר” = סיור (שנקבע ולא בוטל), פנייה (ליד או שיחה על הנכס), או
 * ‏עדכון של הכרטיס. `updatedAt` נספר בכוונה: נכס שהמתווך ערך השבוע
 * ‏אינו נשכח, גם אם איש לא ביקר — ובלי זה נכס שהופעל היום היה
 * ‏„תקוע” מיד, כי אין עמודת „מתי הופעל”.
 *
 * ‏המשימה נושאת את מה שהמתווך צריך לשיחה עם המוכר: הפער מהממוצע
 * ‏למ״ר בשכונה (או בעיר) על מלאי המשרד, ומה אמרו הקונים שכן ביקרו.
 * ‏מספרים ולא „כדאי להוריד מחיר” — זו שיחה של המתווך, לא של המערכת.
 */
async function assessStaleProperty(tenantId: string, propertyId: string, cutoff: Date): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.$executeRaw`SELECT id FROM properties WHERE id = ${propertyId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const property = await tx.property.findFirst({
      where: { id: propertyId, tenantId, deletedAt: null, status: "active" },
      select: {
        agentUserId: true, marketingTitle: true, street: true, houseNumber: true, city: true, neighborhood: true,
        dealType: true, priceAgorot: true, areaSqm: true, updatedAt: true,
      },
    });
    if (!property) return;

    const now = new Date();
    /*
     * ‏סיור **שנקבע** להמשך השבוע הוא פעילות, גם אם עוד לא התקיים:
     * ‏קביעתו אינה נוגעת בשורת הנכס, ובלי הבדיקה הזו הנכס היה מקבל
     * ‏משימה שטוענת „בלי סיור” בזמן שיש אחד ביומן (ביקורת Codex).
     * ‏לגיל הפעילות נספר רק הסיור האחרון שכבר התקיים.
     */
    const [lastViewing, upcomingViewing, lastLead, lastCall] = await Promise.all([
      tx.appointment.findFirst({
        where: { tenantId, propertyId, kind: "viewing", status: { not: "cancelled" }, startsAt: { lte: now } },
        orderBy: { startsAt: "desc" },
        select: { startsAt: true },
      }),
      tx.appointment.findFirst({
        where: { tenantId, propertyId, kind: "viewing", status: { not: "cancelled" }, startsAt: { gt: now } },
        select: { id: true },
      }),
      tx.lead.findFirst({ where: { tenantId, propertyId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      tx.call.findFirst({ where: { tenantId, propertyId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    ]);
    if (upcomingViewing !== null) return;
    const lastActivity = new Date(Math.max(
      property.updatedAt.getTime(),
      lastViewing?.startsAt.getTime() ?? 0,
      lastLead?.createdAt.getTime() ?? 0,
      lastCall?.occurredAt.getTime() ?? 0,
    ));
    if (lastActivity > cutoff) return;

    const sourceKey = `property-stale:${propertyId}`;
    if (await taskAlreadyRaised(tx, tenantId, sourceKey, lastActivity)) return;
    const who = await assigneeFor(tx, tenantId, property.agentUserId);
    if (who === null) return;

    /* ‏הפער מהממוצע — אותו כלל כמו בכרטיס הנכס: אותה עיר, אותו סוג עסקה, לפחות שלושה */
    const lines: string[] = [];
    const perSqm = pricePerSqmAgorot(property.priceAgorot === null ? null : Number(property.priceAgorot), property.areaSqm);
    const cityKey = normalizeLocationName(property.city ?? "");
    if (perSqm !== null && cityKey !== "") {
      const comparable = {
        tenantId, deletedAt: null, id: { not: propertyId }, dealType: property.dealType,
        status: { in: ["active", "on_hold", "sold", "rented"] }, priceAgorot: { gt: 0 }, areaSqm: { gt: 0 },
      };
      /*
       * ‏קודם אילו כתיבים של העיר, ורק אז אילו נכסים — התקרה חלה
       * ‏**בתוך העיר**, כמו בכרטיס הנכס. תקרה על כל המשרד הייתה נותנת
       * ‏לערים אחרות לדחוק את בני ההשוואה החוצה (ביקורת Codex).
       */
      const cities = await tx.property.groupBy({ by: ["city"], where: comparable });
      const sameCity = cities
        .map((row) => row.city)
        .filter((city): city is string => city !== null && normalizeLocationName(city) === cityKey);
      const rows = sameCity.length === 0 ? [] : await tx.property.findMany({
        where: { ...comparable, city: { in: sameCity } },
        select: { neighborhood: true, priceAgorot: true, areaSqm: true },
        orderBy: { createdAt: "desc" },
        take: STALE_PROPERTY_BENCHMARK_SCAN,
      });
      const inCity = rows.map((row) => ({ neighborhood: row.neighborhood, priceAgorot: Number(row.priceAgorot), areaSqm: row.areaSqm }));
      const wanted = property.neighborhood ?? "";
      const inNeighborhood = wanted === "" ? [] : inCity.filter((row) => neighborhoodSame(row.neighborhood ?? "", wanted));
      const scoped = averagePerSqmAgorot(inNeighborhood) !== null
        ? { label: `בשכונה`, benchmark: averagePerSqmAgorot(inNeighborhood)! }
        : averagePerSqmAgorot(inCity) !== null
          ? { label: `בעיר`, benchmark: averagePerSqmAgorot(inCity)! }
          : null;
      if (scoped !== null) {
        const gap = perSqmGapPercent(perSqm, scoped.benchmark);
        if (gap !== null) {
          lines.push(
            gap === 0
              ? `המחיר למ״ר כמו הממוצע ${scoped.label} (${scoped.benchmark.count} נכסים).`
              : `המחיר למ״ר ${gap > 0 ? "גבוה" : "נמוך"} ב-${Math.abs(gap)}% מהממוצע ${scoped.label} (${scoped.benchmark.count} נכסים).`,
          );
        }
      }
    }
    const viewings = await tx.appointment.findMany({
      where: {
        tenantId, propertyId, kind: "viewing", status: "completed",
        OR: [{ feedbackPrice: { not: null } }, { feedbackCondition: { not: null } }, { feedbackFit: { not: null } }],
      },
      select: { feedbackPrice: true, feedbackCondition: true, feedbackFit: true },
      take: 200,
    });
    const sentences = viewingFeedbackSentences(
      summarizeViewingFeedback(viewings.map((v) => ({ price: v.feedbackPrice, condition: v.feedbackCondition, fit: v.feedbackFit }))),
    );
    if (sentences.length > 0) lines.push(`מה אמרו הקונים שביקרו: ${sentences.join(" · ")}.`);

    const quietDays = Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS);
    const label = propertyLabelOf(property);
    const notes = [
      `${quietDays} ימים בלי סיור, בלי פנייה ובלי עדכון בכרטיס.`,
      ...lines,
      "הדוח למוכר מוכן לשליחה: כרטיס הנכס ⟵ „בעל הנכס” ⟵ „שלח דוח”.",
    ].join("\n").slice(0, 2000);
    await tx.task.create({
      data: {
        id: ulid(), tenantId, assignedToUserId: who.assignee,
        title: `🪧 נכס תקוע — לדבר עם המוכר: ${label}`.slice(0, 200),
        notes, dueAt: now, entityType: "property", entityId: propertyId, sourceKey,
      },
    });
    for (const userId of who.notifyUserIds) {
      await tx.notification.create({
        data: {
          id: ulid(), tenantId, userId, type: "property_stale",
          title: `🪧 נכס תקוע — ${label}`,
          body: `${quietDays} ימים בלי סיור ובלי פנייה. ${lines[0] ?? "נוצרה משימה לדבר עם המוכר."}`.slice(0, 500),
          entityType: "property", entityId: propertyId,
        },
      });
    }
  });
}

/** ‏סריקת „נכס תקוע” — פעם ביום, נכסים בשיווק בלבד, לפי הסף של המשרד. */
export async function processStalePropertySweep(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ where: { status: { in: ["active", "trial"] } }, select: { id: true } });
  for (const tenant of tenants) {
    const settings = await automationSettings(tenant.id);
    if (!settings.stale_property.enabled) continue;
    const cutoff = new Date(Date.now() - (automationThresholdMs("stale_property", settings) ?? 21 * DAY_MS));
    let cursor: string | undefined;
    for (;;) {
      const batch = await withTenant(tenant.id, async (tx) => {
        /* ‏סינון גס באינדקס (status, updatedAt); האימות המדויק — בתוך הנעילה */
        return tx.property.findMany({
          where: { tenantId: tenant.id, deletedAt: null, status: "active", updatedAt: { lte: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take: 200,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
      });
      for (const row of batch) await assessStaleProperty(tenant.id, row.id, cutoff);
      if (batch.length < 200) break;
      cursor = batch[batch.length - 1]!.id;
    }
  }
}

/**
 * ‏„קונה שקט” — קונה פעיל שלא היה איתו קשר X ימים.
 *
 * ‏„קשר” = אינטראקציה שאדם רשם (לא `system` — אחרת האוטומציה הייתה
 * ‏מאפסת את עצמה), הודעת וואטסאפ או מייל לאיש הקשר, שיחה, או סיור.
 * ‏גם עדכון של כרטיס הקונה נספר: מי שערך את הדרישות אתמול לא שכח
 * ‏את הקונה.
 */
async function assessQuietBuyer(tenantId: string, buyerId: string, cutoff: Date): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.$executeRaw`SELECT id FROM buyers WHERE id = ${buyerId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const buyer = await tx.buyer.findFirst({
      where: { id: buyerId, tenantId, deletedAt: null, maturity: { in: ACTIVE_BUYER_MATURITIES } },
      select: { contactId: true, ownerUserId: true, updatedAt: true },
    });
    if (!buyer) return;
    const now = new Date();
    const [lastInteraction, lastMessage, lastEmail, lastCall, lastAppointment] = await Promise.all([
      tx.interaction.findFirst({ where: { tenantId, buyerId, kind: { not: "system" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      tx.message.findFirst({ where: { tenantId, contactId: buyer.contactId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      tx.emailMessage.findFirst({ where: { tenantId, contactId: buyer.contactId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      tx.call.findFirst({ where: { tenantId, contactId: buyer.contactId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
      tx.appointment.findFirst({ where: { tenantId, buyerId, status: { not: "cancelled" }, startsAt: { lte: now } }, orderBy: { startsAt: "desc" }, select: { startsAt: true } }),
    ]);
    const lastActivity = new Date(Math.max(
      buyer.updatedAt.getTime(),
      lastInteraction?.createdAt.getTime() ?? 0,
      lastMessage?.createdAt.getTime() ?? 0,
      lastEmail?.createdAt.getTime() ?? 0,
      lastCall?.occurredAt.getTime() ?? 0,
      lastAppointment?.startsAt.getTime() ?? 0,
    ));
    if (lastActivity > cutoff) return;

    const sourceKey = `buyer-quiet:${buyerId}`;
    if (await taskAlreadyRaised(tx, tenantId, sourceKey, lastActivity)) return;
    const who = await assigneeFor(tx, tenantId, buyer.ownerUserId);
    if (who === null) return;

    const quietDays = Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS);
    await tx.task.create({
      data: {
        id: ulid(), tenantId, assignedToUserId: who.assignee,
        title: "🤫 קונה שקט — ליצור קשר",
        notes: `${quietDays} ימים בלי שיחה, הודעה או סיור. עדכון קצר על מה שנכנס לשוק שומר את הקונה אצלכם.`,
        dueAt: now, entityType: "buyer", entityId: buyerId, sourceKey,
      },
    });
    for (const userId of who.notifyUserIds) {
      await tx.notification.create({
        data: {
          id: ulid(), tenantId, userId, type: "buyer_quiet",
          title: "🤫 קונה שקט",
          body: `קונה פעיל בלי קשר ${quietDays} ימים — נוצרה משימה ליצור קשר.`,
          entityType: "buyer", entityId: buyerId,
        },
      });
    }
    await tx.interaction.create({
      data: { id: ulid(), tenantId, buyerId, kind: "system", content: `בלי קשר ${quietDays} ימים — נוצרה משימה ליצור קשר`, createdBy: null },
    });
  });
}

/** ‏סריקת „קונה שקט” — פעם ביום, קונים פעילים בלבד, לפי הסף של המשרד. */
export async function processQuietBuyerSweep(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ where: { status: { in: ["active", "trial"] } }, select: { id: true } });
  for (const tenant of tenants) {
    const settings = await automationSettings(tenant.id);
    if (!settings.quiet_buyer.enabled) continue;
    const cutoff = new Date(Date.now() - (automationThresholdMs("quiet_buyer", settings) ?? 14 * DAY_MS));
    let cursor: string | undefined;
    for (;;) {
      const batch = await withTenant(tenant.id, async (tx) => {
        /* ‏סינון גס באינדקס (maturity, updatedAt); האימות המדויק — בתוך הנעילה */
        return tx.buyer.findMany({
          where: { tenantId: tenant.id, deletedAt: null, maturity: { in: ACTIVE_BUYER_MATURITIES }, updatedAt: { lte: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take: 200,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
      });
      for (const row of batch) await assessQuietBuyer(tenant.id, row.id, cutoff);
      if (batch.length < 200) break;
      cursor = batch[batch.length - 1]!.id;
    }
  }
}

/**
 * סריקת "ליד מתקרר" (docs/09 שלב 1 — "כלום לא נשכח"): ה-SLA מכסה רק
 * מענה ראשון לליד חדש; ליד שכבר בטיפול ופשוט נשכח לא היה מכוסה.
 * פעם ביום: כל ליד פתוח שלא הייתה בו פעילות STALE_LEAD_DAYS ימים
 * מקבל משימת חימום. סינון גס לפי updated_at (זול, באינדקס) ואימות
 * מדויק מול האינטראקציה האחרונה בתוך הטרנזקציה.
 */
export async function processStaleLeadSweep(): Promise<void> {
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
      const batch = await withTenant(tenant.id, async (tx) => {
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
