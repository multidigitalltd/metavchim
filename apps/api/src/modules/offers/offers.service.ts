import { GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { OfferPresentationSchema, type OfferPresentation } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";

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
  ) {}

  /** יצירת הצעה מהתאמה: Snapshot של הנכס + קישור ציבורי חתום-טוקן. */
  async createFromMatch(matchId: string): Promise<OfferDto> {
    const tenantId = TenantContext.current().tenantId;
    const token = randomBytes(32).toString("base64url"); // 43 תווים
    const id = ulid();

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

  private publicUrl(token: string): string {
    return `${loadEnv().WEB_ORIGIN}/offer/${token}`;
  }
}
