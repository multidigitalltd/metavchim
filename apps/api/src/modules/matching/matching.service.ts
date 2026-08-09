import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  scoreMatch,
  MATCH_THRESHOLDS,
  type BuyerRequirements,
} from "@metavchim/shared";
import { assertBuyerAccess, assertMatchAccess, ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { rowToFields } from "../properties/property.mapper";

export interface MatchDto {
  id: string;
  propertyId: string;
  buyerId: string;
  score: number;
  explanation: string;
  status: string;
  computedAt: Date;
}

/** שורה במסך ההתאמות הדו-צדי (אפיון §15, מסך 4). */
export interface EnrichedMatchDto extends MatchDto {
  property: { address: string; title?: string; priceAgorot?: number };
  /** שם הקונה — רק אם למשתמש יש הרשאה אליו; אחרת מוצג "קונה של סוכן אחר" */
  buyerName: string | null;
}

/**
 * כמה שורות לשלוף מעבר למבוקש, כדי שסינון של צד מחוק לא יקצר את
 * התוצאה. מספר קטן ומכוון: המקור מתוקן, וזו רשת ביטחון בלבד.
 */
const LIVE_HEADROOM = 20;

/**
 * מנוע ההתאמות (docs/07 §5) — צנרת שני שלבים:
 * 1. סינון גס ב-SQL (עיר, תקציב, סוג עסקה) — מצמצם למועמדים רלוונטיים.
 * 2. ניקוד מפורט בפונקציה הטהורה scoreMatch — עם הסבר בעברית.
 *
 * סטטוסים ידניים (dismissed/offered) לעולם לא נדרסים ע"י חישוב מחדש —
 * החלטת המתווך גוברת על האלגוריתם.
 */
@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly contacts: ContactsService,
  ) {}

  /**
   * כל ההתאמות הפתוחות במשרד — מסך ההתאמות הדו-צדי. שם הקונה נחשף
   * רק למי שמורשה לקונה (בעלות או view_all) — אין דליפת PII בין סוכנים.
   */
  async listAll(query: {
    minScore: number;
    limit: number;
    propertyId?: string;
  }): Promise<EnrichedMatchDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      /*
       * מרווח מעל המבוקש, כי הסינון של צד מחוק קורה בזיכרון.
       *
       * `take` שווה בדיוק ל-limit היה נותן פחות מהמבוקש כשהשורות
       * העליונות מסוננות — ועם limit=1 אפילו רשימה ריקה בזמן שיש
       * התאמה תקינה שורה מתחת (ביקורת Codex). המקור מתוקן ממילא
       * (התאמה לנכס מחוק מסומנת dismissed), ולכן המרווח הוא רשת
       * ביטחון לשורות ישנות ולא הפתרון עצמו.
       */
      const rows = await tx.match.findMany({
        where: {
          tenantId,
          status: { not: "dismissed" },
          score: { gte: query.minScore },
          ...(query.propertyId ? { propertyId: query.propertyId } : {}),
        },
        orderBy: { score: "desc" },
        take: query.limit + LIVE_HEADROOM,
      });
      if (rows.length === 0) return [];

      /*
       * `deletedAt: null` כאן **וגם** סינון השורות למטה.
       *
       * ל-matches אין קשר מוצהר ל-properties, ולכן אי אפשר לסנן נכס
       * מחוק בשאילתה עצמה. סינון רק כאן היה משאיר את השורה במסך עם
       * הכתובת "נכס" — התאמה לנכס שנמחק, שנראית כמו תקלת תצוגה. מה
       * שנכון הוא להוציא את השורה.
       */
      const properties = await tx.property.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.propertyId))] },
          deletedAt: null,
        },
        select: {
          id: true, street: true, neighborhood: true, city: true,
          marketingTitle: true, priceAgorot: true,
        },
      });
      const propertyById = new Map(properties.map((p) => [p.id, p]));

      // קונה מחוק מוציא את ההתאמה, בדיוק כמו נכס מחוק
      const liveBuyers = await tx.buyer.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.buyerId))] },
          deletedAt: null,
        },
        select: { id: true },
      });
      const liveBuyerIds = new Set(liveBuyers.map((b) => b.id));

      /*
       * הבעלות נשארת סינון נפרד: קונה של סוכן אחר **קיים** ואינו
       * מוציא את ההתאמה — רק שמו אינו מוצג. מיזוג שני הסינונים היה
       * מסתיר התאמות אמיתיות מסוכן עם view_own.
       */
      const visibleBuyers = await tx.buyer.findMany({
        where: {
          tenantId,
          id: { in: [...liveBuyerIds] },
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { id: true, contactId: true },
      });
      // שאילתה אחת לכל השמות בעמוד, לא אחת לכל שורה
      const contactsById = await this.contacts.getByIds(
        tx,
        visibleBuyers.map((b) => b.contactId),
      );
      const buyerNameById = new Map<string, string>();
      for (const buyer of visibleBuyers) {
        const name = contactsById.get(buyer.contactId)?.name;
        if (name !== undefined) buyerNameById.set(buyer.id, name);
      }

      return rows
        // התאמה שצידה האחד נמחק אינה התאמה
        .filter((row) => propertyById.has(row.propertyId) && liveBuyerIds.has(row.buyerId))
        .slice(0, query.limit)
        .map((row) => {
          const property = propertyById.get(row.propertyId)!;
          return {
            ...toMatchDto(row),
            property: {
              address: [property.street, property.neighborhood, property.city]
                .filter(Boolean)
                .join(", "),
              title: property.marketingTitle ?? undefined,
              priceAgorot:
                property.priceAgorot === null ? undefined : Number(property.priceAgorot),
            },
            buyerName: buyerNameById.get(row.buyerId) ?? null,
          };
        });
    });
  }

  async recomputeForProperty(propertyId: string): Promise<number> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
      });
      if (
        !property ||
        property.city === null ||
        property.priceAgorot === null ||
        property.dealType === null
      ) {
        return 0; // בלי עיר, מחיר וסוג עסקה אין סינון אמין — יחושב כשיושלם
      }
      const fields = rowToFields(property);

      // שלב 1 — סינון גס: עיר, סוג עסקה, ותקציב עם מרווח הגמישות (7%)
      const candidates = await tx.buyer.findMany({
        where: {
          tenantId,
          deletedAt: null,
          dealType: property.dealType,
          cities: { has: property.city },
          budgetMaxAgorot: { gte: BigInt(Math.floor(Number(property.priceAgorot) / 1.07)) },
        },
        select: { id: true, requirements: true },
      });

      let kept = 0;
      for (const candidate of candidates) {
        const parsed = BuyerRequirementsSchema.safeParse(candidate.requirements);
        if (!parsed.success) continue;
        kept += await this.upsertMatch(tx, propertyId, candidate.id, fields, parsed.data);
      }

      // נכס שהשתנה (עיר אחרת, מחיר עלה): קונים שיצאו מהסינון הגס לא
      // נבדקים ב-upsertMatch — ההתאמות הישנות שלהם נמחקות כאן.
      await tx.match.deleteMany({
        where: {
          tenantId,
          propertyId,
          status: "suggested",
          buyerId: { notIn: candidates.map((c) => c.id) },
        },
      });

      await this.outbox.emit(tx, "matches.computed", { tenantId, propertyId, matchCount: kept });
      return kept;
    });
  }

  async recomputeForBuyer(buyerId: string): Promise<number> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({ where: { id: buyerId, tenantId, deletedAt: null } });
      if (!buyer) return 0;
      const parsed = BuyerRequirementsSchema.safeParse(buyer.requirements);
      if (!parsed.success) return 0;
      const requirements = parsed.data;

      const candidates = await tx.property.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: ["draft", "active"] },
          city: { in: requirements.cities },
          ...(requirements.dealType ? { dealType: requirements.dealType } : {}),
          priceAgorot: { lte: BigInt(Math.floor(Number(requirements.budgetMaxAgorot) * 1.07)) },
        },
      });

      let kept = 0;
      for (const property of candidates) {
        kept += await this.upsertMatch(tx, property.id, buyerId, rowToFields(property), requirements);
      }
      // דרישות שצומצמו (עיר הוסרה, תקציב ירד): נכסים שיצאו מהסינון הגס
      // לא נבדקים ב-upsertMatch — ההתאמות הישנות שלהם נמחקות כאן.
      // התאמות שהמתווך נגע בהן (הוצעו/נדחו) לא נמחקות — כמו ב-upsertMatch.
      await tx.match.deleteMany({
        where: {
          tenantId,
          buyerId,
          status: "suggested",
          propertyId: { notIn: candidates.map((p) => p.id) },
        },
      });
      await this.outbox.emit(tx, "matches.computed", { tenantId, buyerId, matchCount: kept });
      return kept;
    });
  }

  private async upsertMatch(
    tx: TenantTx,
    propertyId: string,
    buyerId: string,
    fields: ReturnType<typeof rowToFields>,
    requirements: BuyerRequirements,
  ): Promise<number> {
    const tenantId = TenantContext.current().tenantId;
    const result = scoreMatch(fields, requirements);
    const existing = await tx.match.findUnique({
      where: { tenantId_propertyId_buyerId: { tenantId, propertyId, buyerId } },
      select: { id: true, status: true },
    });

    if (result.excluded || result.score < MATCH_THRESHOLDS.review) {
      // התאמה שאינה רלוונטית עוד — מוסרת רק אם המתווך לא נגע בה
      if (existing && existing.status === "suggested") {
        await tx.match.delete({ where: { id: existing.id } });
      }
      return 0;
    }

    if (existing) {
      await tx.match.update({
        where: { id: existing.id },
        data: {
          score: result.score,
          breakdown: result.breakdown as object[],
          explanation: result.explanation,
          computedAt: new Date(),
        },
      });
    } else {
      await tx.match.create({
        data: {
          id: ulid(),
          tenantId,
          propertyId,
          buyerId,
          score: result.score,
          breakdown: result.breakdown as object[],
          explanation: result.explanation,
          status: "suggested",
          computedAt: new Date(),
        },
      });
    }
    return 1;
  }

  async listForProperty(
    propertyId: string,
  ): Promise<(MatchDto & { buyerName: string | null; buyerMaturity: string | null })[]> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const rows = await tx.match.findMany({
        where: {
          tenantId,
          propertyId,
          status: { not: "dismissed" },
        },
        orderBy: { score: "desc" },
        take: 100,
      });

      /*
       * העשרה לכרטיס הנכס (קובץ העיצוב): שם הקונה ותג הבשלות ליד כל
       * התאמה. השם מכבד בעלות — סוכן עם view_own רואה "קונה של סוכן
       * אחר"; הבשלות אינה מזהה ולכן מוצגת תמיד.
       */
      const buyers = await tx.buyer.findMany({
        // קונה מחוק אינו התאמה — הסינון כאן, וההשמטה בשורות למטה
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.buyerId))] },
          deletedAt: null,
        },
        select: { id: true, contactId: true, maturity: true },
      });
      const visibleBuyers = await tx.buyer.findMany({
        where: {
          tenantId,
          id: { in: buyers.map((b) => b.id) },
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { id: true, contactId: true },
      });
      const maturityById = new Map(buyers.map((b) => [b.id, b.maturity]));
      const contactsById = await this.contacts.getByIds(
        tx,
        visibleBuyers.map((b) => b.contactId),
      );
      const nameById = new Map<string, string>();
      for (const buyer of visibleBuyers) {
        const name = contactsById.get(buyer.contactId)?.name;
        if (name !== undefined) nameById.set(buyer.id, name);
      }

      return rows
        .filter((row) => maturityById.has(row.buyerId))
        .map((row) => ({
          ...toMatchDto(row),
          buyerName: nameById.get(row.buyerId) ?? null,
          buyerMaturity: maturityById.get(row.buyerId) ?? null,
        }));
    });
  }

  async listForBuyer(
    buyerId: string,
  ): Promise<(MatchDto & { property: { address: string; title?: string; priceAgorot?: number } })[]> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      // ההתאמות של קונה הן מידע על הקונה — מי שאינו רשאי לראות את
      // הכרטיס אינו רשאי לראות לאילו נכסים הוא מותאם
      await assertBuyerAccess(tx, tenantId, buyerId);
      const rows = await tx.match.findMany({
        where: {
          tenantId,
          buyerId,
          status: { not: "dismissed" },
        },
        orderBy: { score: "desc" },
        take: 100,
      });

      // שם הנכס לכל התאמה — לכרטיס הקונה (קובץ העיצוב); שאילתה אחת לעמוד
      const properties = await tx.property.findMany({
        // נכס מחוק אינו התאמה — הסינון כאן, וההשמטה בשורות למטה
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.propertyId))] },
          deletedAt: null,
        },
        select: {
          id: true, street: true, neighborhood: true, city: true,
          marketingTitle: true, priceAgorot: true,
        },
      });
      const propertyById = new Map(properties.map((p) => [p.id, p]));

      return rows
        .filter((row) => propertyById.has(row.propertyId))
        .map((row) => {
          const property = propertyById.get(row.propertyId)!;
          return {
            ...toMatchDto(row),
            property: {
              address: [property.street, property.neighborhood, property.city]
                .filter(Boolean)
                .join(", "),
              title: property.marketingTitle ?? undefined,
              priceAgorot:
                property.priceAgorot === null ? undefined : Number(property.priceAgorot),
            },
          };
        });
    });
  }

  /**
   * "סמן לא רלוונטי" — פעולת כתיבה על ההתאמה של קונה מסוים, ולכן
   * כפופה לבעלות על אותו קונה. ישבה עד כה בבקר עם גישה ישירה ל-Prisma,
   * ושם קל היה לפספס שמדובר בכתיבה על נתון של מישהו אחר.
   */
  async dismiss(matchId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await assertMatchAccess(tx, tenantId, matchId);
      await tx.match.updateMany({
        where: { id: matchId, tenantId, status: "suggested" },
        data: { status: "dismissed" },
      });
    });
  }
}

function toMatchDto(row: {
  id: string;
  propertyId: string;
  buyerId: string;
  score: number;
  explanation: string;
  status: string;
  computedAt: Date;
}): MatchDto {
  return {
    id: row.id,
    propertyId: row.propertyId,
    buyerId: row.buyerId,
    score: row.score,
    explanation: row.explanation,
    status: row.status,
    computedAt: row.computedAt,
  };
}
