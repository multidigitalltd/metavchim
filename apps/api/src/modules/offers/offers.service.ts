import { GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { OfferPresentationSchema, type OfferPresentation } from "@metavchim/shared";
import { assertMatchAccess, ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { ContactsService } from "../contacts/contacts.service";
import { buildOfferMessage, MessagingService } from "../messaging/messaging.service";

const TOKEN_TTL_DAYS = 14;

export interface OfferDto {
  id: string;
  matchId: string;
  status: string;
  url: string;
  openCount: number;
  createdAt: Date;
}

export interface PublicOfferView {
  presentation: OfferPresentation;
  status: string;
  /** URL-ים חתומים קצרי-מועד לתמונות ה-snapshot — נחתמים בכל צפייה */
  images: { url: string; alt?: string }[];
}

export interface OfferListItem {
  id: string;
  status: string;
  title: string;
  priceAgorot?: number;
  score?: number;
  buyerName: string | null;
  openCount: number;
  sentAt?: Date;
  firstOpenedAt?: Date;
  url: string;
  createdAt: Date;
}

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contacts: ContactsService,
    private readonly messaging: MessagingService,
    private readonly storage: StorageService,
  ) {}

  /**
   * יצירת הצעה מהתאמה: Snapshot של הנכס + קישור ציבורי חתום-טוקן.
   * Idempotent: הצעה אחת פר התאמה — קריאה חוזרת מחזירה את הקיימת;
   * מרוץ בין בקשות נבלם ע"י unique constraint על match_id (ביקורת Codex).
   */
  async createFromMatch(matchId: string): Promise<OfferDto> {
    const tenantId = TenantContext.current().tenantId;
    const token = randomBytes(32).toString("base64url"); // 43 תווים
    const id = ulid();

    // הבדיקה קודמת גם למסלול ה-Idempotent: בלעדיה סוכן שמכיר מזהה
    // התאמה של סוכן אחר היה מקבל בחזרה את הקישור הציבורי להצעה שלו
    const existing = await this.prisma.withTenant(async (tx) => {
      await assertMatchAccess(tx, tenantId, matchId);
      return tx.offer.findFirst({ where: { matchId, tenantId } });
    });
    if (existing) {
      return {
        id: existing.id,
        matchId,
        status: existing.status,
        url: this.publicUrl(existing.publicToken),
        openCount: existing.openCount,
        createdAt: existing.createdAt,
      };
    }

    await this.prisma.withTenant(async (tx) => {
      const match = await tx.match.findFirst({ where: { id: matchId, tenantId } });
      if (!match) throw new NotFoundException("התאמה לא נמצאה");

      const property = await tx.property.findFirst({
        where: {
          id: match.propertyId,
          tenantId,
          deletedAt: null,
          // הצעה רק לנכס משווק — לא לנמכר/הושכר/מוקפא (ביקורת Codex, PR #1)
          status: { in: ["draft", "active"] },
        },
      });
      if (!property) throw new NotFoundException("הנכס כבר אינו זמין לשיווק");

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });

      // תמונות הנכס בזמן היצירה — עד 6, לפי הסדר (הראשית ראשונה)
      const mediaRows = await tx.propertyMedia.findMany({
        where: { tenantId, propertyId: property.id },
        orderBy: { sortOrder: "asc" },
        take: 6,
        select: { s3Key: true, altText: true },
      });

      // Snapshot ללא PII וללא הערות פנימיות — רק מה שהקונה אמור לראות.
      const features = [
        property.hasElevator === true ? "מעלית" : null,
        property.hasParking === true ? "חניה" : null,
        property.hasBalcony === true ? "מרפסת" : null,
        property.hasSafeRoom === true ? 'ממ"ד' : null,
        property.hasStorage === true ? "מחסן" : null,
      ].filter((f): f is string => f !== null);

      const presentation = OfferPresentationSchema.parse({
        title:
          property.marketingTitle ??
          [property.rooms ? `דירת ${Number(property.rooms)} חדרים` : "נכס", property.city]
            .filter(Boolean)
            .join(" ב"),
        city: property.city ?? undefined,
        neighborhood: property.neighborhood ?? undefined,
        rooms: property.rooms === null ? undefined : Number(property.rooms),
        areaSqm: property.areaSqm ?? undefined,
        floor: property.floor ?? undefined,
        priceAgorot: property.priceAgorot === null ? undefined : Number(property.priceAgorot),
        features,
        description: property.marketingDescription ?? undefined,
        agencyName: tenant?.name ?? "משרד התיווך",
        media: mediaRows.map((m) => ({ key: m.s3Key, alt: m.altText ?? undefined })),
      });

      await tx.offer.create({
        data: {
          id,
          tenantId,
          matchId,
          channel: "link",
          presentation: presentation as object,
          publicToken: token,
          tokenExpires: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
          status: "sent",
          sentAt: new Date(),
        },
      });
      await tx.match.update({ where: { id: matchId }, data: { status: "offered" } });
      // רגע-ציר על הקונה: "כלום לא נשכח" — ההצעה מופיעה בהיסטוריה שלו
      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId,
          buyerId: match.buyerId,
          kind: "system",
          content: `נוצרה הצעה: ${presentation.title}`,
          createdBy: TenantContext.current().userId,
        },
      });
      await this.audit.record(tx, { action: "offer.create", entityType: "offer", entityId: id });
      await this.outbox.emit(tx, "offer.sent", { offerId: id, tenantId });
    });

    return {
      id,
      matchId,
      status: "sent",
      url: this.publicUrl(token),
      openCount: 0,
      createdAt: new Date(),
    };
  }

  async listForMatch(matchIds: string[]): Promise<Map<string, OfferDto>> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.offer.findMany({
        where: { tenantId, matchId: { in: matchIds } },
        orderBy: { createdAt: "desc" },
      }),
    );
    const map = new Map<string, OfferDto>();
    for (const row of rows) {
      if (!map.has(row.matchId)) {
        map.set(row.matchId, {
          id: row.id,
          matchId: row.matchId,
          status: row.status,
          url: this.publicUrl(row.publicToken),
          openCount: row.openCount,
          createdAt: row.createdAt,
        });
      }
    }
    return map;
  }

  /** צפייה ציבורית: מסמן פתיחה ("הקונה פתח את ההצעה") ומחזיר את ה-Snapshot בלבד. */
  async publicView(token: string): Promise<PublicOfferView> {
    return this.prisma.withPublicOffer(token, async (tx) => {
      const offer = await tx.offer.findFirst({ where: { publicToken: token } });
      if (!offer) throw new NotFoundException("ההצעה לא נמצאה");
      if (offer.tokenExpires < new Date()) throw new GoneException("תוקף ההצעה פג");

      // הדייר נגזר מההצעה שנמצאה (ערך שרת) — נדרש לפוליסת ה-RLS של ה-Outbox.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${offer.tenantId}, true)`;

      // נכס שירד משיווק — הדף מציג "לא זמין" בלי לספור פתיחה ובלי
      // לתזמן פולו-אפ; קישור חי לא מוכר נכס שנמכר (docs/01)
      if (!(await this.offerPropertyMarketable(tx, offer))) {
        return {
          presentation: OfferPresentationSchema.parse(offer.presentation),
          status: "unavailable",
          images: [],
        };
      }

      // תפיסת "פתיחה ראשונה" אטומית: רק הטרנזקציה שהעבירה בפועל את
      // firstOpenedAt מ-null רושמת בציר — צפיות מקבילות לא מכפילות (Codex)
      const firstOpen = await tx.offer.updateMany({
        where: { id: offer.id, firstOpenedAt: null },
        data: { firstOpenedAt: new Date() },
      });
      // המעבר ל-opened מותנה ב-DB, לא בקריאה הישנה — פתיחה במקביל לתגובה
      // לא מחזירה סטטוס interested/declined אחורה ל-opened
      await tx.offer.updateMany({
        where: { id: offer.id, status: { in: ["sent", "delivered"] } },
        data: { status: "opened" },
      });
      await tx.offer.update({
        where: { id: offer.id },
        data: { openCount: { increment: 1 } },
      });
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          tenantId: offer.tenantId,
          name: "offer.opened",
          payload: { offerId: offer.id, tenantId: offer.tenantId, openCount: offer.openCount + 1 },
        },
      });
      if (firstOpen.count === 1) {
        await this.recordOfferMoment(tx, offer, "הקונה פתח את ההצעה לראשונה");
      }

      const presentation = OfferPresentationSchema.parse(offer.presentation);
      return {
        presentation,
        status: offer.status,
        // נתיבים יחסיים לבסיס ה-API — התמונות מוזרמות דרך השרת
        // (שרת האחסון פנימי ואינו נגיש מדפדפן הקונה)
        images: presentation.media.map((m, index) => ({
          url: `/public/offers/${token}/media/${index}`,
          ...(m.alt !== undefined ? { alt: m.alt } : {}),
        })),
      };
    });
  }

  /** הזרמת תמונה מ-snapshot ההצעה — ציבורי לפי טוקן, בלי Session. */
  async publicImage(
    token: string,
    index: number,
  ): Promise<{ body: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
    const key = await this.prisma.withPublicOffer(token, async (tx) => {
      const offer = await tx.offer.findFirst({ where: { publicToken: token } });
      if (!offer) throw new NotFoundException("ההצעה לא נמצאה");
      if (offer.tokenExpires < new Date()) throw new GoneException("תוקף ההצעה פג");
      const media = OfferPresentationSchema.parse(offer.presentation).media;
      const entry = media[index];
      if (!entry) throw new NotFoundException("התמונה לא נמצאה");
      return entry.key;
    });
    try {
      return await this.storage.getObject(key);
    } catch (error) {
      // רק "האובייקט לא קיים" ממופה ל-404; כשל תשתית זמני נשאר 500
      // כדי לא להתקבע בקאש כתמונה חסרה (ביקורת Codex)
      if (StorageService.isMissingObjectError(error)) {
        throw new NotFoundException("התמונה לא נמצאה באחסון");
      }
      throw error;
    }
  }

  /** תגובת הקונה מהדף הציבורי: מעוניין / לא רלוונטי. */
  async publicRespond(token: string, response: "interested" | "declined"): Promise<void> {
    await this.prisma.withPublicOffer(token, async (tx) => {
      const offer = await tx.offer.findFirst({ where: { publicToken: token } });
      if (!offer) throw new NotFoundException("ההצעה לא נמצאה");
      if (offer.tokenExpires < new Date()) throw new GoneException("תוקף ההצעה פג");

      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${offer.tenantId}, true)`;

      if (!(await this.offerPropertyMarketable(tx, offer))) {
        throw new GoneException("הנכס כבר אינו זמין");
      }

      // מעבר סטטוס אטומי: רק הטרנזקציה ששינתה בפועל רושמת בציר ומודיעה —
      // לחיצות כפולות/מקבילות על אותה תגובה לא מכפילות (ביקורת Codex)
      const changed = await tx.offer.updateMany({
        where: { id: offer.id, status: { not: response } },
        data: { status: response },
      });
      if (changed.count === 1) {
        await this.recordOfferMoment(
          tx,
          offer,
          response === "interested" ? "הקונה סימן: מעוניין בהצעה" : "הקונה סימן: ההצעה לא רלוונטית",
        );
        if (response === "interested") {
          await tx.outboxEvent.create({
            data: {
              id: ulid(),
              tenantId: offer.tenantId,
              name: "offer.interested",
              payload: { offerId: offer.id, tenantId: offer.tenantId },
            },
          });
        }
      }
    });
  }

  /**
   * שליחה מרובה (אפיון §10): הצעות לכל ההתאמות המוצעות מעל סף —
   * "נמצאו 12 קונים מתאימים. לשלוח הצעה?" עם אישור מפורש של המתווך.
   *
   * מעבד בסבבים עד שאין מועמדים (בלי תקרה שקטה); התאמה שקיבלה הצעה
   * עוברת ל-offered ולכן יוצאת מהשאילתה הבאה. מרוץ בין בקשות נבלם
   * ע"י ה-unique על match_id — כפילות נספרת כ-skipped (ביקורת Codex).
   */
  async createBulk(propertyId: string, minScore: number): Promise<{ created: number; skipped: number }> {
    const tenantId = TenantContext.current().tenantId;
    let created = 0;
    let skipped = 0;

    const MAX_ROUNDS = 50; // בלם בטיחות: 50×100 = 5,000 הצעות לכל היותר בקריאה
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const candidates = await this.prisma.withTenant(async (tx) => {
        const matches = await tx.match.findMany({
          where: { tenantId, propertyId, status: "suggested", score: { gte: minScore } },
          select: { id: true },
          orderBy: { score: "desc" },
          take: 100,
        });
        const existing = await tx.offer.findMany({
          where: { tenantId, matchId: { in: matches.map((m) => m.id) } },
          select: { matchId: true },
        });
        const withOffer = new Set(existing.map((o) => o.matchId));
        return matches.map((m) => ({ id: m.id, hasOffer: withOffer.has(m.id) }));
      });
      if (candidates.length === 0) break;

      for (const candidate of candidates) {
        if (candidate.hasOffer) {
          // התאמה עם הצעה שנשארה suggested — מסמנים offered כדי שתצא מהסבב הבא
          await this.prisma.withTenant((tx) =>
            tx.match.updateMany({
              where: { id: candidate.id, tenantId, status: "suggested" },
              data: { status: "offered" },
            }),
          );
          skipped += 1;
          continue;
        }
        try {
          await this.createFromMatch(candidate.id);
          created += 1;
        } catch {
          skipped += 1; // כפילות במרוץ / נכס שירד משיווק — ממשיכים לשאר
        }
      }
    }
    return { created, skipped };
  }

  /**
   * הכנת שליחה בוואטסאפ (אפיון §10): בונה את נוסח ההודעה, מתעד אותה
   * ב-Messages Hub, ומחזיר קישור wa.me עם הטקסט מוכן — המתווך רק לוחץ
   * שלח. שליחה אוטומטית דרך Cloud API תחליף את ה-Provider בהמשך.
   */
  async prepareWhatsApp(offerId: string): Promise<{ waUrl: string; message: string }> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const offer = await tx.offer.findFirst({ where: { id: offerId, tenantId } });
      if (!offer) throw new NotFoundException("הצעה לא נמצאה");

      const match = await tx.match.findFirst({
        where: { id: offer.matchId, tenantId },
        select: { buyerId: true },
      });
      if (!match) throw new NotFoundException("התאמה לא נמצאה");
      const buyer = await tx.buyer.findFirst({
        where: {
          id: match.buyerId,
          tenantId,
          deletedAt: null,
          // הפעולה הזו מחזירה מספר טלפון של אדם. בלי פילטר הבעלות
          // היא הייתה נתיב לשליפת ה-PII של הקונים של סוכן אחר.
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { contactId: true },
      });
      if (!buyer) throw new NotFoundException("הצעה לא נמצאה");
      const contact = await this.contacts.getById(tx, buyer.contactId);
      if (!contact) throw new NotFoundException("איש קשר לא נמצא");

      const presentation = OfferPresentationSchema.parse(offer.presentation);
      const priceText =
        presentation.priceAgorot === undefined
          ? ""
          : new Intl.NumberFormat("he-IL", {
              style: "currency",
              currency: "ILS",
              maximumFractionDigits: 0,
            }).format(presentation.priceAgorot / 100);
      const message = buildOfferMessage({
        title: presentation.title,
        priceText,
        url: this.publicUrl(offer.publicToken),
      });

      await this.messaging.recordOutbound(tx, {
        contactId: buyer.contactId,
        offerId: offer.id,
        channel: "whatsapp",
        provider: "walink",
        body: message,
      });
      // תפיסת ההכנה הראשונה אטומית — לחיצות מקבילות לא מכפילות (Codex)
      const firstWhatsApp = await tx.offer.updateMany({
        where: { id: offer.id, channel: { not: "whatsapp" } },
        data: { channel: "whatsapp" },
      });
      await tx.offer.update({
        where: { id: offer.id },
        data: { sentText: message.slice(0, 2000) },
      });
      if (firstWhatsApp.count === 1) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId,
            buyerId: match.buyerId,
            kind: "whatsapp",
            direction: "out",
            content: `נשלחה הצעה בוואטסאפ: ${presentation.title}`,
            createdBy: TenantContext.current().userId,
          },
        });
      }
      await this.audit.record(tx, {
        action: "offer.whatsapp_prepared",
        entityType: "offer",
        entityId: offer.id,
      });

      const phoneDigits = contact.phone.replace(/\D/gu, "");
      return {
        waUrl: `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`,
        message,
      };
    });
  }

  private publicUrl(token: string): string {
    return `${loadEnv().WEB_ORIGIN}/offer/${token}`;
  }

  /** האם הנכס של ההצעה עדיין משווק (draft/active ולא נמחק). */
  private async offerPropertyMarketable(
    tx: Parameters<Parameters<PrismaService["withTenant"]>[0]>[0],
    offer: { tenantId: string; matchId: string },
  ): Promise<boolean> {
    const match = await tx.match.findFirst({
      where: { id: offer.matchId, tenantId: offer.tenantId },
      select: { propertyId: true },
    });
    if (!match) return false;
    const property = await tx.property.findFirst({
      where: {
        id: match.propertyId,
        tenantId: offer.tenantId,
        deletedAt: null,
        status: { in: ["draft", "active"] },
      },
      select: { id: true },
    });
    return property !== null;
  }

  /**
   * רישום רגע במחזור-החיים של הצעה בציר הקונה (מהדף הציבורי — createdBy
   * ריק, זו פעולת הקונה). מזהה הקונה נגזר מההתאמה של ההצעה; אם ההתאמה
   * נמחקה בינתיים לא מפילים את הדף הציבורי על רשומת ציר.
   */
  private async recordOfferMoment(
    tx: Parameters<Parameters<PrismaService["withTenant"]>[0]>[0],
    offer: { id: string; tenantId: string; matchId: string; presentation: unknown },
    moment: string,
  ): Promise<void> {
    const match = await tx.match.findFirst({
      where: { id: offer.matchId, tenantId: offer.tenantId },
      select: { buyerId: true },
    });
    if (!match) return;
    const title = OfferPresentationSchema.parse(offer.presentation).title;
    await tx.interaction.create({
      data: {
        id: ulid(),
        tenantId: offer.tenantId,
        buyerId: match.buyerId,
        kind: "system",
        content: `${moment}: ${title}`,
        createdBy: null,
      },
    });
  }

  /**
   * רשימת ההצעות של המשרד — המסך שחסר: עד היום אפשר היה לראות הצעה
   * רק דרך ההתאמה או כרטיס הנכס, ולא "מה שלחתי ומה קרה איתו".
   *
   * שמות הנכס והקונה נשלפים בשאילתה מקובצת אחת לכל העמוד, לא לכל שורה.
   */
  async listAll(query: { status?: string; limit: number }): Promise<OfferListItem[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const offers = await tx.offer.findMany({
        where: {
          tenantId,
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: query.limit,
      });
      if (offers.length === 0) return [];

      const matches = await tx.match.findMany({
        where: { tenantId, id: { in: offers.map((o) => o.matchId) } },
        select: { id: true, buyerId: true, score: true },
      });
      const matchById = new Map(matches.map((m) => [m.id, m]));

      const buyers = await tx.buyer.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(matches.map((m) => m.buyerId))] },
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { id: true, contactId: true },
      });
      const buyerNameById = new Map<string, string>();
      for (const buyer of buyers) {
        const contact = await this.contacts.getById(tx, buyer.contactId);
        if (contact) buyerNameById.set(buyer.id, contact.name);
      }

      return offers.map((offer) => {
        const match = matchById.get(offer.matchId);
        const presentation = OfferPresentationSchema.parse(offer.presentation);
        return {
          id: offer.id,
          status: offer.status,
          title: presentation.title,
          priceAgorot: presentation.priceAgorot,
          score: match?.score,
          // קונה של סוכן אחר — ההצעה מוצגת, השם לא (אותו כלל כמו במסך ההתאמות)
          buyerName: match ? (buyerNameById.get(match.buyerId) ?? null) : null,
          openCount: offer.openCount,
          sentAt: offer.sentAt ?? undefined,
          firstOpenedAt: offer.firstOpenedAt ?? undefined,
          url: this.publicUrl(offer.publicToken),
          createdAt: offer.createdAt,
        };
      });
    });
  }
}
