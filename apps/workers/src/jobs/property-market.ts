import { type Job } from "bullmq";
import { ulid } from "ulid";
import { z } from "zod";
import { shekelsLabel } from "@metavchim/shared";
import { prisma } from "../runtime.js";
import { automationOn } from "../tenant-settings.js";

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
const PriceDropJobSchema = z.object({
  tenantId: z.string(),
  propertyId: z.string(),
  fromAgorot: z.number().int(),
  toAgorot: z.number().int(),
  changedAt: z.string(),
});

/**
 * ‏המחיר ירד — משימה אחת לסוכן של הנכס: כמה קונים ביקרו ואמרו „גבוה”,
 * ‏כמה דחו בגלל המחיר, ואיפה ההודעה המוכנה (כרטיס הנכס). בלי שמות
 * ‏במשימה: הם בכרטיס, מאחורי יכולת הקונים.
 *
 * ‏דדופ לפי הנכס ומועד השינוי: ניסיון חוזר של אותו אירוע אינו מכפיל,
 * ‏וירידה נוספת בחודש הבא פותחת משימה חדשה.
 */
export async function processPriceDropReoffer(job: Job): Promise<void> {
  const { tenantId, propertyId, fromAgorot, toAgorot, changedAt } = PriceDropJobSchema.parse(job.data);
  const since = new Date(changedAt);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx.$executeRaw`SELECT id FROM properties WHERE id = ${propertyId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const property = await tx.property.findFirst({
      where: { id: propertyId, tenantId, deletedAt: null, status: { in: ["draft", "active"] } },
      select: {
        agentUserId: true, marketingTitle: true, street: true, houseNumber: true, city: true,
        priceAgorot: true, priceChangedAt: true,
      },
    });
    if (!property) return;
    /*
     * ‏האירוע חייב עדיין לתאר את הנכס: תור שהתעכב אחרי שינוי מחיר נוסף
     * ‏היה יוצר משימה על הורדה שכבר אינה זו שבכרטיס (ביקורת Codex).
     */
    if (
      property.priceChangedAt === null ||
      property.priceChangedAt.getTime() !== since.getTime() ||
      Number(property.priceAgorot) !== toAgorot
    ) {
      return;
    }
    /* ‏רק התנגדויות שלפני ההורדה — מי שאמר „יקר” אחריה ראה כבר את המחיר החדש */
    const [viewings, dismissed] = await Promise.all([
      tx.appointment.findMany({
        where: {
          tenantId, propertyId, kind: "viewing", status: "completed", feedbackPrice: "high", buyerId: { not: null },
          startsAt: { lt: since },
        },
        select: { buyerId: true },
        take: 200,
      }),
      tx.match.findMany({
        where: { tenantId, propertyId, dismissReason: "price", dismissedAt: { lt: since } },
        select: { buyerId: true },
        take: 200,
      }),
    ]);
    const saidHigh = new Set(viewings.map((v) => v.buyerId!));
    const declined = new Set(dismissed.map((m) => m.buyerId));
    const ids = [...new Set([...saidHigh, ...declined])];
    if (ids.length === 0) return;
    const buyers = await tx.buyer.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: null },
      select: { id: true, ownerUserId: true },
    });
    if (buyers.length === 0) return;

    /*
     * ‏למי אומרים: לסוכן של **הקונה**. הכרטיס מסנן לפי בעלות על הקונה,
     * ‏ולכן משימה אחת לסוכן הנכס עם מספר כולל הייתה מראה לו מספר
     * ‏שאינו תואם למה שהוא רואה — ואת סוכני הקונים לא מיידעת כלל
     * ‏(ביקורת Codex). קונה בלי סוכן פעיל ⟵ סוכן הנכס, ואם אין ⟵
     * ‏בעלי המשרד, שרואים את כולם.
     */
    const ownerIds = buyers.map((b) => b.ownerUserId).filter((id): id is string => id !== null);
    const candidates = [...new Set([...ownerIds, ...(property.agentUserId === null ? [] : [property.agentUserId])])];
    const active = new Set(
      candidates.length === 0
        ? []
        : (await tx.user.findMany({ where: { tenantId, isActive: true, id: { in: candidates } }, select: { id: true } })).map((u) => u.id),
    );
    const officeOwners = await tx.user.findMany({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const agent = property.agentUserId !== null && active.has(property.agentUserId) ? property.agentUserId : null;
    const groups = new Map<string, { buyerIds: string[]; notify: string[] }>();
    for (const buyer of buyers) {
      const own = buyer.ownerUserId !== null && active.has(buyer.ownerUserId) ? buyer.ownerUserId : null;
      const assignee = own ?? agent ?? officeOwners[0]?.id;
      if (assignee === undefined) continue;
      const group = groups.get(assignee) ?? {
        buyerIds: [],
        notify: own !== null || agent !== null ? [assignee] : officeOwners.map((o) => o.id),
      };
      group.buyerIds.push(buyer.id);
      groups.set(assignee, group);
    }

    const address = [[property.street, property.houseNumber].filter(Boolean).join(" "), property.city].filter((p) => p).join(", ");
    const label = property.marketingTitle || address || "הנכס";
    const money = (agorot: number): string => shekelsLabel(agorot / 100);
    for (const [assignee, group] of groups) {
      const sourceKey = `price-drop:${propertyId}:${assignee}`;
      const existing = await tx.task.findFirst({ where: { tenantId, sourceKey, createdAt: { gte: since } }, select: { id: true } });
      if (existing) continue;
      const mine = new Set(group.buyerIds);
      const high = ids.filter((id) => mine.has(id) && saidHigh.has(id)).length;
      const decl = ids.filter((id) => mine.has(id) && declined.has(id)).length;
      const parts = [
        high > 0 ? `${high === 1 ? "קונה אחד ביקר ואמר" : `${high} קונים ביקרו ואמרו`} שהמחיר גבוה` : null,
        decl > 0 ? `${decl === 1 ? "אחד דחה" : `${decl} דחו`} בגלל המחיר` : null,
      ].filter((part): part is string => part !== null);
      const count = mine.size === 1 ? "קונה אחד" : `${mine.size} קונים`;
      await tx.task.create({
        data: {
          id: ulid(), tenantId, assignedToUserId: assignee,
          title: `💸 המחיר ירד — ${count} שכדאי להציע להם שוב: ${label}`.slice(0, 200),
          notes: `המחיר ירד מ-${money(fromAgorot)} ל-${money(toAgorot)}. ${parts.join(", ")}.\nבכרטיס הנכס: „ירד המחיר — להציע שוב”, עם הודעת וואטסאפ מוכנה לכל אחד.`.slice(0, 2000),
          dueAt: new Date(), entityType: "property", entityId: propertyId, sourceKey,
        },
      });
      for (const userId of group.notify) {
        await tx.notification.create({
          data: {
            id: ulid(), tenantId, userId, type: "price_drop_reoffer",
            title: `💸 המחיר ירד — ${count} להציע להם שוב`,
            body: `${label}: ${parts.join(", ")}. ההודעה מוכנה בכרטיס הנכס.`.slice(0, 500),
            entityType: "property", entityId: propertyId,
          },
        });
      }
    }
  });
}

export async function processPropertyDelisted(job: Job): Promise<void> {
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
