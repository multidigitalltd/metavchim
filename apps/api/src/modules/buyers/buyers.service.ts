import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  MATURITY_LABELS,
  type BuyerRequirements,
  type Page,
} from "@metavchim/shared";
import { ownershipFilter } from "../../common/ownership";
import { freeTextTerms, normalizeRange, priceRangeAgorot } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { MatchingService } from "../matching/matching.service";

export interface BuyerDto {
  id: string;
  contact: { id: string; name: string; phone: string };
  requirements: BuyerRequirements;
  financing: string;
  maturity: string;
  source: string;
  agentNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BuyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly matching: MatchingService,
  ) {}

  async create(input: {
    contactName: string;
    contactPhone: string;
    requirements: BuyerRequirements;
    financing?: string;
    maturity?: string;
    source: string;
    agentNotes?: string;
  }): Promise<BuyerDto> {
    const id = await this.persist(input);
    await this.matching.recomputeForBuyer(id);
    return this.getById(id);
  }

  /**
   * המרת ליד לקונה (docs/01): הליד הבשיל — המתווך מוסיף דרישות והאדם
   * נכנס למנוע ההתאמות. אותו contact (אין כפילות אדם, docs/03 §contacts),
   * ההמרה נתפסת אטומית (updateMany מותנה — לחיצה כפולה לא יוצרת שני
   * קונים), ושני הצירים מקבלים רשומת קישור.
   */
  async convertFromLead(
    leadId: string,
    input: { requirements: BuyerRequirements; financing?: string; maturity?: string },
  ): Promise<BuyerDto> {
    const ctx = TenantContext.current();
    const id = ulid();

    await this.prisma.withTenant(async (tx) => {
      // ראות הליד לפי אותו פילטר בעלות של מודול הלידים
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId,
          tenantId: ctx.tenantId,
          ...ownershipFilter("leads.view_all", "assignedToUserId"),
        },
      });
      if (!lead) throw new NotFoundException("ליד לא נמצא");

      // נעילת איש הקשר: שני לידים שונים של אותו אדם שמומרים במקביל
      // מסתדרים בתור — בדיקת "קונה פעיל קיים" אטומית ברמת ה-contact,
      // כי אין unique על (tenant, contact) בקונים (ביקורת Codex)
      await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${lead.contactId} AND tenant_id = ${ctx.tenantId} FOR UPDATE`;
      const existingBuyer = await tx.buyer.findFirst({
        where: { tenantId: ctx.tenantId, contactId: lead.contactId, deletedAt: null },
        select: { id: true },
      });
      if (existingBuyer) throw new ConflictException("כבר קיים קונה פעיל לאיש קשר זה");

      const claimed = await tx.lead.updateMany({
        where: { id: leadId, tenantId: ctx.tenantId, status: { not: "converted" } },
        data: {
          status: "converted",
          requiresHuman: false,
          ...(lead.firstResponseAt === null ? { firstResponseAt: new Date() } : {}),
        },
      });
      if (claimed.count === 0) throw new ConflictException("הליד כבר הומר לקונה");
      // המרה = הליד טופל — משימת אסקלציית SLA פתוחה נסגרת
      await tx.task.updateMany({
        where: { tenantId: ctx.tenantId, sourceKey: `lead-sla:${leadId}`, status: "open" },
        data: { status: "done" },
      });

      await tx.buyer.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          contactId: lead.contactId,
          // הקונה שייך לסוכן שמטפל בליד — אדמין שממיר לא גונב בעלות
          // מסוכן שרואה רק view_own (ביקורת Codex, P1)
          ownerUserId: lead.assignedToUserId ?? ctx.userId,
          cities: input.requirements.cities,
          dealType: input.requirements.dealType,
          budgetMinAgorot:
            input.requirements.budgetMinAgorot === undefined
              ? null
              : BigInt(input.requirements.budgetMinAgorot),
          budgetMaxAgorot: BigInt(input.requirements.budgetMaxAgorot),
          roomsMin: input.requirements.roomsMin ?? null,
          roomsMax: input.requirements.roomsMax ?? null,
          requirements: input.requirements as object,
          financing: input.financing ?? "unknown",
          maturity: input.maturity ?? "interested",
          source: `lead:${lead.source}`,
          agentNotes: lead.summary ?? null,
        },
      });

      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          leadId,
          kind: "status_change",
          content: "converted", // ציר הליד מתרגם ערכי סטטוס לעברית ב-UI
          createdBy: ctx.userId,
        },
      });
      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          buyerId: id,
          kind: "system",
          content: `נוצר מהמרת ליד (מקור: ${lead.source})`,
          createdBy: ctx.userId,
        },
      });

      await this.audit.record(tx, {
        action: "lead.convert",
        entityType: "lead",
        entityId: leadId,
        metadata: { buyerId: id },
      });
      await this.outbox.emit(tx, "buyer.updated", {
        buyerId: id,
        tenantId: ctx.tenantId,
        changedFields: ["created"],
      });
    });

    try {
      await this.matching.recomputeForBuyer(id);
    } catch {
      // ההמרה כבר נשמרה — כישלון זמני בהתאמות לא הופך אותה ל"נכשלה"
      // (ניסיון חוזר היה מקבל 409); יחושב מחדש בעריכה הבאה, כמו בייבוא.
    }
    return this.getById(id);
  }

  /**
   * ייבוא בכמות (docs/08 §6): ההצלחה נקבעת בגבול הטרנזקציה — ברגע שהקונה
   * נשמר הוא "נוצר", גם אם חישוב ההתאמות שאחריו נכשל זמנית (best-effort;
   * יחושב מחדש בעריכה הבאה). מונע דיווח-כזב וכפילויות בניסיון חוזר.
   */
  async createForImport(input: {
    contactName: string;
    contactPhone: string;
    requirements: BuyerRequirements;
    financing?: string;
    maturity?: string;
    source: string;
    agentNotes?: string;
  }): Promise<string> {
    const id = await this.persist(input);
    try {
      await this.matching.recomputeForBuyer(id);
    } catch {
      // הקונה כבר נשמר; חישוב ההתאמות אינו חלק מהצלחת היצירה.
    }
    return id;
  }

  /** יוצר את רשומת הקונה (+ איש הקשר) בטרנזקציה יחידה — גבול ההצלחה. */
  private async persist(input: {
    contactName: string;
    contactPhone: string;
    requirements: BuyerRequirements;
    financing?: string;
    maturity?: string;
    source: string;
    agentNotes?: string;
  }): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();

    await this.prisma.withTenant(async (tx) => {
      const contact = await this.contacts.findOrCreateByPhone(tx, {
        name: input.contactName,
        phone: input.contactPhone,
      });
      await tx.buyer.create({
        data: {
          id,
          tenantId,
          contactId: contact.id,
          ownerUserId: TenantContext.current().userId,
          cities: input.requirements.cities,
          dealType: input.requirements.dealType,
          budgetMinAgorot:
            input.requirements.budgetMinAgorot === undefined
              ? null
              : BigInt(input.requirements.budgetMinAgorot),
          budgetMaxAgorot: BigInt(input.requirements.budgetMaxAgorot),
          roomsMin: input.requirements.roomsMin ?? null,
          roomsMax: input.requirements.roomsMax ?? null,
          requirements: input.requirements as object,
          financing: input.financing ?? "unknown",
          maturity: input.maturity ?? "interested",
          source: input.source,
          agentNotes: input.agentNotes ?? null,
        },
      });
      await this.audit.record(tx, { action: "buyer.create", entityType: "buyer", entityId: id });
      await this.outbox.emit(tx, "buyer.updated", {
        buyerId: id,
        tenantId,
        changedFields: ["created"],
      });
    });

    return id;
  }

  async update(
    id: string,
    patch: {
      requirements?: BuyerRequirements;
      financing?: string;
      maturity?: string;
      agentNotes?: string;
    },
  ): Promise<BuyerDto> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      // נעילת השורה: עדכונים מקבילים מסתדרים בתור, כך שהערך הישן שנקרא
      // לרשומת ה-status_change הוא המעבר שבאמת קרה (ביקורת Codex)
      await tx.$queryRaw`SELECT id FROM buyers WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
      const existing = await tx.buyer.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
          // הרשאה בשליפה עצמה: בלעדיה העדכון היה נכתב לשורה של סוכן
          // אחר ורק אז נכשל בקריאה החוזרת המסוננת — כתיבה שהצליחה
          // בשקט מאחורי הודעת שגיאה
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
      });
      if (!existing) throw new NotFoundException("קונה לא נמצא");

      await tx.buyer.update({
        where: { id },
        data: {
          ...(patch.requirements
            ? {
                cities: patch.requirements.cities,
                dealType: patch.requirements.dealType,
                budgetMinAgorot:
                  patch.requirements.budgetMinAgorot === undefined
                    ? null
                    : BigInt(patch.requirements.budgetMinAgorot),
                budgetMaxAgorot: BigInt(patch.requirements.budgetMaxAgorot),
                roomsMin: patch.requirements.roomsMin ?? null,
                roomsMax: patch.requirements.roomsMax ?? null,
                requirements: patch.requirements as object,
              }
            : {}),
          ...(patch.financing !== undefined ? { financing: patch.financing } : {}),
          ...(patch.maturity !== undefined
            ? { maturity: patch.maturity, maturityOverridden: true }
            : {}),
          ...(patch.agentNotes !== undefined ? { agentNotes: patch.agentNotes } : {}),
        },
      });
      // שינוי בשלות אמיתי נרשם בציר — קביעה חוזרת של אותו ערך רק מקבעת override
      if (patch.maturity !== undefined && patch.maturity !== existing.maturity) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId,
            buyerId: id,
            kind: "status_change",
            content: `בשלות: ${MATURITY_LABELS[existing.maturity] ?? existing.maturity} ← ${MATURITY_LABELS[patch.maturity] ?? patch.maturity}`,
            createdBy: TenantContext.current().userId,
          },
        });
      }
      await this.audit.record(tx, {
        action: "buyer.update",
        entityType: "buyer",
        entityId: id,
        metadata: { changedFields: Object.keys(patch) },
      });
      await this.outbox.emit(tx, "buyer.updated", {
        buyerId: id,
        tenantId,
        changedFields: Object.keys(patch),
      });
    });

    if (patch.requirements) {
      await this.matching.recomputeForBuyer(id);
    }
    return this.getById(id);
  }

  async getById(id: string): Promise<BuyerDto> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.buyer.findFirst({
        where: {
          id,
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
      });
      if (!row) throw new NotFoundException("קונה לא נמצא");
      const contact = await this.contacts.getById(tx, row.contactId);
      if (!contact) throw new NotFoundException("איש קשר לא נמצא");
      return this.toDto(row, contact);
    });
  }

  /**
   * ציר האינטראקציות של הקונה (הערות/שיחות) — נראה רק למי שרואה את הקונה
   * עצמו (אותו ownershipFilter; ידיעת ID אינה הרשאה). עימוד Cursor כמו
   * בשאר הרשימות — היסטוריה ארוכה נגישה במלואה, לא נקטמת (ביקורת Codex).
   */
  async listInteractions(
    buyerId: string,
    query: { cursor?: string; limit: number },
  ): Promise<
    Page<{ id: string; kind: string; direction?: string; content: string; createdAt: Date }>
  > {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({
        where: {
          id: buyerId,
          tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { id: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");
      // ULID יורד = מהחדש לישן; ה-Cursor הוא ה-id האחרון שהוצג
      const rows = await tx.interaction.findMany({
        where: {
          tenantId,
          buyerId,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      return {
        items: page.map((i) => ({
          id: i.id,
          kind: i.kind,
          direction: i.direction ?? undefined,
          content: i.content,
          createdAt: i.createdAt,
        })),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /** תיעוד הערה/שיחה על הקונה — נשמר לצמיתות בציר (docs/01 §5). */
  async addInteraction(
    buyerId: string,
    input: { kind: "note" | "call"; direction?: "in" | "out"; content: string },
  ): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({
        where: {
          id: buyerId,
          tenantId: ctx.tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { id: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");
      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          buyerId,
          kind: input.kind,
          direction: input.direction ?? null,
          content: input.content,
          createdBy: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "buyer.interaction_add",
        entityType: "buyer",
        entityId: buyerId,
      });
    });
  }

  async list(query: {
    maturity?: string;
    q?: string;
    minPrice?: number;
    maxPrice?: number;
    minRooms?: number;
    maxRooms?: number;
    cursor?: string;
    limit: number;
  }): Promise<Page<BuyerDto>> {
    const budget = priceRangeAgorot(query.minPrice, query.maxPrice);
    const rooms = normalizeRange(query.minRooms, query.maxRooms);
    const terms = freeTextTerms(query.q);

    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.buyer.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
          ...(query.maturity ? { maturity: query.maturity } : {}),
          /*
           * חפיפה, לא הכלה.
           *
           * לקונה יש *טווח* תקציב, ולא מחיר אחד. מתווך שמסנן
           * "1–2 מיליון" מחפש את מי שהטווח שלו נחתך עם זה — קונה עם
           * 1.5–2.5 מיליון רלוונטי לו לגמרי. בדיקת הכלה הייתה מסתירה
           * בדיוק את הקונים שבגבול, שהם לרוב המעניינים.
           * הנימוק המלא ב-list-filters (rangesOverlap).
           */
          ...(budget.max !== undefined ? { budgetMinAgorot: { lte: budget.max } } : {}),
          ...(budget.min !== undefined ? { budgetMaxAgorot: { gte: budget.min } } : {}),
          ...(rooms.max !== undefined ? { roomsMin: { lte: rooms.max } } : {}),
          ...(rooms.min !== undefined ? { roomsMax: { gte: rooms.min } } : {}),
          /*
           * החיפוש החופשי מכסה את מה שנכתב על הקונה — ערים מבוקשות,
           * הערות הסוכן וסיכומי השיחות. שם הלקוח *אינו* כאן: הוא
           * מוצפן במסד, ואי אפשר לחפש בו ILIKE. חיפוש לפי שם עובר
           * דרך החיפוש הגלובלי, שמשתמש ב-name_hash.
           */
          ...(terms.length > 0
            ? {
                AND: terms.map((term) => ({
                  OR: [
                    { cities: { has: term } },
                    { agentNotes: { contains: term, mode: "insensitive" as const } },
                    { aiNotes: { contains: term, mode: "insensitive" as const } },
                    { source: { contains: term, mode: "insensitive" as const } },
                  ],
                })),
              }
            : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);

      /*
       * העשרה למסך הרשימה (קובץ העיצוב): "הצעות שקיבל" ו"פעילות
       * אחרונה". שתי שאילתות מקובצות לעמוד כולו — לא לכל שורה.
       * אין קשרי Prisma בסכימה, ולכן ספירת ההצעות עוברת דרך ההתאמות:
       * offer.matchId ⟵ match.buyerId.
       */
      const tenantId = TenantContext.current().tenantId;
      const buyerIds = page.map((r) => r.id);
      const pageMatches = await tx.match.findMany({
        where: { tenantId, buyerId: { in: buyerIds } },
        select: { id: true, buyerId: true },
      });
      const buyerByMatch = new Map(pageMatches.map((m) => [m.id, m.buyerId]));
      const offers = await tx.offer.findMany({
        where: { tenantId, matchId: { in: pageMatches.map((m) => m.id) } },
        select: { matchId: true },
      });
      const offerCountByBuyer = new Map<string, number>();
      for (const o of offers) {
        const buyerId = buyerByMatch.get(o.matchId);
        if (buyerId !== undefined) {
          offerCountByBuyer.set(buyerId, (offerCountByBuyer.get(buyerId) ?? 0) + 1);
        }
      }
      const lastInteractions = await tx.interaction.groupBy({
        by: ["buyerId"],
        where: { tenantId, buyerId: { in: buyerIds } },
        _max: { createdAt: true },
      });
      const lastByBuyer = new Map(
        lastInteractions.map((row) => [row.buyerId, row._max.createdAt]),
      );

      const items: (BuyerDto & { offersReceived: number; lastActivityAt: Date })[] = [];
      for (const row of page) {
        const contact = await this.contacts.getById(tx, row.contactId);
        if (contact) {
          items.push({
            ...this.toDto(row, contact),
            offersReceived: offerCountByBuyer.get(row.id) ?? 0,
            // אין תיעוד אינטראקציה ⇒ העדכון האחרון של הכרטיס עצמו
            lastActivityAt: lastByBuyer.get(row.id) ?? row.updatedAt,
          });
        }
      }
      return { items, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
    });
  }

  private toDto(
    row: {
      id: string;
      requirements: unknown;
      financing: string;
      maturity: string;
      source: string;
      agentNotes: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    contact: { id: string; name: string; phone: string },
  ): BuyerDto {
    return {
      id: row.id,
      contact,
      requirements: BuyerRequirementsSchema.parse(row.requirements),
      financing: row.financing,
      maturity: row.maturity,
      source: row.source,
      agentNotes: row.agentNotes ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
