import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  commissionSplitRejectionReason,
  coopOfferCost,
  leadSourceLabel,
  planCreditExpiry,
  referralBonusCredits,
  settleReferral,
  type PayoutMode,
  referralPriceRejectionReason,
  referralRatingAverage,
  referralCommentRejectionReason,
  dimensionRatingRejectionReason,
  declarationAccuracy,
  dimensionAccuracies,
  CLIENT_RATING_DIMENSIONS,
  referralReasonRejectionReason,
  presentationChips,
  type NetworkPresentationFields,
  scoreMatch,
  suggestedReferralPrice,
  type BuyerRequirements,
  type LeadSourcePrice,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { lockContact } from "../../common/locks";
import { assertBuyerAccess, assertLeadAccess, ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { EmailService } from "../../core/email.service";
import { CreditEconomyService } from "../../core/credit-economy.service";
import { OutboxService } from "../../core/outbox.service";
import { LeadPricingService } from "../../core/lead-pricing.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { ExclusivityService } from "../exclusivity/exclusivity.service";
import { assertNetworkQuota } from "./network-quota";
import { officeBadges, type OfficeBadge } from "./office-names";
import {
  networkPrice,
  networkRooms,
  networkTerms,
  officeIdsMatching,
  type NetworkFilter,
} from "./network-filter";
import { readCustomFeatures, rowToFields } from "../properties/property.mapper";

/**
 * תפוגת הקרדיטים כפי שהמשרד רואה אותה.
 *
 * `months: 0` = התפוגה כבויה בפלטפורמה, ואין מה להציג. שדות המנה
 * הקרובה חסרים כשאין מנה חיה שפגה — משרד שכל יתרתו נרכשה בכסף
 * לעולם לא יראה תאריך, וזה נכון.
 */
export interface CreditExpiryInfo {
  months: number;
  nextAmount?: number;
  /** ISO. התצוגה בעברית נעשית במסך, כמו בכל תאריך במערכת. */
  nextAt?: string;
}

/** שורת נכס כפי ש-Prisma מחזירה — הטיפוס נגזר ולא מועתק ידנית. */
type PropertyRow = Parameters<typeof rowToFields>[0];

/** עיגול תקציב כלפי מעלה ל-100 אלף ₪ — אנונימיזציה (docs/04 §7) */
const BUDGET_ROUND_AGOROT = 10_000_000;

/**
 * ‎JSONB → ‎`Record<string, number>`‎ בלי לסמוך על מה שבמסד.
 *
 * הצורה נאכפת בכתיבה (`dimensionRatingRejectionReason`), וכאן די
 * בהגנה מפני שורה ישנה או פגומה: נפילה לאובייקט ריק ולא קריסה של
 * כל הלוח בגלל הצהרה אחת. גם הערכים מסוננים — מפתח עם מחרוזת היה
 * מגיע לחישוב הדיוק כ-NaN ומרעיל ממוצע שלם.
 */
function narrowScores(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

/**
 * הסף שמעליו התאמה ברשת שווה הצגה.
 *
 * זהה לסף בפיד הביקושים בכוונה: "התאמה ברשת" חייבת להיות אותו דבר
 * בכל מסך, אחרת אותו נכס נראה מתאים בכרטיס ולא מתאים ברשימה.
 */
const NETWORK_MATCH_MIN_SCORE = 70;

/** ביקוש ברשת שהנכס הנוכחי עונה עליו — העמודה השנייה בכרטיס הנכס. */
export interface NetworkDemandMatchDto {
  demandId: string;
  score: number;
  explanation: string;
  cities: string[];
  neighborhoods: string[];
  notes?: string;
  /*
   * אותו פרופיל מלא כמו בפיד הרשת. העמודה הזו הציגה עיר, שכונות
   * ותקציב בלבד — כלומר הסוכן שראה "82%" בכרטיס הנכס לא ידע על מה
   * הציון נבנה, ולא יכול היה להחליט אם להציע בלי לעבור למסך אחר.
   */
  dealType: string;
  propertyTypes: string[];
  areaSqmMin?: number;
  budgetMinAgorot?: number;
  /** חסר = הקונה טרם מסר תקציב. הלוח מציג "תקציב לא צוין". */
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  entryType?: string;
  entryBy?: Date;
  financing?: string;
  maturity?: string;
  mustFeatures: string[];
  niceFeatures: string[];
  commissionSplit: number;
  /** מה תעלה ההצעה; 0 = חינם. מוחזר מהשרת ולא מנוחש במסך. */
  creditsCost: number;
  source: string;
  /** כבר הצעתי את הנכס הזה על הביקוש הזה — אין להציע ולחייב פעמיים. */
  alreadyOffered: boolean;
}

/** נכס שמשרד אחר הציע על הקונה הזה — העמודה השנייה בכרטיס הקונה. */
export interface NetworkPropertyOfferDto {
  id: string;
  presentation: Record<string, unknown>;
  commissionSplit: number;
  status: string;
  createdAt: Date;
}

/** נכס שלי שמתאים לביקוש ברשת — כדי שלא צריך לנחש מתוך רשימה. */
export interface DemandMatchDto {
  propertyId: string;
  title: string;
  score: number;
  explanation: string;
  /**
   * הנכס הזה כבר הוצע לביקוש הזה.
   *
   * בלי הסימון הזה ההתאמה נשארת בפיד עם כפתור פעיל אחרי השליחה,
   * הלחיצה השנייה מפרה את `@@unique([demandId, propertyId])`, והמתווך
   * מקבל 500 על פעולה שפשוט כבר בוצעה.
   */
  offered?: boolean;
}


/**
 * קריאת אזורי החיפוש מעמודת ה-JSON.
 *
 * הגנתי בכוונה: העמודה היא `Json`, ומה שיושב בה נכתב בגרסה קודמת
 * של הקוד או הגיע מייבוא. שורה פגומה אחת אינה מפילה את הפיד כולו
 * — היא פשוט אינה מוצגת, וזו ההתנהגות הנכונה למודעה שממילא
 * מתארת אזור ולא מתחייבת עליו.
 */
function readSearchAreas(
  raw: unknown,
): { lat: number; lon: number; radiusKm: number; label?: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { lat: number; lon: number; radiusKm: number; label?: string }[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const area = item as Record<string, unknown>;
    const { lat, lon, radiusKm, label } = area;
    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      typeof radiusKm !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(radiusKm)
    ) {
      continue;
    }
    out.push({ lat, lon, radiusKm, ...(typeof label === "string" ? { label } : {}) });
  }
  return out;
}

export interface SharedDemandDto {
  id: string;
  /**
   * האם המשתמש הזה רשאי לשנות את התנאים או להפסיק את השיתוף.
   *
   * הבעלות על תנאי הביקוש היא הבעלות על הקונה. השדה קיים כדי
   * שהמסך לא יזמין את הסוכן לפעולה שהשרת ידחה.
   */
  canManage?: boolean;
  cities: string[];
  /** שכונות מבוקשות — מדרישות הקונה; מדויק יותר מעיר, עדיין אנונימי */
  neighborhoods: string[];
  /**
   * אזורי החיפוש שסומנו על המפה — נקודה, רדיוס ותווית.
   *
   * מתאר איפה הלקוח מחפש לקנות, לא איפה הוא גר. בלעדיו קונה
   * שסימן אזור ולא הקליד עיר התפרסם בלי שום אזור, והצד השני לא
   * ידע לאן להציע.
   */
  searchAreas: { lat: number; lon: number; radiusKm: number; label?: string }[];
  /** תיאור חופשי שהמשרד המשתף כתב — "מה הקונה מחפש" במילים */
  notes?: string;
  dealType: string;
  /**
   * כל מה שאינו מזהה אדם.
   *
   * הפיד הציג עד כה ערים, חדרים, תקציב ומאפייני חובה בלבד — מספיק
   * כדי לדעת שהביקוש קיים, לא מספיק כדי להחליט אם להציע. השדות
   * האלה הם מה שכבר היה מותר לשתף ופשוט לא נשמר.
   */
  propertyTypes: string[];
  areaSqmMin?: number;
  /** מעוגל כלפי מטה ל-100 אלף ₪ — טווח, לא סכום מדויק. */
  budgetMinAgorot?: number;
  /** חסר = הקונה טרם מסר תקציב. הלוח מציג "תקציב לא צוין". */
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  entryType?: string;
  entryBy?: Date;
  financing?: string;
  maturity?: string;
  mustFeatures: string[];
  niceFeatures: string[];
  source: string;
  /**
   * שם המקור לתצוגה, לפי קטלוג התמחור של המשרד.
   *
   * המסך הציג ‎"Kanko"‎ מתוך השוואה מפורשת ל-`source === "kanko"`,
   * ולכן מקור חדש שהפלטפורמה תמחרה לא הופיע בכלל: הביקוש נראה
   * כאילו הגיע מהרשת בחינם, ורק החיוב סיפר אחרת.
   */
  sourceLabel: string;
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
  /**
   * המשרד שפרסם את הביקוש.
   *
   * חסר לביקוש ממקור חיצוני (Kanko) — הוא אינו משרד תיווך, והמסך
   * מסמן אותו בתג המקור שלו במקום בשם משרד.
   */
  officeName?: string;
  /** לוגו המשרד המפרסם — כתובת חתומה קצרת-חיים, כשיש. */
  officeLogoUrl?: string;
  originBuyerId?: string;
  createdAt: Date;
  /** הנכסים שלי שמתאימים — מחושב במנוע ההתאמות, לא ניחוש */
  myMatches?: DemandMatchDto[];
}

export interface CoopOfferDto {
  id: string;
  demandId: string;
  /**
   * הקונה שההצעה נענית לו — **רק בהצעות נכנסות**.
   *
   * בלי זה ההצעה הייתה "נכס יפה בבני ברק" בלי לומר על מי היא: משרד
   * ששיתף חמישה ביקושים קיבל חמש הצעות שנראות זהות, ולא ידע לאיזה
   * לקוח להתקשר. בהצעה יוצאת השדה נשאר ריק — זהות הקונה של המשרד
   * השני אינה שלנו לדעת ולא שלנו להציג.
   */
  buyerId?: string;
  buyerName?: string;
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

/**
 * אישור המשרד הקולט על הצהרת המפנה — מוחזר לשני הצדדים בלבד.
 *
 * ‎`accuracy`‎ הוא **דיוק ההצהרה** ולא איכות הלקוח: הפער בין מה
 * שהמפנה הצהיר למה שהקולט מצא. `null` כשההפניה פורסמה בלי הצהרה
 * ואין ממה לגזור פער — וזה אינו אפס.
 */
export interface ReferralConfirmationDto {
  accuracy: number | null;
  /** מה שהקולט מצא בכל ממד — לצד ההצהרה, ממד מול ממד. */
  scores: Record<string, number>;
  comment?: string;
  createdAt: Date;
}

/** תפקיד הצופה מול ההפניה — קובע מה מוצג ומה מותר. */
export type ReferralRole = "referrer" | "receiver" | "viewer";

/** דיוק ההצהרות של משרד בממד אחד. */
export interface ReferralDimensionScore {
  /** מפתח מ-`CLIENT_RATING_DIMENSIONS`; התווית נגזרת ממנו במסך */
  key: string;
  average: number;
  /** כמה אישורים נגעו דווקא בממד הזה — לא בהכרח כמו הסך הכולל */
  count: number;
}

/**
 * מוניטין המשרד המפנה, מצרפי ומפורק.
 *
 * הפירוט אינו קישוט: ממוצע 3.5 יכול להיות משרד שמעריך גס בכל
 * הממדים, ויכול להיות משרד שמדייק לחלוטין ברצינות ובזמינות ומנפח
 * בשיטתיות את התקציב. למי שעומד לשלם עמלת הפניה — התמורה משולמת
 * גם אם לא ייסגר דבר — זו אינה אותה עסקה.
 *
 * `dimensions` יכול להיות ריק גם כשיש ממוצע: הפירוט נצבר רק
 * מאישורים שנכתבו אחרי שהטבלה נוצרה, ואין מילוי לאחור.
 */
export interface ReferralReputationView {
  average: number;
  count: number;
  dimensions: ReferralDimensionScore[];
}

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
  /** credits | cash — מה המשרד המפנה בחר לקבל */
  payoutMode: PayoutMode;
  /** מה שנכנס ליתרת הקרדיטים של המשרד המפנה, כולל הבונוס */
  payoutCredits: number;
  /** מה שנכנס ליתרה הכספית שלו, באגורות. 0 במסלול הקרדיטים. */
  payoutAgorot: number;
  status: string;
  /** true אם ההפניה שלי — נשמר לצד `role` כי כרטיס הליד נשען עליו */
  mine: boolean;
  role: ReferralRole;
  /** קישור לליד המקורי — רק למשרד המפנה */
  originLeadId?: string;
  /** הצהרת המפנה על איכות הלקוח — **מוצגת לפני התשלום.** */
  clientScores: Record<string, number>;
  /**
   * מוניטין המשרד המפנה: דיוק ההצהרות שאישרו משרדים שקלטו ממנו.
   * מוחזר עם כל שורה בלוח — התמורה משולמת גם כשלא נסגר דבר, ולכן זה
   * המידע שקובע אם כדאי לשלם אותה.
   */
  referrerRating?: ReferralReputationView;
  /**
   * האישור של המשרד הקולט — נראה לשני הצדדים בלבד.
   *
   * שדה אחד ולא "שלי" ו"של הצד השני": יש אישור אחד לכל הפניה, והוא
   * תמיד של הקולט. שני השדות הקודמים תיארו דירוג הדדי שכבר אינו
   * קיים, ולאחד מהם לא היה כותב לעולם.
   */
  confirmation?: ReferralConfirmationDto;
  createdAt: Date;
}

/** תנאי ההפניה שהטופס נפתח בהם — הצעת מחיר ושיעור העמלה. */
export interface ReferralTermsDto {
  suggestedPriceCredits: number;
  platformFeePercent: number;
  /**
   * הכלכלה עצמה, כדי שהמסך יוכל להציג תצוגה מקדימה של **שני**
   * המסלולים בזמן אמת.
   *
   * המספרים נשלחים מהשרת ולא נצרבים במסך: הם משתנים בלי פריסה, ומסך
   * שמחשב לפי ברירת המחדל שבקוד היה מבטיח למפנה סכום אחד ומזכה
   * אותו באחר.
   */
  economy: {
    creditBonusPercent: number;
    feeCreditsPercent: number;
    feeCashPercent: number;
    unitPriceAgorot: number;
  };
}

@Injectable()
export class CollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly plans: PlanCatalogService,
    private readonly pricing: LeadPricingService,
    private readonly crypto: CryptoService,
    private readonly creditEconomy: CreditEconomyService,
    // הצעת נכס למשרד אחר נספרת לעבר פריט (6) בפעולות השיווק
    private readonly exclusivity: ExclusivityService,
    private readonly email: EmailService,
    // חתימת לוגו המשרד המפרסם לפיד הרשת — ראו `officeBadges`
    private readonly storage: StorageService,
  ) {}

  private readonly logger = new Logger(CollaborationService.name);

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

      /*
       * בלי אזור חיפוש אין מה לפרסם.
       *
       * האזור הוא הקריטריון הפוסל הראשון במנוע ההתאמות: ביקוש בלי
       * אזור מתאים לכל נכס בארץ, ולכן הוא מציף את הפיד של כולם
       * בהתאמות חסרות משמעות — ומייצר בדיוק את חוסר האמון שהורג
       * רשת שיתופים.
       *
       * החסימה כאן ולא רק במסך: הנתיב פתוח גם לקריאות שאינן מגיעות
       * מהטופס, ותנאי שקיים רק בדפדפן אינו תנאי.
       */
      const shareable = BuyerRequirementsSchema.parse(buyer.requirements);
      if (shareable.cities.length === 0 && (shareable.searchAreas ?? []).length === 0) {
        throw new BadRequestException(
          "לא ניתן לפרסם קונה בלי אזור חיפוש — הוסיפו ערים או אזור על המפה בעריכת הדרישות, ואז פרסמו",
        );
      }

      const existing = await tx.sharedDemand.findFirst({
        where: { tenantId, originBuyerId: buyerId, status: "active" },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("הקונה כבר משותף ברשת");

      /*
       * אחרי בדיקת הכפילות ולא לפניה — שיתוף חוזר של קונה שכבר
       * משותף אינו צורך מקום ברשת, ומגיעה לו ההודעה המדויקת.
       */
      await assertNetworkQuota(
        tx,
        tenantId,
        await this.plans.forTenant(tenantId, tx),
        "demand",
      );

      await tx.sharedDemand.create({
        data: {
          id,
          commissionSplit,
          tenantId,
          originBuyerId: buyerId,
          // התיאור החופשי של המשתף: "מה הקונה מחפש" במילים שלו
          notes: note?.trim() || null,
          ...this.demandSnapshot(buyer),
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
   * הקונה → הצילום שהרשת רואה. **הגבול נמצא כאן.**
   *
   * מקום אחד לשיתוף ולרענון כאחד: שתי גרסאות של אותה המרה היו
   * נפרדות ביום שמישהו מוסיף שדה, וזו בדיוק הטעות שדולפת מידע.
   * שם, טלפון, אימייל, כתובת והערות פנימיות אינם ברשימה ולכן אינם
   * נשמרים — לא "מוסתרים במסך" אלא לא קיימים בטבלה.
   *
   * העיגול פועל לשני הכיוונים: המקסימום כלפי מעלה והמינימום כלפי
   * מטה. כך האנונימיזציה תמיד **מרחיבה** את הטווח — עיגול שמצמצם
   * היה פוסל הצעה תקינה מסיבה טכנית, כלומר עסקה שאבדה.
   */
  private demandSnapshot(buyer: {
    dealType: string;
    budgetMinAgorot: bigint | null;
    budgetMaxAgorot: bigint | null;
    roomsMin: Prisma.Decimal | null;
    roomsMax: Prisma.Decimal | null;
    financing: string;
    maturity: string;
    requirements: unknown;
    /*
     * טיפוס היצירה ולא טיפוס העדכון: שדות סקלריים מתקבלים בשניהם,
     * בעוד `UpdateInput` מתיר גם `{ set: ... }` ולכן אינו מתאים
     * ל-`create`. כך אותה פונקציה משרתת את שני המסלולים.
     */
  }): Omit<
    Prisma.SharedDemandUncheckedCreateInput,
    | "id"
    | "tenantId"
    | "originBuyerId"
    | "commissionSplit"
    | "notes"
    | "source"
    | "externalId"
  > {
    const requirements = BuyerRequirementsSchema.parse(buyer.requirements);
    const featureLevels = Object.entries(requirements.features);
    return {
      cities: requirements.cities,
      // שכונות מדרישות הקונה — מדויק יותר מעיר, עדיין בלי PII
      neighborhoods: requirements.neighborhoods,
      /*
       * אזורי המפה עוברים לרשת יחד עם הערים.
       *
       * בלעדיהם קונה שסימן אזור ולא הקליד עיר התפרסם בלי שום אזור,
       * והצד השני לא ידע לאן להציע. הנקודה מתארת איפה הלקוח מחפש
       * לקנות — לא איפה הוא גר — ולכן אינה מרחיבה את החשיפה.
       */
      searchAreas: (requirements.searchAreas ?? []) as unknown as Prisma.InputJsonValue,
      dealType: buyer.dealType,
      /*
       * מצב המימון והבשלות הם מה שאומר לצד השני אם שווה להשקיע נכס
       * ולחכות לתשובה — בלעדיהם ההצעות נשלחות באוויר משני הכיוונים.
       */
      propertyTypes: requirements.propertyTypes,
      areaSqmMin: requirements.areaSqmMin ?? null,
      budgetMinAgorot:
        buyer.budgetMinAgorot === null
          ? null
          : BigInt(
              Math.floor(Number(buyer.budgetMinAgorot) / BUDGET_ROUND_AGOROT) *
                BUDGET_ROUND_AGOROT,
            ),
      /*
       * קונה בלי תקציב מתפרסם בלי תקציב, ולא כ-0.
       *
       * `Number(null)` הוא 0, ולכן העיגול היה מייצר מודעה שאומרת
       * "עד 0 ₪" — כלומר קונה שאינו יכול לשלם דבר. זו לא הצהרה
       * חסרה אלא הצהרה שגויה, והיא הגרועה מבין השתיים: מודעה
       * בלי תקציב עדיין שווה הצעה, ומודעה על אפס נראית כמו טעות.
       */
      budgetMaxAgorot:
        buyer.budgetMaxAgorot === null
          ? null
          : BigInt(
              Math.ceil(Number(buyer.budgetMaxAgorot) / BUDGET_ROUND_AGOROT) *
                BUDGET_ROUND_AGOROT,
            ),
      roomsMin: buyer.roomsMin,
      roomsMax: buyer.roomsMax,
      entryType: requirements.entryType ?? null,
      entryBy: requirements.entryBy ?? null,
      financing: buyer.financing,
      maturity: buyer.maturity,
      mustFeatures: featureLevels
        .filter(([, l]) => l === "must")
        .map(([f]) => f),
      niceFeatures: featureLevels
        .filter(([, l]) => l === "nice")
        .map(([f]) => f),
    };
  }

  /**
   * רענון הצילום אחרי עריכת הקונה.
   *
   * הביקוש ברשת הוא **צילום** של הקונה ברגע השיתוף, ולא הפניה חיה
   * אליו — כך הוא נשאר אנונימי גם אחרי שהקונה נמחק. אבל צילום שאינו
   * מתרענן מזדקן: קונה שהעלה תקציב, שקיבל אישור עקרוני או שהתקרר
   * מ"חם מאוד" ל"לא בשל" נשאר מוצג לרשת כפי שהיה. משרד אחר משקיע
   * נכס על מידע שכבר אינו נכון — וזו בדיוק ההצעה שנשלחת באוויר.
   *
   * שקט כשאין ביקוש פעיל: רוב הקונים אינם משותפים, ועריכה שלהם אינה
   * אמורה להיכשל בגלל מודול שאין לו מה לעשות.
   */
  async resyncDemandForBuyer(buyerId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const demand = await tx.sharedDemand.findFirst({
        where: { tenantId, originBuyerId: buyerId, status: "active" },
        select: { id: true },
      });
      if (!demand) return;
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, tenantId, deletedAt: null },
      });
      if (!buyer) return;
      await tx.sharedDemand.update({
        where: { id: demand.id },
        // התיאור החופשי וחלוקת העמלה **אינם** נדרסים: הם נכתבו
        // בשיתוף עצמו ואינם נגזרים מהקונה.
        data: this.demandSnapshot(buyer),
      });
    });
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
    const found = await this.prisma.withTenant(async (tx) => {
      const row = await tx.sharedDemand.findFirst({
        where: { tenantId, originBuyerId: buyerId, status: "active" },
        select: { id: true },
      });
      if (!row) return null;
      /*
       * הבעלות נבדקת כאן כדי שהמסך לא יציע כפתור שייכשל: אחרי
       * ש-`updateSharedDemand` אוכף בעלות, סוכן שרואה ביקוש של
       * קונה שאינו שלו היה לוחץ „עדכן” ומקבל 404.
       */
      const mayManage = await this.assertDemandTerms(tx, tenantId, buyerId).then(
        () => true,
        () => false,
      );
      return { id: row.id, mayManage };
    });
    if (!found) return null;
    return { ...(await this.getDemand(found.id)), canManage: found.mayManage };
  }

  /**
   * מי רשאי לקבוע את תנאי הרשת של קונה — **הבעלים או מנהל.**
   *
   * הבעלות על התנאים היא הבעלות על הקונה, ולכן `assertBuyerAccess`
   * הוא הבסיס. `collaboration.manage_all` נבדקת לפניו במפורש:
   * בצד הנכס היא כבר פותחת תנאים של עמית, ובלעדיה כאן אותה יכולת
   * הייתה עובדת על חצי מהרשת בלבד — מנהל שקיבל אותה בחריג הרשאות
   * בלי `buyers.view_all` היה נחסם דווקא בצד הקונה (ביקורת Codex).
   */
  private async assertDemandTerms(tx: TenantTx, tenantId: string, buyerId: string): Promise<void> {
    if (TenantContext.current().capabilities.has("collaboration.manage_all")) return;
    await assertBuyerAccess(tx, tenantId, buyerId);
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
      /*
       * הבעלות על התנאים היא הבעלות על הקונה.
       *
       * עד כה השליפה סוננה לפי `tenantId` בלבד, ולכן כל סוכן במשרד
       * יכול היה לשנות את חלוקת העמלה שעמית הבטיח למשרד אחר — על
       * ביקוש של קונה שאינו שלו, ובלי שיראה אותו בשום מסך. אצל
       * הקונה יש בעלים מפורש, ולכן זה בדיוק אותו שער שכבר חל על
       * עריכת דרישותיו (ביקורת המשתמש).
       */
      await this.assertDemandTerms(tx, tenantId, buyerId);
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

  /**
   * הפסקת שיתוף — **אותו שער בדיוק כמו שינוי התנאים.**
   *
   * זה היה החור: העדכון נסגר לבעלים, אבל המחיקה נשארה פתוחה לכל
   * מי שיש לו `collaboration.share` ומזהה ביקוש. כלומר המסך הציג
   * ‎`canManage: false`‎ והסתיר את הכפתור, ובקשת `DELETE` ישירה
   * עדיין סגרה את הביקוש של העמית (ביקורת Codex).
   *
   * מסך שמסתיר פעולה אינו אכיפה — הוא נוחות. האכיפה כאן.
   */
  async unshare(demandId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const demand = await tx.sharedDemand.findFirst({
        where: { id: demandId, tenantId, status: "active" },
        select: { originBuyerId: true },
      });
      if (!demand) throw new NotFoundException("ביקוש לא נמצא");
      /*
       * ביקוש בלי קונה מקורי (מקור חיצוני, למשל קנקו) אינו שייך
       * לאף סוכן, ולכן רק מנהל סוגר אותו.
       */
      if (demand.originBuyerId === null) {
        if (!TenantContext.current().capabilities.has("collaboration.manage_all")) {
          throw new ForbiddenException("רק מנהל יכול לסגור ביקוש שאינו של קונה במשרד");
        }
      } else {
        await this.assertDemandTerms(tx, tenantId, demand.originBuyerId);
      }

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

  /**
   * תנאי הסינון של פיד הביקושים.
   *
   * רץ בשרת ולפני חיתוך ה-100, ולכן "אין תוצאות" הוא תשובה על הרשת
   * כולה ולא על החלון האחרון שלה.
   *
   * הטקסט מתאים בשתי דרכים, ומספיקה אחת:
   *   1. כל המונחים נמצאים בתיאור החופשי (AND בין מונחים).
   *   2. שורת החיפוש **כולה** היא עיר או שכונה מבוקשת, או שם המשרד
   *      המפרסם.
   *
   * הפיצול אינו קוסמטי: `has` על מערך דורש התאמה לאיבר שלם, ו"רמת
   * גן" מתפרק ל"רמת" ו"גן" — שאף אחד מהם אינו שווה לאיבר "רמת גן".
   * זה בדיוק הכשל שתוקן פעם אחת בסינון הקונים, ואותו פתרון חוזר כאן.
   */
  private async demandFilterWhere(
    filter: NetworkFilter,
  ): Promise<Prisma.SharedDemandWhereInput> {
    const conditions: Prisma.SharedDemandWhereInput[] = [];
    const terms = networkTerms(filter);
    const price = networkPrice(filter);
    const rooms = networkRooms(filter);

    /*
     * לקונה יש **טווח** תקציב, ולכן הבדיקה היא חיתוך טווחים: מי
     * שמסנן 1–2 מיליון מחפש גם קונה שתקציבו 1.5–2.5, והוא בדיוק
     * הקונה שבגבול. מינימום חסר נחשב אינסופי כלפי מטה.
     */
    if (price.min !== undefined) {
      // ביקוש בלי תקציב אינו "אפס" — ראו את אותו הנימוק בקונים
      conditions.push({
        OR: [{ budgetMaxAgorot: { gte: price.min } }, { budgetMaxAgorot: null }],
      });
    }
    if (price.max !== undefined) {
      conditions.push({
        OR: [
          { budgetMinAgorot: { lte: price.max } },
          { budgetMinAgorot: null },
        ],
      });
    }
    if (rooms.min !== undefined) {
      conditions.push({
        OR: [{ roomsMax: { gte: rooms.min } }, { roomsMax: null }],
      });
    }
    if (rooms.max !== undefined) {
      conditions.push({
        OR: [{ roomsMin: { lte: rooms.max } }, { roomsMin: null }],
      });
    }

    if (terms.length > 0) {
      const whole = filter.q?.trim() ?? "";
      const offices = await officeIdsMatching(this.prisma, filter);
      conditions.push({
        OR: [
          {
            AND: terms.map((term) => ({
              notes: { contains: term, mode: "insensitive" as const },
            })),
          },
          { cities: { has: whole } },
          { neighborhoods: { has: whole } },
          ...(offices.length > 0 ? [{ tenantId: { in: offices } }] : []),
        ],
      });
    }

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  /** פיד הביקושים: הרשת כולה (כולל שלי, מסומנים). קריאת הרשת רצה כ-withNetwork. */
  async listDemands(filter: NetworkFilter = {}): Promise<SharedDemandDto[]> {
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
    const where = await this.demandFilterWhere(filter);
    const visible = await this.prisma.withNetworkRead((tx) =>
      tx.sharedDemand.findMany({
        where: { status: "active", ...where },
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

    /*
     * מה כבר הצעתי — שאילתה אחת לכל הפיד, כמו `alreadySent` בצד
     * הנכסים. המפתח הוא הצמד (ביקוש, נכס) ולא הביקוש לבדו: מותר
     * להציע לאותו ביקוש נכס שני, ואסור להציע פעמיים את אותו נכס.
     */
    const offered = await this.prisma.withTenant(async (tx) => {
      const rows = await tx.coopOffer.findMany({
        where: {
          fromTenantId: tenantId,
          demandId: { in: visible.map((row) => row.id) },
        },
        select: { demandId: true, propertyId: true },
      });
      return new Set(rows.map((row) => `${row.demandId}:${row.propertyId}`));
    });

    const [prices, offices] = await Promise.all([
      this.pricing.all(),
      officeBadges(
        this.prisma,
        this.storage,
        visible.map((row) => row.tenantId),
      ),
    ]);
    return visible.map((row) => {
      const dto = this.toDemandDto(
        row,
        tenantId,
        prices,
        offices.get(row.tenantId),
      );
      if (dto.mine) return dto;
      const matches = this.matchOwnProperties(myProperties, row).map((match) =>
        offered.has(`${row.id}:${match.propertyId}`)
          ? { ...match, offered: true }
          : match,
      );
      return matches.length > 0 ? { ...dto, myMatches: matches } : dto;
    });
  }

  /** שלוש ההתאמות הטובות ביותר מבין הנכסים שלי, מעל סף שווה-הצגה. */
  private matchOwnProperties(
    properties: PropertyRow[],
    demand: Parameters<CollaborationService["demandToRequirements"]>[0],
  ): DemandMatchDto[] {
    // השכונות משפיעות על הניקוד כמו בהתאמות הפנימיות — נכס באותה
    // עיר מחוץ לשכונות המבוקשות לא מקבל את מלוא נקודות המיקום
    const requirements = this.demandToRequirements(demand);

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
      .filter(
        ({ result }) =>
          !result.excluded && result.score >= NETWORK_MATCH_MIN_SCORE,
      )
      .sort((a, b) => b.result.score - a.result.score)
      .slice(0, 3)
      .map(({ property, result }) => ({
        propertyId: property.id,
        title:
          property.marketingTitle ??
          ([property.street, property.city].filter(Boolean).join(", ") ||
            "נכס"),
        score: result.score,
        explanation: result.explanation,
      }));
  }

  /**
   * דרישות הקונה כפי שהן משתקפות מביקוש ברשת.
   *
   * הביקוש הוא צל אנונימי של הקונה — עיר, תקציב, חדרים, חובות — ולכן
   * אפשר להזין אותו לאותו מנוע ניקוד בדיוק. אין כאן מנוע שני: ציון
   * "82%" על ביקוש ברשת נבנה מאותם קריטריונים כמו "82%" פנימי,
   * אחרת שתי העמודות בכרטיס היו מודדות בשני סרגלים שונים.
   */
  private demandToRequirements(demand: {
    cities: string[];
    neighborhoods: string[];
    dealType: string;
    propertyTypes: string[];
    areaSqmMin: number | null;
    budgetMinAgorot: bigint | null;
    budgetMaxAgorot: bigint | null;
    roomsMin: Prisma.Decimal | null;
    roomsMax: Prisma.Decimal | null;
    entryType: string | null;
    entryBy: Date | null;
    mustFeatures: string[];
    niceFeatures: string[];
    /* עמודת JSON — נקראת דרך `readSearchAreas` ולא כטיפוס קשיח */
    searchAreas: unknown;
  }): BuyerRequirements {
    return {
      cities: demand.cities,
      neighborhoods: demand.neighborhoods,
      searchAreas: readSearchAreas(demand.searchAreas),
      dealType: demand.dealType,
      /*
       * הפרופיל שנשמר, ולא שלד. כשסוג הנכס, השטח, מועד הכניסה
       * ומאפייני העדיפות לא נשמרו, הניקוד שהרשת הציגה נבנה על
       * ארבעה קריטריונים בלבד — ולכן בית פרטי קיבל 90% על ביקוש
       * שמחפש דירה. עכשיו אותו מנוע רואה את אותם שדות משני צדי
       * הגבול.
       */
      propertyTypes: demand.propertyTypes,
      ...(demand.areaSqmMin !== null ? { areaSqmMin: demand.areaSqmMin } : {}),
      /*
       * גם רף התקציב התחתון, ולא רק התקרה. הוא נשמר ומוצג — ובלעדיו
       * כאן, נכס מתחת לרף שהקונה הגדיר היה מקבל ניקוד תקציב מלא ברשת
       * בעוד אותו קונה מוריד עליו ניקוד פנימית. כלומר נכס לא מתאים
       * שנדחף מעל סף התצוגה, ודווקא בצד שאין בו למי לשאול.
       */
      ...(demand.budgetMinAgorot !== null
        ? { budgetMinAgorot: Number(demand.budgetMinAgorot) }
        : {}),
      ...(demand.budgetMaxAgorot === null
        ? {}
        : { budgetMaxAgorot: Number(demand.budgetMaxAgorot) }),
      ...(demand.roomsMin !== null
        ? { roomsMin: Number(demand.roomsMin) }
        : {}),
      ...(demand.roomsMax !== null
        ? { roomsMax: Number(demand.roomsMax) }
        : {}),
      ...(demand.entryType !== null ? { entryType: demand.entryType } : {}),
      ...(demand.entryBy !== null ? { entryBy: demand.entryBy } : {}),
      features: {
        ...Object.fromEntries(demand.niceFeatures.map((f) => [f, "nice"])),
        // חובה גוברת על עדיפות אם מאפיין הופיע בשתי הרשימות
        ...Object.fromEntries(demand.mustFeatures.map((f) => [f, "must"])),
      },
    } as unknown as BuyerRequirements;
  }

  /**
   * ביקושים ברשת שמתאימים לנכס אחד — העמודה השנייה בכרטיס הנכס.
   *
   * עד כה כרטיס הנכס הראה רק קונים מהמאגר הפנימי, והביקושים ברשת
   * חיו במסך נפרד שצריך לזכור להיכנס אליו. הסוכן ראה "3 קונים
   * מתאימים" וסגר את הכרטיס, בלי לדעת שיש עוד ארבעה ביקושים ברשת
   * שהנכס הזה עונה עליהם בדיוק.
   *
   * הביקושים שלי מסוננים: הם כבר מכוסים בעמודה הפנימית, ולראות
   * אותם פעמיים זו ספירה כפולה של אותו קונה.
   */
  async networkMatchesForProperty(
    propertyId: string,
  ): Promise<NetworkDemandMatchDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const property = await this.prisma.withTenant((tx) =>
      tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
      }),
    );
    if (!property) throw new NotFoundException("נכס לא נמצא");

    const demands = await this.prisma.withNetworkRead((tx) =>
      tx.sharedDemand.findMany({
        where: { status: "active", tenantId: { not: tenantId } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    if (demands.length === 0) return [];

    /*
     * מה כבר הצעתי — שאילתה אחת לכל הרשימה ולא אחת לכל ביקוש. בלי
     * זה המסך היה מציע להציע שוב נכס שכבר הוצע, והשרת היה גובה
     * קרדיט על כפילות.
     */
    const offered = await this.prisma.withTenant((tx) =>
      tx.coopOffer.findMany({
        where: {
          fromTenantId: tenantId,
          propertyId,
          demandId: { in: demands.map((d) => d.id) },
        },
        select: { demandId: true },
      }),
    );
    const alreadyOffered = new Set(offered.map((o) => o.demandId));

    const prices = await this.pricing.all();
    const fields = rowToFields(property);
    return demands
      .map((demand) => ({
        demand,
        // בלי משקלי המשרד, כמו בכל ניקוד שמוצג מעבר לגבול הדייר
        result: scoreMatch(fields, this.demandToRequirements(demand)),
      }))
      .filter(
        ({ result }) =>
          !result.excluded && result.score >= NETWORK_MATCH_MIN_SCORE,
      )
      .sort((a, b) => b.result.score - a.result.score)
      .slice(0, 10)
      .map(({ demand, result }) => ({
        demandId: demand.id,
        score: result.score,
        explanation: result.explanation,
        cities: demand.cities,
        neighborhoods: demand.neighborhoods,
        searchAreas: readSearchAreas(demand.searchAreas),
        ...(demand.notes ? { notes: demand.notes } : {}),
        dealType: demand.dealType,
        propertyTypes: demand.propertyTypes,
        ...(demand.areaSqmMin === null
          ? {}
          : { areaSqmMin: demand.areaSqmMin }),
        ...(demand.budgetMinAgorot === null
          ? {}
          : { budgetMinAgorot: Number(demand.budgetMinAgorot) }),
        ...(demand.budgetMaxAgorot === null
        ? {}
        : { budgetMaxAgorot: Number(demand.budgetMaxAgorot) }),
        ...(demand.roomsMin === null
          ? {}
          : { roomsMin: Number(demand.roomsMin) }),
        ...(demand.roomsMax === null
          ? {}
          : { roomsMax: Number(demand.roomsMax) }),
        ...(demand.entryType === null ? {} : { entryType: demand.entryType }),
        ...(demand.entryBy === null ? {} : { entryBy: demand.entryBy }),
        ...(demand.financing === null ? {} : { financing: demand.financing }),
        ...(demand.maturity === null ? {} : { maturity: demand.maturity }),
        mustFeatures: demand.mustFeatures,
        niceFeatures: demand.niceFeatures,
        commissionSplit: demand.commissionSplit,
        creditsCost: coopOfferCost(demand.source, prices),
        source: demand.source,
        alreadyOffered: alreadyOffered.has(demand.id),
      }));
  }

  /**
   * נכסים שמשרדים אחרים הציעו על הקונה הזה — העמודה השנייה בכרטיס
   * הקונה.
   *
   * הצעות שת"פ נחתו עד כה רק במסך השת"פ הכללי, כלומר הסוכן שפתח את
   * כרטיס הקונה לא ראה שמחכה לו שם נכס. הן שייכות לכרטיס: זו בדיוק
   * אותה שאלה — "מה יש בשביל הקונה הזה" — רק שהמקור אחר.
   *
   * `shared: false` אינו שגיאה אלא מצב: הקונה פשוט לא פורסם לרשת,
   * והמסך מזמין לפרסם במקום להציג עמודה ריקה בלי הסבר.
   */
  async networkMatchesForBuyer(
    buyerId: string,
  ): Promise<{ shared: boolean; offers: NetworkPropertyOfferDto[] }> {
    const tenantId = TenantContext.current().tenantId;
    const demand = await this.prisma.withTenant((tx) =>
      tx.sharedDemand.findFirst({
        where: { tenantId, originBuyerId: buyerId, status: "active" },
        select: { id: true },
      }),
    );
    if (!demand) return { shared: false, offers: [] };

    const rows = await this.prisma.withTenant((tx) =>
      tx.coopOffer.findMany({
        where: { demandId: demand.id, toTenantId: tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
    return {
      shared: true,
      offers: rows.map((row) => ({
        id: row.id,
        presentation: row.presentation as Record<string, unknown>,
        commissionSplit: row.commissionSplit,
        status: row.status,
        createdAt: row.createdAt,
      })),
    };
  }

  /**
   * מזהה ושם הקונה שמאחורי כל ביקוש שלי.
   *
   * נקרא בהקשר הדייר בלבד — הביקושים שמגיעים לכאן הם שלי, ולכן אין
   * כאן חשיפה חוצה־דיירים. `originBuyerId` של ביקוש זר לעולם אינו
   * מגיע לפונקציה הזו.
   */
  private async buyerNamesForDemands(
    demandIds: string[],
  ): Promise<Map<string, { buyerId: string; buyerName: string }>> {
    const out = new Map<string, { buyerId: string; buyerName: string }>();
    if (demandIds.length === 0) return out;
    const tenantId = TenantContext.current().tenantId;

    const demands = await this.prisma.withTenant((tx) =>
      tx.sharedDemand.findMany({
        where: {
          tenantId,
          id: { in: demandIds },
          originBuyerId: { not: null },
        },
        select: { id: true, originBuyerId: true },
      }),
    );
    if (demands.length === 0) return out;

    /*
     * הקונה ואיש הקשר בשתי שאילתות ולא ב-include: אין ביניהם יחס
     * מוצהר ב-Prisma, וזה הדפוס בכל שאר השירותים.
     */
    const buyers = await this.prisma.withTenant((tx) =>
      tx.buyer.findMany({
        where: {
          tenantId,
          id: { in: demands.map((d) => d.originBuyerId as string) },
          /*
           * גבול הבעלות נשמר גם כאן. `collaboration.offer` ניתנת
           * להענקה בנפרד מ-`buyers.view_all`, ובלי הסינון סוכן שקיבל
           * רק אותה היה רואה שמות של קונים שאינם שלו — כלומר נתיב
           * צדדי לעקיפת ההפרדה הפנימית במשרד. שאר קריאות הקונים
           * מסננות כך, וגם זו.
           */
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { id: true, contactId: true },
      }),
    );
    if (buyers.length === 0) return out;
    const contacts = await this.prisma.withTenant((tx) =>
      tx.contact.findMany({
        where: { tenantId, id: { in: buyers.map((b) => b.contactId) } },
        select: { id: true, nameEncrypted: true },
      }),
    );
    const nameByContact = new Map(
      contacts.map((c) => [c.id, this.crypto.decrypt(c.nameEncrypted)]),
    );
    const nameById = new Map(
      buyers.flatMap((b) => {
        const name = nameByContact.get(b.contactId);
        return name === undefined ? [] : [[b.id, name] as const];
      }),
    );

    for (const demand of demands) {
      const buyerId = demand.originBuyerId as string;
      const buyerName = nameById.get(buyerId);
      // כרטיס שנמחק אחרי שהביקוש פורסם — ההצעה נשארת, בלי שם
      if (buyerName !== undefined) out.set(demand.id, { buyerId, buyerName });
    }
    return out;
  }

  private async getDemand(id: string): Promise<SharedDemandDto> {
    const tenantId = TenantContext.current().tenantId;
    const prices = await this.pricing.all();
    const row = await this.prisma.withTenant((tx) =>
      tx.sharedDemand.findFirst({ where: { id, tenantId } }),
    );
    if (!row) throw new NotFoundException("ביקוש לא נמצא");
    // תמיד הביקוש שלי (השאילתה מסוננת לפי הדייר) — ולכן המשרד שלי
    const offices = await officeBadges(this.prisma, this.storage, [row.tenantId]);
    return this.toDemandDto(row, tenantId, prices, offices.get(row.tenantId));
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
      throw new BadRequestException(
        "זה ביקוש שלך — ההתאמות הפנימיות כבר כיסו אותו",
      );
    }

    const splitRejection = commissionSplitRejectionReason(commissionSplit);
    if (splitRejection !== null) throw new BadRequestException(splitRejection);
    const prices = await this.pricing.all();
    const sent = await this.prisma.withTenant(async (tx) => {
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
       * הצעה כפולה נחסמת כאן ולא רק במפתח הייחודי שבמסד — בדיוק כמו
       * `coopInterest` בצד הנכסים.
       *
       * הפיד מסמן התאמה שכבר הוצעה, אבל כפתור שנלחץ פעמיים ולשונית
       * שנשארה פתוחה מדקה קודם עדיין מגיעים לכאן, ואז הפרת
       * `@@unique([demandId, propertyId])` צפה כ-500 "Internal server
       * error". המתווך רואה תקלה במערכת ופונה לתמיכה על פעולה
       * שהצליחה בפעם הראשונה.
       */
      const already = await tx.coopOffer.findFirst({
        where: { demandId, propertyId },
        select: { id: true },
      });
      if (already)
        throw new BadRequestException("כבר הצעתם את הנכס הזה לביקוש הזה");

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
          throw new BadRequestException(
            "אין מספיק קרדיטים — אפשר לרכוש במסך שיתופי הפעולה",
          );
        }
      }

      /*
       * חשיפה מדורגת: שכונה ומאפיינים; בלי רחוב, בלי מספר בית, בלי
       * בעלים (docs/04 §7).
       *
       * הצילום הורחב לכל מה שאינו מזהה. הצד המקבל ראה עד כה שורה
       * אחת — "4 חדרים בגבעתיים · 2,300,000 ₪" — והיה צריך לאשר
       * חיבור רק כדי לגלות קומה שביעית בלי מעלית. אישור חיבור הוא
       * צעד שקשה לחזור ממנו, ולכן כל מה שאינו מזהה צריך להיות ידוע
       * לפניו.
       */
      const features = [
        ...(
          [
            "hasElevator",
            "hasParking",
            "hasBalcony",
            "hasSafeRoom",
            "hasStorage",
          ] as const
        )
          .filter((key) => property[key] === true)
          .map((key) => String(key)),
        ...readCustomFeatures(property.attributes)
          .filter((f) => f.value)
          .map((f) => f.key),
      ];
      const presentation = {
        city: property.city ?? undefined,
        neighborhood: property.neighborhood ?? undefined,
        propertyType: property.propertyType ?? undefined,
        dealType: property.dealType ?? undefined,
        rooms: property.rooms === null ? undefined : Number(property.rooms),
        areaSqm: property.areaSqm ?? undefined,
        floor: property.floor ?? undefined,
        totalFloors: property.totalFloors ?? undefined,
        condition: property.condition ?? undefined,
        priceAgorot:
          property.priceAgorot === null
            ? undefined
            : Number(property.priceAgorot),
        entryType: property.entryType ?? undefined,
        entryDate: property.entryDate ?? undefined,
        features,
        title: property.marketingTitle ?? undefined,
      };

      await tx.coopOffer
        .create({
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
        })
        .catch((error: unknown) => {
          // שתי לחיצות במקביל עוברות שתיהן את הבדיקה שמעל — המפתח
          // הייחודי הוא שעוצר, וגם הוא צריך להיראות כהודעה ולא כ-500
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            throw new BadRequestException("כבר הצעתם את הנכס הזה לביקוש הזה");
          }
          throw error;
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
      /*
       * הצעת הנכס למשרד אחר היא צעד לעבר פריט (6) בפעולות השיווק —
       * "הזמנתם של חמישה מתווכים אחרים לפחות".
       *
       * **המפתח הוא המשרד המקבל ולא ההצעה.** הצעה מזוהה מול *ביקוש*,
       * ולמשרד אחד יכולים להיות חמישה ביקושים — חמש הצעות לאותו משרד
       * היו חוצות את הסף בעוד שבפועל נחשף אחד (ביקורת Codex). מפתח
       * לפי `toTenantId` הופך את האינדקס הייחודי החלקי על
       * `(exclusivity_id, source_key)` למונה של משרדים נבדלים — הצעה
       * שנייה לאותו משרד נבלעת ב-`skipDuplicates` במקום להיספר שוב.
       */
      await this.exclusivity.recordAuto(tx, propertyId, "network_offer", {
        sourceKey: `coop-office:${demand.tenantId}`,
        performedAt: new Date(),
        detail: "הנכס הוצע למשרד תיווך נוסף ברשת",
        brokerCount: 1,
      });
      // ההתראה מנותבת לסוכנות המקבלת — tenantId של האירוע הוא היעד
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          tenantId: demand.tenantId,
          name: "coop_offer.sent",
          payload: {
            coopOfferId: id,
            tenantId: demand.tenantId,
            fromTenantId: ctx.tenantId,
          },
        },
      });
      return { presentation };
    });

    /*
     * המייל נשלח אחרי ה-Commit ולא בתוכו: שליחה איטית הייתה מחזיקה
     * טרנזקציה פתוחה, וכשל שלה היה מגלגל לאחור הצעה תקפה.
     */
    try {
      await this.emailDemandOwner({
        demandTenantId: demand.tenantId,
        demandBuyerId: demand.originBuyerId,
        fromTenantId: ctx.tenantId,
        presentation: sent.presentation,
        commissionSplit,
      });
    } catch (error: unknown) {
      this.logger.warn(`מייל על הצעת נכס (${id}) לא נשלח: ${String(error)}`);
    }

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

  /**
   * מייל למשרד שפרסם את הביקוש, בנוסף להתראה שבמערכת.
   *
   * ההתראה במערכת מגיעה למי שכבר נמצא במסך. הצעה שממתינה שלושה ימים
   * כי אף אחד לא נכנס לאזור הרשת היא שיתוף פעולה שלא קרה — והמייל
   * הוא מה שמחזיר את המתווך לכאן.
   *
   * **מה נכנס להודעה:** בדיוק אותו צילום מדורג שהצד המקבל רשאי לראות
   * בפיד (`presentation`), ושם המשרד המציע. לא הכתובת המדויקת, לא
   * המוכר ולא פרטי קשר — מייל נשמר בתיבה של מישהו אחר, וכל מה
   * שנכנס אליו יצא מהמערכת ומהבקרות שלה.
   *
   * הכל Best-effort: ההצעה כבר נרשמה ואושרה, ולכן כשל בשליחה נרשם
   * ביומן ואינו מבטל אותה.
   */
  private async emailDemandOwner(input: {
    demandTenantId: string;
    demandBuyerId: string | null;
    fromTenantId: string;
    presentation: NetworkPresentationFields;
    commissionSplit: number;
  }): Promise<void> {
    if (!(await this.email.isConfigured())) return;

    /*
     * הנמען הוא הסוכן שהכרטיס שלו, ולא "המשרד" בהפשטה: הוא זה
     * שמכיר את הקונה ויכול להחליט אם ההצעה מתאימה. בעל המשרד הוא
     * הגיבוי — כרטיס בלי סוכן אחראי עדיין צריך שמישהו יראה אותו.
     *
     * הקונה נקרא תחת הדייר המקבל: `buyers` נמצאת תחת FORCE RLS,
     * ולכן קריאה ישירה כאן הייתה מחזירה אפס שורות בשקט.
     */
    const ownerUserId =
      input.demandBuyerId === null
        ? null
        : await this.prisma.withExplicitTenant(
            input.demandTenantId,
            async (tx) => {
              const buyer = await tx.buyer.findFirst({
                where: {
                  id: input.demandBuyerId as string,
                  tenantId: input.demandTenantId,
                },
                select: { ownerUserId: true },
              });
              return buyer?.ownerUserId ?? null;
            },
          );

    const [recipient, fallback, fromTenant] = await Promise.all([
      ownerUserId === null
        ? null
        : this.prisma.user.findFirst({
            where: { id: ownerUserId, isActive: true },
            select: { name: true, email: true },
          }),
      this.prisma.user.findFirst({
        where: {
          tenantId: input.demandTenantId,
          role: "owner",
          isActive: true,
        },
        select: { name: true, email: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.tenant.findUnique({
        where: { id: input.fromTenantId },
        select: { name: true },
      }),
    ]);

    const to = recipient ?? fallback;
    if (!to?.email) return;

    /*
     * תיאור הנכס נבנה מאותה פונקציה שבונה את הצ'יפים במסך — כדי
     * שהמייל והפיד לא יתחילו לספר שני סיפורים על אותה הצעה.
     */
    const summary = presentationChips(input.presentation)
      .map((chip) => chip.text)
      .join(" · ");

    await this.email.send(to.email, "הצעת נכס חדשה לביקוש שפרסמתם ברשת", {
      heading: "מחכה לכם הצעת נכס",
      greeting: `שלום ${to.name},`,
      paragraphs: [
        `${fromTenant?.name ?? "משרד תיווך אחר"} הציע נכס לאחד הביקושים שפרסמתם ברשת שיתופי הפעולה.`,
        summary === "" ? "פרטי הנכס מחכים במסך." : `הנכס: ${summary}.`,
        `חלוקת העמלה המוצעת: ${input.commissionSplit}% למשרד המציע, ${100 - input.commissionSplit}% לכם.`,
        "אם זה מתאים לקונה — אישור החיבור במסך פותח את הקשר בין שני המשרדים.",
      ],
      button: {
        label: "להצעה במסך",
        url: `${loadEnv().WEB_ORIGIN}/collaboration?tab=incoming`,
      },
      footnote:
        "ההודעה נשלחה כי פרסמתם ביקוש ברשת שיתופי הפעולה. אפשר לסגור את הפרסום במסך בכל רגע.",
    });
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
    /*
     * שם הקונה להצעות הנכנסות — שתי שאילתות לכל הרשימה ולא אחת לכל
     * הצעה. הביקושים והקונים נטענים פעם אחת ומחוברים בזיכרון.
     */
    const incomingDemandIds = rows
      .filter((row) => row.toTenantId === tenantId)
      .map((row) => row.demandId);
    const buyerByDemand = await this.buyerNamesForDemands(incomingDemandIds);

    return rows.map((row) => ({
      id: row.id,
      demandId: row.demandId,
      ...(row.toTenantId === tenantId
        ? (buyerByDemand.get(row.demandId) ?? {})
        : {}),
      direction: row.toTenantId === tenantId ? "incoming" : "outgoing",
      commissionSplit: row.commissionSplit,
      presentation: row.presentation as Record<string, unknown>,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  /** תגובת הסוכנות המקבלת להצעת שיתוף — מעוניין/דחייה. */
  async respondToCoopOffer(
    id: string,
    response: "interested" | "declined",
  ): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.coopOffer.updateMany({
        where: { id, toTenantId: tenantId, status: "sent" },
        data: { status: response },
      });
      if (result.count === 0)
        throw new NotFoundException("הצעת שיתוף לא נמצאה");
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
    const economy = await this.creditEconomy.current();
    return {
      suggestedPriceCredits: suggestedReferralPrice(source, prices),
      /*
       * מהכלכלה ולא מ-`feePercent()`.
       *
       * שניהם קוראים את **אותה** הגדרה, אבל נופלים לשתי ברירות מחדל
       * שונות — ולכן במשרד שלא נגע במסך המפנה ראה כאן אחוז אחד וחויב
       * באחר. `settleReferral` גובה לפי `feeCreditsPercent`, ולכן זה
       * מה שצריך להיות מוצג.
       */
      platformFeePercent: economy.feeCreditsPercent,
      economy: {
        creditBonusPercent: economy.creditBonusPercent,
        feeCreditsPercent: economy.feeCreditsPercent,
        feeCashPercent: economy.feeCashPercent,
        unitPriceAgorot: economy.unitPriceAgorot,
      },
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
    payoutMode?: PayoutMode;
    /** הצהרת המפנה על איכות הלקוח — מוצגת בלוח לפני התשלום. */
    clientScores: Record<string, number>;
  }): Promise<SharedLeadDto> {
    const ctx = TenantContext.current();
    const id = ulid();
    const priceProblem = referralPriceRejectionReason(input.priceCredits);
    if (priceProblem) throw new BadRequestException(priceProblem);
    const reasonProblem = referralReasonRejectionReason(
      input.reason,
      input.reasonDetail,
    );
    if (reasonProblem) throw new BadRequestException(reasonProblem);
    /*
     * ההצהרה **חובה בפרסום**, ולא שדה שאפשר לדלג עליו.
     *
     * זו כל הסיבה שהמשרד הקולט יכול להחליט לפני שהוא משלם. הפניה
     * בלי הצהרה הייתה חוזרת בדיוק למצב שממנו באנו — שורה בלוח שאין
     * עליה מה לדעת, ומחיר שמשלמים על סמך אמון בלבד.
     */
    const scoresProblem = dimensionRatingRejectionReason(input.clientScores);
    if (scoresProblem) throw new BadRequestException(scoresProblem);
    /*
     * החלוקה לפי הכלכלה שהוגדרה בפלטפורמה, כולל הבונוס, ולפי המסלול
     * שהמשרד המפנה בחר. שני המסלולים פעילים: מי שבוחר קרדיטים מקבל
     * בונוס כי הערך נשאר במערכת, ומי שבוחר כסף מקבל פחות כי
     * הפלטפורמה משלמת בפועל.
     *
     * **התמורה מצולמת על השורה** ולא נגזרת מחדש בקליטה. עד כה
     * הקליטה חישבה `priceCredits - platformFee`, ולכן הבונוס חושב
     * כאן ומעולם לא שולם — הגדרה מסחרית שנראית פעילה ואינה.
     */
    const mode: PayoutMode = input.payoutMode ?? "credits";
    const payout = settleReferral(
      input.priceCredits,
      mode,
      await this.creditEconomy.current(),
    );

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
        where: {
          tenantId: ctx.tenantId,
          originLeadId: input.leadId,
          status: "sold",
        },
        select: { id: true },
      });
      if (sold)
        throw new BadRequestException(
          "הלקוח הזה כבר הופנה ונקלט — אין להפנות אותו שוב",
        );
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
            clientScores: input.clientScores,
            contactNameEncrypted: contact.nameEncrypted,
            contactPhoneEncrypted: contact.phoneEncrypted,
            contactPhoneHash: contact.phoneHash,
            priceCredits: payout.priceCredits,
            platformFeeCredits: payout.platformFeeCredits,
            payoutMode: mode,
            payoutCredits: payout.payoutCredits,
            payoutAgorot: payout.payoutAgorot,
          },
        })
        .catch((error: unknown) => {
          // האינדקס החלקי (tenant, origin_lead) WHERE active — שתי
          // לחיצות פרסום במקביל לא יפרסמו את אותו לקוח פעמיים
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
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
          clientScores: input.clientScores,
          priceCredits: payout.priceCredits,
          platformFeeCredits: payout.platformFeeCredits,
          payoutMode: mode,
          payoutCredits: payout.payoutCredits,
          payoutAgorot: payout.payoutAgorot,
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
      if (result.count === 0)
        throw new NotFoundException("ההפניה לא נמצאה בלוח או שכבר נקלטה");
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
   * האישורים על ההפניות שאני צד בהן. ה-RLS מחזיר רק שורות של הפניות
   * שאני צד בהן, ולכן אין כאן סינון ידני שאפשר לשכוח.
   *
   * מפה של שורה אחת לכל הפניה ולא רשימה: יש אישור אחד, של הקולט.
   */
  private async ratingsFor(sharedLeadIds: readonly string[]): Promise<
    Map<
      string,
      {
        scoreTenths: number;
        scores: Record<string, number>;
        comment: string | null;
        createdAt: Date;
      }
    >
  > {
    const byLead = new Map<
      string,
      {
        scoreTenths: number;
        scores: Record<string, number>;
        comment: string | null;
        createdAt: Date;
      }
    >();
    if (sharedLeadIds.length === 0) return byLead;
    const rows = await this.prisma.withTenant((tx) =>
      tx.leadReferralRating.findMany({
        where: { sharedLeadId: { in: [...sharedLeadIds] } },
        select: {
          sharedLeadId: true,
          scoreTenths: true,
          scores: true,
          comment: true,
          createdAt: true,
        },
      }),
    );
    for (const row of rows) {
      byLead.set(row.sharedLeadId, { ...row, scores: narrowScores(row.scores) });
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
  ): Promise<Map<string, ReferralReputationView>> {
    const byTenant = new Map<string, ReferralReputationView>();
    const unique = [...new Set(tenantIds)];
    if (unique.length === 0) return byTenant;
    /*
     * שתי השאילתות באותה קריאת רשת ובמקביל. הפירוט חסר משמעות
     * בלי המצרפי — משרד שאין לו ממוצע לא יופיע בכלל — ולכן אין
     * טעם לשלם על סבב שני.
     */
    const [rows, dimensionRows] = await this.prisma.withNetworkRead((tx) =>
      Promise.all([
        tx.referralReputation.findMany({ where: { tenantId: { in: unique } } }),
        tx.referralReputationDimension.findMany({
          where: { tenantId: { in: unique } },
        }),
      ]),
    );
    const dimensionsByTenant = new Map<string, ReferralDimensionScore[]>();
    for (const row of dimensionRows) {
      const average = referralRatingAverage(row.ratingSum, row.ratingCount);
      // ממד בלי אישורים אינו "אפס" אלא היעדר מדידה, ולא מוצג
      if (average === null) continue;
      const list = dimensionsByTenant.get(row.tenantId) ?? [];
      list.push({ key: row.dimension, average, count: row.ratingCount });
      dimensionsByTenant.set(row.tenantId, list);
    }
    for (const row of rows) {
      const average = referralRatingAverage(row.ratingSum, row.ratingCount);
      if (average === null) continue;
      byTenant.set(row.tenantId, {
        average,
        count: row.ratingCount,
        /*
         * סדר הקטלוג ולא סדר המסד. הממדים מוצגים בכל מקום באותו
         * סדר — בהצהרה, באישור וכאן — ורשימה שמתהפכת בין משרד
         * למשרד מכריחה את הקורא לקרוא תוויות במקום להשוות עמודות.
         */
        dimensions: CLIENT_RATING_DIMENSIONS.map((dimension) =>
          (dimensionsByTenant.get(row.tenantId) ?? []).find(
            (item) => item.key === dimension.key,
          ),
        ).filter((item): item is ReferralDimensionScore => item !== undefined),
      });
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
      tx.sharedLead.findFirst({
        where: { id: sharedLeadId, status: "active" },
      }),
    );
    if (!row) throw new NotFoundException("ההפניה לא נמצאה בלוח או שכבר נקלטה");
    if (row.tenantId === ctx.tenantId) {
      throw new BadRequestException(
        "זו הפניה שלכם — אפשר להסיר אותה מהלוח, לא לקלוט",
      );
    }
    const cost = row.priceCredits;
    /*
     * העמלה מצולמת על השורה ברגע הפרסום. החישוב כאן נגזר ממנה ולא
     * מהשיעור הנוכחי — שינוי מדיניות לא יגרע מהפניה שכבר פורסמה.
     * הצמצום ל-[0, cost-1] הוא הגנה על שורה פגומה: זיכוי שלילי
     * למפנה הוא באג שקט שמופיע כחוב.
     */
    const platformFee = Math.max(0, Math.min(row.platformFeeCredits, cost - 1));
    /*
     * התמורה **מצולמת על השורה** ברגע הפרסום, ומשולמת כמות שהיא.
     * החישוב מחדש כאן היה `cost - platformFee`, שהתעלם מהבונוס על
     * בחירת קרדיטים — הוא חושב בפרסום ולא הגיע לאף משרד.
     *
     * שורות שפורסמו לפני הצילום נושאות 0 ומקבלות בדיוק את מה שהיו
     * מקבלות אז. אין כאן שינוי תנאים בדיעבד לעסקה שכבר בלוח.
     */
    const isCash = row.payoutMode === "cash";
    const referrerPayout =
      row.payoutCredits > 0 ? row.payoutCredits : cost - platformFee;

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
      throw new BadRequestException(
        "הלקוח כבר טופל אצל המשרד המפנה — ההפניה הוסרה מהלוח",
      );
    }

    const leadId = await this.prisma.$transaction(async (tx) => {
      // צד המשרד המפנה: תפיסה מותנית + זיכוי בניכוי עמלת הפלטפורמה
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${row.tenantId}, true)`;
      const claimed = await tx.sharedLead.updateMany({
        where: { id: sharedLeadId, status: "active" },
        data: {
          status: "sold",
          buyerTenantId: ctx.tenantId,
          soldAt: new Date(),
        },
      });
      if (claimed.count === 0)
        throw new BadRequestException("ההפניה נקלטה הרגע במשרד אחר");
      /*
       * הזיכוי הוא הנטו, ועמלת הפלטפורמה אינה עוברת ליומן של אף
       * משרד — אבל היא **כן** נזקפת לספר הפלטפורמה (למטה). קודם היא
       * הייתה ההפרש בין מה שהקולט חויב למה שהמפנה זוכה, כלומר
       * קרדיטים שיצאו מהמחזור בלי שאיש רשם אותם, ולא היה איפה לראות
       * כמה הפלטפורמה הרוויחה מהפניות.
       */
      /*
       * שני ספרים, ולכל מסלול שלו. קרדיט הוא אמצעי תשלום פנימי,
       * ושקל הוא התחייבות של הפלטפורמה — ערבובם באותו מספר היה
       * הופך כל בונוס בקרדיטים לחוב כספי.
       */
      if (isCash) {
        await tx.payoutLedger.create({
          data: {
            id: ulid(),
            tenantId: row.tenantId,
            kind: "lead_sale",
            amountAgorot: row.payoutAgorot,
            refId: sharedLeadId,
          },
        });
      } else {
        await tx.creditLedger.create({
          data: {
            id: ulid(),
            tenantId: row.tenantId,
            kind: "lead_sale",
            amount: referrerPayout,
            refId: sharedLeadId,
          },
        });
      }
      /*
       * העמלה נזקפת לחשבון הפלטפורמה — באותה טרנזקציה שבה המפנה
       * זוכה והקולט מחויב, כי שלושתם צד אחד של אותה עסקה. זקיפה
       * מאוחרת יותר הייתה יוצרת חלון שבו הכסף כבר עבר והספר עוד לא
       * יודע.
       *
       * הטבלה אינה תחת RLS ולכן היא נכתבת כאן בלי קשר להקשר הדייר
       * שנקבע ל-`row.tenantId` בשורה שמעל.
       *
       * השורה נכתבת **גם כשהעמלה אפס**: הצד היקר של העסקה — הבונוס
       * שהונפק והמזומן ששולם — מצולם עליה, והוא קיים גם בהפניה בלי
       * עמלה. הוא נשמר כאן ולא נקרא מ-`shared_leads`, כי זו טבלה
       * תחת RLS שאין לפלטפורמה דרך חוקית לקרוא ממנה חוצה-דיירים:
       * ניסיון כזה מחזיר אפס שורות בשקט, כלומר דוח שכולו אפסים
       * ונראה תקין (ביקורת Codex).
       */
      await tx.platformCreditLedger.create({
        data: {
          id: ulid(),
          kind: "referral_fee",
          amount: platformFee,
          bonusCredits: referralBonusCredits({
            priceCredits: cost,
            platformFeeCredits: platformFee,
            payoutCredits: isCash ? 0 : referrerPayout,
          }),
          cashPaidAgorot: isCash ? row.payoutAgorot : 0,
          sourceTenantId: ctx.tenantId,
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
            payoutCredits: isCash ? 0 : referrerPayout,
            payoutAgorot: isCash ? row.payoutAgorot : 0,
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
        throw new BadRequestException(
          "אין מספיק קרדיטים — אפשר לרכוש במסך שיתופי הפעולה",
        );
      }
      /*
       * ההצפנה במפתח אפליקטיבי אחיד, לכן הצילום מועתק כמות שהוא —
       * בלי פענוח ביניים. אם הטלפון כבר מוכר למשרד הקולט (לפי
       * ה-HMAC) לא נוצר כרטיס כפול.
       */
      let contact = await tx.contact.findUnique({
        where: {
          tenantId_phoneHash: {
            tenantId: ctx.tenantId,
            phoneHash: row.contactPhoneHash,
          },
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
            tenantId_phoneHash: {
              tenantId: ctx.tenantId,
              phoneHash: row.contactPhoneHash,
            },
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
   * אישור המשרד הקולט על הצהרת המפנה — פעם אחת, וניתן לעדכן.
   *
   * **רק הקולט מאשר.** המפנה כבר אמר את שלו ברגע הפרסום, וההצהרה
   * שלו היא חלק מהמודעה ולא דירוג. לכן אין כאן `role` מהנתיב: יש
   * צד אחד שיכול לאשר, והוא נבדק מול השורה.
   *
   * הציון שנשמר הוא **דיוק ההצהרה** ולא איכות הלקוח — הפער בין מה
   * שהוצהר למה שהתברר. הוא נגזר בשרת משני הצדדים ואינו מתקבל
   * מהמסך: ערך שהלקוח שולח היה נתון שאפשר לזייף, והוא ממילא חישוב.
   *
   * הצהרה ריקה (הפניה שקדמה לשדה) אינה ניתנת למדידה, ולכן האישור
   * נשמר ומוצג אבל אינו נכנס למוניטין. אפס במקום היעדר-מדידה היה
   * מעניש משרד על שדה שלא היה קיים כשפרסם.
   */
  async confirmReferral(
    sharedLeadId: string,
    scores: Record<string, number>,
    comment?: string,
  ): Promise<void> {
    const ctx = TenantContext.current();
    const problem =
      dimensionRatingRejectionReason(scores) ??
      referralCommentRejectionReason(comment);
    if (problem) throw new BadRequestException(problem);

    // ה-RLS מחזיר כאן רק הפניה שאני צד בה — כמפנה או כקולט
    const row = await this.prisma.withTenant((tx) =>
      tx.sharedLead.findFirst({
        where: { id: sharedLeadId },
        select: {
          id: true,
          tenantId: true,
          buyerTenantId: true,
          status: true,
          clientScores: true,
        },
      }),
    );
    if (!row) throw new NotFoundException("ההפניה לא נמצאה");
    if (row.status !== "sold" || !row.buyerTenantId) {
      throw new BadRequestException("אפשר לאשר רק הפניה שנקלטה");
    }
    // מי שאינו הקולט אינו מאשר — כולל המפנה עצמו
    if (row.buyerTenantId !== ctx.tenantId) {
      throw new NotFoundException("ההפניה לא נמצאה");
    }

    const declared = narrowScores(row.clientScores);
    const accuracy = declarationAccuracy(declared, scores);
    // עשיריות לאורך כל הצבירה — ראו `LeadReferralRating.scoreTenths`
    const scoreTenths = accuracy === null ? 0 : Math.round(accuracy * 10);
    const buyerTenantId = row.buyerTenantId;
    const trimmed = comment?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
      /*
       * נעילת האישור הזה עד סוף הטרנזקציה. הפרש הציון למוניטין
       * מחושב מקריאה של האישור הקודם, ושתי שליחות במקביל מאותו
       * משרד היו קוראות שתיהן את אותו ערך ומחילות את ההפרש פעמיים.
       */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`referral_rating:${sharedLeadId}:${ctx.tenantId}`}, 0))`;
      const existing = await tx.leadReferralRating.findUnique({
        where: {
          sharedLeadId_raterTenantId: {
            sharedLeadId,
            raterTenantId: ctx.tenantId,
          },
        },
        // `scores` נדרש לחישוב דלתת הפירוט לפי ממד: אישור מתוקן
        // משנה את הדיוק של כל ממד בנפרד, ובלי הערכים הקודמים אי
        // אפשר לדעת מה להוריד מהצבירה
        select: { id: true, scoreTenths: true, scores: true },
      });
      if (existing) {
        await tx.leadReferralRating.update({
          where: { id: existing.id },
          data: { scoreTenths, scores, comment: trimmed },
        });
      } else {
        await tx.leadReferralRating.create({
          data: {
            id: ulid(),
            sharedLeadId,
            sellerTenantId: row.tenantId,
            buyerTenantId,
            raterTenantId: ctx.tenantId,
            scoreTenths,
            scores,
            comment: trimmed,
          },
        });
      }
      await this.audit.record(tx, {
        action: "collaboration.referral_confirm",
        entityType: "shared_lead",
        entityId: sharedLeadId,
        metadata: { accuracy },
      });

      /*
       * המוניטין מתעדכן בהקשר של המשרד המפנה — הוא הבעלים של
       * השורה. עדכון בדלתא ולא כתיבת ערך מחושב: שני אישורים על
       * שתי הפניות שונות של אותו משרד יכולים להתרחש בו-זמנית.
       *
       * **המונה נגזר ממה שתרם ולא ממה שקיים.** אישור נספר רק
       * כשיש בו דיוק למדוד, כלומר כשיש ולו ממד אחד ששני הצדדים
       * נגעו בו. בלעדיו `scoreTenths` הוא 0, וספירה שלו הייתה
       * מושכת את הממוצע לאפס על סמך לא-כלום.
       *
       * הבדיקה הזו לא יכולה להיות `if (accuracy === null) return`,
       * כפי שהייתה: הקולט רשאי לתקן את האישור, והתיקון יכול לחצות
       * את הגבול לשני הכיוונים. אישור ראשון בלי חפיפה שתוקן לאישור
       * עם חפיפה לא היה נספר כלל, ואישור עם חפיפה שתוקן לאישור
       * בלעדיה היה נשאר בצבירה לנצח.
       */
      /*
       * שתי המפות הן מקור האמת לכל הדלתאות שלמטה — המצרפית וגם
       * הפירוט. מפה ריקה פירושה "אין ולו ממד אחד ששני הצדדים נגעו
       * בו", כלומר בדיוק המצב שבו אין דיוק למדוד.
       */
      const before = existing
        ? dimensionAccuracies(declared, narrowScores(existing.scores))
        : {};
      const after = dimensionAccuracies(declared, scores);

      const scoreDelta = scoreTenths - (existing?.scoreTenths ?? 0);
      const countDelta =
        (Object.keys(after).length > 0 ? 1 : 0) -
        (Object.keys(before).length > 0 ? 1 : 0);
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${row.tenantId}, true)`;
      if (scoreDelta !== 0 || countDelta !== 0) {
        await tx.$executeRaw`
          INSERT INTO referral_reputation (tenant_id, rating_count, rating_sum, updated_at)
          VALUES (${row.tenantId}, ${countDelta}, ${scoreDelta}, now())
          ON CONFLICT (tenant_id) DO UPDATE SET
            rating_count = referral_reputation.rating_count + ${countDelta},
            rating_sum = referral_reputation.rating_sum + ${scoreDelta},
            updated_at = now()`;
      }

      /*
       * ואותה צבירה בדיוק, לכל ממד בנפרד.
       *
       * אותו דפוס דלתא ומאותה סיבה — אישור מתוקן צריך להוריד את
       * מה שתרם קודם. ההשוואה היא בין שתי מפות ולא בין שני
       * מספרים: אישור מתוקן יכול להוסיף ממד שלא דורג קודם או
       * להסיר ממד שדורג, וכל אחד מהם משנה גם את המונה.
       */
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const sumDelta = ((after[key] ?? 0) - (before[key] ?? 0)) * 10;
        const dimensionCountDelta =
          (after[key] === undefined ? 0 : 1) - (before[key] === undefined ? 0 : 1);
        if (sumDelta === 0 && dimensionCountDelta === 0) continue;
        await tx.$executeRaw`
          INSERT INTO referral_reputation_dimensions
            (tenant_id, dimension, rating_count, rating_sum, updated_at)
          VALUES (${row.tenantId}, ${key}, ${dimensionCountDelta}, ${sumDelta}, now())
          ON CONFLICT (tenant_id, dimension) DO UPDATE SET
            rating_count = referral_reputation_dimensions.rating_count + ${dimensionCountDelta},
            rating_sum = referral_reputation_dimensions.rating_sum + ${sumDelta},
            updated_at = now()`;
      }
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
      clientScores: unknown;
      priceCredits: number;
      platformFeeCredits: number;
      payoutMode: string;
      payoutCredits: number;
      payoutAgorot: number;
      status: string;
      buyerTenantId: string | null;
      createdAt: Date;
    },
    viewerTenantId: string,
    extras: {
      ratings?: Map<
        string,
        {
          /** עשיריות — כפי שנשמר. ההמרה לכוכבים נעשית כאן ובמקום אחד בלבד. */
          scoreTenths: number;
          scores: Record<string, number>;
          comment: string | null;
          createdAt: Date;
        }
      >;
      reputation?: ReferralReputationView;
    } = {},
  ): SharedLeadDto {
    const mine = row.tenantId === viewerTenantId;
    const role: ReferralRole = mine
      ? "referrer"
      : row.buyerTenantId === viewerTenantId
        ? "receiver"
        : "viewer";
    /*
     * האישור נראה לשני הצדדים להפניה בלבד. צופה ברשת רואה את
     * המוניטין המצטבר של המפנה ואת ההצהרה על הלקוח — לא את מה
     * שמשרד אחר כתב על משרד אחר.
     */
    const confirmed = role === "viewer" ? undefined : extras.ratings?.get(row.id);
    const declared = narrowScores(row.clientScores);
    const platformFeeCredits = Math.max(
      0,
      Math.min(row.platformFeeCredits, row.priceCredits - 1),
    );
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
      payoutMode: row.payoutMode as PayoutMode,
      /*
       * התמורה כפי שצולמה בפרסום. שורות שקדמו לצילום נושאות 0,
       * ולהן מוצג מה שהיה מוצג להן אז — price פחות העמלה, בלי בונוס.
       *
       * הנפילה-לאחור חלה **רק במסלול הקרדיטים**. בלי התנאי הזה
       * הפניה שנמכרה בכסף הציגה גם "75 קרדיטים" לצד הסכום בשקלים,
       * כלומר הבטיחה תמורה כפולה (התגלה בבדיקה מול API אמיתי).
       */
      payoutCredits:
        row.payoutMode === "cash"
          ? 0
          : row.payoutCredits > 0
            ? row.payoutCredits
            : row.priceCredits - platformFeeCredits,
      payoutAgorot: row.payoutAgorot,
      status: row.status,
      mine,
      role,
      // הקישור לליד המקורי נחשף רק למשרד המפנה — לעולם לא לרשת
      originLeadId: mine ? row.originLeadId : undefined,
      clientScores: declared,
      ...(extras.reputation ? { referrerRating: extras.reputation } : {}),
      ...(confirmed
        ? {
            confirmation: {
              /*
               * הצהרה ריקה נשמרה כ-0 כדי שהעמודה תישאר שלמה, אבל
               * "אין ממה למדוד" אינו "דיוק אפס" — וזה ההבדל בין
               * משרד גרוע להפניה שפורסמה לפני שהשדה היה קיים.
               */
              accuracy:
                Object.keys(declared).length === 0
                  ? null
                  : confirmed.scoreTenths / 10,
              scores: confirmed.scores,
              comment: confirmed.comment ?? undefined,
              createdAt: confirmed.createdAt,
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
    const { balance } = await this.balance();
    return { incomingOffers, openReferrals, credits: balance };
  }

  /**
   * היתרה **ומה אפשר לקנות** — בקריאה אחת.
   *
   * המסך שמראה יתרה אפסית בלי לומר איך ממלאים אותה הוא מבוי סתום,
   * וזה בדיוק המצב שהיה: הודעת השגיאה הפנתה ל"הגדרות" שאין בהן כלום.
   */
  async credits(): Promise<{
    balance: number;
    unitPriceAgorot: number;
    packages: { credits: number; priceAgorot: number }[];
    expiry: CreditExpiryInfo;
  }> {
    const economy = await this.creditEconomy.current();
    const { balance } = await this.balance();
    return {
      balance,
      unitPriceAgorot: economy.unitPriceAgorot,
      packages: economy.packages,
      expiry: await this.expiryInfo(economy.expiryMonths),
    };
  }

  /**
   * מה עומד לפוג ומתי — למסך הקרדיטים של המשרד.
   *
   * המשרד רואה יתרה אחת, אבל היא מורכבת ממנות עם תאריכים שונים.
   * בלי החלון הזה, "היו לי 40 קרדיטים ועכשיו 25" הוא הפתעה שמגיעה
   * אחרי מעשה. החישוב זהה לזה שהסריקה מריצה — אותה פונקציה, לא
   * העתק שלה.
   */
  private async expiryInfo(expiryMonths: number): Promise<CreditExpiryInfo> {
    if (expiryMonths <= 0) return { months: 0 };
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.creditLedger.findMany({
        where: { tenantId },
        select: {
          id: true,
          kind: true,
          amount: true,
          refId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    );
    const plan = planCreditExpiry(rows, expiryMonths, new Date());
    /*
     * המנה הקרובה ביותר לפוג ועדיין חיה. לא סכום כל מה שיפוג אי פעם:
     * "כל הקרדיטים שלך יפוגו בסופו של דבר" נכון וחסר תועלת. מה
     * שמניע פעולה הוא התאריך הקרוב ומה שקשור אליו.
     */
    const live = plan.batches
      .filter((b) => b.expiresAt !== null && b.remaining > 0)
      .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime());
    const next = live[0];
    if (!next) return { months: expiryMonths };
    return {
      months: expiryMonths,
      nextAmount: live
        .filter((b) => b.expiresAt!.getTime() === next.expiresAt!.getTime())
        .reduce((sum, b) => sum + b.remaining, 0),
      nextAt: next.expiresAt!.toISOString(),
    };
  }

  private async balance(): Promise<{ balance: number }> {
    const tenantId = TenantContext.current().tenantId;
    const balance = await this.prisma.withTenant(async (tx) => {
      const hasAny = await tx.creditLedger.findFirst({
        where: { tenantId },
        select: { id: true },
      });
      if (!hasAny) {
        /*
         * מענק פתיחה חד-פעמי — נרשם כתנועה, לא כיתרה קסומה.
         * הסכום מגיע מהגדרות הפלטפורמה: גם הוא מספר מסחרי שמשתנה,
         * ואין סיבה שיהיה קבוע בקוד.
         */
        /*
         * השורה נכתבת **גם כשהמענק אפס**. בלי זה משרד שנפתח בתקופת
         * "בלי מענק" נשאר בלי שום תנועה, כלומר "לא אותחל" לנצח —
         * וברגע שהמענק יעלה, כל המשרדים הוותיקים האלה היו מקבלים
         * אותו רטרואקטיבית. סכום אפס הוא סימון, לא מתנה.
         */
        const { initialGrantCredits } = await this.creditEconomy.current();
        await tx.creditLedger.create({
          data: {
            id: ulid(),
            tenantId,
            kind: "initial_grant",
            amount: initialGrantCredits,
          },
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
      propertyTypes: string[];
      areaSqmMin: number | null;
      budgetMinAgorot: bigint | null;
      budgetMaxAgorot: bigint | null;
      roomsMin: unknown;
      roomsMax: unknown;
      entryType: string | null;
      entryBy: Date | null;
      financing: string | null;
      maturity: string | null;
      mustFeatures: string[];
      niceFeatures: string[];
      searchAreas: unknown;
      source: string;
      status: string;
      commissionSplit: number;
      createdAt: Date;
    },
    viewerTenantId: string,
    prices: readonly LeadSourcePrice[],
    office?: OfficeBadge,
  ): SharedDemandDto {
    const mine = row.tenantId === viewerTenantId;
    return {
      id: row.id,
      cities: row.cities,
      neighborhoods: row.neighborhoods,
      searchAreas: readSearchAreas(row.searchAreas),
      ...(row.notes ? { notes: row.notes } : {}),
      dealType: row.dealType,
      propertyTypes: row.propertyTypes,
      ...(row.areaSqmMin === null ? {} : { areaSqmMin: row.areaSqmMin }),
      ...(row.budgetMinAgorot === null
        ? {}
        : { budgetMinAgorot: Number(row.budgetMinAgorot) }),
      ...(row.budgetMaxAgorot === null
        ? {}
        : { budgetMaxAgorot: Number(row.budgetMaxAgorot) }),
      roomsMin: row.roomsMin === null ? undefined : Number(row.roomsMin),
      roomsMax: row.roomsMax === null ? undefined : Number(row.roomsMax),
      ...(row.entryType === null ? {} : { entryType: row.entryType }),
      ...(row.entryBy === null ? {} : { entryBy: row.entryBy }),
      ...(row.financing === null ? {} : { financing: row.financing }),
      ...(row.maturity === null ? {} : { maturity: row.maturity }),
      mustFeatures: row.mustFeatures,
      niceFeatures: row.niceFeatures,
      source: row.source,
      sourceLabel: leadSourceLabel(row.source, prices),
      creditsCost: coopOfferCost(row.source, prices),
      commissionSplit: row.commissionSplit,
      status: row.status,
      mine,
      ...(office === undefined ? {} : { officeName: office.name }),
      ...(office?.logoUrl === undefined ? {} : { officeLogoUrl: office.logoUrl }),
      // הקישור לקונה נחשף רק לסוכנות המקור — לעולם לא לרשת (docs/04 §7)
      originBuyerId: mine ? (row.originBuyerId ?? undefined) : undefined,
      createdAt: row.createdAt,
    };
  }
}
