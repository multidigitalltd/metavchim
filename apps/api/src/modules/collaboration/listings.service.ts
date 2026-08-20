import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  commissionSplitRejectionReason,
  scoreMatch,
  summarizeReach,
  type PropertyFields,
  type ReachSummary,
} from "@metavchim/shared";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { StorageService } from "../../core/storage.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { DealRoomService } from "./deal-room.service";
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
 * הכיוון השני של הרשת — **נכס שמתפרסם, וקונה שמביע בו עניין.**
 *
 * הרשת ידעה לומר "יש לי קונה, למי יש נכס" ולא את ההפך. משרד עם נכס
 * תקוע ומשרד עם קונה מתאים לא נפגשו אלא אם הראשון במקרה גלל את
 * הפיד — כלומר חצי מהשוק לא נפגש.
 *
 * ## למה שירות נפרד
 *
 * `collaboration.service.ts` כבר עומד על 1,300 שורות ונושא שלושה
 * מנגנונים. הכיוון החדש הוא מנגנון רביעי עם אותו מבנה בדיוק, ודחיפה
 * שלו לאותו קובץ הייתה הופכת אותו לבלתי קריא. הגבול נקי: כאן חיים
 * הפרסום, העניין וההצעה לפרסם — ותו לא.
 *
 * ## הגבול של מה שנחשף
 *
 * זהה לצד הקיים ולא הקלה שלו: אזור, סוג, חדרים, שטח, קומה, מצב,
 * מחיר, מועד כניסה ומאפיינים. **בלי רחוב, בלי מספר בית ובלי
 * בעלים.** המחיר כאן מדויק ולא מעוגל — תקציב הוא מידע פרטי של אדם,
 * ומחיר מבוקש הוא מה שהמוכר מפרסם ממילא.
 */

/** מיקום מעוגל — ראו `roundCoord`. */
const COORD_PRECISION = 100;

/**
 * דיוק המיקום שהרשת מקבלת.
 *
 * שתי ספרות אחרי הנקודה ≈ קילומטר. מספיק כדי שאזור חיפוש של קונה
 * יידע אם הנכס בתוכו, ולא מספיק כדי לגזור בניין. מיקום מדויק לצד
 * מחיר וחדרים הוא כתובת בכל דבר מלבד השם.
 */
function roundCoord(value: number | null): number | null {
  return value === null
    ? null
    : Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}

export interface SharedListingDto {
  id: string;
  city?: string;
  neighborhood?: string;
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  condition?: string;
  priceAgorot?: number;
  entryType?: string;
  entryDate?: Date;
  features: string[];
  title?: string;
  notes?: string;
  /**
   * תמונות הנכס — כתובות חתומות קצרות-חיים.
   *
   * מתווך אינו מציע נכס ללקוח שלו על סמך טבלה, ובלי תמונה הפיד
   * נקרא ולא מופעל. הכתובת המדויקת והבעלים ממשיכים לא להיחשף —
   * התמונות מציגות את מה שכבר מותר, לא יותר.
   */
  photos: string[];
  commissionSplit: number;
  status: string;
  /** true אם הפרסום שלי — רק אז יש קישור לנכס. */
  mine: boolean;
  /**
   * האם המשתמש הזה רשאי לשנות את התנאים או להוריד את הפרסום.
   *
   * המסך צריך את זה כדי **לא להציע כפתור שייכשל**: אחרי שהבעלות
   * נאכפת בשרת, סוכן שרואה פרסום של עמית היה לוחץ "עדכן" ומקבל
   * 403 על פעולה שהמסך הזמין אותו לעשות.
   */
  canManage: boolean;
  /** המשרד שפרסם את הנכס לרשת. */
  officeName?: string;
  /** לוגו המשרד המפרסם — כתובת חתומה קצרת-חיים, כשיש. */
  officeLogoUrl?: string;
  originPropertyId?: string;
  createdAt: Date;
  /** הקונים שלי שמתאימים — מחושב במנוע ההתאמות, לא ניחוש. */
  myMatches?: {
    buyerId: string;
    name: string;
    score: number;
    explanation: string;
  }[];
  /** כבר הבעתי עניין בשם קונה כלשהו — אין להציע פעמיים. */
  interestSent?: boolean;
}

type PropertyRow = Prisma.PropertyGetPayload<object>;

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contacts: ContactsService,
    private readonly plans: PlanCatalogService,
    private readonly storage: StorageService,
    // אישור פנייה פותח חדר עסקה משותף — ראו `DealRoomService`
    private readonly dealRoom: DealRoomService,
  ) {}

  /**
   * הנכס → הצילום שהרשת רואה. **הגבול נמצא כאן.**
   *
   * מקום אחד לפרסום ולרענון כאחד — שתי גרסאות של אותה המרה היו
   * נפרדות ביום שמישהו מוסיף שדה, וזו בדיוק הטעות שדולפת מידע.
   * רחוב, מספר בית ומזהה הבעלים אינם ברשימה ולכן אינם נשמרים — לא
   * "מוסתרים במסך" אלא לא קיימים בטבלה.
   */
  private snapshot(
    property: PropertyRow,
  ): Omit<
    Prisma.SharedListingUncheckedCreateInput,
    "id" | "tenantId" | "originPropertyId" | "commissionSplit" | "notes"
  > {
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
    return {
      city: property.city,
      neighborhood: property.neighborhood,
      propertyType: property.propertyType,
      dealType: property.dealType,
      rooms: property.rooms,
      areaSqm: property.areaSqm,
      floor: property.floor,
      totalFloors: property.totalFloors,
      condition: property.condition,
      priceAgorot: property.priceAgorot,
      entryType: property.entryType,
      entryDate: property.entryDate,
      features,
      title: property.marketingTitle,
      latitude: roundCoord(property.latitude),
      longitude: roundCoord(property.longitude),
    };
  }

  /** פרסום נכס לרשת. */
  async publish(
    propertyId: string,
    commissionSplit: number,
    note?: string,
  ): Promise<SharedListingDto> {
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();
    const rejection = commissionSplitRejectionReason(commissionSplit);
    if (rejection !== null) throw new BadRequestException(rejection);

    await this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");

      /*
       * התמונות נשלפות כאן ולא ב-`snapshot`: הן חיות בטבלה נפרדת,
       * וקריאה למסד בתוך פונקציה שאמורה להיות המרה טהורה הייתה
       * מסתירה שאילתה במקום שאיש לא מחפש אותה.
       *
       * `image` בלבד — מסמכים ותוכניות אינם חלק ממה שהרשת רואה.
       * חמש הראשונות לפי סדר התצוגה: מודעה אינה גלריה, וההגבלה
       * שומרת גם על גודל התשובה בפיד.
       */
      const photos = await tx.propertyMedia.findMany({
        where: { tenantId, propertyId, kind: "image" },
        orderBy: { sortOrder: "asc" },
        take: 5,
        select: { s3Key: true },
      });
      /*
       * נכס שנמכר או ירד משיווק אינו מתפרסם. בלי הבדיקה הזו הרשת
       * הייתה מציגה נכסים שאי אפשר לקנות, ומשרד שפונה עליהם לומד
       * שלא כדאי לו לפנות בכלל.
       */
      if (property.status !== "active" && property.status !== "draft") {
        throw new BadRequestException("אפשר לפרסם רק נכס פעיל");
      }

      const existing = await tx.sharedListing.findFirst({
        where: { tenantId, originPropertyId: propertyId, status: "active" },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("הנכס כבר מפורסם ברשת");

      /*
       * המכסה נבדקת **אחרי** בדיקת הכפילות ולא לפניה: פרסום חוזר של
       * נכס שכבר מפורסם אינו צורך מקום, ולכן הוא צריך לקבל את ההודעה
       * המדויקת ("כבר מפורסם") ולא הודעת מכסה מבלבלת.
       */
      await assertNetworkQuota(
        tx,
        tenantId,
        await this.plans.forTenant(tenantId, tx),
        "listing",
      );

      await tx.sharedListing.create({
        data: {
          id,
          tenantId,
          originPropertyId: propertyId,
          commissionSplit,
          // הבעלות על התנאים — ראו `assertListingOwner`
          createdBy: TenantContext.current().userId,
          notes: note?.trim() || null,
          photoKeys: photos.map((p) => p.s3Key),
          ...this.snapshot(property),
        },
      });
      await this.audit.record(tx, {
        action: "collaboration.publish_listing",
        entityType: "shared_listing",
        entityId: id,
        metadata: { propertyId, commissionSplit },
      });
    });

    return this.getListing(id);
  }

  /**
   * מי רשאי לגעת בתנאי פרסום קיים — **המפרסם או מנהל.**
   *
   * חלוקת העמלה אינה העדפה פנימית אלא התחייבות כלפי משרדים אחרים
   * שרואים אותה בלוח ומחליטים לפיה אם להשקיע נכס. שליפה לפי
   * `tenantId` בלבד אפשרה לכל סוכן במשרד לשנות את התנאים של עמית —
   * או להוריד את הפרסום שלו — בלי ידיעתו.
   *
   * `network.share_all` היא הצורה הניהולית של הכלל: מי שמנהל את
   * פעילות הרשת של המשרד כן צריך לתקן תנאים שסוכן שיצא לחופשה קבע.
   * פרסום ישן בלי `createdBy` נשאר בידיו בלבד — ברירת המחדל
   * השמרנית, ולא „פתוח לכולם”.
   */
  private mayManageListing(listing: { createdBy: string | null }): boolean {
    const ctx = TenantContext.current();
    if (ctx.capabilities.has("collaboration.manage_all")) return true;
    return listing.createdBy !== null && listing.createdBy === ctx.userId;
  }

  /**
   * הצורה הזורקת של אותה שאלה.
   *
   * הפרדה מכוונת: `canManage` ב-DTO ובדיקת השער חייבים להיות אותו
   * חישוב, אחרת המסך מסתיר כפתור שהשרת דווקא מאשר — או גרוע יותר,
   * מציג כפתור שייכשל.
   */
  private assertListingOwner(listing: { createdBy: string | null }): void {
    if (this.mayManageListing(listing)) return;
    throw new ForbiddenException("רק הסוכן שפרסם את הנכס יכול לשנות את תנאי הפרסום");
  }

  async updatePublication(
    propertyId: string,
    commissionSplit: number,
    note?: string,
  ): Promise<SharedListingDto> {
    const tenantId = TenantContext.current().tenantId;
    const rejection = commissionSplitRejectionReason(commissionSplit);
    if (rejection !== null) throw new BadRequestException(rejection);

    const listingId = await this.prisma.withTenant(async (tx) => {
      const existing = await tx.sharedListing.findFirst({
        where: { tenantId, originPropertyId: propertyId, status: "active" },
        select: { id: true, createdBy: true },
      });
      if (!existing) throw new NotFoundException("הנכס אינו מפורסם ברשת");
      this.assertListingOwner(existing);
      await tx.sharedListing.updateMany({
        where: { id: existing.id, tenantId, status: "active" },
        data: { commissionSplit, notes: note?.trim() || null },
      });
      await this.audit.record(tx, {
        action: "collaboration.publish_update",
        entityType: "shared_listing",
        entityId: existing.id,
        metadata: { propertyId, commissionSplit },
      });
      return existing.id;
    });
    return this.getListing(listingId);
  }

  async unpublish(propertyId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      /*
       * אותו שער כמו בשינוי התנאים, ומאותו נימוק — למעשה חמור יותר:
       * הורדת פרסום של עמית מוחקת הזדמנות שכבר מוצגת למשרדים אחרים.
       */
      const existing = await tx.sharedListing.findFirst({
        where: { tenantId, originPropertyId: propertyId, status: "active" },
        select: { createdBy: true },
      });
      if (!existing) throw new NotFoundException("הנכס אינו מפורסם ברשת");
      this.assertListingOwner(existing);

      const result = await tx.sharedListing.updateMany({
        where: { tenantId, originPropertyId: propertyId, status: "active" },
        data: { status: "closed" },
      });
      if (result.count === 0)
        throw new NotFoundException("הנכס אינו מפורסם ברשת");
      await this.audit.record(tx, {
        action: "collaboration.unpublish_listing",
        entityType: "shared_listing",
        entityId: propertyId,
      });
    });
  }

  /**
   * רענון הצילום אחרי עריכת הנכס.
   *
   * הפרסום הוא **צילום** ולא הפניה חיה, כך שהוא נשאר אנונימי גם
   * אחרי שהנכס נמחק. אבל צילום שאינו מתרענן מזדקן: נכס שירד במחיר
   * מ-2.3 ל-2.1 מיליון נשאר מוצג לרשת ב-2.3, ומשרד אחר מחליט על
   * סמך מידע שאינו נכון. זו בדיוק התקלה שכבר תוקנה בצד הקונה.
   *
   * שקט כשאין פרסום פעיל: רוב הנכסים אינם מפורסמים, ועריכה שלהם
   * אינה אמורה להיכשל בגלל מודול שאין לו מה לעשות.
   */
  async resyncForProperty(propertyId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const listing = await tx.sharedListing.findFirst({
        where: { tenantId, originPropertyId: propertyId, status: "active" },
        select: { id: true },
      });
      if (!listing) return;
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
      });
      /*
       * נכס שנמחק או ירד משיווק — הפרסום נסגר ולא מתרענן. נכס שאי
       * אפשר לקנות אינו אמור להישאר בפיד.
       */
      if (
        !property ||
        (property.status !== "active" && property.status !== "draft")
      ) {
        await tx.sharedListing.updateMany({
          where: { id: listing.id, tenantId },
          data: { status: "closed" },
        });
        return;
      }
      await tx.sharedListing.update({
        where: { id: listing.id },
        // חלוקת העמלה והתיאור **אינם** נדרסים: הם נכתבו בפרסום
        // עצמו ואינם נגזרים מהנכס.
        data: this.snapshot(property),
      });
    });
  }

  /**
   * סגירת הפרסום **בתוך** הטרנזקציה שמורידה את הנכס.
   *
   * `resyncForProperty` מספיק לעריכה — שם הכישלון הגרוע ביותר הוא
   * צילום ישן, והוא מתוקן בעריכה הבאה. כאן הכישלון הגרוע ביותר הוא
   * נכס שהמשרד הוריד משיווק וממשיך להיות מוצג לכל הרשת, ולכן
   * הסגירה חייבת להיות אטומית עם המחיקה ולא ניסיון "כמיטב היכולת"
   * שאפשר לבלוע (ביקורת Codex).
   */
  async closeForProperty(tx: TenantTx, propertyId: string): Promise<void> {
    await tx.sharedListing.updateMany({
      where: {
        tenantId: TenantContext.current().tenantId,
        originPropertyId: propertyId,
        status: "active",
      },
      data: { status: "closed" },
    });
  }

  /** מצב הפרסום של נכס מסוים — null כשאינו מפורסם. */
  async activeForProperty(
    propertyId: string,
  ): Promise<SharedListingDto | null> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.sharedListing.findFirst({
        where: { tenantId, originPropertyId: propertyId, status: "active" },
      }),
    );
    return row === null ? null : await this.toDto(row, tenantId);
  }

  private async getListing(id: string): Promise<SharedListingDto> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.sharedListing.findFirst({ where: { id } }),
    );
    if (!row) throw new NotFoundException("פרסום לא נמצא");
    return await this.toDto(row, tenantId);
  }

  /**
   * `async` בגלל התמונות בלבד.
   *
   * הכתובות נחתמות בזמן הקריאה ולא נשמרות: כתובת חתומה בטבלה פגה
   * אחרי שעה ומשאירה תמונה שבורה במודעה. החתימה היא קריאה
   * מקומית לספרייה ולא פנייה לרשת, ולכן היא זולה גם בפיד שלם.
   */
  private async toDto(
    row: Prisma.SharedListingGetPayload<object>,
    viewerTenantId: string,
    office?: OfficeBadge,
  ): Promise<SharedListingDto> {
    const mine = row.tenantId === viewerTenantId;
    /*
     * תמונה שאין לה מפתח תקין אינה מפילה את המודעה כולה: היא
     * פשוט אינה מוצגת. מודעה בלי תמונה שווה יותר משגיאת שרת.
     */
    const photos = (
      await Promise.all(
        row.photoKeys.map((key) =>
          this.storage.signedGetUrl(key).catch(() => null),
        ),
      )
    ).filter((url): url is string => url !== null);
    return {
      id: row.id,
      ...(row.city === null ? {} : { city: row.city }),
      ...(row.neighborhood === null ? {} : { neighborhood: row.neighborhood }),
      ...(row.propertyType === null ? {} : { propertyType: row.propertyType }),
      ...(row.dealType === null ? {} : { dealType: row.dealType }),
      ...(row.rooms === null ? {} : { rooms: Number(row.rooms) }),
      ...(row.areaSqm === null ? {} : { areaSqm: row.areaSqm }),
      ...(row.floor === null ? {} : { floor: row.floor }),
      ...(row.totalFloors === null ? {} : { totalFloors: row.totalFloors }),
      ...(row.condition === null ? {} : { condition: row.condition }),
      ...(row.priceAgorot === null
        ? {}
        : { priceAgorot: Number(row.priceAgorot) }),
      ...(row.entryType === null ? {} : { entryType: row.entryType }),
      ...(row.entryDate === null ? {} : { entryDate: row.entryDate }),
      features: row.features,
      photos,
      ...(row.title === null ? {} : { title: row.title }),
      ...(row.notes === null ? {} : { notes: row.notes }),
      commissionSplit: row.commissionSplit,
      status: row.status,
      mine,
      // רק על הפרסומים שלנו — למודעה של משרד אחר אין משמעות לשאלה
      canManage: mine && this.mayManageListing(row),
      ...(office === undefined ? {} : { officeName: office.name }),
      ...(office?.logoUrl === undefined ? {} : { officeLogoUrl: office.logoUrl }),
      // הקישור לנכס נחשף רק לסוכנות המקור — לעולם לא לרשת
      ...(mine ? { originPropertyId: row.originPropertyId } : {}),
      createdAt: row.createdAt,
    };
  }

  /**
   * צילום הנכס כפי שמנוע ההתאמות קורא אותו.
   *
   * הפרסום נושא בדיוק את השדות שהמנוע צריך, ולכן אין כאן שחזור אלא
   * העברה. `rowToFields` אינו מתאים — הוא מצפה לשורת נכס מלאה עם
   * רחוב ובעלים, ואלה בכוונה אינם קיימים כאן.
   */
  private listingToFields(
    row: Prisma.SharedListingGetPayload<object>,
  ): PropertyFields {
    return {
      ...(row.city === null ? {} : { city: row.city }),
      ...(row.neighborhood === null ? {} : { neighborhood: row.neighborhood }),
      ...(row.propertyType === null ? {} : { propertyType: row.propertyType }),
      ...(row.dealType === null ? {} : { dealType: row.dealType }),
      ...(row.rooms === null ? {} : { rooms: Number(row.rooms) }),
      ...(row.areaSqm === null ? {} : { areaSqm: row.areaSqm }),
      ...(row.floor === null ? {} : { floor: row.floor }),
      ...(row.priceAgorot === null
        ? {}
        : { priceAgorot: Number(row.priceAgorot) }),
      ...(row.entryType === null ? {} : { entryType: row.entryType }),
      ...(row.entryDate === null ? {} : { entryDate: row.entryDate }),
      ...(row.latitude === null ? {} : { latitude: row.latitude }),
      ...(row.longitude === null ? {} : { longitude: row.longitude }),
      /*
       * המאפיינים חוזרים לשדות בוליאניים, כי כך המנוע קורא אותם.
       * מה שאינו ברשימה נשאר `undefined` — "לא ידוע" ולא "אין",
       * וזו הבחנה שהמנוע כבר מכיר.
       */
      ...Object.fromEntries(row.features.map((f) => [f, true])),
      customFeatures: row.features
        .filter((f) => f.startsWith("custom:"))
        .map((f) => ({
          key: f,
          label: f.slice("custom:".length),
          value: true,
        })),
    } as unknown as PropertyFields;
  }

  /**
   * הקונים ש**המשתמש הזה** רשאי לראות — לא כל קוני המשרד.
   *
   * סוכן עם `buyers.view_own` בלבד אינו רואה את הקונים של עמיתיו
   * בשום מסך אחר, ואין סיבה שהרשת תהיה החריג: פיד שמציג לו "הקונה
   * של דנה מתאים לנכס הזה" חושף בפניו לקוח שאינו שלו, ולחיצה על
   * הכפתור שולחת את הדרישות, המימון והבשלות של אותו לקוח למשרד
   * אחר (ביקורת Codex).
   *
   * אותו `ownershipFilter` בדיוק שכל שאר נתיבי הקונים משתמשים בו —
   * ולא כלל שני שאפשר לשכוח לעדכן.
   */
  private ownBuyersWhere(tenantId: string): Prisma.BuyerWhereInput {
    return {
      tenantId,
      deletedAt: null,
      ...ownershipFilter("buyers.view_all", "ownerUserId"),
    };
  }

  /**
   * תנאי הסינון של פיד הנכסים.
   *
   * רץ בשרת ולפני חיתוך ה-100, כדי ש"אין תוצאות" יהיה תשובה על הרשת
   * כולה ולא על החלון האחרון שלה.
   *
   * כאן, בשונה מהביקושים, העיר והשכונה הן עמודות טקסט רגילות ולא
   * מערכים — ולכן ILIKE על כל מונח בנפרד עובד, ואין צורך בהתאמה
   * לאיבר שלם.
   *
   * לנכס יש מחיר אחד ומספר חדרים אחד. שדה ריק פירושו "לא ידוע"
   * והמודעה נשארת גלויה: להסתיר מודעה בגלל מה שלא מולא היה מסתיר
   * בדיוק את הנכסים שכדאי לשאול עליהם.
   */
  private async filterWhere(
    filter: NetworkFilter,
  ): Promise<Prisma.SharedListingWhereInput> {
    const conditions: Prisma.SharedListingWhereInput[] = [];
    const terms = networkTerms(filter);
    const price = networkPrice(filter);
    const rooms = networkRooms(filter);

    if (price.min !== undefined) {
      conditions.push({
        OR: [{ priceAgorot: { gte: price.min } }, { priceAgorot: null }],
      });
    }
    if (price.max !== undefined) {
      conditions.push({
        OR: [{ priceAgorot: { lte: price.max } }, { priceAgorot: null }],
      });
    }
    if (rooms.min !== undefined) {
      conditions.push({ OR: [{ rooms: { gte: rooms.min } }, { rooms: null }] });
    }
    if (rooms.max !== undefined) {
      conditions.push({ OR: [{ rooms: { lte: rooms.max } }, { rooms: null }] });
    }

    if (terms.length > 0) {
      const offices = await officeIdsMatching(this.prisma, filter);
      conditions.push({
        OR: [
          {
            AND: terms.map((term) => ({
              OR: [
                { city: { contains: term, mode: "insensitive" as const } },
                {
                  neighborhood: {
                    contains: term,
                    mode: "insensitive" as const,
                  },
                },
                { title: { contains: term, mode: "insensitive" as const } },
                { notes: { contains: term, mode: "insensitive" as const } },
              ],
            })),
          },
          ...(offices.length > 0 ? [{ tenantId: { in: offices } }] : []),
        ],
      });
    }

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  /**
   * פיד הנכסים ברשת — הרשת כולה, כולל שלי (מסומנים).
   *
   * לכל נכס מחושבים הקונים **שלי** שמתאימים לו, באותו מנוע ובאותו
   * סף כמו בכיוון השני. בלי זה המתווך היה עובר על עשרות נכסים
   * ומנחש למי מהקונים שלו להראות אותם.
   */
  async list(filter: NetworkFilter = {}): Promise<SharedListingDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const where = await this.filterWhere(filter);
    const visible = await this.prisma.withNetworkRead((tx) =>
      tx.sharedListing.findMany({
        where: { status: "active", ...where },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    if (visible.length === 0) return [];

    const { buyers, names, alreadySent } = await this.prisma.withTenant(
      async (tx) => {
        const rows = await tx.buyer.findMany({
          where: this.ownBuyersWhere(tenantId),
          take: 200,
        });
        const sent = await tx.coopInterest.findMany({
          where: {
            fromTenantId: tenantId,
            listingId: { in: visible.map((l) => l.id) },
          },
          select: { listingId: true },
        });
        /*
         * השמות מפוענחים בקריאה אחת לכל הרשימה. שם של איש קשר מוצפן
         * במסד, ופענוח פר-שורה היה מייצר בדיוק את ה-N+1 שכבר תוקן
         * בשאר המודול.
         */
        return {
          buyers: rows,
          names: await this.contacts.getByIds(
            tx,
            rows.map((b) => b.contactId),
          ),
          alreadySent: new Set(sent.map((i) => i.listingId)),
        };
      },
    );

    const offices = await officeBadges(
      this.prisma,
      this.storage,
      visible.map((row) => row.tenantId),
    );

    /*
     * `Promise.all` ולא לולאה סדרתית: חתימת התמונות היא החישוב
     * היחיד שנוסף כאן, והיא מקומית — המתנה לכל מודעה בתורה הייתה
     * מוסיפה השהיה לפיד בלי שום סיבה.
     */
    return await Promise.all(
      visible.map(async (row) => {
        const dto = await this.toDto(row, tenantId, offices.get(row.tenantId));
        if (dto.mine) return dto;
        const matches = this.matchOwnBuyers(buyers, names, row);
        return {
          ...dto,
          ...(matches.length > 0 ? { myMatches: matches } : {}),
          interestSent: alreadySent.has(row.id),
        };
      }),
    );
  }

  /** שלוש ההתאמות הטובות ביותר מבין הקונים שלי, מעל סף שווה-הצגה. */
  private matchOwnBuyers(
    buyers: readonly Prisma.BuyerGetPayload<object>[],
    names: ReadonlyMap<string, { name: string }>,
    row: Prisma.SharedListingGetPayload<object>,
  ): { buyerId: string; name: string; score: number; explanation: string }[] {
    const fields = this.listingToFields(row);
    return buyers
      .map((buyer) => {
        /*
         * **בלי משקלי המשרד — בכוונה.** הציון הזה מוצג לצד השני
         * ברשת, ומשקלים מקומיים היו הופכים "82%" למספר שאין לו
         * משמעות משותפת.
         */
        const result = scoreMatch(
          fields,
          BuyerRequirementsSchema.parse(buyer.requirements),
        );
        return { buyer, result };
      })
      .filter(
        ({ result }) =>
          !result.excluded && result.score >= NETWORK_MATCH_MIN_SCORE,
      )
      .sort((a, b) => b.result.score - a.result.score)
      .slice(0, 3)
      .map(({ buyer, result }) => ({
        buyerId: buyer.id,
        name: names.get(buyer.contactId)?.name ?? "קונה",
        score: result.score,
        explanation: result.explanation,
      }));
  }

  /**
   * "יש לי קונה לנכס שלך" — התמונה המשלימה להצעת נכס.
   *
   * הצילום של הקונה נשלח בלי שם, טלפון או אימייל, בדיוק כמו ביקוש
   * שמתפרסם. הצד השני מחליט על סמך מה שהקונה מחפש ומה מצב המימון
   * שלו — לא על סמך מי הוא.
   */
  async expressInterest(
    listingId: string,
    buyerId: string,
    commissionSplit: number,
  ): Promise<void> {
    const ctx = TenantContext.current();
    const rejection = commissionSplitRejectionReason(commissionSplit);
    if (rejection !== null) throw new BadRequestException(rejection);
    const id = ulid();

    const listing = await this.prisma.withNetworkRead((tx) =>
      tx.sharedListing.findFirst({
        where: { id: listingId, status: "active" },
      }),
    );
    if (!listing) throw new NotFoundException("פרסום לא נמצא");
    if (listing.tenantId === ctx.tenantId) {
      throw new BadRequestException("אי אפשר להביע עניין בנכס של המשרד עצמו");
    }

    await this.prisma.withTenant(async (tx) => {
      /*
       * הבעלות נבדקת גם כאן ולא רק בפיד. ידיעת מזהה אינה הרשאה:
       * הפיד מסונן, אבל הנתיב הזה מקבל `buyerId` מהלקוח, וסוכן עם
       * `view_own` יכול לשלוח מזהה של קונה שאינו שלו — ולשגר את
       * הדרישות, המימון והבשלות שלו למשרד אחר.
       */
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, ...this.ownBuyersWhere(ctx.tenantId) },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");

      /*
       * פנייה כפולה נחסמת כאן ולא רק במפתח הייחודי שבמסד.
       *
       * המסך מסתיר את הכפתור אחרי פנייה, אבל "להציע קונה אחר"
       * וכפתור שנלחץ פעמיים עדיין מגיעים לכאן — ואז הפרה של
       * `@@unique([listingId, buyerId])` צפה כ-500 "Internal server
       * error". שגיאה כזו נראית למתווך כמו תקלה במערכת, והוא פונה
       * לתמיכה על פעולה שפשוט כבר בוצעה.
       */
      const already = await tx.coopInterest.findFirst({
        where: { listingId, buyerId },
        select: { id: true },
      });
      if (already)
        throw new BadRequestException("כבר פניתם על הנכס הזה עבור הקונה הזה");

      const requirements = BuyerRequirementsSchema.parse(buyer.requirements);
      const featureLevels = Object.entries(requirements.features);
      /* בדיוק אותם שדות שהביקוש חושף — ולא יותר */
      const presentation = {
        cities: requirements.cities,
        neighborhoods: requirements.neighborhoods,
        dealType: buyer.dealType,
        propertyTypes: requirements.propertyTypes,
        // `Number(null)` הוא 0 — "עד 0 ₪" בכרטיס ההצעה
        ...(buyer.budgetMaxAgorot === null
          ? {}
          : { budgetMaxAgorot: Number(buyer.budgetMaxAgorot) }),
        ...(buyer.roomsMin === null
          ? {}
          : { roomsMin: Number(buyer.roomsMin) }),
        ...(buyer.roomsMax === null
          ? {}
          : { roomsMax: Number(buyer.roomsMax) }),
        ...(requirements.areaSqmMin === undefined
          ? {}
          : { areaSqmMin: requirements.areaSqmMin }),
        ...(requirements.entryType === undefined
          ? {}
          : { entryType: requirements.entryType }),
        financing: buyer.financing,
        maturity: buyer.maturity,
        mustFeatures: featureLevels
          .filter(([, l]) => l === "must")
          .map(([f]) => f),
        niceFeatures: featureLevels
          .filter(([, l]) => l === "nice")
          .map(([f]) => f),
      };

      await tx.coopInterest.create({
        data: {
          id,
          listingId,
          fromTenantId: ctx.tenantId,
          toTenantId: listing.tenantId,
          buyerId,
          presentation,
          commissionSplit,
          // מי הציע — כדי שחדר העסקה יידע למי להרים טלפון
          createdBy: ctx.userId ?? null,
        },
      });
      await this.audit.record(tx, {
        action: "collaboration.interest",
        entityType: "coop_interest",
        entityId: id,
        metadata: { listingId, buyerId },
      });
    });
  }

  /**
   * תגובה לפניית קונה. „מעוניין” פותח חדר עסקה משותף ומחזיר את
   * מזההו — התמונה המשלימה ל-`respondToCoopOffer`, ומאותה סיבה:
   * חיבור בלי מקום לעבוד בו הוא חיבור שממשיך בוואטסאפ.
   */
  async respondToInterest(
    id: string,
    response: "interested" | "declined",
  ): Promise<{ dealId: string | null }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.coopInterest.updateMany({
        where: { id, toTenantId: tenantId, status: "sent" },
        data: { status: response },
      });
      if (result.count === 0) throw new NotFoundException("פנייה לא נמצאה");
      await this.audit.record(tx, {
        action: `collaboration.interest_${response}`,
        entityType: "coop_interest",
        entityId: id,
      });
    });
    // אחרי ה-Commit: פתיחת החדר נוגעת בשני דיירים ושולחת מייל
    if (response !== "interested") return { dealId: null };
    return { dealId: await this.dealRoom.openFromInterest(id) };
  }

  /** מה שהתקבל עליי — קונים שמשרדים אחרים מציעים על הנכסים שפרסמתי. */
  async listInterests(): Promise<
    {
      id: string;
      listingId: string;
      propertyId?: string;
      propertyTitle?: string;
      presentation: Record<string, unknown>;
      commissionSplit: number;
      status: string;
      createdAt: Date;
    }[]
  > {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.coopInterest.findMany({
        where: { toTenantId: tenantId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      if (rows.length === 0) return [];
      /*
       * שאילתה אחת לכל הרשימה ולא אחת לשורה: בלי זה מסך עם עשרים
       * פניות היה מייצר עשרים שאילתות, וזה בדיוק ה-N+1 שכבר תוקן
       * בשאר המודול.
       */
      const listings = await tx.sharedListing.findMany({
        where: { id: { in: rows.map((r) => r.listingId) }, tenantId },
        select: { id: true, originPropertyId: true, title: true, city: true },
      });
      const byId = new Map(listings.map((l) => [l.id, l]));
      return rows.map((row) => {
        const listing = byId.get(row.listingId);
        /*
         * "על איזה נכס" הוא הפרט שקובע מה עושים עם הפנייה. משרד
         * שפרסם חמישה נכסים קיבל חמש פניות שנראו זהות ולא ידע על
         * מה מדובר. כותרת שיווקית עדיפה, העיר היא הנפילה — ואם גם
         * היא חסרה עדיף בלי כותרת מאשר "נכס בundefined".
         */
        const title =
          listing?.title ??
          (listing?.city === null || listing?.city === undefined
            ? null
            : `נכס ב${listing.city}`);
        return {
          id: row.id,
          listingId: row.listingId,
          ...(listing === undefined
            ? {}
            : { propertyId: listing.originPropertyId }),
          ...(title === null ? {} : { propertyTitle: title }),
          presentation: row.presentation as Record<string, unknown>,
          commissionSplit: row.commissionSplit,
          status: row.status,
          createdAt: row.createdAt,
        };
      });
    });
  }

  /**
   * מה מהמאגר שלי מתאים למשהו שכבר ברשת — ואינו מפורסם בה.
   *
   * **לראות את הרשת אינו דורש שיתוף; להיראות בה כן.** סוכן שפותח
   * את הפיד רואה נכסים וביקושים של אחרים, ולא יודע שהנכס שלו —
   * שמתאים לשלושה מהם — אינו מפורסם, ולכן אף אחד מהם לא יפנה אליו.
   * הוא לא יודע כי עד עכשיו לא היה מקום שאומר לו.
   *
   * הכלל עצמו יושב ב-`logic/network-reach.ts`; כאן רק אוספים את
   * הנתונים ומריצים את המנוע.
   */
  async reach(): Promise<ReachSummary> {
    const tenantId = TenantContext.current().tenantId;
    const [demands, listings] = await this.prisma.withNetworkRead(
      async (tx) => [
        await tx.sharedDemand.findMany({
          where: { status: "active", tenantId: { not: tenantId } },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        await tx.sharedListing.findMany({
          where: { status: "active", tenantId: { not: tenantId } },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ],
    );
    if (demands.length === 0 && listings.length === 0) {
      return summarizeReach({ properties: [], buyers: [] });
    }

    return this.prisma.withTenant(async (tx) => {
      const [properties, buyers, sharedListings, sharedDemands] = [
        await tx.property.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: { in: ["active", "draft"] },
          },
          take: 200,
        }),
        await tx.buyer.findMany({
          where: this.ownBuyersWhere(tenantId),
          take: 200,
        }),
        await tx.sharedListing.findMany({
          where: { tenantId, status: "active" },
          select: { originPropertyId: true },
        }),
        await tx.sharedDemand.findMany({
          where: { tenantId, status: "active" },
          select: { originBuyerId: true },
        }),
      ];
      const names = await this.contacts.getByIds(
        tx,
        buyers.map((b) => b.contactId),
      );
      const publishedProperties = new Set(
        sharedListings.map((l) => l.originPropertyId),
      );
      const publishedBuyers = new Set(
        sharedDemands
          .map((d) => d.originBuyerId)
          .filter((v): v is string => v !== null),
      );

      const demandRequirements = demands.map((d) => demandToRequirements(d));
      const listingFields = listings.map((l) => this.listingToFields(l));

      return summarizeReach({
        properties: properties.map((property) => {
          const fields = rowToFields(property);
          return {
            id: property.id,
            title:
              property.marketingTitle ??
              [property.street, property.city].filter(Boolean).join(", ") ??
              "נכס",
            shared: publishedProperties.has(property.id),
            scores: demandRequirements
              .map((req) => scoreMatch(fields, req))
              .filter((r) => !r.excluded)
              .map((r) => r.score),
          };
        }),
        buyers: buyers.map((buyer) => {
          const requirements = BuyerRequirementsSchema.parse(
            buyer.requirements,
          );
          return {
            id: buyer.id,
            title: names.get(buyer.contactId)?.name ?? "קונה",
            shared: publishedBuyers.has(buyer.id),
            scores: listingFields
              .map((fields) => scoreMatch(fields, requirements))
              .filter((r) => !r.excluded)
              .map((r) => r.score),
          };
        }),
      });
    });
  }
}

/** אותו סף כמו בכיוון השני — ראו `REACH_MIN_SCORE`. */
const NETWORK_MATCH_MIN_SCORE = 70;

/**
 * ביקוש → דרישות, לצורך ניקוד הנכסים שלי מולו.
 *
 * שכפול מודע של הפונקציה הפרטית שב-`collaboration.service`: ייצוא
 * שלה משם היה גורר את כל השירות לתוך המודול הזה, ומטרת ההפרדה היא
 * בדיוק ההפך. השדות זהים, והבדיקה בשני הצדדים היא אותו מנוע.
 */
function demandToRequirements(
  demand: Prisma.SharedDemandGetPayload<object>,
): ReturnType<typeof BuyerRequirementsSchema.parse> {
  return {
    cities: demand.cities,
    neighborhoods: demand.neighborhoods,
    dealType: demand.dealType,
    propertyTypes: demand.propertyTypes,
    ...(demand.areaSqmMin === null ? {} : { areaSqmMin: demand.areaSqmMin }),
    ...(demand.budgetMinAgorot === null
      ? {}
      : { budgetMinAgorot: Number(demand.budgetMinAgorot) }),
    // חסר ⇒ `scoreMatch` מדלג על קריטריון התקציב, ולא משווה מול 0
    ...(demand.budgetMaxAgorot === null
      ? {}
      : { budgetMaxAgorot: Number(demand.budgetMaxAgorot) }),
    ...(demand.roomsMin === null ? {} : { roomsMin: Number(demand.roomsMin) }),
    ...(demand.roomsMax === null ? {} : { roomsMax: Number(demand.roomsMax) }),
    ...(demand.entryType === null ? {} : { entryType: demand.entryType }),
    ...(demand.entryBy === null ? {} : { entryBy: demand.entryBy }),
    features: {
      ...Object.fromEntries(demand.niceFeatures.map((f) => [f, "nice"])),
      ...Object.fromEntries(demand.mustFeatures.map((f) => [f, "must"])),
    },
  } as unknown as ReturnType<typeof BuyerRequirementsSchema.parse>;
}
