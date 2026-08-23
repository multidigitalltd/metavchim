import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  DEFAULT_COMMISSION_SPLIT,
  uniformTerms,
  labelOf,
  MATURITY_LABELS,
  type BuyerRequirements,
  type Page,
} from "@metavchim/shared";
import { assertBuyerAccess, ownershipFilter } from "../../common/ownership";
import {
  cleanVocabulary,
  freeTextTerms,
  normalizeRange,
  priceRangeAgorot,
} from "@metavchim/shared";
import type { Prisma } from "@prisma/client";
import { TenantContext } from "../../common/tenant-context";
import { deleteCoopDeals } from "../../common/coop-deal-cleanup";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import {
  MatchingService,
  type MatchTrigger,
} from "../matching/matching.service";
import { CollaborationService } from "../collaboration/collaboration.service";

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
  private readonly logger = new Logger(BuyersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly matching: MatchingService,
    private readonly collaboration: CollaborationService,
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
    /*
     * ההתאמות ברקע — היצירה חוזרת מיד. אותם כללים כמו בצד הנכסים:
     * הקונה כבר נשמר, ההתאמות מופיעות בכרטיס שניות אחר כך, והרענון
     * התקופתי הוא רשת הביטחון לכשל.
     */
    void this.matching.recomputeForBuyer(id).catch((error: unknown) => {
      this.logger.warn(`background match recompute failed for buyer ${id}: ${String(error)}`);
    });
    await this.autoShareToNetwork(id);
    return this.getById(id);
  }

  /**
   * שיתוף אוטומטי כביקוש ברשת — כשהמשרד בחר בכך בהגדרות.
   *
   * התאום של `PropertiesService.autoPublishToNetwork`, ואותם שלושה
   * כללים: המדיניות של מי שמחזיק `settings.manage` ולא של הסוכן
   * הקולט; מה שמתפרסם הוא צילום `demandSnapshot` האנונימי — בלי שם,
   * טלפון או הערות פנימיות; ו-best-effort — קונה בלי אזור חיפוש,
   * מכסת רשת מלאה או מסלול בלי רשת אינם "יצירת הקונה נכשלה".
   * השיתוף הידני מכרטיס הקונה זמין תמיד.
   *
   * לא נקרא מ-`createForImport` — ראו הנימוק בצד הנכסים.
   */
  private async autoShareToNetwork(buyerId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    if (settings["autoShareBuyers"] !== true) return;
    try {
      await this.collaboration.shareBuyer(
        buyerId,
        uniformTerms(DEFAULT_COMMISSION_SPLIT),
      );
    } catch {
      // הקונה נשמר; שיתוף ידני זמין מכרטיס הקונה
    }
  }

  /**
   * המרת ליד לקונה (docs/01): הליד הבשיל — המתווך מוסיף דרישות והאדם
   * נכנס למנוע ההתאמות. אותו contact (אין כפילות אדם, docs/03 §contacts),
   * ההמרה נתפסת אטומית (updateMany מותנה — לחיצה כפולה לא יוצרת שני
   * קונים), ושני הצירים מקבלים רשומת קישור.
   */
  async convertFromLead(
    leadId: string,
    input: {
      requirements: BuyerRequirements;
      financing?: string;
      maturity?: string;
    },
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
        where: {
          tenantId: ctx.tenantId,
          contactId: lead.contactId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingBuyer)
        throw new ConflictException("כבר קיים קונה פעיל לאיש קשר זה");

      const claimed = await tx.lead.updateMany({
        where: {
          id: leadId,
          tenantId: ctx.tenantId,
          status: { not: "converted" },
        },
        data: {
          status: "converted",
          requiresHuman: false,
          ...(lead.firstResponseAt === null
            ? { firstResponseAt: new Date() }
            : {}),
        },
      });
      if (claimed.count === 0)
        throw new ConflictException("הליד כבר הומר לקונה");
      // המרה = הליד טופל — משימת אסקלציית SLA פתוחה נסגרת
      await tx.task.updateMany({
        where: {
          tenantId: ctx.tenantId,
          sourceKey: `lead-sla:${leadId}`,
          status: "open",
        },
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
          hasSearchAreas: input.requirements.searchAreas.length > 0,
          dealType: input.requirements.dealType,
          budgetMinAgorot:
            input.requirements.budgetMinAgorot === undefined
              ? null
              : BigInt(input.requirements.budgetMinAgorot),
          // חסר = הלקוח לא מסר תקציב, ולא "תקציב אפס"
          budgetMaxAgorot:
            input.requirements.budgetMaxAgorot === undefined
              ? null
              : BigInt(input.requirements.budgetMaxAgorot),
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

    // ברקע — כמו ביצירה; ההמרה כבר נשמרה והרענון התקופתי מגבה
    void this.matching.recomputeForBuyer(id).catch((error: unknown) => {
      this.logger.warn(`background match recompute failed for buyer ${id}: ${String(error)}`);
    });
    // ליד שהומר הוא קונה חדש לכל דבר — אותה מדיניות רשת כמו בקליטה
    await this.autoShareToNetwork(id);
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
    contactEmail?: string;
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
    contactEmail?: string;
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
      // השלמה, לא דריסה: כתובת קיימת על הכרטיס גוברת על הקובץ
      if (input.contactEmail) {
        const existingEmail = await this.contacts.emailFor(tx, contact.id);
        if (existingEmail === undefined) {
          await this.contacts.setEmail(tx, contact.id, input.contactEmail);
        }
      }
      await tx.buyer.create({
        data: {
          id,
          tenantId,
          contactId: contact.id,
          ownerUserId: TenantContext.current().userId,
          cities: input.requirements.cities,
          hasSearchAreas: input.requirements.searchAreas.length > 0,
          dealType: input.requirements.dealType,
          budgetMinAgorot:
            input.requirements.budgetMinAgorot === undefined
              ? null
              : BigInt(input.requirements.budgetMinAgorot),
          // חסר = הלקוח לא מסר תקציב, ולא "תקציב אפס"
          budgetMaxAgorot:
            input.requirements.budgetMaxAgorot === undefined
              ? null
              : BigInt(input.requirements.budgetMaxAgorot),
          roomsMin: input.requirements.roomsMin ?? null,
          roomsMax: input.requirements.roomsMax ?? null,
          requirements: input.requirements as object,
          financing: input.financing ?? "unknown",
          maturity: input.maturity ?? "interested",
          source: input.source,
          agentNotes: input.agentNotes ?? null,
        },
      });
      await this.audit.record(tx, {
        action: "buyer.create",
        entityType: "buyer",
        entityId: id,
      });
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
    /** ראו ההסבר ליד ההשמה, בתוך הטרנזקציה. */
    let trigger: MatchTrigger | undefined;
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
      /*
       * העלאת תקציב — התאום של ירידת מחיר בנכס.
       *
       * לקוח שהעלה תקציב אמר בכך שהוא רציני, ובאותו רגע נפתחים לו
       * נכסים שהיו מעליו. ההתראה אומרת בדיוק את זה במקום "נמצאו
       * נכסים חדשים", שנקרא כמו עדכון מערכת. ירידת תקציב סוגרת
       * נכסים, ואין בה מה לבשר.
       */
      /*
       * `null` הוא "לא נמסר", ולא אפס.
       *
       * `Number(null)` הוא 0, ולכן לקוח שמסר תקציב בפעם הראשונה
       * היה מייצר "העלאת התקציב פתחה N התאמות" — מ-0 ₪. הודעה
       * שמתארת שיפור שלא קרה, על סמך נתון שלא היה קיים.
       */
      const budgetBefore =
        existing.budgetMaxAgorot === null ? null : Number(existing.budgetMaxAgorot);
      const budgetAfter = patch.requirements?.budgetMaxAgorot;
      if (budgetBefore !== null && budgetAfter !== undefined && budgetAfter > budgetBefore) {
        trigger = {
          kind: "budget_raise",
          fromAgorot: budgetBefore,
          toAgorot: budgetAfter,
        };
      }

      await tx.buyer.update({
        where: { id },
        data: {
          ...(patch.requirements
            ? {
                cities: patch.requirements.cities,
                hasSearchAreas: patch.requirements.searchAreas.length > 0,
                dealType: patch.requirements.dealType,
                budgetMinAgorot:
                  patch.requirements.budgetMinAgorot === undefined
                    ? null
                    : BigInt(patch.requirements.budgetMinAgorot),
                budgetMaxAgorot:
                  patch.requirements.budgetMaxAgorot === undefined
                    ? null
                    : BigInt(patch.requirements.budgetMaxAgorot),
                roomsMin: patch.requirements.roomsMin ?? null,
                roomsMax: patch.requirements.roomsMax ?? null,
                requirements: patch.requirements as object,
              }
            : {}),
          ...(patch.financing !== undefined
            ? { financing: patch.financing }
            : {}),
          ...(patch.maturity !== undefined
            ? { maturity: patch.maturity, maturityOverridden: true }
            : {}),
          ...(patch.agentNotes !== undefined
            ? { agentNotes: patch.agentNotes }
            : {}),
        },
      });
      // שינוי בשלות אמיתי נרשם בציר — קביעה חוזרת של אותו ערך רק מקבעת override
      if (
        patch.maturity !== undefined &&
        patch.maturity !== existing.maturity
      ) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId,
            buyerId: id,
            kind: "status_change",
            content: `בשלות: ${labelOf(MATURITY_LABELS, existing.maturity)} ← ${labelOf(MATURITY_LABELS, patch.maturity)}`,
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
      await this.matching.recomputeForBuyer(id, { trigger });
    }
    /*
     * הביקוש ברשת הוא צילום של הקונה, ולכן הוא מזדקן בכל עריכה:
     * תקציב שעלה, אישור עקרוני שהתקבל, בשלות שהתקררה. משרד אחר
     * שמשקיע נכס על מידע שכבר אינו נכון שולח הצעה באוויר — ומאשים
     * בכך את הרשת. הרענון הוא best-effort: העריכה כבר נשמרה, וכשל
     * זמני בסנכרון אינו הופך אותה ל"נכשלה".
     */
    try {
      await this.collaboration.resyncDemandForBuyer(id);
    } catch {
      // הצילום יתרענן בעריכה הבאה — כמו בחישוב ההתאמות
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
    Page<{
      id: string;
      kind: string;
      direction?: string;
      content: string;
      createdAt: Date;
    }>
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

  /**
   * פילוח לפי בשלות, מכל המאגר — לגרף בדשבורד.
   *
   * groupBy סופר בבסיס הנתונים ואינו מושך רשומות, ולכן העלות קבועה
   * גם במשרד עם עשרות אלפי קונים; אין כאן שום פענוח PII, כי הבשלות
   * אינה מוצפנת. פילטר הבעלות זהה לזה של הרשימה, אחרת המונה היה
   * מדווח על קונים שאינם גלויים למשתמש.
   */
  async breakdown(): Promise<{
    total: number;
    byMaturity: Record<string, number>;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const where = {
      tenantId,
      deletedAt: null,
      ...ownershipFilter("buyers.view_all", "ownerUserId"),
    };
    const rows = await this.prisma.withTenant((tx) =>
      tx.buyer.groupBy({ by: ["maturity"], where, _count: { _all: true } }),
    );
    const byMaturity: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      byMaturity[row.maturity] = row._count._all;
      total += row._count._all;
    }
    return { total, byMaturity };
  }

  /**
   * כל שמות המקומות שמופיעים בכרטיסי הקונים של המשרד.
   *
   * **זה מה שהחליף את רשימת הערים הקשיחה.** קודם זיהוי העיר בשאלה
   * קולית עבד מול תשע-עשרה ערים כתובות בקוד, וכל שם אחר — גבעתיים,
   * חולון, הרצליה — פשוט לא זוהה. התוצאה לא הייתה "לא הבנתי" אלא
   * חמישים קונים מכל הארץ, כי תנאי העיר מעולם לא נוסף לשאילתה.
   *
   * אוצר המילים של המשרד עצמו טוב מכל רשימה: עיר שאין בה אף קונה
   * לעולם אינה תשובה נכונה לשאלה "מי מחפש שם", והוא מתעדכן לבדו.
   *
   * `DISTINCT unnest` ולא שליפת כל הקונים: המשרד יכול להחזיק אלפי
   * כרטיסים, והמאגר יודע להחזיר את הערכים הייחודיים בלבד.
   *
   * ללא פילטר בעלות במכוון — זו רשימת **שמות מקומות**, לא נתוני
   * לקוחות. סוכן עם `view_own` שהשאלה שלו הוגבלה לאוצר המילים שלו
   * בלבד היה מקבל "לא מצאתי מקום כזה" על עיר שקיימת במשרד, והסינון
   * על הקונים עצמם ממילא נשאר מוגבל לו.
   */
  async placeVocabulary(): Promise<string[]> {
    const tenantId = TenantContext.current().tenantId;
    /*
     * המאגר כולו, לא הקונים בלבד: הסוכן פותר מולו גם שאלות על
     * **נכסים** ("מה יש לי ברמת גן"), ועיר שקיימת רק בנכס הייתה
     * מקבלת "אין במאגר אף רשומה" — אזהרה שגויה על שאלה נכונה.
     */
    const rows = await this.prisma.withTenant((tx) =>
      tx.$queryRaw<{ city: string }[]>`
        SELECT DISTINCT unnest(cities) AS city
        FROM buyers
        WHERE tenant_id = ${tenantId}::char(26) AND deleted_at IS NULL
        UNION
        SELECT DISTINCT city
        FROM properties
        WHERE tenant_id = ${tenantId}::char(26) AND deleted_at IS NULL AND city IS NOT NULL
      `,
    );
    return cleanVocabulary(rows.map((row) => row.city));
  }

  async list(query: {
    maturity?: string;
    q?: string;
    /** ערים מפורשות — קונה מתאים אם אחת מהן ברשימת הערים שלו (hasSome) */
    cities?: string[];
    minPrice?: number;
    maxPrice?: number;
    minRooms?: number;
    maxRooms?: number;
    /**
     * רק קונים שהצהירו על מספר חדרים.
     *
     * בסינון רגיל קצה ריק נחשב "פתוח", וקונה שלא מילא חדרים עובר כל
     * טווח — התנהגות נכונה למסך שמצמצם רשימה. ב**שאלה ישירה** ("מי
     * מחפש 4 חדרים") היא הפוכה: אנחנו לא יודעים כמה חדרים הוא רוצה,
     * ולכן התשובה "הוא מחפש 4" אינה נכונה. ההפרדה כאן ולא בקורא, כי
     * הסינון חייב לרוץ במסד — סינון אחרי השליפה היה שובר את מגבלת
     * החמישים.
     */
    roomsDeclaredOnly?: boolean;
    /**
     * תקציב כתנאי קשיח — לשאלה ישירה של הסוכן, לא למסך הסינון.
     *
     * הסינון הרגיל בודק חפיפת טווחים: "עד 3 מיליון" מעביר גם קונה
     * עם תקציב עד 3.6, כי הטווחים נחתכים — נכון למסך שמצמצם רשימה,
     * ושגוי כתשובה לשאלה "מי מחפש עד 3 מיליון" (המשתמש קיבל 3.6
     * בתשובה וצדק שזו טעות). במצב הזה "עד X" פירושו שהתקרה
     * **המוצהרת** של הקונה אינה עולה על X, ו"מעל X" — שהיא מגיעה
     * לפחות ל-X; קונה בלי תקציב מוצהר אינו נכלל, כי איננו יודעים.
     */
    budgetDeclaredOnly?: boolean;
    cursor?: string;
    limit: number;
  }): Promise<Page<BuyerDto>> {
    const budget = priceRangeAgorot(query.minPrice, query.maxPrice);
    const rooms = normalizeRange(query.minRooms, query.maxRooms);
    const terms = freeTextTerms(query.q);

    /*
     * כל התנאים נאספים לרשימת AND אחת ולא נפרשים כמפתחות נפרדים.
     *
     * שני תנאים שמשתמשים ב-OR באותה רמה היו דורסים זה את זה בפריסת
     * האובייקט: המפתח השני מנצח, והראשון נעלם בשקט בלי שום שגיאה.
     */
    const conditions: Prisma.BuyerWhereInput[] = [];

    /*
     * חפיפה, לא הכלה. לקונה יש *טווח* תקציב ולא מחיר אחד, ולכן מי
     * שמסנן "1–2 מיליון" מקבל גם קונה עם 1.5–2.5. בדיקת הכלה הייתה
     * מסתירה בדיוק את הקונים שבגבול, שהם לרוב המעניינים.
     * הנימוק המלא ב-list-filters (rangesOverlap).
     *
     * קצה חסר = פתוח, ולכן null חייב לעבור: ב-SQL `NULL <= x` אינו
     * true אלא NULL, וקונה שלא הגדיר תקציב מינימלי היה נעלם מכל
     * סינון "עד X" — הסמנטיקה ההפוכה בדיוק ממה שהלוגיקה המשותפת
     * מגדירה ובודקת (ביקורת Codex).
     */
    if (query.budgetDeclaredOnly === true) {
      /*
       * שאלה ישירה — התקרה המוצהרת קובעת, וקונה בלי תקציב לא נכלל.
       * השוואת SQL על NULL אינה true, ולכן אין צורך בענף null: הוא
       * נופל מעצמו, וזו בדיוק הכוונה (ראו budgetDeclaredOnly).
       */
      if (budget.max !== undefined) {
        conditions.push({ budgetMaxAgorot: { lte: budget.max } });
      }
      /*
       * "מעל X" מתקיים גם אצל קונה שהצהיר רק על מינימום: מינימום
       * מוצהר של 3.5 מיליון מוכיח שהתקציב מגיע מעל 3 — אין צורך
       * בתקרה כדי לדעת זאת (ביקורת Codex). התקרה נבדקת כשהיא
       * קיימת; בהיעדרה המינימום המוצהר מכריע.
       */
      if (budget.min !== undefined) {
        conditions.push({
          OR: [
            { budgetMaxAgorot: { gte: budget.min } },
            {
              AND: [
                { budgetMaxAgorot: null },
                { budgetMinAgorot: { gte: budget.min } },
              ],
            },
          ],
        });
      }
    } else {
      if (budget.max !== undefined) {
        conditions.push({
          OR: [
            { budgetMinAgorot: { lte: budget.max } },
            { budgetMinAgorot: null },
          ],
        });
      }
      /*
       * אותה סמנטיקה בדיוק כמו למעלה, בכיוון הנגדי: קונה בלי תקציב
       * מוצהר אינו "תקציב אפס" ולכן אינו נופל מסינון "מעל X". הוא
       * פשוט לא הצהיר, וההסתרה שלו הייתה מסתירה בדיוק את הלקוחות
       * שהמתווך צריך להתקשר אליהם כדי לברר.
       */
      if (budget.min !== undefined) {
        conditions.push({
          OR: [
            { budgetMaxAgorot: { gte: budget.min } },
            { budgetMaxAgorot: null },
          ],
        });
      }
    }
    if (rooms.max !== undefined) {
      conditions.push({
        OR: [{ roomsMin: { lte: rooms.max } }, { roomsMin: null }],
      });
    }
    if (rooms.min !== undefined) {
      conditions.push({
        OR: [{ roomsMax: { gte: rooms.min } }, { roomsMax: null }],
      });
    }

    /*
     * ערים מפורשות (השאילתה הקולית): hasSome — חיתוך לא-ריק בין
     * הערים שנשאלו לערים שהקונה מחפש. "תל אביב או רמת גן" מוצא גם
     * קונה שמעוניין רק בשנייה; ה-q הטקסטואלי נשאר למסך הסינון.
     */
    if (query.cities !== undefined && query.cities.length > 0) {
      conditions.push({ cities: { hasSome: query.cities } });
    }

    /*
     * שאלה ישירה על חדרים — רק מי שהצהיר. ראו `roomsDeclaredOnly`.
     * שני הקצוות נבדקים כי קונה יכול להצהיר על מינימום בלבד, ודי
     * באחד מהם כדי שנדע משהו על מה שהוא מחפש.
     */
    if (query.roomsDeclaredOnly === true) {
      conditions.push({ OR: [{ roomsMin: { not: null } }, { roomsMax: { not: null } }] });
    }

    /*
     * שתי דרכים להתאים לחיפוש החופשי, ומספיקה אחת:
     *   1. כל המונחים נמצאים בשדות הטקסט (AND בין מונחים).
     *   2. שורת החיפוש **כולה** היא עיר מבוקשת.
     *
     * הפיצול נדרש כי `has` על מערך דורש התאמה מדויקת לאיבר שלם:
     * "רמת גן" מתפרק ל"רמת" ו"גן", ואף אחד מהם אינו שווה לאיבר
     * "רמת גן" — כלומר רוב ערי ישראל לא היו נמצאות (ביקורת Codex).
     *
     * שם הלקוח והטלפון אינם כאן: הם מוצפנים במסד, ואי אפשר לחפש
     * בהם ILIKE. חיפוש לפי שם עובר דרך החיפוש הגלובלי (name_hash).
     */
    if (terms.length > 0) {
      conditions.push({
        OR: [
          {
            AND: terms.map((term) => ({
              OR: [
                {
                  agentNotes: { contains: term, mode: "insensitive" as const },
                },
                { aiNotes: { contains: term, mode: "insensitive" as const } },
                { source: { contains: term, mode: "insensitive" as const } },
              ],
            })),
          },
          { cities: { has: (query.q ?? "").trim() } },
        ],
      });
    }

    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.buyer.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
          ...(query.maturity ? { maturity: query.maturity } : {}),
          ...(conditions.length > 0 ? { AND: conditions } : {}),
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
          offerCountByBuyer.set(
            buyerId,
            (offerCountByBuyer.get(buyerId) ?? 0) + 1,
          );
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

      // שאילתה אחת לכל אנשי הקשר בעמוד, לא אחת לכל שורה
      const contactsById = await this.contacts.getByIds(
        tx,
        page.map((row) => row.contactId),
      );
      const items: (BuyerDto & {
        offersReceived: number;
        lastActivityAt: Date;
      })[] = [];
      for (const row of page) {
        const contact = contactsById.get(row.contactId);
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
  } /**
   * בדיקת הרשאה שרואה גם כרטיס בארכיון.
   *
   * `assertBuyerAccess` המשותפת מסננת `deletedAt: null` — נכון לכל
   * פעולה על כרטיס פעיל, ושגוי בדיוק כאן: אחרי הארכיון הכרטיס היה
   * נעלם מבדיקת ההרשאה, והמחיקה לצמיתות הייתה מחזירה "קונה לא נמצא"
   * לנצח. כלומר המסלול הדו-שלבי לא היה מגיע לשלב השני.
   *
   * פילטר הבעלות נשמר — סוכן לא נוגע בכרטיס של סוכן אחר, בארכיון או
   * מחוצה לו.
   */
  private async assertAccessIncludingArchived(
    tx: TenantTx,
    id: string,
  ): Promise<void> {
    const buyer = await tx.buyer.findFirst({
      where: {
        id,
        tenantId: TenantContext.current().tenantId,
        ...ownershipFilter("buyers.view_all", "ownerUserId"),
      },
      select: { id: true },
    });
    if (!buyer) throw new NotFoundException("קונה לא נמצא");
  }

  /**
   * מה תגרור מחיקת הכרטיס — לפני שמוחקים.
   *
   * אותו עיקרון כמו במחיקת לקוח: מנהל שמוחק כרטיס עם שלוש הצעות
   * פתוחות זכאי לדעת את זה לפני הלחיצה ולא אחריה.
   */
  async deletionPreview(id: string): Promise<{
    matches: number;
    offers: number;
    interactions: number;
    appointments: number;
    sharedDemands: number;
    archived: boolean;
  }> {
    const { tenantId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      await this.assertAccessIncludingArchived(tx, id);
      const buyer = await tx.buyer.findFirst({
        where: { id, tenantId },
        select: { deletedAt: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");
      const matchRows = await tx.match.findMany({
        where: { tenantId, buyerId: id },
        select: { id: true },
      });
      const matchIds = matchRows.map((m) => m.id);
      const [offers, interactions, appointments, sharedDemands] =
        await Promise.all([
          tx.offer.count({ where: { tenantId, matchId: { in: matchIds } } }),
          tx.interaction.count({ where: { tenantId, buyerId: id } }),
          tx.appointment.count({ where: { tenantId, buyerId: id } }),
          tx.sharedDemand.count({ where: { tenantId, originBuyerId: id } }),
        ]);
      return {
        matches: matchIds.length,
        offers,
        interactions,
        appointments,
        sharedDemands,
        archived: buyer.deletedAt !== null,
      };
    });
  }

  /**
   * ארכיון — הכרטיס יורד מהרשימות וההיסטוריה נשמרת.
   *
   * זו פעולת ברירת המחדל, ובכוונה: "הלקוח כבר לא מחפש" אינו "הלקוח
   * מעולם לא היה". הביקוש יורד מהרשת ומההתאמות כי הוא אינו רלוונטי
   * יותר — אחרת סוכנים ממשיכים לקבל הצעות על קונה שסגר.
   */
  /**
   * מחיקה מרוכזת — **המקרה של "ייבאתי את המאגר הלא נכון".**
   *
   * ייבוא שגוי מכניס מאות כרטיסים בבת אחת, וניקוי שלהם אחד-אחד
   * אינו אפשרות מעשית. בלי הפעולה הזו הדרך היחידה לתקן טעות של
   * לחיצה אחת היא מאות לחיצות, או פנייה לתמיכה.
   *
   * ## אותם שערים בדיוק, רק בלולאה
   *
   * כל מזהה עובר דרך `archive`/`purge` הקיימים, ולכן הוא נבדק
   * לבעלות ולמצב כמו במחיקה בודדת. מסלול מרוכז שכותב שאילתה משלו
   * היה עוקף את השערים האלה — וזו בדיוק הצורה שבה פעולה נוחה
   * הופכת לחור.
   *
   * ## למה כשל אחד אינו מפיל את הכול
   *
   * בבחירה של מאתיים כרטיסים סביר שאחד כבר נמחק, אחד שייך לעמית,
   * ואחד אינו בארכיון. עצירה על הראשון הייתה משאירה את המשתמש עם
   * מצב חלקי שאינו יודע לתאר. כל מזהה נספר בנפרד, והתשובה אומרת
   * כמה נמחקו וכמה לא — כך אפשר לפעול לפיה.
   */
  async removeMany(
    ids: readonly string[],
    permanent: boolean,
  ): Promise<{ removed: number; skipped: number }> {
    let removed = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        /*
         * מחיקה לצמיתות עוברת דרך הארכיון, ולא במקומו.
         *
         * `purge` דורש כרטיס שכבר בארכיון — וזו דרישה נכונה במחיקה
         * בודדת, שבה המשתמש רואה את הכרטיס בארכיון ובוחר למחוק
         * אותו משם. אבל הרשימה שממנה נבחרים הכרטיסים מציגה
         * **פעילים בלבד**, ולכן קריאה ישירה ל-`purge` הייתה נדחית
         * על כל אחד מהם, נספרת כ„דולג”, והכפתור היה מדווח אפס
         * מחיקות בלי שום הסבר (ביקורת Codex).
         *
         * שני השלבים ברצף שומרים על אותו כלל בדיוק: כרטיס עובר
         * לארכיון ואז נמחק — רק בלי להכריח את המשתמש לעשות זאת
         * מאתיים פעם ידנית.
         */
        if (permanent) {
          await this.archive(id).catch(() => undefined); // כבר בארכיון — תקין
          await this.purge(id);
        } else {
          await this.archive(id);
        }
        removed += 1;
      } catch {
        // כרטיס של עמית, או כזה שכבר נמחק
        skipped += 1;
      }
    }
    return { removed, skipped };
  }

  async archive(id: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      await assertBuyerAccess(tx, ctx.tenantId, id);
      const buyer = await tx.buyer.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");

      await tx.buyer.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.retireBuyerMatches(tx, id);
      await this.withdrawDemands(tx, ctx.tenantId, id);
      await this.audit.record(tx, {
        action: "buyer.archive",
        entityType: "buyer",
        entityId: id,
      });
    });
  }

  /**
   * מחיקה לצמיתות — רק מכרטיס שכבר בארכיון.
   *
   * שני שלבים ולא אחד: כרטיס פעיל שנמחק בלחיצה אחת הוא היסטוריה
   * שנעלמת בטעות. מי שמוחק כרטיס בארכיון כבר החליט פעם אחת.
   *
   * הפגישות והשיחות **מנותקות ולא נמחקות** — פגישה שהתקיימה היא
   * אירוע ביומן של הסוכן, ולא נכס של הכרטיס. אותו כלל בדיוק כמו
   * במחיקת ליד.
   */
  async purge(id: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      await this.assertAccessIncludingArchived(tx, id);
      const buyer = await tx.buyer.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { deletedAt: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");
      if (buyer.deletedAt === null) {
        throw new BadRequestException(
          "יש להעביר את הכרטיס לארכיון לפני מחיקה לצמיתות",
        );
      }

      const matchRows = await tx.match.findMany({
        where: { tenantId: ctx.tenantId, buyerId: id },
        select: { id: true },
      });
      const matchIds = matchRows.map((m) => m.id);
      // ההצעה תלויה בהתאמה, ולכן לפניה
      await tx.offer.deleteMany({
        where: { tenantId: ctx.tenantId, matchId: { in: matchIds } },
      });
      await tx.match.deleteMany({
        where: { tenantId: ctx.tenantId, buyerId: id },
      });
      await this.withdrawDemands(tx, ctx.tenantId, id);
      await tx.interaction.deleteMany({
        where: { tenantId: ctx.tenantId, buyerId: id },
      });
      await tx.appointment.updateMany({
        where: { tenantId: ctx.tenantId, buyerId: id },
        data: { buyerId: null },
      });
      await tx.notification.deleteMany({
        where: { tenantId: ctx.tenantId, entityType: "buyer", entityId: id },
      });
      await tx.task.deleteMany({
        where: { tenantId: ctx.tenantId, entityType: "buyer", entityId: id },
      });
      /*
       * בקשות טופס הלקוח שהצביעו על הקונה — כולל מה שהלקוח מילא.
       * קישור ששרד את הכרטיס הוא טופס שממשיך לעבוד ולהצביע על
       * כרטיס שאיננו, ומחיקה ש„לא נשאר ממנה פרט” חייבת לכלול אותו.
       */
      await tx.intakeRequest.deleteMany({
        where: { tenantId: ctx.tenantId, subject: "buyer", subjectId: id },
      });
      await tx.buyer.delete({ where: { id } });

      // מזהים ומונים בלבד — ביומן לא נשמר מה שנמחק
      await this.audit.record(tx, {
        action: "buyer.delete",
        entityType: "buyer",
        entityId: id,
        metadata: { matches: matchIds.length },
      });
    });
  }

  /** התאמות של כרטיס שיצא ממחזור — כמו ביציאת נכס משיווק. */
  private async retireBuyerMatches(
    tx: TenantTx,
    buyerId: string,
  ): Promise<void> {
    /*
     * ההצעות של ההתאמות הנמחקות יורדות איתן. בפועל התאמה במצב
     * `suggested` היא התאמה שלא הוצעה — שליחת הצעה מעבירה אותה
     * ל-`offered` — ולכן אין כאן מה למחוק. אבל אין FK בין `offers`
     * ל-`matches`, כלומר האינווריאנט הזה נשמר בקוד בלבד, ורגע שבו
     * הוא נשבר משאיר הצעה שמצביעה על התאמה שאיננה ואיש כבר לא
     * יגיע אליה. שאילתה אחת מונעת זליגה שאין דרך לנקות אחריה.
     */
    const doomed = await tx.match.findMany({
      where: { buyerId, status: "suggested" },
      select: { id: true },
    });
    if (doomed.length > 0) {
      await tx.offer.deleteMany({
        where: { matchId: { in: doomed.map((m) => m.id) } },
      });
    }
    await tx.match.deleteMany({ where: { buyerId, status: "suggested" } });
    await tx.match.updateMany({
      where: { buyerId, status: { not: "dismissed" } },
      data: { status: "dismissed" },
    });
  }

  /**
   * הסרת הביקוש מהרשת.
   *
   * הצעות שת"פ שהתקבלו עליו יורדות איתו: הצעה על ביקוש שאינו קיים
   * היא פנייה שאיש לא יטפל בה, והמשרד השני ממתין לשווא.
   */
  private async withdrawDemands(
    tx: TenantTx,
    tenantId: string,
    buyerId: string,
  ): Promise<void> {
    // חדרי העסקה שהקונה הזה עומד בבסיסם — לפני הביקושים וההצעות,
    // כי הם מצביעים על הכרטיס שעומד להימחק
    await deleteCoopDeals(tx, { buyerId, buyerTenantId: tenantId });

    const demands = await tx.sharedDemand.findMany({
      where: { tenantId, originBuyerId: buyerId },
      select: { id: true },
    });
    if (demands.length === 0) return;
    await tx.coopOffer.deleteMany({
      where: { demandId: { in: demands.map((d) => d.id) } },
    });
    await tx.sharedDemand.deleteMany({
      where: { tenantId, originBuyerId: buyerId },
    });
  }
}
