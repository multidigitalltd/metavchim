import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  PLATFORM_REFERRAL_FEE_PERCENT,
  commissionSplitRejectionReason,
  coopOfferCost,
  referralPayout,
  referralPriceRejectionReason,
  referralRatingAverage,
  referralRatingRejectionReason,
  referralReasonRejectionReason,
  scoreMatch,
  suggestedReferralPrice,
  type BuyerRequirements,
  type LeadSourcePrice,
} from "@metavchim/shared";
import { lockContact } from "../../common/locks";
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
  /** שכונות מבוקשות — מדרישות הקונה; מדויק יותר מעיר, עדיין אנונימי */
  neighborhoods: string[];
  /** תיאור חופשי שהמשרד המשתף כתב — "מה הקונה מחפש" במילים */
  notes?: string;
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

/** דירוג שכבר ניתן על הפניה — מוחזר לשני הצדדים בלבד. */
export interface ReferralRatingDto {
  score: number;
  comment?: string;
  createdAt: Date;
}

/** תפקיד הצופה מול ההפניה — קובע מה מוצג ומה מותר. */
export type ReferralRole = "referrer" | "receiver" | "viewer";

/** הפניה בלוח — רק מה שאנונימי; פרטי הקשר לעולם לא כאן. */
export interface SharedLeadDto {
  id: string;
  intent: string;
  source: string;
  city?: string;
  note?: string;
  /** למה הלקוח מופנה — המידע שהמשרד הקולט הכי צריך לפני שהוא משלם */
  reason: string;
  reasonDetail?: string;
  /** מה שהמשרד הקולט משלם */
  priceCredits: number;
  /** כמה מתוך התמורה הולך לפלטפורמה — גלוי לשני הצדדים */
  platformFeeCredits: number;
  /** מה שנכנס ליתרת המשרד המפנה */
  payoutCredits: number;
  status: string;
  /** true אם ההפניה שלי — נשמר לצד `role` כי כרטיס הליד נשען עליו */
  mine: boolean;
  role: ReferralRole;
  /** קישור לליד המקורי — רק למשרד המפנה */
  originLeadId?: string;
  /**
   * מוניטין המשרד המפנה: ממוצע הדירוגים שנתנו לו משרדים שקלטו ממנו.
   * מוחזר עם כל שורה בלוח — התמורה משולמת גם כשלא נסגר דבר, ולכן זה
   * המידע שקובע אם כדאי לשלם אותה.
   */
  referrerRating?: { average: number; count: number };
  /** הדירוג שאני נתתי, אם נתתי */
  myRating?: ReferralRatingDto;
  /** הדירוג של הצד השני — נראה רק למי שהוא צד בהפניה */
  counterpartRating?: ReferralRatingDto;
  createdAt: Date;
}

/** תנאי ההפניה שהטופס נפתח בהם — הצעת מחיר ושיעור העמלה. */
export interface ReferralTermsDto {
  suggestedPriceCredits: number;
  platformFeePercent: number;
}

@Injectable()
export class CollaborationService {
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
  async shareBuyer(
    buyerId: string,
    commissionSplit: number,
    note?: string,
  ): Promise<SharedDemandDto> {
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
          // שכונות מדרישות הקונה — מדויק יותר מעיר, עדיין בלי PII
          neighborhoods: requirements.neighborhoods ?? [],
          // התיאור החופשי של המשתף: "מה הקונה מחפש" במילים שלו
          notes: note?.trim() || null,
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

  /**
   * הביקוש הפעיל של קונה מסוים, אם הוא משותף.
   *
   * בלי זה כרטיס הקונה לא ידע בטעינה שהוא כבר משותף: הוא היה מציע
   * לשתף שוב, והשיתוף היה נדחה ב"הקונה כבר משותף ברשת" — הסוכן רואה
   * שגיאה על פעולה שהמסך עצמו הציע לו.
   */
  async activeDemandForBuyer(buyerId: string): Promise<SharedDemandDto | null> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant(async (tx) =>
      tx.sharedDemand.findFirst({
        where: { tenantId, originBuyerId: buyerId, status: "active" },
        select: { id: true },
      }),
    );
    return row ? this.getDemand(row.id) : null;
  }

  /**
   * עדכון ביקוש קיים — חלוקת עמלה ותיאור.
   *
   * סוכן שלא קיבל פניות ירצה להעלות את חלקו של הצד השני או לחדד את
   * התיאור. בלי מסלול עדכון הדרך היחידה הייתה לסגור ולפרסם מחדש,
   * וזה מאבד את ההיסטוריה של הביקוש ואת ההצעות שכבר התקבלו עליו.
   *
   * שאר שדות הביקוש (ערים, תקציב, חדרים) נגזרים מהקונה ואינם
   * נערכים כאן — הם מתעדכנים דרך עריכת דרישות הקונה.
   */
  async updateSharedDemand(
    buyerId: string,
    commissionSplit: number,
    note?: string,
  ): Promise<SharedDemandDto> {
    const tenantId = TenantContext.current().tenantId;
    const splitRejection = commissionSplitRejectionReason(commissionSplit);
    if (splitRejection !== null) throw new BadRequestException(splitRejection);

    const demandId = await this.prisma.withTenant(async (tx) => {
      const existing = await tx.sharedDemand.findFirst({
        where: { tenantId, originBuyerId: buyerId, status: "active" },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException("הקונה אינו משותף ברשת");

      await tx.sharedDemand.updateMany({
        where: { id: existing.id, tenantId, status: "active" },
        data: { commissionSplit, notes: note?.trim() || null },
      });
      await this.audit.record(tx, {
        action: "collaboration.share_update",
        entityType: "shared_demand",
        entityId: existing.id,
        metadata: { buyerId, commissionSplit },
      });
      return existing.id;
    });

    return this.getDemand(demandId);
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
      neighborhoods: string[];
      dealType: string;
      budgetMaxAgorot: bigint;
      roomsMin: Prisma.Decimal | null;
      roomsMax: Prisma.Decimal | null;
      mustFeatures: string[];
    },
  ): DemandMatchDto[] {
    const requirements = {
      cities: demand.cities,
      // השכונות משפיעות על הניקוד כמו בהתאמות הפנימיות — נכס באותה
      // עיר מחוץ לשכונות המבוקשות לא מקבל את מלוא נקודות המיקום
      neighborhoods: demand.neighborhoods,
      dealType: demand.dealType,
      propertyTypes: [],
      budgetMaxAgorot: Number(demand.budgetMaxAgorot),
      ...(demand.roomsMin !== null ? { roomsMin: Number(demand.roomsMin) } : {}),
      ...(demand.roomsMax !== null ? { roomsMax: Number(demand.roomsMax) } : {}),
      features: Object.fromEntries(demand.mustFeatures.map((f) => [f, "must"])),
    } as unknown as BuyerRequirements;

    return properties
      .map((property) => {
        /*
         * **בלי משקלי המשרד — בכוונה.**
         *
         * הציון הזה מוצג לצד השני ברשת, ומשקלים מקומיים היו הופכים
         * אותו לבלתי ניתן להשוואה: משרד יכול היה לנפח "95% התאמה"
         * על כל נכס כדי למשוך הצעות. ברשת יש שפה אחת.
         */
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
        // אותה נעילה כמו בקניית ליד — בדיקת יתרה וחיוב סדרתיים פר-משרד
        await this.lockCreditSpend(tx, ctx.tenantId);
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
     לוח ההפניות: משרד מפנה לקוח שאינו מתאים לו, משרד אחר קולט
     ומשלם תמורה בקרדיטים. חלק מהתמורה הוא עמלת פלטפורמה, והשאר
     נכנס ליתרת המשרד המפנה.

     **לא "מכירת ליד".** הפניית לקוח היא פעולה מקצועית מוכרת בין
     משרדי תיווך; המילים בקוד ובמסכים נשמרות זהות כדי שלא ייווצר
     פער בין מה שהמערכת עושה למה שהיא אומרת.
     ============================================================ */

  /**
   * תנאי ההפניה לליד מסוים — הצעת מחיר פתיחה ושיעור עמלת הפלטפורמה.
   *
   * הטופס לא ממציא את ההצעה בצד הלקוח: התמחור לפי מקור הוא נתון של
   * הפלטפורמה, ומסך שמנחש אותו יציג מספר אחר ממה שהשרת מכיר.
   */
  async referralTerms(leadId: string): Promise<ReferralTermsDto> {
    const ctx = TenantContext.current();
    const prices = await this.pricing.all();
    const source = await this.prisma.withTenant(async (tx) => {
      await assertLeadAccess(tx, ctx.tenantId, leadId);
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId: ctx.tenantId },
        select: { source: true },
      });
      if (!lead) throw new NotFoundException("ליד לא נמצא");
      return lead.source;
    });
    return {
      suggestedPriceCredits: suggestedReferralPrice(source, prices),
      platformFeePercent: PLATFORM_REFERRAL_FEE_PERCENT,
    };
  }

  /**
   * פרסום הפניה בלוח. בלוח יופיע רק מידע אנונימי; פרטי הקשר נשמרים
   * כצילום מוצפן על השורה ומועתקים למשרד הקולט רק אחרי הקליטה.
   *
   * **התמורה נקבעת בידי המשרד המפנה** — הוא זה שיודע מה שווה הלקוח
   * שהוא מוותר עליו. גם היא וגם עמלת הפלטפורמה מצולמות כאן, ברגע
   * הפרסום: המשרד הקולט משלם את מה שראה בלוח, גם אם שיעור העמלה
   * השתנה בינתיים.
   *
   * **הסיבה חובה.** בלעדיה אי אפשר להבחין בין הפניה מקצועית לבין
   * היפטרות מלקוח, וזה בדיוק מה שהמשרד הקולט משלם עליו.
   */
  async shareLead(input: {
    leadId: string;
    priceCredits: number;
    reason: string;
    reasonDetail?: string;
    note?: string;
    city?: string;
  }): Promise<SharedLeadDto> {
    const ctx = TenantContext.current();
    const id = ulid();
    const priceProblem = referralPriceRejectionReason(input.priceCredits);
    if (priceProblem) throw new BadRequestException(priceProblem);
    const reasonProblem = referralReasonRejectionReason(input.reason, input.reasonDetail);
    if (reasonProblem) throw new BadRequestException(reasonProblem);
    const payout = referralPayout(input.priceCredits);

    const row = await this.prisma.withTenant(async (tx) => {
      // סוכן עם view_own לא מפנה את הליד של סוכן אחר
      await assertLeadAccess(tx, ctx.tenantId, input.leadId);
      const lead = await tx.lead.findFirst({
        where: { id: input.leadId, tenantId: ctx.tenantId },
        select: { source: true, intent: true, status: true, contactId: true },
      });
      if (!lead) throw new NotFoundException("ליד לא נמצא");
      if (lead.status === "converted") {
        throw new BadRequestException("ליד שהומר כבר טופל — אין מה להפנות");
      }
      /*
       * לקוח שכבר הופנה ונקלט אינו חוזר ללוח לעולם: האינדקס החלקי
       * מכסה רק active, ובלי הבדיקה הזו משרד היה מפרסם ומקבל תמורה
       * על אותו איש קשר שוב ושוב (ביקורת Codex). הסרה מרצון
       * (withdrawn) כן מאפשרת פרסום מחדש.
       */
      const sold = await tx.sharedLead.findFirst({
        where: { tenantId: ctx.tenantId, originLeadId: input.leadId, status: "sold" },
        select: { id: true },
      });
      if (sold) throw new BadRequestException("הלקוח הזה כבר הופנה ונקלט — אין להפנות אותו שוב");
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
            originLeadId: input.leadId,
            source: lead.source,
            intent: lead.intent,
            city: input.city?.trim() || null,
            note: input.note?.trim() || null,
            reason: input.reason,
            reasonDetail: input.reasonDetail?.trim() || null,
            contactNameEncrypted: contact.nameEncrypted,
            contactPhoneEncrypted: contact.phoneEncrypted,
            contactPhoneHash: contact.phoneHash,
            priceCredits: payout.priceCredits,
            platformFeeCredits: payout.platformFeeCredits,
          },
        })
        .catch((error: unknown) => {
          // האינדקס החלקי (tenant, origin_lead) WHERE active — שתי
          // לחיצות פרסום במקביל לא יפרסמו את אותו לקוח פעמיים
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new BadRequestException("הלקוח הזה כבר מופנה בלוח");
          }
          throw error;
        });
      await this.audit.record(tx, {
        action: "collaboration.lead_share",
        entityType: "shared_lead",
        entityId: id,
        metadata: {
          leadId: input.leadId,
          reason: input.reason,
          priceCredits: payout.priceCredits,
          platformFeeCredits: payout.platformFeeCredits,
        },
      });
      return created;
    });

    return this.toSharedLeadDto(row, ctx.tenantId);
  }

  /** הסרת הפניה מהלוח — רק כל עוד לא נקלטה. */
  async withdrawLead(sharedLeadId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.sharedLead.updateMany({
        where: { id: sharedLeadId, tenantId, status: "active" },
        data: { status: "withdrawn" },
      });
      if (result.count === 0) throw new NotFoundException("ההפניה לא נמצאה בלוח או שכבר נקלטה");
      await this.audit.record(tx, {
        action: "collaboration.lead_withdraw",
        entityType: "shared_lead",
        entityId: sharedLeadId,
      });
    });
  }

  /** ההפניות שפרסמתי, בכל סטטוס — נגיש עם יכולת השיתוף בלבד. */
  async listMySharedLeads(): Promise<SharedLeadDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const mine = await this.prisma.withTenant((tx) =>
      tx.sharedLead.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
    const ratings = await this.ratingsFor(mine.map((row) => row.id));
    return mine.map((row) => this.toSharedLeadDto(row, tenantId, { ratings }));
  }

  /**
   * הלוח: ההפניות הפעילות ברשת, ובנוסף מה שאני צד בו — מה שפרסמתי
   * (בכל סטטוס) ומה שקלטתי. משרד מפנה צריך לראות "נקלטה" בלי לחפש
   * ביומן הקרדיטים, ומשרד קולט צריך להגיע להפניה שלו כדי לדרג.
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
    /*
     * שאילתה אחת לשני התפקידים. מדיניות ה-RLS מגבילה אותה ממילא
     * לשורות שלי ולשורות שקלטתי, ולכן ה-OR כאן אינו הרשאה אלא
     * ביטוי של אותה כוונה בשכבת השאילתה.
     */
    const mine = await this.prisma.withTenant((tx) =>
      tx.sharedLead.findMany({
        where: { OR: [{ tenantId }, { buyerTenantId: tenantId }] },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );

    const seen = new Set<string>();
    const rows = [...mine, ...network].filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });

    /*
     * המוניטין נשלף גם למשרד עצמו ולא רק לאחרים: מי שמפנה צריך
     * לראות באיזה ציון הוא נמצא, וזה בדיוק המקום שבו הוא מסתכל.
     */
    const [ratings, reputations] = await Promise.all([
      this.ratingsFor(rows.map((row) => row.id)),
      this.reputationFor(rows.map((row) => row.tenantId)),
    ]);

    const merged = rows.map((row) =>
      this.toSharedLeadDto(row, tenantId, {
        ratings,
        reputation: reputations.get(row.tenantId),
      }),
    );
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return merged;
  }

  /**
   * הדירוגים על ההפניות שאני צד בהן. ה-RLS מחזיר רק שורות של הפניות
   * שאני צד בהן, ולכן אין כאן סינון ידני שאפשר לשכוח.
   */
  private async ratingsFor(
    sharedLeadIds: readonly string[],
  ): Promise<Map<string, { raterTenantId: string; score: number; comment: string | null; createdAt: Date }[]>> {
    const byLead = new Map<
      string,
      { raterTenantId: string; score: number; comment: string | null; createdAt: Date }[]
    >();
    if (sharedLeadIds.length === 0) return byLead;
    const rows = await this.prisma.withTenant((tx) =>
      tx.leadReferralRating.findMany({
        where: { sharedLeadId: { in: [...sharedLeadIds] } },
        select: {
          sharedLeadId: true,
          raterTenantId: true,
          score: true,
          comment: true,
          createdAt: true,
        },
      }),
    );
    for (const row of rows) {
      const list = byLead.get(row.sharedLeadId) ?? [];
      list.push(row);
      byLead.set(row.sharedLeadId, list);
    }
    return byLead;
  }

  /**
   * מוניטין המשרדים המפנים שמופיעים בלוח — שאילתה אחת לכולם.
   *
   * הטבלה מכילה מספרים בלבד, ולכן היא נקראת בקריאת רשת; ההערות
   * החופשיות שמשרד כתב על משרד יושבות בטבלה אחרת שאין לה קריאת רשת.
   */
  private async reputationFor(
    tenantIds: readonly string[],
  ): Promise<Map<string, { average: number; count: number }>> {
    const byTenant = new Map<string, { average: number; count: number }>();
    const unique = [...new Set(tenantIds)];
    if (unique.length === 0) return byTenant;
    const rows = await this.prisma.withNetworkRead((tx) =>
      tx.referralReputation.findMany({ where: { tenantId: { in: unique } } }),
    );
    for (const row of rows) {
      const average = referralRatingAverage(row.ratingSum, row.ratingCount);
      if (average !== null) byTenant.set(row.tenantId, { average, count: row.ratingCount });
    }
    return byTenant;
  }

  /**
   * קליטת הפניה מהלוח — **טרנזקציה אחת לשני הצדדים.**
   *
   * `set_config(..., is_local=true)` תקף פר-משפט, ולכן אפשר לעבור
   * מהקשר המשרד המפנה להקשר המשרד הקולט בתוך אותה טרנזקציה. קריסה,
   * פריסה או ניתוק בכל נקודה מחזירים את הכול — אין רגע שבו ההפניה
   * sold, המפנה זוכה והקולט לא חויב (ביקורת Codex). זה גם מייתר
   * רשומות קיזוז: מה שלא הושלם פשוט לא קרה.
   *
   * **התשלום אינו מותנה בתוצאה.** המשרד הקולט משלם על ההפניה ברגע
   * הזה, ולא על עסקה שתיסגר; אין החזר אם לא ייסגר דבר. המסך אומר
   * זאת במפורש לפני הלחיצה, וזו גם הסיבה שהדירוג ההדדי קיים.
   */
  async buyLead(sharedLeadId: string): Promise<{ leadId: string }> {
    const ctx = TenantContext.current();

    const row = await this.prisma.withNetworkRead((tx) =>
      tx.sharedLead.findFirst({ where: { id: sharedLeadId, status: "active" } }),
    );
    if (!row) throw new NotFoundException("ההפניה לא נמצאה בלוח או שכבר נקלטה");
    if (row.tenantId === ctx.tenantId) {
      throw new BadRequestException("זו הפניה שלכם — אפשר להסיר אותה מהלוח, לא לקלוט");
    }
    const cost = row.priceCredits;
    /*
     * העמלה מצולמת על השורה ברגע הפרסום. החישוב כאן נגזר ממנה ולא
     * מהשיעור הנוכחי — שינוי מדיניות לא יגרע מהפניה שכבר פורסמה.
     * הצמצום ל-[0, cost-1] הוא הגנה על שורה פגומה: זיכוי שלילי
     * למפנה הוא באג שקט שמופיע כחוב.
     */
    const platformFee = Math.max(0, Math.min(row.platformFeeCredits, cost - 1));
    const referrerPayout = cost - platformFee;

    /*
     * המשרד המפנה המיר את הליד אחרי הפרסום? הרישום יורד מהלוח במקום
     * שמשרד אחר ישלם על לקוח שכבר טופל (ביקורת Codex). מחוץ
     * לטרנזקציית הקליטה — ההסרה צריכה להישאר גם כשהקליטה נכשלת.
     */
    const origin = await this.prisma.withExplicitTenant(row.tenantId, (tx) =>
      tx.lead.findFirst({
        where: { id: row.originLeadId, tenantId: row.tenantId },
        select: { status: true },
      }),
    );
    if (!origin || origin.status === "converted") {
      await this.prisma.withExplicitTenant(row.tenantId, (tx) =>
        tx.sharedLead.updateMany({
          where: { id: sharedLeadId, status: "active" },
          data: { status: "withdrawn" },
        }),
      );
      throw new BadRequestException("הלקוח כבר טופל אצל המשרד המפנה — ההפניה הוסרה מהלוח");
    }

    const leadId = await this.prisma.$transaction(async (tx) => {
      // צד המשרד המפנה: תפיסה מותנית + זיכוי בניכוי עמלת הפלטפורמה
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${row.tenantId}, true)`;
      const claimed = await tx.sharedLead.updateMany({
        where: { id: sharedLeadId, status: "active" },
        data: { status: "sold", buyerTenantId: ctx.tenantId, soldAt: new Date() },
      });
      if (claimed.count === 0) throw new BadRequestException("ההפניה נקלטה הרגע במשרד אחר");
      /*
       * הזיכוי הוא הנטו. עמלת הפלטפורמה אינה עוברת ליומן של אף
       * משרד — היא ההפרש בין מה שהקולט חויב למה שהמפנה זוכה, והיא
       * שמורה על שורת ההפניה וביומן הביקורת לצורך דיווח.
       */
      await tx.creditLedger.create({
        data: {
          id: ulid(),
          tenantId: row.tenantId,
          kind: "lead_sale",
          amount: referrerPayout,
          refId: sharedLeadId,
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          tenantId: row.tenantId,
          name: "shared_lead.sold",
          payload: {
            sharedLeadId,
            tenantId: row.tenantId,
            priceCredits: cost,
            payoutCredits: referrerPayout,
          },
        },
      });

      // צד המשרד הקולט — אותה טרנזקציה, הקשר דייר חדש
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
      /*
       * נעילת הוצאות פר-משרד: שתי קליטות מקבילות של אותו משרד היו
       * קוראות שתיהן את אותה יתרה לפני ששתיהן חייבו, ועוברות יחד גם
       * כשהסכום המשותף גדול מהיתרה (ביקורת Codex). הנעילה משחררת
       * בסוף הטרנזקציה.
       */
      await this.lockCreditSpend(tx, ctx.tenantId);
      if ((await this.balanceInTx(tx, ctx.tenantId)) < cost) {
        throw new BadRequestException("אין מספיק קרדיטים — ניתן לרכוש בהגדרות");
      }
      /*
       * ההצפנה במפתח אפליקטיבי אחיד, לכן הצילום מועתק כמות שהוא —
       * בלי פענוח ביניים. אם הטלפון כבר מוכר למשרד הקולט (לפי
       * ה-HMAC) לא נוצר כרטיס כפול.
       */
      let contact = await tx.contact.findUnique({
        where: {
          tenantId_phoneHash: { tenantId: ctx.tenantId, phoneHash: row.contactPhoneHash },
        },
        select: { id: true },
      });
      /*
       * מיחזור כרטיס קיים נועל אותו וקורא שוב — אותו כלל כמו
       * ב-`ContactsService.findOrCreateByPhone`: כרטיס בלי שום קשר
       * עלול להימחק בדיוק כאן, ולידים שיצביעו עליו לא ייפתחו.
       */
      if (contact) {
        await lockContact(tx, contact.id);
        contact = await tx.contact.findUnique({
          where: {
            tenantId_phoneHash: { tenantId: ctx.tenantId, phoneHash: row.contactPhoneHash },
          },
          select: { id: true },
        });
      }
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
          // מי שקלט — סוכן עם view_own חייב לראות את ההפניה שקלט
          assignedToUserId: ctx.userId,
          summary: (summary || "לקוח שהופנה מרשת שיתופי הפעולה").slice(0, 500),
        },
      });
      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          leadId: newLeadId,
          kind: "note",
          content: `הפניית לקוח שנקלטה מרשת שיתופי הפעולה תמורת ${cost} קרדיטים`,
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
        metadata: {
          leadId: newLeadId,
          priceCredits: cost,
          platformFeeCredits: platformFee,
          payoutCredits: referrerPayout,
        },
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

    return { leadId };
  }

  /**
   * נעילת הוצאת קרדיטים של משרד עד סוף הטרנזקציה — בדיקת יתרה וחיוב
   * הופכים לסדרתיים. בלעדיה שתי הוצאות מקבילות עוברות יחד את בדיקת
   * היתרה והיומן יורד למינוס.
   */
  private async lockCreditSpend(tx: TenantTx, tenantId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`credits:${tenantId}`}, 0))`;
  }

  /**
   * דירוג הפניה שנקלטה — כל צד מדרג פעם אחת, וניתן לעדכן.
   *
   * `role` מגיע מהנתיב (שני נתיבים, שתי יכולות שונות) ונבדק מול
   * המציאות שבשורה: משרד שקרא לנתיב הלא נכון מקבל 404 ולא מדרג
   * בשם הצד השני.
   *
   * **רק דירוג המשרד הקולט נספר למוניטין.** משרד שמדרג את ההפניה
   * של עצמו היה מנפח לעצמו את הציון שמוצג לרשת; הדירוג שלו נשמר
   * ומוצג לצד השני, ולא נכנס לממוצע.
   */
  async rateReferral(
    sharedLeadId: string,
    role: Exclude<ReferralRole, "viewer">,
    score: number,
    comment?: string,
  ): Promise<void> {
    const ctx = TenantContext.current();
    const problem = referralRatingRejectionReason(score, comment);
    if (problem) throw new BadRequestException(problem);

    // ה-RLS מחזיר כאן רק הפניה שאני צד בה — כמפנה או כקולט
    const row = await this.prisma.withTenant((tx) =>
      tx.sharedLead.findFirst({
        where: { id: sharedLeadId },
        select: { id: true, tenantId: true, buyerTenantId: true, status: true },
      }),
    );
    if (!row) throw new NotFoundException("ההפניה לא נמצאה");
    if (row.status !== "sold" || !row.buyerTenantId) {
      throw new BadRequestException("אפשר לדרג רק הפניה שנקלטה");
    }
    const actualRole: ReferralRole =
      row.tenantId === ctx.tenantId
        ? "referrer"
        : row.buyerTenantId === ctx.tenantId
          ? "receiver"
          : "viewer";
    if (actualRole !== role) throw new NotFoundException("ההפניה לא נמצאה");

    const buyerTenantId = row.buyerTenantId;
    const trimmed = comment?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
      /*
       * נעילת הדירוג הזה עד סוף הטרנזקציה. הפרש הציון למוניטין
       * מחושב מקריאה של הדירוג הקודם, ושתי שליחות במקביל מאותו
       * משרד היו קוראות שתיהן את אותו ערך ומחילות את ההפרש פעמיים.
       */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`referral_rating:${sharedLeadId}:${ctx.tenantId}`}, 0))`;
      const existing = await tx.leadReferralRating.findUnique({
        where: {
          sharedLeadId_raterTenantId: { sharedLeadId, raterTenantId: ctx.tenantId },
        },
        select: { id: true, score: true },
      });
      if (existing) {
        await tx.leadReferralRating.update({
          where: { id: existing.id },
          data: { score, comment: trimmed },
        });
      } else {
        await tx.leadReferralRating.create({
          data: {
            id: ulid(),
            sharedLeadId,
            sellerTenantId: row.tenantId,
            buyerTenantId,
            raterTenantId: ctx.tenantId,
            raterRole: role,
            score,
            comment: trimmed,
          },
        });
      }
      await this.audit.record(tx, {
        action: "collaboration.referral_rate",
        entityType: "shared_lead",
        entityId: sharedLeadId,
        metadata: { role, score },
      });

      if (role !== "receiver") return;
      /*
       * המוניטין מתעדכן בהקשר של המשרד המדורג — הוא הבעלים של
       * השורה. עדכון בדלתא ולא כתיבת ערך מחושב: שני דירוגים על
       * שתי הפניות שונות של אותו משרד יכולים להתרחש בו-זמנית.
       */
      const scoreDelta = score - (existing?.score ?? 0);
      const countDelta = existing ? 0 : 1;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${row.tenantId}, true)`;
      await tx.$executeRaw`
        INSERT INTO referral_reputation (tenant_id, rating_count, rating_sum, updated_at)
        VALUES (${row.tenantId}, ${countDelta}, ${scoreDelta}, now())
        ON CONFLICT (tenant_id) DO UPDATE SET
          rating_count = referral_reputation.rating_count + ${countDelta},
          rating_sum = referral_reputation.rating_sum + ${scoreDelta},
          updated_at = now()`;
    });
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
      reason: string;
      reasonDetail: string | null;
      priceCredits: number;
      platformFeeCredits: number;
      status: string;
      buyerTenantId: string | null;
      createdAt: Date;
    },
    viewerTenantId: string,
    extras: {
      ratings?: Map<
        string,
        { raterTenantId: string; score: number; comment: string | null; createdAt: Date }[]
      >;
      reputation?: { average: number; count: number };
    } = {},
  ): SharedLeadDto {
    const mine = row.tenantId === viewerTenantId;
    const role: ReferralRole = mine
      ? "referrer"
      : row.buyerTenantId === viewerTenantId
        ? "receiver"
        : "viewer";
    const given = extras.ratings?.get(row.id) ?? [];
    const mineRating = given.find((r) => r.raterTenantId === viewerTenantId);
    const other = role === "viewer" ? undefined : given.find((r) => r.raterTenantId !== viewerTenantId);
    const platformFeeCredits = Math.max(0, Math.min(row.platformFeeCredits, row.priceCredits - 1));
    return {
      id: row.id,
      intent: row.intent,
      source: row.source,
      city: row.city ?? undefined,
      note: row.note ?? undefined,
      reason: row.reason,
      reasonDetail: row.reasonDetail ?? undefined,
      priceCredits: row.priceCredits,
      platformFeeCredits,
      payoutCredits: row.priceCredits - platformFeeCredits,
      status: row.status,
      mine,
      role,
      // הקישור לליד המקורי נחשף רק למשרד המפנה — לעולם לא לרשת
      originLeadId: mine ? row.originLeadId : undefined,
      ...(extras.reputation ? { referrerRating: extras.reputation } : {}),
      ...(mineRating
        ? {
            myRating: {
              score: mineRating.score,
              comment: mineRating.comment ?? undefined,
              createdAt: mineRating.createdAt,
            },
          }
        : {}),
      ...(other
        ? {
            counterpartRating: {
              score: other.score,
              comment: other.comment ?? undefined,
              createdAt: other.createdAt,
            },
          }
        : {}),
      createdAt: row.createdAt,
    };
  }

  /**
   * סיכום הרשת לדשבורד — **ספירות במסד ולא סינון של רשימה.**
   *
   * הדשבורד הציג מספרים שנגזרו מ-`listCoopOffers` ו-`listSharedLeads`,
   * ושתיהן חתוכות ל-100 השורות האחרונות: משרד עם מאה הצעות יוצאות
   * חדשות היה רואה "0 הצעות שהתקבלו" בזמן שממתינה לו הצעה, ומספר
   * ההפניות הפתוחות היה נמוך מהאמת (ביקורת Codex). `count` אינו
   * מוגבל, והוא גם חוסך הורדה של מאתיים שורות שאיש לא מציג.
   */
  async networkSummary(): Promise<{
    incomingOffers: number;
    openReferrals: number;
    credits: number;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const incomingOffers = await this.prisma.withTenant((tx) =>
      tx.coopOffer.count({ where: { toTenantId: tenantId, status: "sent" } }),
    );
    /*
     * ההפניות של המשרד עצמו אינן "פתוחות ברשת" עבורו — הוא פרסם
     * אותן. אותו סינון בדיוק כמו בלוח, כדי שהמספר בדשבורד יהיה
     * מספר השורות שייראו בלחיצה.
     */
    const openReferrals = await this.prisma.withNetworkRead((tx) =>
      tx.sharedLead.count({ where: { status: "active", NOT: { tenantId } } }),
    );
    const { balance } = await this.credits();
    return { incomingOffers, openReferrals, credits: balance };
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
      neighborhoods: string[];
      notes: string | null;
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
      neighborhoods: row.neighborhoods,
      ...(row.notes ? { notes: row.notes } : {}),
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
