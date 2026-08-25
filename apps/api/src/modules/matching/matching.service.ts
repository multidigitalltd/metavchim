import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import {
  BUDGET_BAND_AGOROT,
  budgetBandAgorot,
  BuyerRequirementsSchema,
  boundingBox,
  locationNameVariants,
  summarizeDismissals,
  DISMISS_REASONS,
  type DismissReason,
  type DismissReport,
  resolveMatchWeights,
  scoreMatch,
  MATCH_THRESHOLDS,
  type BuyerRequirements,
  type MatchWeights,
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

/** מה שהזיז את החישוב, כשזו פעולה מסחרית של הסוכן. ראו events.ts. */
export interface MatchTrigger {
  kind: "price_drop" | "budget_raise";
  fromAgorot: number;
  toAgorot: number;
}

/**
 * נכס נסרק מול קונים רק בסטטוסים האלה.
 *
 * **הצד השני כבר סינן כך** (`recomputeForBuyer`), והאי-סימטריה הייתה
 * באג של ממש: עריכה של נכס שנמכר ייצרה לו התאמות מחדש, והסבב הבא
 * מצד הקונה מחק אותן. הסוכן ראה קונים מוצעים לנכס שאינו למכירה,
 * ואז ראה אותם נעלמים בלי סיבה נראית לעין.
 */
export const MATCHABLE_PROPERTY_STATUSES = ["draft", "active"] as const;

/** אפשרויות חישוב מחדש — ראו `silent` בסבב הרענון. */
export interface RecomputeOptions {
  trigger?: MatchTrigger;
  /**
   * לא לפרסם אירוע בתום החישוב.
   *
   * קיים בשביל סבב הרענון בלבד: הוא נוגע בכל המאגר, ואירוע לכל נכס
   * היה נהפך לעשרות התראות "נמצאו קונים חדשים" בלילה אחד. הסבב
   * מסכם את עצמו בהתראה **אחת** — ראו `MatchRefreshService`.
   */
  silent?: boolean;
}

/**
 * תוצאת חישוב מחדש.
 *
 * `opened` — כמה **נולדו** בסבב, ולא כמה קיימות. זו ההבחנה שעליה
 * נשענת כל ההתראה: סבב שרק עדכן ציונים של אותן התאמות אינו חדשה,
 * וסבב שפתח שלוש התאמות הוא שיחת טלפון שצריך לעשות היום.
 */
export interface RecomputeResult {
  matches: number;
  opened: number;
}

const NO_MATCHES: RecomputeResult = { matches: 0, opened: 0 };

/**
 * מנוע ההתאמות (docs/07 §5) — צנרת שני שלבים:
 * 1. סינון גס ב-SQL (עיר, תקציב, סוג עסקה) — מצמצם למועמדים רלוונטיים.
 * 2. ניקוד מפורט בפונקציה הטהורה scoreMatch — עם הסבר בעברית.
 *
 * סטטוסים ידניים (dismissed/offered) לעולם לא נדרסים ע"י חישוב מחדש —
 * החלטת המתווך גוברת על האלגוריתם.
 */
/**
 * כמה התאמות מוחזרות לכרטיס אחד — **קבוע אחד, כי הקורא צריך לדעת.**
 *
 * רשימה שהגיעה לתקרה אינה „כל ההתאמות”, והתשובה של הסוכן אמורה
 * לומר זאת. כל עוד המספר היה כתוב פעמיים ב-`take` בלבד, הקורא לא
 * יכול היה להשוות אליו — ולכן הציג עמוד חתוך כרשימה מלאה
 * (ביקורת Codex).
 */
export const MATCH_LIST_LIMIT = 100;

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

  /**
   * `trigger` — כשהחישוב נובע משינוי מסחרי שהסוכן עשה זה עתה.
   *
   * הוא נוסע עד ההתראה ומשנה את ניסוחה: "הורדת המחיר פתחה 3
   * התאמות" במקום "נמצאו 3 קונים חדשים". אותו אירוע, אבל הראשון
   * מגיע לסוכן שעדיין באותו הקשר ולכן הוא זה שיפעל לפיו.
   */
  async recomputeForProperty(
    propertyId: string,
    options: RecomputeOptions = {},
  ): Promise<RecomputeResult> {
    const { trigger, silent } = options;
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
        return NO_MATCHES; // בלי עיר, מחיר וסוג עסקה אין סינון אמין — יחושב כשיושלם
      }

      /*
       * נכס שיצא משיווק — נמכר, הושכר, הוקפא או הועבר לארכיון —
       * מנקה את ההצעות שנותרו לו ואינו מייצר חדשות. בלי זה, כל
       * עריכה קטנה בנכס שנמכר הייתה מציפה את המסך בקונים "מתאימים"
       * לנכס שאינו קיים בשוק.
       */
      if (!(MATCHABLE_PROPERTY_STATUSES as readonly string[]).includes(property.status)) {
        await tx.match.deleteMany({ where: { tenantId, propertyId, status: "suggested" } });
        return NO_MATCHES;
      }
      const fields = rowToFields(property);

      /*
       * שלב 1 — סינון גס: עיר, סוג עסקה, ותקציב עם מרווח הגמישות (7%).
       *
       * **הסינון חייב להיות רחב לפחות כמו המנוע.** קונה שכתב
       * "בני-ברק" מול נכס ב"בני ברק" נופל בהשוואת מחרוזות ולא מגיע
       * בכלל לניקוד — הסינון הגס היה מבטל את כל הסלחנות שנוספה
       * למנוע. `locationNameVariants` מרחיב לכל הכתיבים המקובלים.
       *
       * קונה שסימן אזורים על המפה נכנס תמיד: הרדיוס שלו עשוי לכלול
       * את הנכס גם כשהעיר שונה לחלוטין, וזו בדיוק הנקודה. הסינון
       * המדויק לפי מרחק קורה במנוע.
       */
      const cityVariants = locationNameVariants(property.city);
      const candidates = await tx.buyer.findMany({
        where: {
          tenantId,
          deletedAt: null,
          dealType: property.dealType,
          /*
           * שני תנאי-או נפרדים, ולכן `AND` מפורש: מפתח `OR` יחיד
           * באובייקט אחד היה דורס את קודמו, ושני התנאים חייבים
           * להתקיים יחד.
           */
          AND: [
            {
              OR: [
                { cities: { hasSome: cityVariants } },
                // רשימת ערים ריקה = בלי מגבלת אזור — הקונה נשאר מועמד
                { cities: { isEmpty: true } },
                { hasSearchAreas: true },
              ],
            },
            {
              /*
               * קונה בלי תקציב נשאר מועמד.
               *
               * הסינון הגס חייב להיות רחב לפחות כמו המנוע, והמנוע
               * מדלג על קריטריון התקציב כשאין תקציב. `>=` ב-SQL אינו
               * מתאים ל-NULL, ולכן בלי הענף הזה קונה בלי תקציב לא
               * היה מקבל ולו התאמה אחת — והסיבה לא הייתה נראית
               * בשום מסך.
               */
              OR: [
                { budgetMaxAgorot: null },
                {
                  /*
                   * רחב לפחות כמו רצועת התקציב של המנוע: קונה נשאר
                   * מועמד אם תקרת התקציב שלו בתוך הרצועה מתחת למחיר.
                   * רצועת המכירה (400 אלף ₪) רחבה מרצועת השכירות
                   * היחסית בכל מחיר ריאלי — ולכן בטוחה לשני הסוגים;
                   * המנוע עצמו מדייק לפי סוג העסקה.
                   */
                  budgetMaxAgorot: {
                    gte: BigInt(
                      Math.max(
                        0,
                        Math.floor(Number(property.priceAgorot)) -
                          BUDGET_BAND_AGOROT,
                      ),
                    ),
                  },
                },
              ],
            },
          ],
        },
        select: { id: true, requirements: true },
      });

      // פעם אחת לכל הסבב — ראו weightsFor
      const weights = await this.weightsFor(tx);
      let kept = 0;
      let created = 0;
      let strong = 0;
      for (const candidate of candidates) {
        const parsed = BuyerRequirementsSchema.safeParse(candidate.requirements);
        if (!parsed.success) continue;
        const outcome = await this.upsertMatch(
          tx,
          propertyId,
          candidate.id,
          fields,
          parsed.data,
          weights,
        );
        if (outcome.kept) kept += 1;
        if (outcome.created) created += 1;
        if (outcome.strong) strong += 1;
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

      if (!silent) {
        await this.outbox.emit(tx, "matches.computed", {
          tenantId,
          propertyId,
          matchCount: kept,
          newMatchCount: created,
          strongMatchCount: strong,
          ...(trigger ? { trigger } : {}),
        });
      }
      return { matches: kept, opened: created };
    });
  }

  async recomputeForBuyer(buyerId: string, options: RecomputeOptions = {}): Promise<RecomputeResult> {
    const { trigger, silent } = options;
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({ where: { id: buyerId, tenantId, deletedAt: null } });
      if (!buyer) return NO_MATCHES;
      const parsed = BuyerRequirementsSchema.safeParse(buyer.requirements);
      if (!parsed.success) return NO_MATCHES;
      const requirements = parsed.data;

      /*
       * הכיוון ההפוך, ואותו עיקרון: הסינון רחב לפחות כמו המנוע.
       *
       * כשיש אזורי חיפוש, התיבה התוחמת סביבם מחליפה את סינון העיר
       * — היא אינדקסבילית, וכוללת את טווח החסד כך שנכס שמנוקד לא
       * ייפול כאן. נכס בלי קואורדינטה נכנס דרך שם העיר, כי עליו
       * המנוע ממילא ייפול חזרה לטקסט.
       */
      const areas = requirements.searchAreas ?? [];
      const box = boundingBox(areas);
      const cityNames = requirements.cities.flatMap((c) => locationNameVariants(c));
      const locationFilter =
        box !== null
          ? {
              OR: [
                {
                  latitude: { gte: box.minLat, lte: box.maxLat },
                  longitude: { gte: box.minLon, lte: box.maxLon },
                },
                ...(cityNames.length > 0 ? [{ city: { in: cityNames } }] : []),
                { latitude: null },
              ],
            }
          : cityNames.length > 0
            ? { city: { in: cityNames } }
            : {};

      const candidates = await tx.property.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: [...MATCHABLE_PROPERTY_STATUSES] },
          ...locationFilter,
          ...(requirements.dealType ? { dealType: requirements.dealType } : {}),
          /*
           * בלי תקציב אין תקרת מחיר, ולכן אין תנאי.
           *
           * `Number(undefined)` הוא NaN ו-`BigInt(NaN)` זורק — כלומר
           * בלי התנאי הזה רענון ההתאמות של קונה בלי תקציב היה נופל
           * בשגיאה, ולא רק מחזיר פחות.
           */
          ...(requirements.budgetMaxAgorot === undefined
            ? {}
            : {
                /*
                 * רצועת התקציב של המנוע, בשני הכיוונים: התקרה היא
                 * התקציב + הרצועה, והרצפה — המינימום המוצהר (או
                 * התקציב עצמו כשאין) פחות רצועה שנמדדת **מהרצפה
                 * עצמה** (ביקורת Codex) — אותו חישוב כמו במנוע, כדי
                 * ש-SQL והניקוד יישארו מיושרים. קונה של 3.5 מיליון
                 * לא מקבל מועמדים של 2.5 מיליון כבר בסינון הגס.
                 */
                priceAgorot: {
                  lte: BigInt(
                    requirements.budgetMaxAgorot +
                      budgetBandAgorot(
                        requirements.budgetMaxAgorot,
                        requirements.dealType,
                      ),
                  ),
                  gte: BigInt(
                    Math.max(
                      0,
                      (requirements.budgetMinAgorot ??
                        requirements.budgetMaxAgorot) -
                        budgetBandAgorot(
                          requirements.budgetMinAgorot ??
                            requirements.budgetMaxAgorot,
                          requirements.dealType,
                        ),
                    ),
                  ),
                },
              }),
        },
      });

      const weights = await this.weightsFor(tx);
      let kept = 0;
      let created = 0;
      let strong = 0;
      for (const property of candidates) {
        const outcome = await this.upsertMatch(
          tx,
          property.id,
          buyerId,
          rowToFields(property),
          requirements,
          weights,
        );
        if (outcome.kept) kept += 1;
        if (outcome.created) created += 1;
        if (outcome.strong) strong += 1;
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
      /*
       * הצד הזה לא הודיע לאיש עד היום: מיפוי ההתראות דרש `propertyId`,
       * ולכן ביקוש שנרשם עכשיו ומצא נכסים עבר בשקט. ההתראה הולכת
       * לסוכן שהכרטיס שלו — זו השיחה שהוא צריך לעשות היום.
       */
      if (!silent) {
        await this.outbox.emit(tx, "matches.computed", {
          tenantId,
          buyerId,
          matchCount: kept,
          newMatchCount: created,
          strongMatchCount: strong,
          ...(buyer.ownerUserId ? { ownerUserId: buyer.ownerUserId } : {}),
          ...(trigger ? { trigger } : {}),
        });
      }
      return { matches: kept, opened: created };
    });
  }

  /**
   * משקלי ההתאמה של המשרד, בקריאה אחת לכל סבב.
   *
   * נקראים כאן ולא בתוך הלולאה: recompute רץ על עשרות נכסים, ושאילתת
   * הגדרות לכל אחד מהם הייתה N+1 על נתון שאינו משתנה באמצע הסבב.
   */
  private async weightsFor(tx: TenantTx): Promise<MatchWeights> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    return resolveMatchWeights(settings["matchWeights"]);
  }

  /**
   * מחזיר **מה קרה** ולא רק "נשמר".
   *
   * ההבחנה בין התאמה שנולדה עכשיו לאחת שרק חושבה מחדש היא מה שמאפשר
   * להתריע רק על חדשות. בלעדיה כל עריכה קטנה בנכס הייתה מודיעה שוב
   * על אותם קונים, וההתראה הייתה הופכת לרעש.
   */
  private async upsertMatch(
    tx: TenantTx,
    propertyId: string,
    buyerId: string,
    fields: ReturnType<typeof rowToFields>,
    requirements: BuyerRequirements,
    weights: MatchWeights,
  ): Promise<{ kept: boolean; created: boolean; strong: boolean }> {
    const tenantId = TenantContext.current().tenantId;
    const result = scoreMatch(fields, requirements, weights);
    const existing = await tx.match.findUnique({
      where: { tenantId_propertyId_buyerId: { tenantId, propertyId, buyerId } },
      select: { id: true, status: true },
    });

    if (result.excluded || result.score < MATCH_THRESHOLDS.review) {
      // התאמה שאינה רלוונטית עוד — מוסרת רק אם המתווך לא נגע בה
      if (existing && existing.status === "suggested") {
        await tx.match.delete({ where: { id: existing.id } });
      }
      return { kept: false, created: false, strong: false };
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
    return {
      kept: true,
      created: existing === null,
      // "חזק" נספר רק על חדשה — ההתראה מדברת על מה שהתחדש
      strong: existing === null && result.score >= MATCH_THRESHOLDS.recommended,
    };
  }

  async listForProperty(
    propertyId: string,
    limit: number = MATCH_LIST_LIMIT,
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
        take: limit + LIVE_HEADROOM,
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
        .slice(0, limit)
        .map((row) => ({
          ...toMatchDto(row),
          buyerName: nameById.get(row.buyerId) ?? null,
          buyerMaturity: maturityById.get(row.buyerId) ?? null,
        }));
    });
  }

  async listForBuyer(
    buyerId: string,
    limit: number = MATCH_LIST_LIMIT,
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
        take: limit + LIVE_HEADROOM,
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
        .slice(0, limit)
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
  /**
   * "סמן לא רלוונטי" — **עם סיבה.**
   *
   * הסיבה אינה קישוט: היא היחידה שמאפשרת לדעת אילו קריטריונים
   * מייצרים התאמות שאיש לא רוצה, ולכייל את המשקלים לפי מציאות ולא
   * לפי תחושה. היא אופציונלית בחוזה כדי שלקוח ישן של ה-API לא
   * יישבר, והמסך מבקש אותה תמיד.
   */
  async dismiss(
    matchId: string,
    feedback?: { reason: DismissReason; note?: string },
  ): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      await assertMatchAccess(tx, ctx.tenantId, matchId);
      await tx.match.updateMany({
        where: { id: matchId, tenantId: ctx.tenantId, status: "suggested" },
        data: {
          status: "dismissed",
          dismissedAt: new Date(),
          dismissedBy: ctx.userId,
          ...(feedback
            ? { dismissReason: feedback.reason, dismissNote: feedback.note?.trim() || null }
            : {}),
        },
      });
    });
  }

  /**
   * דוח "למה התאמות נדחות".
   *
   * חלון זמן ולא "מאז ומעולם": מנוע שכויל לפני חצי שנה ומאז השתנו
   * המשקלים אינו מעניין, ודוח שמערבב את שתי התקופות מסתיר בדיוק את
   * מה שהשתנה.
   */
  async dismissReport(days: number): Promise<DismissReport> {
    const tenantId = TenantContext.current().tenantId;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.withTenant((tx) =>
      tx.match.findMany({
        where: { tenantId, dismissReason: { not: null }, dismissedAt: { gte: since } },
        select: { dismissReason: true },
        take: 5000,
      }),
    );
    return summarizeDismissals(
      rows
        .map((r) => r.dismissReason)
        .filter((r): r is DismissReason => r !== null && DISMISS_REASONS.includes(r as DismissReason)),
    );
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
