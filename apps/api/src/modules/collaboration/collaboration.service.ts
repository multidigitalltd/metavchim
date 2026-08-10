import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  commissionSplitRejectionReason,
  coopOfferCost,
  scoreMatch,
  sharedLeadPrice,
  type BuyerRequirements,
  type LeadSourcePrice,
} from "@metavchim/shared";
import { assertLeadAccess } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { LeadPricingService } from "../../core/lead-pricing.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { rowToFields } from "../properties/property.mapper";

/** שורת נכס כפי ש-Prisma מחזירה — הטיפוס נגזר ולא מועתק ידנית. */
type PropertyRow = Parameters<typeof rowToFields>[0];

const INITIAL_CREDITS = 20;
/** עיגול תקציב כלפי מעלה ל-100 אלף ₪ — אנונימיזציה (docs/04 §7) */
const BUDGET_ROUND_AGOROT = 10_000_000;

/** נכס שלי שמתאים לביקוש ברשת — כדי שלא צריך לנחש מתוך רשימה. */
export interface DemandMatchDto {
  propertyId: string;
  title: string;
  score: number;
  explanation: string;
}

export interface SharedDemandDto {
  id: string;
  cities: string[];
  dealType: string;
  budgetMaxAgorot: number;
  roomsMin?: number;
  roomsMax?: number;
  mustFeatures: string[];
  source: string;
  /**
   * כמה קרדיטים תעלה הצעה על הביקוש הזה. 0 = חינם.
   *
   * מוחזר מהשרת ולא מחושב במסך: המסך שמראה "חינם" על ביקוש שיחייב
   * הוא הפתעה בתשלום.
   */
  creditsCost: number;
  /** אחוז העמלה שהמשרד המשתף מבקש; לצד השני נשאר המשלים. */
  commissionSplit: number;
  status: string;
  /** true אם הביקוש שלי — רק אז יש קישור לקונה */
  mine: boolean;
  originBuyerId?: string;
  createdAt: Date;
  /** הנכסים שלי שמתאימים — מחושב במנוע ההתאמות, לא ניחוש */
  myMatches?: DemandMatchDto[];
}

export interface CoopOfferDto {
  id: string;
  demandId: string;
  direction: "incoming" | "outgoing";
  presentation: Record<string, unknown>;
  status: string;
  /**
   * אחוז העמלה שהמשרד ה**מציע** לוקח.
   *
   * מוחזר לשני הצדדים: המקבל צריך לדעת על מה הוא מסכים לפני שהוא
   * מסמן "מעוניין", ולא אחרי.
   */
  commissionSplit: number;
  createdAt: Date;
}

/** ליד בשוק — בפיד רק מה שאנונימי; פרטי הקשר לעולם לא כאן. */
export interface SharedLeadDto {
  id: string;
  intent: string;
  source: string;
  city?: string;
  note?: string;
  priceCredits: number;
  status: string;
  mine: boolean;
  /** קישור לליד המקורי — רק למשרד המוכר */
  originLeadId?: string;
  createdAt: Date;
}

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly plans: PlanCatalogService,
    private readonly pricing: LeadPricingService,
  ) {}

  /**
   * שיתוף קונה כביקוש אנונימי: בלי שם, בלי טלפון, תקציב מעוגל.
   *
   * `commissionSplit` הוא האחוז שהמשרד המשתף לוקח. הוא נקבע כאן, ברגע
   * השיתוף, ולא בסוף העסקה — מו"מ על אחוזים אחרי שהקונה כבר התעניין
   * הוא המקום שבו שיתופי פעולה נשברים.
   */
  async shareBuyer(buyerId: string, commissionSplit: number): Promise<SharedDemandDto> {
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();
    const splitRejection = commissionSplitRejectionReason(commissionSplit);
    if (splitRejection !== null) throw new BadRequestException(splitRejection);

    await this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, tenantId, deletedAt: null },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");

      const existing = await tx.sharedDemand.findFirst({
        where: { tenantId, originBuyerId: buyerId, status: "active" },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("הקונה כבר משותף ברשת");

      const requirements = BuyerRequirementsSchema.parse(buyer.requirements);
      const roundedBudget =
        Math.ceil(Number(buyer.budgetMaxAgorot) / BUDGET_ROUND_AGOROT) * BUDGET_ROUND_AGOROT;

      await tx.sharedDemand.create({
        data: {
          id,
          commissionSplit,
          tenantId,
          originBuyerId: buyerId,
          cities: requirements.cities,
          dealType: buyer.dealType,
          budgetMaxAgorot: BigInt(roundedBudget),
          roomsMin: buyer.roomsMin,
          roomsMax: buyer.roomsMax,
          mustFeatures: Object.entries(requirements.features)
            .filter(([, level]) => level === "must")
            .map(([feature]) => feature),
        },
      });
      await this.audit.record(tx, {
        action: "collaboration.share",
        entityType: "shared_demand",
        entityId: id,
        metadata: { buyerId },
      });
    });

    return this.getDemand(id);
  }

  async unshare(demandId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.sharedDemand.updateMany({
        where: { id: demandId, tenantId, status: "active" },
        data: { status: "closed" },
      });
      if (result.count === 0) throw new NotFoundException("ביקוש לא נמצא");
      await this.audit.record(tx, {
        action: "collaboration.unshare",
        entityType: "shared_demand",
        entityId: demandId,
      });
    });
  }

  /** פיד הביקושים: הרשת כולה (כולל שלי, מסומנים). קריאת הרשת רצה כ-withNetwork. */
  async listDemands(): Promise<SharedDemandDto[]> {
    const tenantId = TenantContext.current().tenantId;
    /*
     * אין עוד סינון זכאות.
     *
     * הפיד סינן קודם משרדים שהמסלול שלהם אינו כולל שיתוף פעולה, וזה
     * חייב שני שלבים ושאילתת מסלול לכל משרד מפרסם — רק כדי להסתיר
     * ביקושים. מרגע שהשת"פ הבסיסי פתוח בכל המסלולים אין מי לסנן,
     * וכל המנגנון ההוא נעלם יחד עם ה-N+1 שהיה בו.
     *
     * מה שהחליף אותו הוא תמחור לפי מקור: הביקושים מוצגים לכולם,
     * ולכל אחד מהם מוחזרת העלות שלו.
     */
    const visible = await this.prisma.withNetworkRead((tx) =>
            tx.sharedDemand.findMany({
              where: { status: "active" },
              orderBy: { createdAt: "desc" },
              take: 100,
            }),
          );

    /*
     * לכל ביקוש מחושבות ההתאמות מתוך הנכסים *שלי* — בדיוק אותו מנוע
     * שמשמש את ההתאמות הפנימיות. בלי זה המתווך היה בוחר נכס מרשימה
     * נפתחת של עשרות, מנחש, ומבזבז קרדיט על נכס שלא מתאים.
     *
     * הנכסים נטענים פעם אחת לכל הרשימה; הניקוד עצמו הוא פונקציה
     * טהורה בזיכרון.
     */
    const myProperties = await this.prisma.withTenant((tx) =>
      tx.property.findMany({
        // נכס שנמכר או ירד משיווק לא אמור להיות מוצע לרשת
        where: { tenantId, deletedAt: null, status: "active" },
        take: 200,
      }),
    );

    const prices = await this.pricing.all();
    return visible.map((row) => {
      const dto = this.toDemandDto(row, tenantId, prices);
      if (dto.mine) return dto;
      const matches = this.matchOwnProperties(myProperties, row);
      return matches.length > 0 ? { ...dto, myMatches: matches } : dto;
    });
  }

  /** שלוש ההתאמות הטובות ביותר מבין הנכסים שלי, מעל סף שווה-הצגה. */
  private matchOwnProperties(
    properties: PropertyRow[],
    demand: {
      cities: string[];
      dealType: string;
      budgetMaxAgorot: bigint;
      roomsMin: Prisma.Decimal | null;
      roomsMax: Prisma.Decimal | null;
      mustFeatures: string[];
    },
  ): DemandMatchDto[] {
    const requirements = {
      cities: demand.cities,
      neighborhoods: [],
      dealType: demand.dealType,
      propertyTypes: [],
      budgetMaxAgorot: Number(demand.budgetMaxAgorot),
      ...(demand.roomsMin !== null ? { roomsMin: Number(demand.roomsMin) } : {}),
      ...(demand.roomsMax !== null ? { roomsMax: Number(demand.roomsMax) } : {}),
      features: Object.fromEntries(demand.mustFeatures.map((f) => [f, "must"])),
    } as unknown as BuyerRequirements;

    return properties
      .map((property) => {
        const result = scoreMatch(rowToFields(property), requirements);
        return { property, result };
      })
      .filter(({ result }) => !result.excluded && result.score >= 70)
      .sort((a, b) => b.result.score - a.result.score)
      .slice(0, 3)
      .map(({ property, result }) => ({
        propertyId: property.id,
        title:
          property.marketingTitle ??
          ([property.street, property.city].filter(Boolean).join(", ") || "נכס"),
        score: result.score,
        explanation: result.explanation,
      }));
  }

  private async getDemand(id: string): Promise<SharedDemandDto> {
    const tenantId = TenantContext.current().tenantId;
    const prices = await this.pricing.all();
    const row = await this.prisma.withTenant((tx) =>
      tx.sharedDemand.findFirst({ where: { id, tenantId } }),
    );
    if (!row) throw new NotFoundException("ביקוש לא נמצא");
    return this.toDemandDto(row, tenantId, prices);
  }

  /** הצעת נכס לביקוש רשת — עולה קרדיט; חשיפה מדורגת בלי כתובת מדויקת. */
  async offerProperty(
    demandId: string,
    propertyId: string,
    commissionSplit: number,
  ): Promise<CoopOfferDto> {
    const ctx = TenantContext.current();
    const id = ulid();

    // הביקוש נקרא בהקשר רשת (ייתכן ששייך לסוכנות אחרת)
    const demand = await this.prisma.withNetworkRead((tx) =>
      tx.sharedDemand.findFirst({ where: { id: demandId, status: "active" } }),
    );
    if (!demand) throw new NotFoundException("הביקוש לא נמצא או נסגר");
    if (demand.tenantId === ctx.tenantId) {
      throw new BadRequestException("זה ביקוש שלך — ההתאמות הפנימיות כבר כיסו אותו");
    }

    const splitRejection = commissionSplitRejectionReason(commissionSplit);
    if (splitRejection !== null) throw new BadRequestException(splitRejection);
    const prices = await this.pricing.all();
    await this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: {
          id: propertyId,
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: { in: ["draft", "active"] },
        },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא או אינו משווק");

      /*
       * העלות נגזרת ממקור הביקוש ולא מהמסלול: הצעה למשרד תיווך אחר
       * חינם, וליד ממקור חיצוני עולה קרדיטים — ראו
       * packages/shared/logic/collaboration-cost.ts.
       */
      const cost = coopOfferCost(demand.source, prices);
      if (cost > 0) {
        const balance = await this.balanceInTx(tx, ctx.tenantId);
        if (balance < cost) {
          throw new BadRequestException("אין מספיק קרדיטים — ניתן לרכוש בהגדרות");
        }
      }

      // חשיפה מדורגת: שכונה+מאפיינים; בלי רחוב, בלי בעלים (docs/04 §7)
      const presentation = {
        city: property.city ?? undefined,
        neighborhood: property.neighborhood ?? undefined,
        rooms: property.rooms === null ? undefined : Number(property.rooms),
        areaSqm: property.areaSqm ?? undefined,
        floor: property.floor ?? undefined,
        priceAgorot: property.priceAgorot === null ? undefined : Number(property.priceAgorot),
        title: property.marketingTitle ?? undefined,
      };

      await tx.coopOffer.create({
        data: {
          id,
          demandId,
          fromTenantId: ctx.tenantId,
          toTenantId: demand.tenantId,
          propertyId,
          presentation,
          creditsCost: cost,
          commissionSplit,
        },
      });
      // תנועה נרשמת רק כשיש חיוב: שורה בסכום אפס היא רעש ביומן
      // הקרדיטים, ומקשה על קריאה של מה באמת נגבה
      if (cost > 0) {
        await tx.creditLedger.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            kind: "coop_offer",
            amount: -cost,
            refId: id,
          },
        });
      }
      await this.audit.record(tx, {
        action: "collaboration.offer",
        entityType: "coop_offer",
        entityId: id,
        metadata: { demandId, propertyId },
      });
      // ההתראה מנותבת לסוכנות המקבלת — tenantId של האירוע הוא היעד
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          tenantId: demand.tenantId,
          name: "coop_offer.sent",
          payload: { coopOfferId: id, tenantId: demand.tenantId, fromTenantId: ctx.tenantId },
        },
      });
    });

    return {
      id,
      demandId,
      direction: "outgoing",
      presentation: {},
      status: "sent",
      commissionSplit,
      createdAt: new Date(),
    };
  }

  /** הצעות שיתוף — נכנסות (על הביקושים שלי) ויוצאות (ששלחתי). */
  async listCoopOffers(): Promise<CoopOfferDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.coopOffer.findMany({
        where: { OR: [{ toTenantId: tenantId }, { fromTenantId: tenantId }] },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      demandId: row.demandId,
      direction: row.toTenantId === tenantId ? "incoming" : "outgoing",
      commissionSplit: row.commissionSplit,
      presentation: row.presentation as Record<string, unknown>,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  /** תגובת הסוכנות המקבלת להצעת שיתוף — מעוניין/דחייה. */
  async respondToCoopOffer(id: string, response: "interested" | "declined"): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.coopOffer.updateMany({
        where: { id, toTenantId: tenantId, status: "sent" },
        data: { status: response },
      });
      if (result.count === 0) throw new NotFoundException("הצעת שיתוף לא נמצאה");
      await this.audit.record(tx, {
        action: `collaboration.${response}`,
        entityType: "coop_offer",
        entityId: id,
      });
    });
  }

  /* ============================================================
     שוק הלידים: משרד מוכר ליד שהוא לא יטפל בו, משרד אחר קונה
     בקרדיטים. הקרדיטים עוברים מהקונה למוכר.
     ============================================================ */

  /**
   * הצעת ליד למכירה. בפיד יופיע רק מידע אנונימי; פרטי הקשר נשמרים
   * כצילום מוצפן על השורה ומועתקים לקונה רק אחרי רכישה.
   *
   * המחיר נקבע כאן, ברגע השיתוף — לפי מקור הליד ומטבלת התמחור של
   * הפלטפורמה — ונשמר על השורה. הקונה משלם את מה שראה בפיד, גם אם
   * התמחור השתנה בינתיים.
   */
  async shareLead(leadId: string, note?: string, city?: string): Promise<SharedLeadDto> {
    const ctx = TenantContext.current();
    const id = ulid();
    const prices = await this.pricing.all();

    const row = await this.prisma.withTenant(async (tx) => {
      // סוכן עם view_own לא מוכר את הליד של סוכן אחר
      await assertLeadAccess(tx, ctx.tenantId, leadId);
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId: ctx.tenantId },
        select: { source: true, intent: true, status: true, contactId: true },
      });
      if (!lead) throw new NotFoundException("ליד לא נמצא");
      if (lead.status === "converted") {
        throw new BadRequestException("ליד שהומר כבר טופל — אין מה למכור בו");
      }
      const contact = await tx.contact.findFirst({
        where: { id: lead.contactId, tenantId: ctx.tenantId },
        select: { nameEncrypted: true, phoneEncrypted: true, phoneHash: true },
      });
      if (!contact) throw new NotFoundException("איש הקשר של הליד לא נמצא");

      const created = await tx.sharedLead
        .create({
          data: {
            id,
            tenantId: ctx.tenantId,
            originLeadId: leadId,
            source: lead.source,
            intent: lead.intent,
            city: city?.trim() || null,
            note: note?.trim() || null,
            contactNameEncrypted: contact.nameEncrypted,
            contactPhoneEncrypted: contact.phoneEncrypted,
            contactPhoneHash: contact.phoneHash,
            priceCredits: sharedLeadPrice(lead.source, prices),
          },
        })
        .catch((error: unknown) => {
          // האינדקס החלקי (tenant, origin_lead) WHERE active — שתי
          // לחיצות שיתוף במקביל לא יפרסמו את אותו ליד פעמיים
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new BadRequestException("הליד כבר מוצע ברשת");
          }
          throw error;
        });
      await this.audit.record(tx, {
        action: "collaboration.lead_share",
        entityType: "shared_lead",
        entityId: id,
        metadata: { leadId },
      });
      return created;
    });

    return this.toSharedLeadDto(row, ctx.tenantId);
  }

  /** הסרת ליד מהשוק — רק כל עוד לא נמכר. */
  async withdrawLead(sharedLeadId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.sharedLead.updateMany({
        where: { id: sharedLeadId, tenantId, status: "active" },
        data: { status: "withdrawn" },
      });
      if (result.count === 0) throw new NotFoundException("הליד לא נמצא בשוק או כבר נמכר");
      await this.audit.record(tx, {
        action: "collaboration.lead_withdraw",
        entityType: "shared_lead",
        entityId: sharedLeadId,
      });
    });
  }

  /**
   * פיד השוק: הלידים הפעילים ברשת, ובנוסף הלידים ששיתפתי בכל סטטוס —
   * המוכר צריך לראות "נמכר" בלי לחפש ביומן הקרדיטים.
   */
  async listSharedLeads(): Promise<SharedLeadDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const network = await this.prisma.withNetworkRead((tx) =>
      tx.sharedLead.findMany({
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    const mine = await this.prisma.withTenant((tx) =>
      tx.sharedLead.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
    const seen = new Set<string>();
    const merged = [...mine, ...network].filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return merged.map((row) => this.toSharedLeadDto(row, tenantId));
  }

  /**
   * קניית ליד מהשוק.
   *
   * הסדר קריטי ומכוון:
   * 1. תפיסה אטומית אצל המוכר (active→sold) + זיכוי המוכר — טרנזקציה
   *    אחת. שני קונים במקביל: רק אחד עובר את ה-updateMany המותנה.
   * 2. אצל הקונה: בדיקת יתרה, העתקת איש הקשר, יצירת הליד, חיוב.
   * 3. כשל בשלב 2 ⇒ השורה חוזרת ל-active והזיכוי מתקזז ברשומה נגדית —
   *    היומן Append-Only, מוחקים בו כלום.
   */
  async buyLead(sharedLeadId: string): Promise<{ leadId: string }> {
    const ctx = TenantContext.current();

    const row = await this.prisma.withNetworkRead((tx) =>
      tx.sharedLead.findFirst({ where: { id: sharedLeadId, status: "active" } }),
    );
    if (!row) throw new NotFoundException("הליד לא נמצא בשוק או כבר נמכר");
    if (row.tenantId === ctx.tenantId) {
      throw new BadRequestException("זה ליד שלך — אפשר להסיר אותו מהשוק, לא לקנות");
    }
    const cost = row.priceCredits;

    // בדיקת יתרה מוקדמת — לא לתפוס ליד אצל המוכר רק כדי להחזיר אותו
    const balance = await this.prisma.withTenant((tx) => this.balanceInTx(tx, ctx.tenantId));
    if (balance < cost) {
      throw new BadRequestException("אין מספיק קרדיטים — ניתן לרכוש בהגדרות");
    }

    const claimed = await this.prisma.withExplicitTenant(row.tenantId, async (tx) => {
      const result = await tx.sharedLead.updateMany({
        where: { id: sharedLeadId, status: "active" },
        data: { status: "sold", buyerTenantId: ctx.tenantId, soldAt: new Date() },
      });
      if (result.count === 0) return false;
      await tx.creditLedger.create({
        data: { id: ulid(), tenantId: row.tenantId, kind: "lead_sale", amount: cost, refId: sharedLeadId },
      });
      return true;
    });
    if (!claimed) throw new BadRequestException("הליד נמכר הרגע למשרד אחר");

    let leadId: string;
    try {
      leadId = await this.prisma.withTenant(async (tx) => {
        // הבדיקה המחייבת — בתוך הטרנזקציה, אחרי המוקדמת שבחוץ
        if ((await this.balanceInTx(tx, ctx.tenantId)) < cost) {
          throw new BadRequestException("אין מספיק קרדיטים — ניתן לרכוש בהגדרות");
        }
        /*
         * ההצפנה במפתח אפליקטיבי אחיד, לכן הצילום מועתק כמות שהוא —
         * בלי פענוח ביניים. אם הטלפון כבר מוכר למשרד הקונה (לפי
         * ה-HMAC) לא נוצר כרטיס כפול.
         */
        let contact = await tx.contact.findUnique({
          where: {
            tenantId_phoneHash: { tenantId: ctx.tenantId, phoneHash: row.contactPhoneHash },
          },
          select: { id: true },
        });
        contact ??= await tx.contact.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            nameEncrypted: row.contactNameEncrypted,
            phoneEncrypted: row.contactPhoneEncrypted,
            phoneHash: row.contactPhoneHash,
          },
          select: { id: true },
        });

        const newLeadId = ulid();
        const summary = [row.note, row.city ? `עיר: ${row.city}` : null]
          .filter(Boolean)
          .join("\n");
        await tx.lead.create({
          data: {
            id: newLeadId,
            tenantId: ctx.tenantId,
            contactId: contact.id,
            source: "network",
            intent: row.intent,
            status: "new",
            summary: (summary || "ליד שנרכש ברשת השת\"פ").slice(0, 500),
          },
        });
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: newLeadId,
            kind: "note",
            content: `נרכש ברשת השת"פ תמורת ${cost} קרדיטים`,
            createdBy: ctx.userId,
          },
        });
        await tx.creditLedger.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            kind: "lead_purchase",
            amount: -cost,
            refId: sharedLeadId,
          },
        });
        await this.audit.record(tx, {
          action: "collaboration.lead_buy",
          entityType: "shared_lead",
          entityId: sharedLeadId,
          metadata: { leadId: newLeadId, priceCredits: cost },
        });
        // ליד רגיל לכל דבר — SLA והתראות מטפלים בו כמו בכל ליד חדש
        await tx.outboxEvent.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            name: "lead.created",
            payload: {
              leadId: newLeadId,
              tenantId: ctx.tenantId,
              source: "network",
              requiresHuman: false,
            },
          },
        });
        return newLeadId;
      });
    } catch (error) {
      // שחרור: הליד חוזר לשוק והזיכוי מתקזז ברשומה נגדית
      await this.prisma
        .withExplicitTenant(row.tenantId, async (tx) => {
          await tx.sharedLead.updateMany({
            where: { id: sharedLeadId, status: "sold", buyerTenantId: ctx.tenantId },
            data: { status: "active", buyerTenantId: null, soldAt: null },
          });
          await tx.creditLedger.create({
            data: {
              id: ulid(),
              tenantId: row.tenantId,
              kind: "lead_sale_reversal",
              amount: -cost,
              refId: sharedLeadId,
            },
          });
        })
        .catch((releaseError: unknown) => {
          this.logger.error(
            `שחרור ליד ${sharedLeadId} אחרי קנייה כושלת נכשל: ${String(releaseError)}`,
          );
        });
      throw error;
    }

    // התראה למוכר — אחרי שהקנייה הושלמה; כשל כאן אינו מבטל את המכירה
    await this.prisma
      .withExplicitTenant(row.tenantId, (tx) =>
        tx.outboxEvent.create({
          data: {
            id: ulid(),
            tenantId: row.tenantId,
            name: "shared_lead.sold",
            payload: { sharedLeadId, tenantId: row.tenantId, priceCredits: cost },
          },
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(`התראת מכירת ליד ${sharedLeadId} לא נשלחה: ${String(error)}`);
      });

    return { leadId };
  }

  private toSharedLeadDto(
    row: {
      id: string;
      tenantId: string;
      originLeadId: string;
      source: string;
      intent: string;
      city: string | null;
      note: string | null;
      priceCredits: number;
      status: string;
      createdAt: Date;
    },
    viewerTenantId: string,
  ): SharedLeadDto {
    const mine = row.tenantId === viewerTenantId;
    return {
      id: row.id,
      intent: row.intent,
      source: row.source,
      city: row.city ?? undefined,
      note: row.note ?? undefined,
      priceCredits: row.priceCredits,
      status: row.status,
      mine,
      // הקישור לליד המקורי נחשף רק למוכר — לעולם לא לרשת
      originLeadId: mine ? row.originLeadId : undefined,
      createdAt: row.createdAt,
    };
  }

  async credits(): Promise<{ balance: number }> {
    const tenantId = TenantContext.current().tenantId;
    const balance = await this.prisma.withTenant(async (tx) => {
      const hasAny = await tx.creditLedger.findFirst({
        where: { tenantId },
        select: { id: true },
      });
      if (!hasAny) {
        // מענק פתיחה חד-פעמי — נרשם כתנועה, לא כיתרה קסומה
        await tx.creditLedger.create({
          data: { id: ulid(), tenantId, kind: "initial_grant", amount: INITIAL_CREDITS },
        });
      }
      return this.balanceInTx(tx, tenantId);
    });
    return { balance };
  }

  private async balanceInTx(tx: TenantTx, tenantId: string): Promise<number> {
    const agg = await tx.creditLedger.aggregate({
      where: { tenantId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  private toDemandDto(
    row: {
      id: string;
      tenantId: string;
      originBuyerId: string | null;
      cities: string[];
      dealType: string;
      budgetMaxAgorot: bigint;
      roomsMin: unknown;
      roomsMax: unknown;
      mustFeatures: string[];
      source: string;
      status: string;
      commissionSplit: number;
      createdAt: Date;
    },
    viewerTenantId: string,
    prices: readonly LeadSourcePrice[],
  ): SharedDemandDto {
    const mine = row.tenantId === viewerTenantId;
    return {
      id: row.id,
      cities: row.cities,
      dealType: row.dealType,
      budgetMaxAgorot: Number(row.budgetMaxAgorot),
      roomsMin: row.roomsMin === null ? undefined : Number(row.roomsMin),
      roomsMax: row.roomsMax === null ? undefined : Number(row.roomsMax),
      mustFeatures: row.mustFeatures,
      source: row.source,
      creditsCost: coopOfferCost(row.source, prices),
      commissionSplit: row.commissionSplit,
      status: row.status,
      mine,
      // הקישור לקונה נחשף רק לסוכנות המקור — לעולם לא לרשת (docs/04 §7)
      originBuyerId: mine ? (row.originBuyerId ?? undefined) : undefined,
      createdAt: row.createdAt,
    };
  }
}
