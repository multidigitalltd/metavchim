import { ConflictException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import {
  BuyerRequirementsSchema,
  COMPARISON_TOKEN_DAYS,
  ComparisonPresentationSchema,
  comparisonMessage,
  whatsappLink,
  type ComparisonPresentation,
} from "@metavchim/shared";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { assertBuyerAccess, ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { StorageService, type StoredObject } from "../../core/storage.service";
import { AgreementsService } from "../agreements/agreements.service";
import { ContactsService } from "../contacts/contacts.service";
import { MessagingService } from "../messaging/messaging.service";
import { OffersService } from "./offers.service";

/**
 * ‏דף השוואה לקונה (docs/03 — comparisons).
 *
 * ‏אותם כללים כמו הצעה לנכס בודד, כי זה אותו מעשה — הצגת נכס ללקוח:
 * ‏הזמנה בכתב חתומה לכל נכס לפני שהדף נוצר **וגם** בהגשה (נכס שההסכם
 * ‏עליו פג מוצג כ„לא זמין”), נכס שירד משיווק מוצג כ„לא זמין”, הדף
 * ‏הוא תמונת מצב בלי פרטי הקונה, והטוקן פג אחרי 60 יום.
 */

const MARKETABLE = new Set(["draft", "active"]);

export interface ComparisonDto {
  id: string;
  url: string;
  createdAt: string;
  openCount: number;
  titles: string[];
  /** ‏הנכסים שהקונה סימן „מעוניין” בדף */
  interested: string[];
}

export interface PublicComparisonView {
  agencyName: string;
  wants: ComparisonPresentation["wants"];
  properties: (ComparisonPresentation["properties"][number] & {
    available: boolean;
    images: { url: string; alt?: string }[];
  })[];
  interested: string[];
}

@Injectable()
export class ComparisonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly agreements: AgreementsService,
    private readonly offers: OffersService,
    private readonly messaging: MessagingService,
    private readonly storage: StorageService,
  ) {}

  async create(buyerId: string, propertyIds: string[]): Promise<ComparisonDto> {
    const ctx = TenantContext.current();
    const tenantId = ctx.tenantId;
    return this.prisma.withTenant(async (tx) => {
      await assertBuyerAccess(tx, tenantId, buyerId);
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, tenantId, deletedAt: null },
        select: { contactId: true, requirements: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");
      const rows = await tx.property.findMany({
        where: { id: { in: propertyIds }, tenantId, deletedAt: null, status: { in: [...MARKETABLE] } },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const properties = propertyIds.map((id) => byId.get(id));
      if (properties.some((row) => row === undefined)) throw new NotFoundException("נכס לא נמצא או שאינו בשיווק");

      /*
       * ‏הזמנה בכתב לכל נכס — לפני שנוצר קישור שמציג אותו. אותו שער
       * ‏של ההצעה הבודדת, ואותה תשובה: 409 עם קישור ההסכם לחתימה.
       */
      for (const property of properties as NonNullable<(typeof properties)[number]>[]) {
        if (await this.agreements.hasSigned(tx, tenantId, buyer.contactId, "brokerage", property.id)) continue;
        const gate = await this.agreements.create(tx, { kind: "brokerage", contactId: buyer.contactId, propertyId: property.id });
        throw new ConflictException({
          message: "הלקוח טרם חתם על הזמנה בכתב לנכס הזה — שלחו לו קודם את ההסכם לחתימה",
          code: "signature_required",
          signUrl: gate.url,
          propertyId: property.id,
        });
      }

      const wants = BuyerRequirementsSchema.safeParse(buyer.requirements);
      const presentation = ComparisonPresentationSchema.parse({
        agencyName: "",
        properties: await Promise.all(
          (properties as NonNullable<(typeof properties)[number]>[]).map(async (property) => {
            const single = await this.offers.presentationFor(tx, tenantId, property);
            return {
              propertyId: property.id,
              title: single.title,
              city: single.city,
              neighborhood: single.neighborhood,
              propertyType: property.propertyType ?? undefined,
              rooms: single.rooms,
              areaSqm: single.areaSqm,
              floor: single.floor,
              totalFloors: property.totalFloors ?? undefined,
              priceAgorot: single.priceAgorot,
              features: single.features,
              media: single.media.slice(0, 3),
            };
          }),
        ),
        wants: wants.success
          ? {
              budgetMaxAgorot: wants.data.budgetMaxAgorot,
              roomsMin: wants.data.roomsMin,
              roomsMax: wants.data.roomsMax,
              cities: wants.data.cities,
            }
          : { cities: [] },
      });
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      presentation.agencyName = tenant?.name ?? "משרד התיווך";

      const id = ulid();
      const token = randomBytes(32).toString("base64url");
      const row = await tx.comparison.create({
        data: {
          id, tenantId, buyerId, publicToken: token,
          tokenExpires: new Date(Date.now() + COMPARISON_TOKEN_DAYS * 86_400_000),
          presentation, createdByUserId: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "buyer.comparison_created",
        entityType: "buyer",
        entityId: buyerId,
        metadata: { comparisonId: id, propertyIds },
      });
      return this.toDto(row);
    });
  }

  async listForBuyer(buyerId: string): Promise<ComparisonDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      await assertBuyerAccess(tx, tenantId, buyerId);
      const rows = await tx.comparison.findMany({ where: { tenantId, buyerId }, orderBy: { createdAt: "desc" }, take: 20 });
      return rows.map((row) => this.toDto(row));
    });
  }

  /** ‏ההודעה והקישור לוואטסאפ של הקונה — ורישום שיצא, כמו בהצעה בודדת. */
  async prepareWhatsApp(id: string): Promise<{ waUrl: string; message: string }> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.comparison.findFirst({ where: { id, tenantId } });
      if (!row) throw new NotFoundException("דף ההשוואה לא נמצא");
      const buyer = await tx.buyer.findFirst({
        where: { id: row.buyerId, tenantId, deletedAt: null, ...ownershipFilter("buyers.view_all", "ownerUserId") },
        select: { contactId: true },
      });
      if (!buyer) throw new NotFoundException("דף ההשוואה לא נמצא");
      const contact = await this.contacts.getById(tx, buyer.contactId);
      if (!contact) throw new NotFoundException("איש קשר לא נמצא");
      const presentation = ComparisonPresentationSchema.parse(row.presentation);
      const message = comparisonMessage({
        count: presentation.properties.length,
        url: this.publicUrl(row.publicToken),
        agencyName: presentation.agencyName,
      });
      await this.messaging.recordOutbound(tx, { contactId: buyer.contactId, channel: "whatsapp", provider: "walink", body: message });
      return { waUrl: whatsappLink(contact.phone, message), message };
    });
  }

  /* ---------- ‏הדף הציבורי ---------- */

  async publicView(token: string): Promise<PublicComparisonView> {
    return this.prisma.withPublicComparison(token, async (tx) => {
      const row = await this.publicRow(tx, token);
      const presentation = ComparisonPresentationSchema.parse(row.presentation);
      const buyer = await tx.buyer.findFirst({ where: { id: row.buyerId, tenantId: row.tenantId, deletedAt: null }, select: { contactId: true } });
      const properties = await Promise.all(
        presentation.properties.map(async (property, index) => ({
          ...property,
          available: buyer !== null && (await this.stillShowable(tx, row.tenantId, buyer.contactId, property.propertyId)),
          images: property.media.map((m, i) => ({ url: `/public/compare/${token}/media/${index}/${i}`, ...(m.alt === undefined ? {} : { alt: m.alt }) })),
        })),
      );
      await tx.comparison.updateMany({
        where: { id: row.id },
        data: { openCount: { increment: 1 }, ...(row.firstOpenedAt === null ? { firstOpenedAt: new Date() } : {}) },
      });
      return { agencyName: presentation.agencyName, wants: presentation.wants, properties, interested: ComparisonService.responses(row.responses) };
    });
  }

  async publicImage(token: string, propertyIndex: number, mediaIndex: number): Promise<StoredObject> {
    const key = await this.prisma.withPublicComparison(token, async (tx) => {
      const row = await this.publicRow(tx, token);
      const presentation = ComparisonPresentationSchema.parse(row.presentation);
      const entry = presentation.properties[propertyIndex]?.media[mediaIndex];
      if (!entry) throw new NotFoundException("התמונה לא נמצאה");
      return entry.key;
    });
    try {
      return await this.storage.getObject(key);
    } catch (error) {
      if (StorageService.isMissingObjectError(error)) throw new NotFoundException("התמונה לא נמצאה באחסון");
      throw error;
    }
  }

  /** ‏„מעוניין” על נכס אחד — פעם אחת: ציר הזמן של הקונה והתראה לסוכן שלו. */
  async publicInterest(token: string, propertyId: string): Promise<void> {
    await this.prisma.withPublicComparison(token, async (tx) => {
      const row = await this.publicRow(tx, token);
      const presentation = ComparisonPresentationSchema.parse(row.presentation);
      const property = presentation.properties.find((p) => p.propertyId === propertyId);
      if (!property) throw new NotFoundException("הנכס אינו בדף הזה");
      /* ‏אטומי: רק הטרנזקציה שהוסיפה את המזהה רושמת ומודיעה — לחיצה כפולה לא מכפילה */
      const changed = await tx.$executeRaw`
        UPDATE comparisons SET responses = responses || to_jsonb(ARRAY[${propertyId}]::text[]), updated_at = NOW()
        WHERE id = ${row.id} AND NOT (responses ? ${propertyId})`;
      if (changed !== 1) return;
      const buyer = await tx.buyer.findFirst({ where: { id: row.buyerId, tenantId: row.tenantId, deletedAt: null }, select: { id: true, ownerUserId: true } });
      if (!buyer) return;
      await tx.interaction.create({
        data: {
          id: ulid(), tenantId: row.tenantId, buyerId: buyer.id, propertyId, kind: "system", direction: "in",
          content: `הקונה סימן בדף ההשוואה: מעוניין ב${property.title}`,
        },
      });
      await tx.notification.create({
        data: {
          id: ulid(), tenantId: row.tenantId, userId: buyer.ownerUserId, type: "offer_interested",
          title: "👍 מעוניין — מדף ההשוואה",
          body: `${property.title} — הקונה סימן שמעניין אותו. כדאי לחזור אליו לתיאום סיור.`.slice(0, 500),
          entityType: "buyer", entityId: buyer.id,
        },
      });
    });
  }

  /* ---------- ‏פנימי ---------- */

  private async publicRow(tx: TenantTx, token: string) {
    const row = await tx.comparison.findFirst({ where: { publicToken: token } });
    if (!row) throw new NotFoundException("דף ההשוואה לא נמצא");
    if (row.tokenExpires < new Date()) throw new GoneException("תוקף הקישור פג");
    /* ‏המשרד נגזר מהשורה שנמצאה — ערך שרת, לא קלט */
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${row.tenantId}, true)`;
    return row;
  }

  /** ‏עדיין מותר להציג: בשיווק, וההזמנה בכתב עדיין בתוקף. */
  private async stillShowable(tx: TenantTx, tenantId: string, contactId: string, propertyId: string): Promise<boolean> {
    const property = await tx.property.findFirst({
      where: { id: propertyId, tenantId, deletedAt: null, status: { in: [...MARKETABLE] } },
      select: { id: true },
    });
    if (!property) return false;
    return this.agreements.hasSigned(tx, tenantId, contactId, "brokerage", propertyId);
  }

  private static responses(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  }

  private publicUrl(token: string): string {
    return `${loadEnv().WEB_ORIGIN}/compare/${token}`;
  }

  private toDto(row: { id: string; publicToken: string; createdAt: Date; openCount: number; presentation: unknown; responses: unknown }): ComparisonDto {
    const presentation = ComparisonPresentationSchema.safeParse(row.presentation);
    return {
      id: row.id,
      url: this.publicUrl(row.publicToken),
      createdAt: row.createdAt.toISOString(),
      openCount: row.openCount,
      titles: presentation.success ? presentation.data.properties.map((p) => p.title) : [],
      interested: ComparisonService.responses(row.responses),
    };
  }
}
