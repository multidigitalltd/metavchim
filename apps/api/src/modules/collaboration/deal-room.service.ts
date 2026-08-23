import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ulid } from "ulid";
import {
  COOP_DEAL_STAGE_LABELS,
  coopDealMessageRejectionReason,
  coopDealMoveRejectionReason,
  coopDealStageEventBody,
  isFinalCoopDealStage,
  type CoopDealStage,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { EmailService } from "../../core/email.service";
import { loadEnv } from "../../config/env";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { collabRecipient, sendCollabMail } from "./collab-mail";
import { officeBadges } from "./office-names";

/**
 * חדר העסקה — סביבת העבודה המשותפת של שני משרדים.
 *
 * ## מה הוא פותר
 *
 * הרשת ידעה לחבר ולא לעבוד. משרד פרסם, משרד אחר הציע, הצד המקבל
 * לחץ „מעניין” — והסטטוס השתנה. שם זה נגמר: שני המשרדים נשארו עם
 * שורה על המסך ובלי שום דרך להמשיך. מי שכן המשיך עשה זאת בוואטסאפ,
 * כלומר מחוץ למערכת — ואז הנכס של המשרד רץ במקום שהמשרד לא רואה.
 *
 * החדר הוא גם קיום הבטחה שכבר נכתבה בשני מקומות: המייל על הצעת נכס
 * אומר „אישור החיבור במסך פותח את הקשר בין שני המשרדים”, וההערה על
 * `CoopOffer` בסכימה אומרת „כתובת מלאה רק אחרי אישור חיבור”. עד כאן
 * שתיהן לא התקיימו.
 *
 * ## הגבול — מה נחשף בחדר
 *
 * **הסוכנים**: שם, טלפון ואימייל, לשני הצדדים. זה מה שהופך חיבור
 * לשיחה.
 *
 * **הכתובת המדויקת של הנכס**, לצד שמביא את הקונה. בלעדיה אי אפשר
 * להגיע לסיור, וזו בדיוק ההבטחה שבסכימה.
 *
 * **הלקוחות — לא.** הקונה נשאר של המשרד שהביא אותו והמוכר של המשרד
 * שגייס אותו, גם אחרי החיבור. משרד שמקבל את הטלפון של הקונה של
 * עמיתו כבר אינו שותף אלא מחליף, וכל הרשת עומדת על כך שזה לא יקרה.
 * לכן אין כאן שום נתיב שמחזיר `Contact`.
 *
 * ## למה שירות נפרד
 *
 * אותו נימוק שהוליד את `listings.service.ts`: `collaboration.service`
 * כבר נושא ארבעה מנגנונים, והחדר הוא מנגנון חמישי עם מחזור חיים
 * משלו. הגבול נקי — כאן חיים פתיחת החדר, השרשור והשלבים.
 */

/**
 * כמה שורות מהשרשור נטענות בכל פתיחה.
 *
 * תקרה ולא הכול: חדר ותיק יכול לצבור מאות שורות, ותשובה בלי גבול
 * הופכת את פתיחת החדר לאיטית בדיוק ככל שהעסקה פעילה יותר.
 */
const THREAD_LIMIT = 500;

/** צד אחד של החדר, כפי שהוא מוצג לצד השני. */
export interface DealSideDto {
  officeName: string;
  officeLogoUrl?: string;
  /** הסוכן בפועל; חסר כשהכרטיס אינו משויך ואין בעל משרד פעיל. */
  agentName?: string;
  agentPhone?: string;
  agentEmail?: string;
}

export interface DealEntryDto {
  id: string;
  kind: string;
  body: string;
  /** האם אני כתבתי אותה — המסך מיישר לפי זה. */
  mine: boolean;
  authorName?: string;
  createdAt: Date;
}

export interface DealSummaryDto {
  id: string;
  stage: CoopDealStage;
  /** מאיזה צד אני בעסקה הזו — קובע את כיוון חלוקת העמלה במסך. */
  mySide: "listing" | "buyer";
  commissionSplit: number;
  /** כותרת קצרה לרשימה: מה הנכס. */
  title: string;
  counterpartOffice: string;
  counterpartLogoUrl?: string;
  lastActivityAt: Date;
  createdAt: Date;
}

export interface DealDto extends DealSummaryDto {
  counterpart: DealSideDto;
  me: DealSideDto;
  /** הנכס — כתובת מלאה, כי החדר כבר נפתח. */
  property: {
    id: string;
    /** מזהה פנימי רק לצד שהנכס שלו; לצד השני אין למה ללחוץ. */
    linkable: boolean;
    address: string;
    city?: string;
    rooms?: number;
    areaSqm?: number;
    priceAgorot?: string;
  };
  /** הקונה — בלי שם ובלי טלפון, בדיוק כמו בפיד. */
  buyer: {
    id: string;
    linkable: boolean;
    budgetMaxAgorot?: string;
    rooms?: number;
    cities: string[];
  };
  closedNote?: string;
  entries: DealEntryDto[];
}

@Injectable()
export class DealRoomService {
  private readonly logger = new Logger(DealRoomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
  ) {}

  /* ============================================================
     פתיחת החדר
     ============================================================ */

  /**
   * פותח חדר על הצעת נכס שאושרה, ומחזיר את מזההו.
   *
   * `null` כשאין למי לפתוח: ביקוש חיצוני (Kanko) אינו נשען על כרטיס
   * קונה במערכת, ולכן אין צד שני שאפשר להראות לו משהו. זו התוצאה
   * הנכונה ולא שגיאה — האישור עצמו תקף, פשוט אין חדר.
   *
   * נקרא מתוך `respondToCoopOffer` **אחרי** שהסטטוס כבר עודכן, ולכן
   * הוא רץ רק על הצעה שהצד המקבל באמת אישר.
   */
  async openFromOffer(offerId: string): Promise<string | null> {
    const tenantId = TenantContext.current().tenantId;
    const offer = await this.prisma.withTenant((tx) =>
      tx.coopOffer.findFirst({
        where: { id: offerId, toTenantId: tenantId },
        select: {
          id: true,
          demandId: true,
          fromTenantId: true,
          toTenantId: true,
          propertyId: true,
          commissionSplit: true,
          createdBy: true,
        },
      }),
    );
    if (!offer) return null;

    /*
     * הביקוש נקרא בהקשר הדייר המקבל — הוא בעליו. `shared_demands`
     * תחת FORCE RLS, וקריאה בלי הקשר הייתה מחזירה אפס שורות בשקט.
     */
    const demand = await this.prisma.withTenant((tx) =>
      tx.sharedDemand.findFirst({
        where: { id: offer.demandId, tenantId },
        select: { originBuyerId: true },
      }),
    );
    const buyerId = demand?.originBuyerId ?? null;
    if (buyerId === null) return null;

    return this.open({
      originType: "offer",
      originId: offer.id,
      listingTenantId: offer.fromTenantId,
      buyerTenantId: offer.toTenantId,
      propertyId: offer.propertyId,
      buyerId,
      listingUserId: offer.createdBy,
      commissionSplit: offer.commissionSplit,
    });
  }

  /**
   * פותח חדר על פניית קונה שאושרה. התמונה המשלימה בדיוק:
   * כאן הנכס שלי והקונה של הצד השני.
   */
  async openFromInterest(interestId: string): Promise<string | null> {
    const tenantId = TenantContext.current().tenantId;
    const interest = await this.prisma.withTenant((tx) =>
      tx.coopInterest.findFirst({
        where: { id: interestId, toTenantId: tenantId },
        select: {
          id: true,
          listingId: true,
          fromTenantId: true,
          toTenantId: true,
          buyerId: true,
          commissionSplit: true,
          createdBy: true,
        },
      }),
    );
    if (!interest) return null;

    const listing = await this.prisma.withTenant((tx) =>
      tx.sharedListing.findFirst({
        where: { id: interest.listingId, tenantId },
        select: { originPropertyId: true, createdBy: true },
      }),
    );
    if (!listing) return null;

    return this.open({
      originType: "interest",
      originId: interest.id,
      listingTenantId: interest.toTenantId,
      buyerTenantId: interest.fromTenantId,
      propertyId: listing.originPropertyId,
      buyerId: interest.buyerId,
      listingUserId: listing.createdBy,
      buyerUserId: interest.createdBy,
      commissionSplit: interest.commissionSplit,
    });
  }

  /**
   * היצירה עצמה, משותפת לשני הכיוונים.
   *
   * `commissionSplit` מצולם ולא נגזר מחדש: אחוז שהשתנה בפרסום אחרי
   * שהעסקה כבר רצה אינו משנה עסקה שרצה — אותו כלל בדיוק שכבר נאכף
   * ב-`CoopOffer`/`CoopInterest`.
   */
  private async open(input: {
    originType: "offer" | "interest";
    originId: string;
    listingTenantId: string;
    buyerTenantId: string;
    propertyId: string;
    buyerId: string;
    listingUserId?: string | null;
    buyerUserId?: string | null;
    commissionSplit: number;
  }): Promise<string> {
    /*
     * הסוכן של הקונה נלקח מהכרטיס עצמו ולא מהצד ששלח — הוא מקור
     * האמת לשאלה „של מי הלקוח הזה”, ובדיוק ממנו נגזרת גם הבעלות
     * על תנאי השיתוף.
     */
    const buyerOwner =
      input.buyerUserId ??
      (await this.prisma.withExplicitTenant(input.buyerTenantId, async (tx) => {
        const buyer = await tx.buyer.findFirst({
          where: { id: input.buyerId, tenantId: input.buyerTenantId },
          select: { ownerUserId: true },
        });
        return buyer?.ownerUserId ?? null;
      }));

    const id = ulid();
    const created = await this.prisma.withTenant(async (tx) => {
      /*
       * `upsert` על `originId` ולא `create`: לחיצה כפולה על „מעניין”,
       * או שתי לשוניות פתוחות, היו נופלות על אילוץ הייחודיות
       * ומחזירות שגיאת שרת על פעולה שכבר הצליחה.
       */
      const existing = await tx.coopDeal.findUnique({
        where: { originId: input.originId },
        select: { id: true },
      });
      if (existing) return { id: existing.id, fresh: false };

      await tx.coopDeal.create({
        data: {
          id,
          originType: input.originType,
          originId: input.originId,
          listingTenantId: input.listingTenantId,
          buyerTenantId: input.buyerTenantId,
          propertyId: input.propertyId,
          buyerId: input.buyerId,
          listingUserId: input.listingUserId ?? null,
          buyerUserId: buyerOwner,
          commissionSplit: input.commissionSplit,
        },
      });
      await tx.coopDealMessage.create({
        data: {
          id: ulid(),
          dealId: id,
          authorTenantId: TenantContext.current().tenantId,
          userId: TenantContext.current().userId ?? null,
          kind: "event",
          body: "החיבור אושר — החדר נפתח לשני המשרדים",
        },
      });
      await this.audit.record(tx, {
        action: "collaboration.deal_opened",
        entityType: "coop_deal",
        entityId: id,
        metadata: { originType: input.originType, originId: input.originId },
      });
      return { id, fresh: true };
    });

    if (created.fresh) {
      /*
       * ההתראות והמייל שניהם best-effort: החדר כבר נוצר, וכשל
       * בהודעה עליו אינו סיבה להחזיר שגיאה על פעולה שהצליחה.
       */
      try {
        await this.notifyBothSides(created.id, {
          title: "נפתח חדר עסקה משותף",
          body: "החיבור אושר — אפשר לתאם סיור ולנהל את העסקה במקום אחד",
        });
      } catch (error: unknown) {
        this.logger.warn(
          `התראה על פתיחת חדר עסקה (${created.id}) לא נכתבה: ${String(error)}`,
        );
      }
      /*
       * המייל מחוץ לטרנזקציה ו-best-effort, כמו בכל שאר הרשת: חדר
       * שנפתח בהצלחה לא יתגלגל לאחור בגלל תיבת דואר שלא ענתה.
       */
      try {
        await this.emailOpened(created.id);
      } catch (error: unknown) {
        this.logger.warn(
          `מייל על פתיחת חדר עסקה (${created.id}) לא נשלח: ${String(error)}`,
        );
      }
    }
    return created.id;
  }

  /* ============================================================
     קריאה
     ============================================================ */

  /** כל חדרי העסקה שאני שותף להם — פתוחים תחילה, אחר כך סגורים. */
  async list(): Promise<DealSummaryDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.coopDeal.findMany({
        where: {
          OR: [{ listingTenantId: tenantId }, { buyerTenantId: tenantId }],
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    );
    if (rows.length === 0) return [];

    const badges = await officeBadges(
      this.prisma,
      rows.map((row) =>
        row.listingTenantId === tenantId
          ? row.buyerTenantId
          : row.listingTenantId,
      ),
    );
    /*
     * כותרות הנכסים בשאילתה אחת לכל הרשימה, ולא אחת לשורה: זה
     * ה-N+1 שכבר תוקן פעמיים במודול הזה.
     */
    const titles = await this.propertyTitles(rows, tenantId);

    return rows.map((row) => {
      const mine: "listing" | "buyer" =
        row.listingTenantId === tenantId ? "listing" : "buyer";
      const other =
        mine === "listing" ? row.buyerTenantId : row.listingTenantId;
      const badge = badges.get(other);
      return {
        id: row.id,
        stage: row.stage as CoopDealStage,
        mySide: mine,
        commissionSplit: row.commissionSplit,
        title: titles.get(row.id) ?? "נכס בשיתוף פעולה",
        counterpartOffice: badge?.name ?? "משרד תיווך",
        ...(badge?.logoUrl === undefined
          ? {}
          : { counterpartLogoUrl: badge.logoUrl }),
        lastActivityAt: row.updatedAt,
        createdAt: row.createdAt,
      };
    });
  }

  /**
   * כותרת קצרה לכל חדר.
   *
   * הנכס חי אצל צד אחד בלבד, ולכן הכותרת נקראת מהפרסום ברשת —
   * `shared_listings` נקראת בקריאת רשת ולא דורשת להיות בעליה.
   * חדר שנפתח על נכס שלא פורסם (הצעה לביקוש אינה מחייבת פרסום)
   * נופל לכותרת גנרית, וזה עדיף על „נכס ב-undefined”.
   */
  private async propertyTitles(
    rows: readonly { id: string; propertyId: string; listingTenantId: string }[],
    tenantId: string,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const propertyIds = [...new Set(rows.map((row) => row.propertyId))];
    if (propertyIds.length === 0) return out;

    const [listings, own] = await Promise.all([
      this.prisma.withNetworkRead((tx) =>
        tx.sharedListing.findMany({
          where: { originPropertyId: { in: propertyIds } },
          select: { originPropertyId: true, title: true, city: true },
        }),
      ),
      this.prisma.withTenant((tx) =>
        tx.property.findMany({
          where: { id: { in: propertyIds }, tenantId },
          select: { id: true, city: true, street: true },
        }),
      ),
    ]);
    const byListing = new Map(listings.map((l) => [l.originPropertyId, l]));
    const byOwn = new Map(own.map((p) => [p.id, p]));

    for (const row of rows) {
      const listing = byListing.get(row.propertyId);
      const mineRow = byOwn.get(row.propertyId);
      const label =
        listing?.title ??
        joinNonEmpty([mineRow?.street, mineRow?.city ?? listing?.city]) ??
        null;
      if (label !== null) out.set(row.id, label);
    }
    return out;
  }

  /** החדר עצמו: שני הצדדים, הנכס, הקונה והשרשור. */
  async get(id: string): Promise<DealDto> {
    const ctx = TenantContext.current();
    const row = await this.prisma.withTenant((tx) =>
      tx.coopDeal.findFirst({
        where: {
          id,
          OR: [
            { listingTenantId: ctx.tenantId },
            { buyerTenantId: ctx.tenantId },
          ],
        },
      }),
    );
    if (!row) throw new NotFoundException("חדר עסקה לא נמצא");

    const mySide: "listing" | "buyer" =
      row.listingTenantId === ctx.tenantId ? "listing" : "buyer";
    const otherTenantId =
      mySide === "listing" ? row.buyerTenantId : row.listingTenantId;

    const [badges, meSide, counterSide, property, buyer, entries] =
      await Promise.all([
        officeBadges(this.prisma, [
          row.listingTenantId,
          row.buyerTenantId,
        ]),
        this.side(
          ctx.tenantId,
          mySide === "listing" ? row.listingUserId : row.buyerUserId,
        ),
        this.side(
          otherTenantId,
          mySide === "listing" ? row.buyerUserId : row.listingUserId,
        ),
        this.propertyCard(row, mySide),
        this.buyerCard(row, mySide),
        this.entries(id, ctx.tenantId),
      ]);

    const myBadge = badges.get(ctx.tenantId);
    const otherBadge = badges.get(otherTenantId);

    return {
      id: row.id,
      stage: row.stage as CoopDealStage,
      mySide,
      commissionSplit: row.commissionSplit,
      title: property.address,
      counterpartOffice: otherBadge?.name ?? "משרד תיווך",
      ...(otherBadge?.logoUrl === undefined
        ? {}
        : { counterpartLogoUrl: otherBadge.logoUrl }),
      lastActivityAt: row.updatedAt,
      createdAt: row.createdAt,
      me: {
        officeName: myBadge?.name ?? "המשרד שלנו",
        ...(myBadge?.logoUrl === undefined
          ? {}
          : { officeLogoUrl: myBadge.logoUrl }),
        ...meSide,
      },
      counterpart: {
        officeName: otherBadge?.name ?? "משרד תיווך",
        ...(otherBadge?.logoUrl === undefined
          ? {}
          : { officeLogoUrl: otherBadge.logoUrl }),
        ...counterSide,
      },
      property,
      buyer,
      ...(row.closedNote === null ? {} : { closedNote: row.closedNote }),
      entries,
    };
  }

  /**
   * הסוכן של צד אחד — שם, טלפון ואימייל.
   *
   * `users` אינה תחת RLS (תשתית אימות; ראו מיגרציית ה-RLS) ולכן
   * הקריאה ישירה. בעל המשרד הוא הנפילה כשאין סוכן משויך או שהוא
   * כבר אינו פעיל: חדר בלי טלפון הוא חדר שלא עובדים בו.
   */
  private async side(
    tenantId: string,
    userId: string | null,
  ): Promise<Omit<DealSideDto, "officeName" | "officeLogoUrl">> {
    const agent =
      userId === null
        ? null
        : await this.prisma.user.findFirst({
            where: { id: userId, tenantId, isActive: true },
            select: { name: true, email: true, phone: true },
          });
    const person =
      agent ??
      (await this.prisma.user.findFirst({
        where: { tenantId, role: "owner", isActive: true },
        select: { name: true, email: true, phone: true },
        orderBy: { createdAt: "asc" },
      }));
    if (!person) return {};
    return {
      agentName: person.name,
      agentEmail: person.email,
      ...(person.phone === null ? {} : { agentPhone: person.phone }),
    };
  }

  /**
   * כרטיס הנכס בחדר — **עם הכתובת המדויקת**.
   *
   * זו ההבטחה שבסכימה („כתובת מלאה רק אחרי אישור חיבור”) והיא
   * מתקיימת כאן ורק כאן: בפיד ובהצעה הכתובת עדיין מוסתרת. הנכס
   * נקרא בהקשר הדייר **שהוא שלו**, ולכן `withExplicitTenant`.
   */
  private async propertyCard(
    row: { propertyId: string; listingTenantId: string },
    mySide: "listing" | "buyer",
  ): Promise<DealDto["property"]> {
    const property = await this.prisma.withExplicitTenant(
      row.listingTenantId,
      (tx) =>
        tx.property.findFirst({
          where: { id: row.propertyId, tenantId: row.listingTenantId },
          select: {
            id: true,
            city: true,
            street: true,
            houseNumber: true,
            rooms: true,
            areaSqm: true,
            priceAgorot: true,
          },
        }),
    );
    if (!property)
      return {
        id: row.propertyId,
        linkable: false,
        address: "הנכס כבר אינו במאגר",
      };
    const address =
      joinNonEmpty([
        joinNonEmpty([property.street, property.houseNumber], " "),
        property.city,
      ]) ?? "נכס בשיתוף פעולה";
    return {
      id: property.id,
      // רק לצד שהנכס שלו יש למה ללחוץ — לצד השני אין כרטיס כזה
      linkable: mySide === "listing",
      address,
      ...(property.city === null ? {} : { city: property.city }),
      ...(property.rooms === null ? {} : { rooms: Number(property.rooms) }),
      ...(property.areaSqm === null ? {} : { areaSqm: property.areaSqm }),
      ...(property.priceAgorot === null
        ? {}
        : { priceAgorot: property.priceAgorot.toString() }),
    };
  }

  /**
   * כרטיס הקונה בחדר — **בלי שם ובלי טלפון**, גם אחרי החיבור.
   *
   * זה לא שריד מהפיד אלא הכלל עצמו: הקונה שייך למשרד שהביא אותו,
   * ושיתוף פעולה שבו הצד השני מקבל את פרטיו הוא שיתוף פעולה שהופך
   * להחלפה. מי שרוצה לדבר עם הקונה מדבר עם הסוכן שלו — ופרטיו של
   * הסוכן דווקא כן נמצאים כאן.
   */
  private async buyerCard(
    row: { buyerId: string; buyerTenantId: string },
    mySide: "listing" | "buyer",
  ): Promise<DealDto["buyer"]> {
    const buyer = await this.prisma.withExplicitTenant(
      row.buyerTenantId,
      (tx) =>
        tx.buyer.findFirst({
          where: { id: row.buyerId, tenantId: row.buyerTenantId },
          select: { id: true, budgetMaxAgorot: true, requirements: true },
        }),
    );
    if (!buyer) return { id: row.buyerId, linkable: false, cities: [] };
    const requirements = (buyer.requirements ?? {}) as Record<string, unknown>;
    const cities = Array.isArray(requirements["cities"])
      ? (requirements["cities"] as unknown[]).filter(
          (city): city is string => typeof city === "string",
        )
      : [];
    const rooms = requirements["roomsMin"];
    return {
      id: buyer.id,
      linkable: mySide === "buyer",
      cities,
      ...(buyer.budgetMaxAgorot === null
        ? {}
        : { budgetMaxAgorot: buyer.budgetMaxAgorot.toString() }),
      ...(typeof rooms === "number" ? { rooms } : {}),
    };
  }

  /**
   * השרשור. שמות הכותבים בשאילתה אחת, לא אחת לשורה.
   *
   * **החדשות ביותר, לא הישנות ביותר.** התקרה נשלפת בסדר יורד
   * ומתהפכת לתצוגה: שליפה בסדר עולה עם `take` הייתה מחזירה לנצח
   * את 500 השורות הראשונות, וכל הודעה חדשה — ואפילו מעבר שלב —
   * הייתה נכתבת בהצלחה ופשוט לא מופיעה. חדר שממשיך לקבל הודעות
   * ומציג שיחה מלפני חודשיים גרוע מחדר שאומר שהוא קטוע (ביקורת
   * Codex).
   */
  private async entries(
    dealId: string,
    tenantId: string,
  ): Promise<DealEntryDto[]> {
    const newest = await this.prisma.withTenant((tx) =>
      tx.coopDealMessage.findMany({
        where: { dealId },
        orderBy: { createdAt: "desc" },
        take: THREAD_LIMIT,
      }),
    );
    const rows = newest.reverse();
    const userIds = [
      ...new Set(
        rows
          .map((row) => row.userId)
          .filter((userId): userId is string => userId !== null),
      ),
    ];
    const users =
      userIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          });
    const nameById = new Map(users.map((user) => [user.id, user.name]));
    return rows.map((row) => {
      const name = row.userId === null ? null : (nameById.get(row.userId) ?? null);
      return {
        id: row.id,
        kind: row.kind,
        body: row.body,
        mine: row.authorTenantId === tenantId,
        ...(name === null ? {} : { authorName: name }),
        createdAt: row.createdAt,
      };
    });
  }

  /* ============================================================
     כתיבה
     ============================================================ */

  /** הודעה בשרשור. */
  async post(id: string, body: string): Promise<void> {
    const problem = coopDealMessageRejectionReason(body);
    if (problem !== null) throw new BadRequestException(problem);
    const ctx = TenantContext.current();

    await this.prisma.withTenant(async (tx) => {
      const deal = await this.member(tx, id, ctx.tenantId);
      if (isFinalCoopDealStage(deal.stage as CoopDealStage))
        throw new BadRequestException(
          "העסקה נסגרה — אי אפשר להוסיף הודעות לחדר סגור",
        );
      await tx.coopDealMessage.create({
        data: {
          id: ulid(),
          dealId: id,
          authorTenantId: ctx.tenantId,
          userId: ctx.userId ?? null,
          kind: "message",
          body: body.trim(),
        },
      });
      /*
       * דחיפת `updatedAt` היא מה שמעלה את החדר לראש הרשימה. בלעדיה
       * הרשימה מסודרת לפי מתי החדר נפתח, ושיחה חיה מאתמול נקברת
       * מתחת לחדרים שקטים שנפתחו היום.
       */
      await tx.coopDeal.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
    });

    await this.notifyQuietly(id, {
      title: "הודעה חדשה בחדר עסקה",
      body: body.trim().slice(0, 200),
    });
  }

  /**
   * מעבר שלב. שני הצדדים רשאים, ובכוונה: סיור נקבע אצל מי שמביא
   * את הקונה וחוזה נחתם אצל מי שמחזיק את הנכס.
   */
  async move(id: string, stage: CoopDealStage, note?: string): Promise<void> {
    const ctx = TenantContext.current();
    const actor =
      ctx.userId === null || ctx.userId === undefined
        ? null
        : await this.prisma.user.findUnique({
            where: { id: ctx.userId },
            select: { name: true },
          });

    await this.prisma.withTenant(async (tx) => {
      const deal = await this.member(tx, id, ctx.tenantId);
      const problem = coopDealMoveRejectionReason(
        deal.stage as CoopDealStage,
        stage,
      );
      if (problem !== null) throw new BadRequestException(problem);

      const closing = isFinalCoopDealStage(stage);
      /*
       * **השוואה-והחלפה על השלב שנקרא, ולא עדכון עיוור.**
       *
       * חדר הוא הדבר היחיד במערכת ששני משרדים כותבים אליו במקביל,
       * ולכן זה המקום היחיד שבו הכלל „עסקה סגורה אינה נפתחת מחדש”
       * יכול להישבר בלי שאיש עשה משהו אסור: שתי בקשות קוראות את
       * אותו `contact`, שתיהן עוברות את הבדיקה, ואז „בוטלה” ו„סיור”
       * נכתבים בזו אחר זו — והעסקה שנסגרה חוזרת לחיים, עם שתי שורות
       * סותרות בשרשור (ביקורת Codex).
       *
       * `updateMany` עם השלב הישן בתנאי הופך את הבדיקה והכתיבה
       * לפעולה אחת: מי שהגיע שני מקבל אפס שורות ונדחה. אין צורך
       * בנעילה — התנאי עצמו הוא הסריאליזציה.
       */
      const moved = await tx.coopDeal.updateMany({
        where: { id, stage: deal.stage },
        data: {
          stage,
          ...(closing
            ? { closedAt: new Date(), closedNote: note?.trim() || null }
            : {}),
        },
      });
      if (moved.count === 0)
        throw new ConflictException(
          "המשרד השותף עדכן את שלב העסקה באותו רגע — רעננו את המסך",
        );
      await tx.coopDealMessage.create({
        data: {
          id: ulid(),
          dealId: id,
          authorTenantId: ctx.tenantId,
          userId: ctx.userId ?? null,
          kind: "event",
          body: coopDealStageEventBody(stage, actor?.name ?? "המשרד השותף"),
        },
      });
      await this.audit.record(tx, {
        action: "collaboration.deal_stage",
        entityType: "coop_deal",
        entityId: id,
        metadata: { from: deal.stage, to: stage },
      });
    });

    const line = coopDealStageEventBody(stage, actor?.name ?? "המשרד השותף");
    await this.notifyQuietly(id, { title: "התקדמות בחדר עסקה", body: line });
    /*
     * גם מייל, ולא רק התראה במערכת: מעבר שלב הוא בדיוק הרגע שבו
     * הצד השני צריך לפעול — לתאם סיור, להכין הצעה, או לדעת שהעסקה
     * נסגרה — והוא לרוב אינו יושב באותו רגע במסך (בקשת המשתמש).
     */
    await this.mailStageChange(id, stage, line);
  }

  /**
   * עדכון במייל לצד השני על מעבר שלב. Best-effort, כמו כל מייל
   * ברשת: המעבר כבר נרשם ואינו מתגלגל לאחור בגלל תיבת דואר.
   */
  private async mailStageChange(
    dealId: string,
    stage: CoopDealStage,
    line: string,
  ): Promise<void> {
    try {
      const tenantId = TenantContext.current().tenantId;
      const deal = await this.prisma.withTenant((tx) =>
        tx.coopDeal.findFirst({
          where: { id: dealId },
          select: {
            listingTenantId: true,
            buyerTenantId: true,
            listingUserId: true,
            buyerUserId: true,
            closedNote: true,
          },
        }),
      );
      if (!deal) return;
      const mine = deal.listingTenantId === tenantId;
      const otherTenantId = mine ? deal.buyerTenantId : deal.listingTenantId;
      const otherUserId = mine ? deal.buyerUserId : deal.listingUserId;

      const [to, badges] = await Promise.all([
        collabRecipient(this.prisma, otherTenantId, otherUserId),
        officeBadges(this.prisma, [tenantId]),
      ]);
      const closing = isFinalCoopDealStage(stage);
      await sendCollabMail(this.email, to, {
        subject: closing
          ? "העסקה המשותפת נסגרה"
          : "התקדמות בעסקה המשותפת",
        heading: COOP_DEAL_STAGE_LABELS[stage],
        paragraphs: [
          `${badges.get(tenantId)?.name ?? "המשרד השותף"}: ${line}.`,
          ...(closing && deal.closedNote !== null
            ? [`הסיבה שנרשמה: ${deal.closedNote}`]
            : []),
          closing
            ? "השרשור והתנאים נשמרים לשני המשרדים כפי שהם."
            : "אפשר להמשיך את התיאום בשרשור החדר.",
        ],
        button: {
          label: "לחדר העסקה",
          url: `${loadEnv().WEB_ORIGIN}/collaboration/deals/${dealId}`,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `מייל על מעבר שלב (${dealId}) לא נשלח: ${String(error)}`,
      );
    }
  }

  /**
   * שער השייכות לחדר.
   *
   * RLS כבר מונע קריאה של חדר זר, אבל שאילתה שאינה מוצאת שורה
   * מחזירה `null` ולא שגיאה — ובלי הבדיקה המפורשת הקריאה הבאה
   * הייתה נופלת על `undefined` ומחזירה 500 במקום 404.
   */
  private async member(
    tx: TenantTx,
    id: string,
    tenantId: string,
  ): Promise<{ stage: string }> {
    const deal = await tx.coopDeal.findFirst({
      where: {
        id,
        OR: [{ listingTenantId: tenantId }, { buyerTenantId: tenantId }],
      },
      select: { stage: true },
    });
    if (!deal) throw new NotFoundException("חדר עסקה לא נמצא");
    return deal;
  }

  /* ============================================================
     התראות
     ============================================================ */

  /**
   * התראה לצד השני בלבד.
   *
   * `withExplicitTenant`: `notifications` תחת FORCE RLS, וכתיבה
   * בהקשר שלי הייתה נכתבת לתיבה שלי — כלומר התראה על מה שאני
   * עצמי עשיתי, והצד שצריך לדעת לא היה שומע דבר.
   */
  /**
   * התראה שלא מפילה את הפעולה שכבר הצליחה.
   *
   * ההודעה או מעבר השלב כבר בוצעו ו-Commit נסגר. כשל בכתיבת ההתראה
   * — דייר שנמחק, תקלת מסד רגעית — היה מוחזר כשגיאה, המסך היה אומר
   * „ההודעה לא נשלחה” ומשאיר את הטיוטה, והמשתמש היה שולח שוב:
   * הודעה כפולה בשרשור, בגלל שלב שאינו ההודעה עצמה (ביקורת Codex).
   *
   * אותו דפוס בדיוק כמו המיילים בשאר מודול הרשת, ומאותו טעם.
   */
  private async notifyQuietly(
    dealId: string,
    message: { title: string; body: string },
  ): Promise<void> {
    try {
      await this.notifyOtherSide(dealId, message);
    } catch (error: unknown) {
      this.logger.warn(
        `התראה על חדר עסקה (${dealId}) לא נכתבה: ${String(error)}`,
      );
    }
  }

  private async notifyOtherSide(
    dealId: string,
    message: { title: string; body: string },
  ): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const deal = await this.prisma.withTenant((tx) =>
      tx.coopDeal.findFirst({
        where: { id: dealId },
        select: {
          listingTenantId: true,
          buyerTenantId: true,
          listingUserId: true,
          buyerUserId: true,
        },
      }),
    );
    if (!deal) return;
    const toTenant =
      deal.listingTenantId === tenantId
        ? deal.buyerTenantId
        : deal.listingTenantId;
    const toUser =
      deal.listingTenantId === tenantId ? deal.buyerUserId : deal.listingUserId;
    await this.writeNotification(dealId, toTenant, toUser, message);
  }

  private async notifyBothSides(
    dealId: string,
    message: { title: string; body: string },
  ): Promise<void> {
    const deal = await this.prisma.withTenant((tx) =>
      tx.coopDeal.findFirst({
        where: { id: dealId },
        select: {
          listingTenantId: true,
          buyerTenantId: true,
          listingUserId: true,
          buyerUserId: true,
        },
      }),
    );
    if (!deal) return;
    await Promise.all([
      this.writeNotification(
        dealId,
        deal.listingTenantId,
        deal.listingUserId,
        message,
      ),
      this.writeNotification(
        dealId,
        deal.buyerTenantId,
        deal.buyerUserId,
        message,
      ),
    ]);
  }

  private async writeNotification(
    dealId: string,
    tenantId: string,
    userId: string | null,
    message: { title: string; body: string },
  ): Promise<void> {
    await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.notification.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          type: "coop_deal",
          title: message.title,
          body: message.body,
          entityType: "coop_deal",
          entityId: dealId,
        },
      }),
    );
  }

  /**
   * מייל לשני הצדדים על פתיחת החדר.
   *
   * ההתראה במערכת מגיעה למי שכבר נמצא במסך; חדר שנפתח ואיש לא נכנס
   * אליו שלושה ימים הוא שיתוף הפעולה שלא קרה — אותו נימוק בדיוק
   * שהוליד את המייל על הצעת נכס. מה שנכנס להודעה: שם המשרד השני
   * וקישור לחדר. לא כתובת, לא לקוח ולא מספר — מייל יוצא מהמערכת
   * ומהבקרות שלה.
   */
  private async emailOpened(dealId: string): Promise<void> {
    if (!(await this.email.isConfigured())) return;
    const deal = await this.prisma.withTenant((tx) =>
      tx.coopDeal.findFirst({
        where: { id: dealId },
        select: {
          listingTenantId: true,
          buyerTenantId: true,
          listingUserId: true,
          buyerUserId: true,
        },
      }),
    );
    if (!deal) return;

    const badges = await officeBadges(this.prisma, [
      deal.listingTenantId,
      deal.buyerTenantId,
    ]);
    const url = `${loadEnv().WEB_ORIGIN}/collaboration/deals/${dealId}`;

    await Promise.all(
      (
        [
          [deal.listingTenantId, deal.listingUserId, deal.buyerTenantId],
          [deal.buyerTenantId, deal.buyerUserId, deal.listingTenantId],
        ] as const
      ).map(async ([tenantId, userId, otherTenantId]) => {
        const side = await this.side(tenantId, userId);
        if (side.agentEmail === undefined) return;
        await this.email.send(
          side.agentEmail,
          "נפתח חדר עסקה משותף ברשת שיתופי הפעולה",
          {
            heading: "החיבור אושר",
            greeting: `שלום ${side.agentName ?? ""},`.trim(),
            paragraphs: [
              `נפתח חדר עסקה משותף מול ${badges.get(otherTenantId)?.name ?? "משרד התיווך השני"}.`,
              "בחדר נמצאים פרטי הסוכן שמולכם, כתובת הנכס, שרשור להתכתבות ושלבי העסקה.",
              "פרטי הלקוחות נשארים אצל המשרד שהביא אותם — גם עכשיו.",
            ],
            button: { label: "לחדר העסקה", url },
            footnote:
              "ההודעה נשלחה כי אישרתם חיבור ברשת שיתופי הפעולה של מתווכים.",
          },
        );
      }),
    );
  }
}

/** חיבור חלקים קיימים בלבד; `null` כשאין אף חלק — ולא מחרוזת ריקה. */
function joinNonEmpty(
  parts: readonly (string | null | undefined)[],
  separator = ", ",
): string | null {
  const kept = parts.filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return kept.length === 0 ? null : kept.join(separator);
}
