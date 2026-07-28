import { GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { OfferPresentationSchema, type OfferPresentation } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
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
}

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contacts: ContactsService,
    private readonly messaging: MessagingService,
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

    const existing = await this.prisma.withTenant((tx) =>
      tx.offer.findFirst({ where: { matchId, tenantId } }),
    );
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

      await tx.offer.update({
        where: { id: offer.id },
        data: {
          openCount: { increment: 1 },
          ...(offer.firstOpenedAt === null ? { firstOpenedAt: new Date() } : {}),
          ...(offer.status === "sent" || offer.status === "delivered" ? { status: "opened" } : {}),
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          tenantId: offer.tenantId,
          name: "offer.opened",
          payload: { offerId: offer.id, tenantId: offer.tenantId, openCount: offer.openCount + 1 },
        },
      });

      return {
        presentation: OfferPresentationSchema.parse(offer.presentation),
        status: offer.status,
      };
    });
  }

  /** תגובת הקונה מהדף הציבורי: מעוניין / לא רלוונטי. */
  async publicRespond(token: string, response: "interested" | "declined"): Promise<void> {
    await this.prisma.withPublicOffer(token, async (tx) => {
      const offer = await tx.offer.findFirst({ where: { publicToken: token } });
      if (!offer) throw new NotFoundException("ההצעה לא נמצאה");
      if (offer.tokenExpires < new Date()) throw new GoneException("תוקף ההצעה פג");

      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${offer.tenantId}, true)`;

      await tx.offer.update({ where: { id: offer.id }, data: { status: response } });
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
        where: { id: match.buyerId, tenantId, deletedAt: null },
        select: { contactId: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");
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
      await tx.offer.update({
        where: { id: offer.id },
        data: { channel: "whatsapp", sentText: message.slice(0, 2000) },
      });
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
}
