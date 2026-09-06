import { Prisma } from "@prisma/client";
import { ForbiddenException, Injectable } from "@nestjs/common";
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
  MATCHABLE_PROPERTY_STATUSES,
  type BuyerRequirements,
  type MatchWeights,
  SCORE_NOTE_MAX,
  ScoreComponentSchema,
  type ScoreComponent,
  PARTNER_CANDIDATE_SCAN,
  PARTNER_PAIR_LIMIT,
  partnerPairs,
  type PartnerCandidate,
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
  /**
   * ‎**הפירוט לפי קריטריון — מה נבדק, ומה יצא.**
   *
   * הוא חושב ונשמר מאז ומעולם, ומעולם לא הוחזר: המסך קיבל ציון
   * ומשפט חופשי, ולכן יכול היה לומר „‎87%” ולא לומר **על מה**. מתווך
   * שרואה מספר בלי הרכב אינו יכול להחליט אם לשלוח — והוא גם אינו
   * יכול לדעת מה חסר כדי שהציון ישתפר.
   *
   * ‎`ScoreComponent` נושא גם `weight`, ולכן המסך יכול להבחין בין
   * „נבדק ונכשל” (`score = 0`) לבין „לא נבדק כלל” (הקריטריון חסר
   * מהרשימה) — שתי אמירות שונות לגמרי, שעד כה נראו זהות.
   */
  breakdown: ScoreComponent[];
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
/** ‏צמד שותפים לנכס — שני אנשים בשמם, כי זו ההצעה. */
export interface PartnerPairDto {
  score: number;
  explanation: string;
  combinedBudgetAgorot: number;
  /** ‏העודף מעל המחיר. אפס = כיסוי מדויק. */
  headroomAgorot: number;
  partners: {
    buyerId: string;
    buyerName: string;
    budgetMaxAgorot: number;
    shareAgorot: number;
    score: number;
  }[];
}

export interface MatchTrigger {
  kind: "price_drop" | "budget_raise";
  fromAgorot: number;
  toAgorot: number;
}

/* `MATCHABLE_PROPERTY_STATUSES` עבר לחבילה — גם המסך זקוק לו. */
export { MATCHABLE_PROPERTY_STATUSES };

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

/**
 * ההתאמות הפתוחות של כרטיס — **תנאי אחד לשאילתה ולספירה.**
 *
 * הספירה קיימת כדי לומר „יש עוד” בלי לנחש: הסינון של שורות
 * מיושנות קורה בזיכרון, ולכן אורך התוצאה אינו מעיד על מה שקיים
 * במאגר — ומרווח קבוע, גדול ככל שיהיה, נשבר כשמספר השורות
 * המיושנות עולה עליו (ביקורת Codex). שני מקומות שכותבים את אותו
 * תנאי היו נפרדים ביום שאחד מהם משתנה, ואז הספירה הייתה של משהו
 * אחר מהרשימה.
 */
function openMatchesOf(tenantId: string, key: { propertyId: string } | { buyerId: string }) {
  return { tenantId, ...key, status: { not: "dismissed" } };
}

/**
 * ‎**התנאי המשותף — בשפת ה-SQL, כדי שה-`LIMIT` יחול אחריו.**
 *
 * ## ‏למה לא לסנן בזיכרון
 *
 * ‏הרשימות שלפו `limit + LIVE_HEADROOM` שורות וסיננו אחר כך. המרווח
 * הזה (20) תועד במפורש כ„רשת ביטחון” לצד **מחוק** — מקרה נדיר. נכס
 * שנמכר אינו נדיר, ולכן ברגע שהוא עבר דרך אותה רשת היא הפכה
 * לחסם: קונה ש-21 ההתאמות החזקות שלו הן לנכסים שנמכרו היה מקבל
 * רשימה **ריקה**, בזמן שיש לו התאמות תקינות שורה מתחת (ביקורת
 * Codex, P1).
 *
 * ‏המסננת עברה למסד, ולכן ה-`LIMIT` סופר שורות שכבר עברו אותה. אין
 * מרווח ואין תלות בו.
 *
 * ## ‏גם הקונה, ולא רק הנכס
 *
 * ‏הסינון של קונה מחוק היה בזיכרון מאותה סיבה ובאותו מרווח. הוא
 * נכנס לאותו תנאי: התאמה היא בין שני צדדים, ושניהם חייבים להתקיים.
 *
 * ## ‏המחיר
 *
 * ‏התנאי חי עכשיו ב-SQL וגם ב-`openMatchesOf` שנשאר לכרטיס הנכס.
 * הבדיקה המבנית משווה ביניהם, כי עותק שני מסכים עם הראשון עד היום
 * שבו אחד מהם משתנה.
 */
function matchableMatchesFrom(tenantId: string, extra: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    FROM matches m
    WHERE m.tenant_id = ${tenantId}
      AND m.status <> 'dismissed'
      ${extra}
      AND EXISTS (
        SELECT 1 FROM properties p
        WHERE p.id = m.property_id
          AND p.tenant_id = m.tenant_id
          AND p.deleted_at IS NULL
          AND p.status IN (${Prisma.join([...MATCHABLE_PROPERTY_STATUSES])})
      )
      AND EXISTS (
        SELECT 1 FROM buyers b
        WHERE b.id = m.buyer_id
          AND b.tenant_id = m.tenant_id
          AND b.deleted_at IS NULL
      )
  `;
}

/**
 * ‎**נכס שאפשר להציע — התנאי של הקריאה, לא רק של הכתיבה.**
 *
 * ## ‏מה היה
 *
 * ‏הכלל „נכס שנמכר אינו מוצע” נאכף **רק בכתיבה**: `retireMatches`
 * מוריד את ההתאמות ברגע שהסטטוס משתנה, ושני מסלולי החישוב מדלגים
 * על נכס שאינו לשיווק. הקריאה סיננה `deletedAt` בלבד, כלומר היא
 * הניחה שהניקוי אכן רץ.
 *
 * ‏הנחה כזו נכונה עד לפעם הראשונה שהיא אינה: שורה שנוצרה בגרסה
 * שקדמה לניקוי, טרנזקציה שנקטעה, או מסלול שנוסף ושכח לקרוא לו.
 * ‏**ואין מי שיתקן אותה בדיעבד** — הסבב היומי עובר על נכסים
 * לשיווק בלבד, ולכן נכס שנמכר אינו נבדק שוב לעולם. שורה כזו
 * מופיעה במסך לתמיד.
 *
 * ‏זה הסינון שהופך את „לא אמורים להופיע” לנכון בלי תלות בהיסטוריה:
 * גם אם השורה קיימת, היא אינה נקראת.
 *
 * ## ‏למה `deletedAt` **וגם** הסטטוס באותו מקום
 *
 * ‏שניהם עונים לאותה שאלה — „האם מותר להציע את הנכס הזה עכשיו” —
 * ושני תנאים בשני מקומות נפרדים היו מסכימים ביום שנכתבו בלבד.
 */
function matchablePropertyOf(tenantId: string, propertyIds: readonly string[]) {
  return {
    tenantId,
    id: { in: [...new Set(propertyIds)] },
    deletedAt: null,
    status: { in: [...MATCHABLE_PROPERTY_STATUSES] },
  };
}

/**
 * ‎**מה שהשורה בכרטיס הנכס מספרת על הקונה.**
 *
 * הציון לבדו אומר „מתאים” ולא אומר **למה שווה להתקשר עכשיו**:
 * תקציב, כמה חדרים הוא מחפש, איפה, וכמה זמן הוא כבר מחפש. כל אלה
 * כבר יושבים בשורת הקונה, ובלעדיהם המתווך פותח כרטיס אחרי כרטיס
 * רק כדי להחליט למי לפנות ראשון.
 *
 * ‎`null` = הקונה אינו של הסוכן הזה ואינו במסלול הצפייה שלו. אותו
 * גדר של השם, ומאותה סיבה.
 */
export interface BuyerFacts {
  /** תקרת התקציב באגורות; `null` = לא הוזנה. */
  budgetMaxAgorot: number | null;
  roomsMin: number | null;
  roomsMax: number | null;
  cities: string[];
  /** מתי נפתח כרטיס הקונה — „מחפש כבר שלושה שבועות”. */
  searchingSince: string;
}

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
       * ‏הסינון קורה **במסד**, ולכן ה-`LIMIT` כבר סופר שורות תקינות
       * בלבד. הגרסה הקודמת שלפה מרווח וסיננה בזיכרון — ראו
       * ‎`matchableMatchesFrom` למה זה נשבר.
       */
      const rows = await this.matchableRows(
        tx,
        tenantId,
        Prisma.sql`
          AND m.score >= ${query.minScore}
          ${query.propertyId ? Prisma.sql`AND m.property_id = ${query.propertyId}` : Prisma.empty}
        `,
        query.limit,
      );
      if (rows.length === 0) return [];

      /*
       * ‏הסינון כאן **וגם** השמטת השורות למטה.
       *
       * ל-matches אין קשר מוצהר ל-properties, ולכן אי אפשר לסנן נכס
       * מחוק או נכס שנמכר בשאילתה של ההתאמות עצמה. סינון רק כאן היה
       * משאיר את השורה במסך עם הכתובת "נכס" — התאמה לנכס שאינו
       * מוצג, שנראית כמו תקלת תצוגה. מה שנכון הוא להוציא את השורה.
       *
       * ‏ראו `matchablePropertyOf`: מחוק **וגם** יצא משיווק.
       */
      const properties = await tx.property.findMany({
        where: matchablePropertyOf(tenantId, rows.map((r) => r.propertyId)),
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

      /*
       * ‎**אין כאן `slice`** — ה-SQL כבר החזיר בדיוק `limit` שורות
       * שעברו את התנאי, וזה מה שמתקן את הקיצור.
       *
       * ‏השורה שאין לה נכס **מדולגת ולא נדחפת ב-`!`**: שאילתת הנכס
       * מחילה את אותו תנאי בעצמה, ולכן חוסר כאן פירושו ששני
       * הניסוחים סטו זה מזה. במצב כזה עדיף להשמיט שורה אחת מאשר
       * להפיל את המסך — ובכיוון הבטוח, שהרי הכלל הוא שנכס שיצא
       * משיווק לא ייראה.
       */
      return rows.flatMap((row) => {
        const property = propertyById.get(row.propertyId);
        if (property === undefined) return [];
        return [
          {
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
          },
        ];
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
      if (!property) return NO_MATCHES;

      /*
       * ‎**„אי אפשר לחשב כאן” אינו „אין מיקום”.** שתי שאלות נפרדות,
       * ולערבב אותן עולה בנתונים של הלקוח.
       *
       * הסינון הגס כאן נשען על שם העיר, ולכן בלי עיר, מחיר או סוג
       * עסקה אי אפשר לבחור מועמדים — ומכאן היציאה המוקדמת. אבל
       * למנוע יש **שני** מסלולי מיקום, ונכס עם קואורדינטות ובלי
       * עיר ממוקם לגמרי: `scoreMatch` בוחן אותו מול אזורי המפה של
       * הקונה, ו-`recomputeForBuyer` בוחר אותו דרך התיבה התוחמת.
       * ההתאמה שנוצרה שם אמיתית, והיא נוצרה בכיוון שכן יודע לנקד
       * אותו.
       *
       * הגרסה הראשונה של הניקוי כאן מחקה על `city === null` לבדו,
       * וכך הייתה מוחקת בכל סבב יומי בדיוק את ההתאמות התקינות
       * האלה (ביקורת Codex). המחיקה מכוונת עכשיו למה שהיא נועדה
       * לו: נכס שאין לו מיקום כלל.
       */
      const locatable = property.city !== null || property.latitude !== null;
      if (!locatable) {
        /*
         * ‎**זה מה שהעלאת גרסת המנוע נועדה לנקות.** התאמה שנשמרה
         * לפני כלל הברזל, על נכס בלי מיקום, שרדה כל סבב רענון —
         * הסבב עובר על נכסים, וכל נכס כזה יצא כאן לפני כל מחיקה.
         * רק `suggested` נמחק; הצעה שהסוכן נגע בה נשארת שלו.
         */
        await tx.match.deleteMany({ where: { tenantId, propertyId, status: "suggested" } });
        return NO_MATCHES;
      }

      if (
        property.city === null ||
        property.priceAgorot === null ||
        property.dealType === null
      ) {
        // ממוקם, אך חסר לסינון הגס — לא מחשבים כאן, וגם לא הורסים
        return NO_MATCHES;
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
      /*
       * ‎**`createdAt` אינו ברשימה, וזו כל הנקודה.**
       *
       * ‎`computedAt` הוא „מתי חושבה לאחרונה” והוא אמור לזוז כאן.
       * ‎`createdAt` הוא „מתי נולדה”, וגבול ההפעלה של ההצעות
       * האוטומטיות („מכאן והלאה”) נשען עליו: ברגע שהוא יזוז, כל
       * עריכת מחיר תהפוך התאמה ישנה ל„חדשה” ותשלח דיוור היסטורי.
       * הוספתו כאן היא הדרך היחידה לשבור את הגבול הזה.
       */
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

  /**
   * כמה התאמות משרדיות עומדות בסף — **התשובה ל„יש עוד”.**
   *
   * אותו נימוק כמו לכרטיס: הרשימה מסוננת בזיכרון משורות מיושנות,
   * ולכן אורכה אינו מעיד על מה שקיים. השארתי את המשרדית על השורה
   * העודפת בסבב הקודם בטענה שאין לה תנאי קבוע לספור — ויש, הוא
   * פשוט נגזר מהבקשה (ביקורת Codex).
   */
  async countAll(query: { minScore: number; propertyId?: string }): Promise<number> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      /*
        ‏הספירה חייבת להתיישר עם הרשימה, ולכן היא מחריגה את אותם
        נכסים בדיוק. „12 התאמות” מעל רשימה של שמונה הוא מונה ששולח
        לחפש ארבע שאינן קיימות.
      */
      return this.countMatchable(
        tx,
        tenantId,
        Prisma.sql`
          AND m.score >= ${query.minScore}
          ${query.propertyId ? Prisma.sql`AND m.property_id = ${query.propertyId}` : Prisma.empty}
        `,
      );
    });
  }

  /**
   * כמה התאמות פתוחות יש לכרטיס — **התשובה ל„יש עוד”.**
   *
   * ספירה ולא אורך הרשימה, כי הרשימה מסוננת בזיכרון משורות
   * מיושנות. הכיוון של אי-הדיוק חשוב: הספירה כוללת שורה מיושנת
   * שהרשימה השמיטה, ולכן היא עלולה לומר „יש עוד” כשאין — ולעולם
   * לא „זה הכול” כשיש. השקר הראשון עולה למתווך לחיצה, השני עולה
   * לו לקוח.
   */
  async countForProperty(propertyId: string): Promise<number> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      // ‏אותו תנאי של `listForProperty`, אחרת המונה סופר מה שהיא לא מציגה
      if (!(await this.isMatchable(tx, tenantId, propertyId))) return 0;
      return tx.match.count({ where: openMatchesOf(tenantId, { propertyId }) });
    });
  }

  /** אותו דבר לקונה — ובאותה בדיקת גישה כמו הרשימה שלו. */
  async countForBuyer(buyerId: string): Promise<number> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      await assertBuyerAccess(tx, tenantId, buyerId);
      return this.countMatchable(tx, tenantId, Prisma.sql`AND m.buyer_id = ${buyerId}`);
    });
  }

  /**
   * ‎**ספירה שמתיישרת עם הרשימה — בלי לשלוף מזהים.**
   *
   * ‏הגרסה הראשונה שלי שלפה את כל הנכסים שיצאו משיווק והחריגה אותם
   * ב-`notIn`, בנימוק שהם הצד הקטן. **הנימוק שגוי**: משרד שפועל
   * שנים מכר יותר נכסים משיש לו פעילים, ולכן הרשימה גדלה בלי חסם
   * ומופיעה בכל טעינה של מסך ההתאמות. ‏`dropOrphanMatches` כבר מזהיר
   * מזה במפורש, ופותר באותו `NOT EXISTS` שכאן.
   *
   * ‎**התנאי חי גם ב-`openMatchesOf`**, שנשאר לכרטיס הנכס. זה בדיוק
   * מה שהתגובות בקובץ מזהירות ממנו, ולכן הבדיקה המבנית משווה את
   * השניים: `status <> 'dismissed'` כאן חייב להתאים
   * ל-`status: { not: "dismissed" }` שם.
   *
   * ‏רשימת הסטטוסים נגזרת מ-`MATCHABLE_PROPERTY_STATUSES` ואינה
   * כתובה כאן, כדי שהיא לא תוכל לסטות מהרשימה.
   */
  private async countMatchable(
    tx: TenantTx,
    tenantId: string,
    extra: Prisma.Sql,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count ${matchableMatchesFrom(tenantId, extra)}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * ‎**השורות עצמן — מסוננות ומוגבלות במסד.**
   *
   * ‏שני שלבים ולא אחד: ה-SQL בוחר את המזהים לפי הניקוד ומחיל את
   * ה-`LIMIT` על מה שכבר עבר את התנאי, ו-Prisma שולפת את השורות
   * עצמן. כך הטיפוסים נשארים של Prisma (‏`breakdown` הוא JSON,
   * ‎`computedAt` הוא `Date`) ולא רשומה שהורכבה ביד מ-`$queryRaw`.
   *
   * ‏המיון חוזר גם ב-`findMany`: `IN (...)` אינו משמר סדר.
   */
  private async matchableRows(
    tx: TenantTx,
    tenantId: string,
    extra: Prisma.Sql,
    limit: number,
  ): Promise<Awaited<ReturnType<TenantTx["match"]["findMany"]>>> {
    const picked = await tx.$queryRaw<{ id: string }[]>`
      SELECT m.id ${matchableMatchesFrom(tenantId, extra)}
      ORDER BY m.score DESC
      LIMIT ${limit}
    `;
    if (picked.length === 0) return [];
    return tx.match.findMany({
      where: { tenantId, id: { in: picked.map((row) => row.id) } },
      orderBy: { score: "desc" },
    });
  }

  /**
   * ‏האם מותר להציע את הנכס הזה עכשיו.
   *
   * ‏שאילתה אחת שעונה על שני התנאים של `matchablePropertyOf` — מחוק,
   * ויצא משיווק — כדי שהתשובה לנכס יחיד לא תיכתב בנפרד מהתשובה
   * לרשימה.
   */
  private async isMatchable(
    tx: TenantTx,
    tenantId: string,
    propertyId: string,
  ): Promise<boolean> {
    const row = await tx.property.findFirst({
      where: matchablePropertyOf(tenantId, [propertyId]),
      select: { id: true },
    });
    return row !== null;
  }


  async listForProperty(
    propertyId: string,
    limit: number = MATCH_LIST_LIMIT,
  ): Promise<
    (MatchDto & {
      buyerName: string | null;
      buyerMaturity: string | null;
      buyerFacts: BuyerFacts | null;
    })[]
  > {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      /*
        ‏נכס שיצא משיווק אינו מציג „קונים מוצעים”: הרשימה הזו היא
        הזמנה לפעולה — להתקשר, להציע, לקבוע סיור — ונכס שנמכר אינו
        מזמין אף אחת מהן.
      */
      if (!(await this.isMatchable(tx, tenantId, propertyId))) return [];
      const rows = await tx.match.findMany({
        where: openMatchesOf(tenantId, { propertyId }),
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
        /*
         * ‎**עובדות הקונה — רק למי שרשאי לראות אותו.**
         *
         * אותו גדר בדיוק של השם: `visibleBuyers` כבר מסונן ב-
         * ‎`ownershipFilter`, ולכן תקציב ודרישות של קונה של סוכן אחר
         * אינם יוצאים מכאן. השורה שלו תמשיך לומר „קונה של סוכן אחר”
         * — עכשיו גם בלי המספרים שלו.
         */
        select: {
          id: true,
          contactId: true,
          budgetMaxAgorot: true,
          roomsMin: true,
          roomsMax: true,
          cities: true,
          createdAt: true,
        },
      });
      const maturityById = new Map(buyers.map((b) => [b.id, b.maturity]));
      const contactsById = await this.contacts.getByIds(
        tx,
        visibleBuyers.map((b) => b.contactId),
      );
      const nameById = new Map<string, string>();
      const factsById = new Map<string, BuyerFacts>();
      for (const buyer of visibleBuyers) {
        const name = contactsById.get(buyer.contactId)?.name;
        if (name !== undefined) nameById.set(buyer.id, name);
        factsById.set(buyer.id, {
          // ‏`BigInt` אינו עובר ב-JSON; אגורות נכנסות בשלמות ל-`number`
          budgetMaxAgorot:
            buyer.budgetMaxAgorot === null ? null : Number(buyer.budgetMaxAgorot),
          roomsMin: buyer.roomsMin === null ? null : Number(buyer.roomsMin),
          roomsMax: buyer.roomsMax === null ? null : Number(buyer.roomsMax),
          cities: buyer.cities,
          searchingSince: buyer.createdAt.toISOString(),
        });
      }

      return rows
        .filter((row) => maturityById.has(row.buyerId))
        .slice(0, limit)
        .map((row) => ({
          ...toMatchDto(row),
          buyerName: nameById.get(row.buyerId) ?? null,
          buyerMaturity: maturityById.get(row.buyerId) ?? null,
          buyerFacts: factsById.get(row.buyerId) ?? null,
        }));
    });
  }

  /**
   * ‎**שידוך שותפים לנכס בטאבו משותף.**
   *
   * ‏שתי הרשימות — ההתאמות הרגילות והשותפויות — הן שתי שאלות
   * ‏שונות על אותו נכס, ולכן גם שתי מדיניות ראייה שונות:
   *
   * ‏ברשימת ההתאמות קונה שאיני רשאי לראות **נשאר בשורה** בלי שם
   * ‏(„קונה של סוכן אחר”): המנהל צריך לדעת שיש עוד ביקוש, והמספר
   * ‏עצמו אינו מזהה איש.
   *
   * ‏בשותפויות זה בלתי אפשרי. ההצעה כאן היא **„חבר בין שני האנשים
   * ‏האלה”**, ואי אפשר לחבר בין אנשים בעילום שם; שורה כזו הייתה גם
   * ‏מספרת לסוכן שלקוח של עמיתו מחפש בדיוק את מה שהוא מחפש, בטווח
   * ‏מחירים ובעיר — כלומר בדיוק הדליפה הפנים-משרדית שהופרדה כאן.
   * ‏לכן הסינון לפי בעלות נעשה **בשאילתה**: מי שאיני רשאי לראות
   * ‏אינו נכנס לשידוך בכלל, לא כשורה ולא כמועמד.
   *
   * ‏מנהל עם `buyers.view_all` מקבל את כל המשרד, וזה בדיוק תפקידו:
   * ‏הוא היחיד שיכול לראות שני לקוחות של שני סוכנים שונים ולהציע
   * ‏להם עסקה משותפת.
   */
  async partnersForProperty(
    propertyId: string,
    limit: number = PARTNER_PAIR_LIMIT,
  ): Promise<PartnerPairDto[]> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
      });
      if (property === null) return [];
      /*
       * ‎**הגבול כאן הוא על האנשים ולא על הנכס** — ובכוונה.
       *
       * ‏רשימת הנכסים היא משרדית: כל סוכן רואה את כל הכתובות, וזו
       * ‏החלטה קיימת. מה שאינו משרדי הם ה**לקוחות**, ולכן הסינון
       * ‏היחיד שיש כאן הוא `ownershipFilter` על הקונים למטה. שער
       * ‏נוסף על הנכס היה חוסם סוכן מלראות שידוך על נכס שהוא כן
       * ‏רשאי לראות, ולא היה מונע שום דליפה שהסינון ההוא אינו מונע.
       */
      /* ‏נכס שיצא משיווק אינו מזמין פעולה, וזו רשימת פעולות */
      if (!(await this.isMatchable(tx, tenantId, propertyId))) return [];

      const fields = rowToFields(property);
      const price = fields.priceAgorot;
      if (fields.sharedTabu !== true || fields.dealType !== "sale" || price === undefined) {
        return [];
      }
      /*
       * ‎**שער הכניסה למודול הקונים — במפורש** (ביקורת Codex, P1).
       *
       * ‏`ownershipFilter` הוא **צמצום** ולא שער: בלי `view_all` הוא
       * ‏מחזיר `{ ownerUserId: <אני> }`, שנראה בטוח — אבל מי שהמודול
       * ‏חסום אצלו לגמרי עדיין מקבל את הקונים **שלו**, על שם, תקציב
       * ‏וציון. הקובץ `common/ownership.ts` מזהיר על כך במפורש:
       * ‏„`view_own` הוא הסף”. הנתיב דורש `matches.view` בלבד, ולכן
       * ‏הסף חייב להיאמר כאן.
       *
       * ‏זריקה ולא רשימה ריקה: „אין שותפויות” על מודול חסום הוא
       * ‏בדיוק השקר שמזמין את המתווך לחפש למה אין — והמסך שמעליו
       * ‏מסתיר את המקטע כשאין הרשאה, כך שהזריקה נשארת לקוראים
       * ‏ישירים של ה-API.
       */
      const capabilities = TenantContext.current().capabilities;
      if (!capabilities.has("buyers.view_own") && !capabilities.has("buyers.view_all")) {
        throw new ForbiddenException("שידוך שותפים — מודול הקונים חסום עבורך, פנו למנהל המשרד");
      }

      /*
       * ‏הסינון הגס נגזר **מאותה רצועה** שהמנוע משתמש בה, ולכן הוא
       * ‏רחב בדיוק כמוהו: „אינו מגיע לבד” פירושו `budget < price − band`,
       * ‏שהוא בדיוק השלילה של `price <= budget + band`. שני ליטרלים
       * ‏היו נפרדים ביום שהרצועה משתנה.
       */
      const band = budgetBandAgorot(price, "sale");

      /*
       * ‎**זרות משתי הרשימות דורשת גם את השורות השמורות** (ביקורת Codex, P1).
       *
       * ‏„אינו מגיע לבד” מחושב מהתקציב **הנוכחי**, אבל התאמה שכבר
       * ‏הוצעה אינה נמחקת: `upsertMatch` מוחק `suggested` בלבד, כדי
       * ‏לא לאבד עבודה של הסוכן. קונה שהתקציב שלו ירד — או נכס
       * ‏שהמחיר שלו עלה — נשאר עם שורת `offered` חיה, וגם היה נכנס
       * ‏לשידוך. אותו אדם, שתי המלצות סותרות על אותו מסך.
       *
       * ‏השורה השמורה גוברת: היא מייצגת פעולה שהסוכן כבר עשה.
       */
      const durable = await tx.match.findMany({
        where: { tenantId, propertyId, status: { notIn: ["suggested", "dismissed"] } },
        select: { buyerId: true },
      });

      /*
       * ‎**הסינון הגס לפני התקרה, ולא אחריה** (ביקורת Codex, P2).
       *
       * ‏התקרה חתכה לפי תקציב בלבד, ולכן שישים קונים עשירים מעיר
       * ‏אחרת יכלו למלא אותה, ליפול כולם ב-`partnerPairs`, ולהסתיר
       * ‏צמד תקין של קונים זולים יותר — „אין שותפויות” על משרד שיש
       * ‏לו. התנאי כאן הוא **אותו** סינון גס שהמנוע משתמש בו בכיוון
       * ‏השני (`recomputeForProperty`), ולכן הוא רחב לפחות כמוהו:
       * ‏רשימת ערים ריקה היא „בלי מגבלת אזור”, ומי שסימן אזורים על
       * ‏המפה נכנס תמיד — הרדיוס שלו עשוי לכלול את הנכס גם כשהעיר
       * ‏שונה, וההכרעה המדויקת נעשית במנוע.
       */
      const cityVariants =
        property.city === null ? null : locationNameVariants(property.city);

      const rows = await tx.buyer.findMany({
        where: {
          tenantId,
          deletedAt: null,
          dealType: "sale",
          sharedTabuStance: "accepts",
          budgetMaxAgorot: { lt: BigInt(price - band) },
          ...(durable.length === 0
            ? {}
            : { id: { notIn: durable.map((row) => row.buyerId) } }),
          ...(cityVariants === null
            ? {}
            : {
                OR: [
                  { cities: { hasSome: cityVariants } },
                  { cities: { isEmpty: true } },
                  { hasSearchAreas: true },
                ],
              }),
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        /*
         * ‏התקציב הגבוה ראשון: החיתוך הוא לפי סדר הקלט, ומי שקרוב
         * ‏יותר למחיר משלים צמד עם יותר שותפים אפשריים.
         */
        orderBy: [{ budgetMaxAgorot: "desc" }, { id: "asc" }],
        /*
         * ‎**סריקה, לא תקרה** (ביקורת Codex, P2, סבב שני).
         *
         * ‏כאן היה `PARTNER_CANDIDATE_MAX`, כלומר התקרה נלקחה על
         * ‏שורות שאיש לא בדק. הסינון הגס למעלה מכסה עמדה, תקציב,
         * ‏סוג עסקה ועיר — אבל לא סוג נכס, לא חדרים ולא תכונות, ולכן
         * ‏שישים קונים בעיר הנכונה שמחפשים בית פרטי עדיין יכלו למלא
         * ‏אותה ולהסתיר צמד תקין. התקרה על **המועמדים שהתקבלו**
         * ‏נאכפת ממילא בתוך `partnerPairs`. ראו `PARTNER_CANDIDATE_SCAN`.
         */
        take: PARTNER_CANDIDATE_SCAN,
        select: { id: true, contactId: true, requirements: true },
      });

      const candidates: PartnerCandidate[] = [];
      const contactIdByBuyer = new Map<string, string>();
      for (const row of rows) {
        /*
         * ‏כרטיס שה-JSON שלו פגום מדולג ואינו מפיל את הרשימה. אותו
         * ‏לקח כמו בשלב משפך פגום: תצורה שבורה בשורה אחת אינה
         * ‏אמורה למחוק תשובה לכל השאר.
         */
        const parsed = BuyerRequirementsSchema.safeParse(row.requirements);
        if (!parsed.success) continue;
        /* ‏מפתח הזהות הוא איש הקשר — שני כרטיסים שלו אינם שני אנשים */
        candidates.push({
          buyerId: row.id,
          requirements: parsed.data,
          partnerKey: row.contactId,
        });
        contactIdByBuyer.set(row.id, row.contactId);
      }

      const pairs = partnerPairs(fields, candidates, { limit });
      if (pairs.length === 0) return [];

      const contactsById = await this.contacts.getByIds(tx, [...contactIdByBuyer.values()]);
      const nameByBuyer = new Map<string, string>();
      for (const [buyerId, contactId] of contactIdByBuyer) {
        const name = contactsById.get(contactId)?.name;
        if (name !== undefined) nameByBuyer.set(buyerId, name);
      }

      return pairs
        /*
         * ‏צמד שאחד מחבריו איבד את שמו (מחיקת לקוח לפי בקשתו) אינו
         * ‏מוצג: „חבר בין X לבין ” אינו הצעה.
         */
        .filter((pair) => pair.partners.every((p) => nameByBuyer.has(p.buyerId)))
        .map((pair) => ({
          score: pair.score,
          explanation: pair.explanation,
          combinedBudgetAgorot: pair.combinedBudgetAgorot,
          headroomAgorot: pair.headroomAgorot,
          partners: pair.partners.map((p) => ({
            buyerId: p.buyerId,
            buyerName: nameByBuyer.get(p.buyerId)!,
            budgetMaxAgorot: p.budgetMaxAgorot,
            shareAgorot: p.shareAgorot,
            score: p.score,
          })),
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
      const rows = await this.matchableRows(
        tx,
        tenantId,
        Prisma.sql`AND m.buyer_id = ${buyerId}`,
        limit,
      );

      // שם הנכס לכל התאמה — לכרטיס הקונה (קובץ העיצוב); שאילתה אחת לעמוד
      const properties = await tx.property.findMany({
        // נכס מחוק או שיצא משיווק אינו התאמה — ראו `matchablePropertyOf`
        where: matchablePropertyOf(tenantId, rows.map((r) => r.propertyId)),
        select: {
          id: true, street: true, neighborhood: true, city: true,
          marketingTitle: true, priceAgorot: true,
        },
      });
      const propertyById = new Map(properties.map((p) => [p.id, p]));

      /* ‏ה-SQL כבר סינן והגביל; הדילוג הוא אותו דילוג של `listAll` */
      return rows.flatMap((row) => {
        const property = propertyById.get(row.propertyId);
        if (property === undefined) return [];
        return [
          {
            ...toMatchDto(row),
            property: {
              address: [property.street, property.neighborhood, property.city]
                .filter(Boolean)
                .join(", "),
              title: property.marketingTitle ?? undefined,
              priceAgorot:
                property.priceAgorot === null ? undefined : Number(property.priceAgorot),
            },
          },
        ];
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
  breakdown: unknown;
  status: string;
  computedAt: Date;
}): MatchDto {
  return {
    id: row.id,
    propertyId: row.propertyId,
    buyerId: row.buyerId,
    score: row.score,
    explanation: row.explanation,
    breakdown: parseBreakdown(row.breakdown),
    status: row.status,
    computedAt: row.computedAt,
  };
}

/**
 * ‎`breakdown` יושב ב-JSON, כלומר הוא קלט ולא טיפוס.
 *
 * שורות שנכתבו לפני שהקריטריון הנוכחי היה קיים, או בגרסה שבה שדה
 * נקרא אחרת, יחזרו מכאן כאובייקטים שאינם תואמים. `as` היה מעביר
 * אותם למסך ומפיל אותו שם; הסכמה מסננת כל רכיב בנפרד, כך ששורה
 * אחת פגומה אינה מוחקת את הפירוט כולו.
 *
 * ## ‎**הערה ארוכה מדי מקצצים, לא זורקים**
 *
 * המנוע ייצר הערות ארוכות מ-`SCORE_NOTE_MAX` (רשימת מאפיינים
 * משורשרת, בלי גבול על מספר הדרישות של הקונה), והכתיבה שמרה אותן
 * בלי אימות. סינון הרכיב כולו על סמך אורך ההערה היה מוחק מהמסך
 * קריטריון ש**נבדק, נכשל, ואף פסל את ההתאמה** — ורצועת ההסבר
 * הייתה מציגה אותו כאילו לא נבדק כלל (ביקורת Codex).
 *
 * זו ההבחנה שהרצועה כולה קיימת בשבילה, שנשברה בשלב הקריאה. הציון
 * והמשקל תקינים; רק הטקסט ארוך. מקצצים את הטקסט ושומרים את העובדה.
 *
 * המנוע כבר אינו מייצר הערות כאלה — הקיצוץ כאן הוא בשביל שורות
 * שנכתבו לפני כן ועדיין יושבות במסד.
 *
 * מה שלא נותר אחרי כל זה הוא **חסר**, לא שגוי.
 */
function parseBreakdown(raw: unknown): ScoreComponent[] {
  if (!Array.isArray(raw)) return [];
  const out: ScoreComponent[] = [];
  for (const item of raw) {
    const parsed = ScoreComponentSchema.safeParse(trimNote(item));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** קיצוץ הערה שנשמרה לפני שהמנוע הכיר את התקרה. */
function trimNote(item: unknown): unknown {
  if (typeof item !== "object" || item === null) return item;
  const note = (item as { note?: unknown }).note;
  if (typeof note !== "string" || note.length <= SCORE_NOTE_MAX) return item;
  /* „…” במקום חיתוך חד, כדי שייקרא כקטוע ולא כמשפט שנגמר באמצע */
  return { ...item, note: `${note.slice(0, SCORE_NOTE_MAX - 1)}…` };
}
