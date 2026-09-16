import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  isOpenHouseSlot,
  openHouseSlots,
  slotAvailability,
  type OpenHouseCreate,
  type OpenHouseStatus,
  type SlotAvailability,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { leadOwnershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { WebLeadService } from "../leads/web-lead.service";
import { LandingService } from "./landing.service";

/**
 * ‏בית פתוח (docs/03 — open_houses).
 *
 * ## ‏מבקר = סיור
 *
 * ‏אין טבלת מבקרים: מי שנרשם מקבל **ליד** (אותה קליטה של טופס דף
 * ‏הנחיתה — כרטיס איש קשר מוצפן, הצטרפות לליד פתוח, התראה לסוכן)
 * ‏ו**פגישה ביומן** מסוג `viewing` שמצביעה על האירוע. לכן הוא נכנס
 * ‏לדוח למוכר, לסריקת „נכס תקוע” ולמשוב הסיור בלי קוד נוסף, ושום
 * ‏שם או טלפון אינו נכתב בטבלה חדשה.
 *
 * ## ‏מי רואה את מי
 *
 * ‏האירוע והמספרים — לכל מי שרואה את הנכס. **שמות** המבקרים — רק
 * ‏למי שרואה את הליד (`leadOwnershipFilter`); אחרת „מבקר”.
 *
 * ## ‏הדף הציבורי
 *
 * ‏ההרשמה נכנסת דרך טוקן דף הנחיתה — אותו קישור שעל השלט. המשרד
 * ‏נקבע מהנכס שהטוקן פתח (ערך שרת), ורק אז נקראים האירוע והספירות
 * ‏בהקשר הדייר, כמו ב-`LandingService.publicView`.
 */

const MARKETABLE = new Set(["draft", "active"]);
const MASKED_NAME = "מבקר";
const OPEN_HOUSE_SOURCE = "בית פתוח";

export interface OpenHouseVisitorDto {
  appointmentId: string;
  leadId: string;
  slotAt: string;
  name: string;
  phone?: string;
  visible: boolean;
  arrived: boolean;
  feedback: { price: string | null; condition: string | null; fit: string | null };
}

export interface OpenHouseDto {
  id: string;
  startsAt: string;
  endsAt: string;
  slotMinutes: number;
  slotCapacity: number | null;
  status: OpenHouseStatus;
  slots: SlotAvailability[];
  registered: number;
  arrived: number;
  visitors: OpenHouseVisitorDto[];
}

export interface OpenHousesDto {
  /** ‏קישור ההרשמה — דף הנחיתה של הנכס; נוצר עם האירוע הראשון */
  registrationUrl: string | null;
  events: OpenHouseDto[];
}

export interface PublicOpenHouseDto {
  event: { id: string; startsAt: string; endsAt: string; slotMinutes: number; slots: SlotAvailability[] } | null;
}

type EventRow = {
  id: string;
  propertyId: string;
  startsAt: Date;
  endsAt: Date;
  slotMinutes: number;
  slotCapacity: number | null;
  status: string;
};

function labelOf(p: { marketingTitle: string | null; street: string | null; houseNumber: string | null; city: string | null }): string {
  const address = [[p.street, p.houseNumber].filter(Boolean).join(" "), p.city].filter((part) => part).join(", ");
  return p.marketingTitle || address || "הנכס";
}

@Injectable()
export class OpenHouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly plans: PlanCatalogService,
    private readonly webLeads: WebLeadService,
    private readonly landing: LandingService,
  ) {}

  async list(propertyId: string): Promise<OpenHousesDto> {
    return this.prisma.withTenant(async (tx) => {
      const property = await this.property(tx, propertyId);
      return this.listIn(tx, property);
    });
  }

  async create(propertyId: string, input: OpenHouseCreate): Promise<OpenHousesDto> {
    const ctx = TenantContext.current();
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (startsAt.getTime() <= Date.now()) throw new BadRequestException("בית פתוח נקבע להמשך, לא לעבר");
    /* ‏הקישור שעל השלט ובהזמנה — נוצר כאן אם עוד אין, כדי שההרשמה תעבוד מיד */
    await this.landing.ensure(propertyId);
    return this.prisma.withTenant(async (tx) => {
      const property = await this.property(tx, propertyId);
      if (!MARKETABLE.has(property.status)) throw new ConflictException("הנכס אינו בשיווק");
      const overlapping = await tx.openHouse.findFirst({
        where: { tenantId: ctx.tenantId, propertyId, status: "planned", startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { id: true },
      });
      if (overlapping) throw new ConflictException("כבר יש בית פתוח מתוכנן בשעות האלה");
      const id = ulid();
      await tx.openHouse.create({
        data: {
          id, tenantId: ctx.tenantId, propertyId, startsAt, endsAt,
          slotMinutes: input.slotMinutes, slotCapacity: input.slotCapacity, createdByUserId: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "property.open_house_created",
        entityType: "property",
        entityId: propertyId,
        metadata: { openHouseId: id, startsAt: input.startsAt, endsAt: input.endsAt },
      });
      return this.listIn(tx, property);
    });
  }

  /** ‏„התקיים” מסמן את מי שלא הגיע כ-no_show; „בוטל” מבטל את הסיורים שנקבעו. */
  async setStatus(propertyId: string, openHouseId: string, status: "done" | "cancelled"): Promise<OpenHousesDto> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const property = await this.property(tx, propertyId);
      const event = await this.plannedEvent(tx, propertyId, openHouseId);
      await tx.openHouse.update({ where: { id: event.id }, data: { status } });
      await tx.appointment.updateMany({
        where: { tenantId, openHouseId: event.id, status: "scheduled" },
        data: { status: status === "done" ? "no_show" : "cancelled" },
      });
      await this.audit.record(tx, {
        action: status === "done" ? "property.open_house_done" : "property.open_house_cancelled",
        entityType: "property",
        entityId: propertyId,
        metadata: { openHouseId: event.id },
      });
      return this.listIn(tx, property);
    });
  }

  /** ‏מבקר שהגיע בלי להירשם — ליד + סיור שכבר התקיים. */
  async walkIn(
    propertyId: string,
    openHouseId: string,
    input: { name: string; phone: string; slotAt?: string },
  ): Promise<OpenHousesDto> {
    const ctx = TenantContext.current();
    const { property, event } = await this.prisma.withTenant(async (tx) => ({
      property: await this.property(tx, propertyId),
      event: await this.plannedEvent(tx, propertyId, openHouseId),
    }));
    const slotAt = input.slotAt === undefined ? OpenHouseService.currentSlot(event, new Date()) : new Date(input.slotAt);
    if (!isOpenHouseSlot(slotAt, event.startsAt, event.endsAt, event.slotMinutes)) {
      throw new BadRequestException("השעה אינה אחת ממשבצות האירוע");
    }
    const { leadId } = await this.ingest(ctx.tenantId, property, input);
    return this.prisma.withTenant(async (tx) => {
      await this.upsertVisit(tx, { tenantId: ctx.tenantId, event, property, leadId, slotAt, status: "completed", createdBy: ctx.userId });
      return this.listIn(tx, property);
    });
  }

  async setArrived(propertyId: string, openHouseId: string, appointmentId: string, arrived: boolean): Promise<OpenHousesDto> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const property = await this.property(tx, propertyId);
      const event = await tx.openHouse.findFirst({ where: { id: openHouseId, tenantId, propertyId }, select: { status: true } });
      if (!event) throw new NotFoundException("בית פתוח לא נמצא");
      if (event.status === "cancelled") throw new ConflictException("האירוע בוטל");
      const visit = await tx.appointment.findFirst({
        where: { id: appointmentId, tenantId, propertyId, openHouseId },
        select: { id: true, status: true },
      });
      if (!visit || visit.status === "cancelled") throw new NotFoundException("המבקר לא נמצא");
      /* ‏ביטול „הגיע” אחרי שהאירוע נסגר מחזיר ל„לא הגיע”, לא ל„נקבע” */
      const back = event.status === "done" ? "no_show" : "scheduled";
      await tx.appointment.update({ where: { id: visit.id }, data: { status: arrived ? "completed" : back } });
      return this.listIn(tx, property);
    });
  }

  /* ---------- ‏הדף הציבורי ---------- */

  async publicView(token: string): Promise<PublicOpenHouseDto> {
    return this.prisma.withPublicLanding(token, async (tx) => {
      const property = await this.publicProperty(tx, token);
      if (property === null) return { event: null };
      const event = await this.nextEvent(tx, property.tenantId, property.id);
      if (event === null) return { event: null };
      const slots = await this.slotsOf(tx, property.tenantId, event);
      return {
        event: { id: event.id, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), slotMinutes: event.slotMinutes, slots },
      };
    });
  }

  /**
   * ‏הרשמה: ליד (אותה קליטה של טופס דף הנחיתה) + סיור במשבצת. הקיבולת
   * ‏נבדקת תחת נעילת שורת האירוע — שני נרשמים למקום האחרון לא נכנסים
   * ‏שניהם. הרשמה חוזרת של אותו טלפון מזיזה את המשבצת ואינה מכפילה.
   */
  async register(token: string, openHouseId: string, input: { name: string; phone: string; slotAt: string }): Promise<void> {
    const resolved = await this.prisma.withPublicLanding(token, async (tx) => {
      const property = await this.publicProperty(tx, token);
      if (property === null) throw new NotFoundException("הדף לא נמצא");
      const event = await tx.openHouse.findFirst({
        where: { id: openHouseId, tenantId: property.tenantId, propertyId: property.id, status: "planned", endsAt: { gt: new Date() } },
      });
      if (!event) throw new NotFoundException("האירוע כבר אינו פתוח להרשמה");
      const slotAt = new Date(input.slotAt);
      if (!isOpenHouseSlot(slotAt, event.startsAt, event.endsAt, event.slotMinutes)) {
        throw new BadRequestException("השעה אינה אחת ממשבצות האירוע");
      }
      /*
       * ‏הקיבולת נבדקת **לפני** קליטת הליד: משבצת מלאה מחזירה 409 בלי
       * ‏להשאיר כרטיס ליד על הרשמה שלא קרתה. הבדיקה המחייבת חוזרת
       * ‏תחת הנעילה למטה — כאן רק חוסכים את הכתיבה המיותרת.
       */
      if (event.slotCapacity !== null) {
        const taken = await tx.appointment.count({
          where: { tenantId: property.tenantId, openHouseId: event.id, startsAt: slotAt, status: { not: "cancelled" } },
        });
        if (taken >= event.slotCapacity) throw new ConflictException("המשבצת הזו התמלאה — בחרו שעה אחרת");
      }
      return { property, event, slotAt };
    });
    const { event, property, slotAt } = resolved;
    const { leadId } = await this.ingest(property.tenantId, property, input);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${property.tenantId}, true)`;
      await tx.$queryRaw`SELECT id FROM open_houses WHERE id = ${event.id} AND tenant_id = ${property.tenantId} FOR UPDATE`;
      const live = await tx.openHouse.findFirst({ where: { id: event.id, status: "planned" }, select: { id: true } });
      if (!live) throw new NotFoundException("האירוע כבר אינו פתוח להרשמה");
      if (event.slotCapacity !== null) {
        const taken = await tx.appointment.count({
          where: { tenantId: property.tenantId, openHouseId: event.id, startsAt: slotAt, status: { not: "cancelled" }, leadId: { not: leadId } },
        });
        if (taken >= event.slotCapacity) throw new ConflictException("המשבצת הזו התמלאה — בחרו שעה אחרת");
      }
      await this.upsertVisit(tx, { tenantId: property.tenantId, event, property, leadId, slotAt, status: "scheduled", createdBy: null });
    });
  }

  /* ---------- ‏פנימי ---------- */

  private async property(tx: TenantTx, propertyId: string) {
    const property = await tx.property.findFirst({
      where: { id: propertyId, tenantId: TenantContext.current().tenantId, deletedAt: null },
      select: { id: true, tenantId: true, status: true, agentUserId: true, landingToken: true, marketingTitle: true, street: true, houseNumber: true, city: true },
    });
    if (!property) throw new NotFoundException("נכס לא נמצא");
    return property;
  }

  private async plannedEvent(tx: TenantTx, propertyId: string, openHouseId: string): Promise<EventRow> {
    const event = await tx.openHouse.findFirst({
      where: { id: openHouseId, tenantId: TenantContext.current().tenantId, propertyId },
    });
    if (!event) throw new NotFoundException("בית פתוח לא נמצא");
    if (event.status !== "planned") throw new ConflictException("האירוע כבר הסתיים או בוטל");
    return event;
  }

  /** ‏הנכס שהטוקן פותח, כשהדף פעיל למשרד; `null` כשאין מה להציג. */
  private async publicProperty(tx: TenantTx, token: string) {
    const property = await tx.property.findFirst({
      where: { landingToken: token },
      select: { id: true, tenantId: true, deletedAt: true, status: true, agentUserId: true, marketingTitle: true, street: true, houseNumber: true, city: true },
    });
    if (!property || property.deletedAt !== null || !MARKETABLE.has(property.status)) return null;
    if (!(await this.plans.tenantHasFeature(property.tenantId, "landing_pages", tx))) return null;
    /* ‏ההקשר נקבע מהנכס שנמצא — ערך שרת, לא קלט */
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${property.tenantId}, true)`;
    return property;
  }

  private nextEvent(tx: TenantTx, tenantId: string, propertyId: string): Promise<EventRow | null> {
    return tx.openHouse.findFirst({
      where: { tenantId, propertyId, status: "planned", endsAt: { gt: new Date() } },
      orderBy: { startsAt: "asc" },
    });
  }

  private async slotsOf(tx: TenantTx, tenantId: string, event: EventRow): Promise<SlotAvailability[]> {
    const rows = await tx.appointment.groupBy({
      by: ["startsAt"],
      where: { tenantId, openHouseId: event.id, status: { not: "cancelled" } },
      _count: { _all: true },
    });
    const counts = new Map(rows.map((row) => [row.startsAt.toISOString(), row._count._all]));
    return slotAvailability(openHouseSlots(event.startsAt, event.endsAt, event.slotMinutes), counts, event.slotCapacity);
  }

  private static currentSlot(event: EventRow, now: Date): Date {
    const slots = openHouseSlots(event.startsAt, event.endsAt, event.slotMinutes);
    const started = slots.filter((slot) => slot.getTime() <= now.getTime());
    return started[started.length - 1] ?? slots[0] ?? event.startsAt;
  }

  private ingest(
    tenantId: string,
    property: { id: string; marketingTitle: string | null; street: string | null; houseNumber: string | null; city: string | null },
    input: { name: string; phone: string },
  ): Promise<{ leadId: string }> {
    return this.webLeads.ingestForTenant(
      tenantId,
      { name: input.name, phone: input.phone, pageUrl: `בית פתוח — ${labelOf(property)}`, propertyId: property.id },
      OPEN_HOUSE_SOURCE,
    );
  }

  /** ‏סיור אחד לכל ליד באירוע: הרשמה חוזרת מזיזה, ולא מכפילה. */
  private async upsertVisit(
    tx: TenantTx,
    input: {
      tenantId: string;
      event: EventRow;
      property: { id: string; agentUserId: string | null };
      leadId: string;
      slotAt: Date;
      status: "scheduled" | "completed";
      createdBy: string | null;
    },
  ): Promise<void> {
    const endsAt = new Date(input.slotAt.getTime() + input.event.slotMinutes * 60_000);
    const existing = await tx.appointment.findFirst({
      where: { tenantId: input.tenantId, openHouseId: input.event.id, leadId: input.leadId },
      select: { id: true, status: true },
    });
    if (existing) {
      await tx.appointment.update({
        where: { id: existing.id },
        data: { startsAt: input.slotAt, endsAt, status: existing.status === "completed" ? "completed" : input.status },
      });
      return;
    }
    await tx.appointment.create({
      data: {
        id: ulid(),
        tenantId: input.tenantId,
        kind: "viewing",
        title: "בית פתוח",
        leadId: input.leadId,
        propertyId: input.property.id,
        openHouseId: input.event.id,
        startsAt: input.slotAt,
        endsAt,
        status: input.status,
        ownerUserId: input.property.agentUserId ?? input.createdBy,
        createdBy: input.createdBy,
      },
    });
  }

  private async listIn(
    tx: TenantTx,
    property: { id: string; tenantId: string; landingToken: string | null },
  ): Promise<OpenHousesDto> {
    const tenantId = property.tenantId;
    const events = await tx.openHouse.findMany({
      where: { tenantId, propertyId: property.id },
      orderBy: { startsAt: "desc" },
      take: 20,
    });
    if (events.length === 0) return { registrationUrl: this.registrationUrl(property.landingToken), events: [] };
    const visits = await tx.appointment.findMany({
      where: { tenantId, openHouseId: { in: events.map((e) => e.id) }, status: { not: "cancelled" } },
      select: { id: true, openHouseId: true, leadId: true, startsAt: true, status: true, feedbackPrice: true, feedbackCondition: true, feedbackFit: true },
      orderBy: { startsAt: "asc" },
      take: 1000,
    });
    const leadIds = [...new Set(visits.map((v) => v.leadId).filter((id): id is string => id !== null))];
    const visibleLeads = leadIds.length === 0
      ? []
      : await tx.lead.findMany({ where: { tenantId, id: { in: leadIds }, ...leadOwnershipFilter() }, select: { id: true, contactId: true } });
    const contactsById = await this.contacts.getByIds(tx, visibleLeads.map((l) => l.contactId));
    const personOf = new Map<string, { name: string; phone?: string }>();
    for (const lead of visibleLeads) {
      const c = contactsById.get(lead.contactId);
      if (c) personOf.set(lead.id, { name: c.name, ...(c.phone === undefined ? {} : { phone: c.phone }) });
    }
    const dto: OpenHouseDto[] = events.map((event) => {
      const mine = visits.filter((v) => v.openHouseId === event.id);
      const counts = new Map<string, number>();
      for (const v of mine) counts.set(v.startsAt.toISOString(), (counts.get(v.startsAt.toISOString()) ?? 0) + 1);
      return {
        id: event.id,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        slotMinutes: event.slotMinutes,
        slotCapacity: event.slotCapacity,
        status: event.status as OpenHouseStatus,
        slots: slotAvailability(openHouseSlots(event.startsAt, event.endsAt, event.slotMinutes), counts, event.slotCapacity),
        registered: mine.length,
        arrived: mine.filter((v) => v.status === "completed").length,
        visitors: mine.map((v) => {
          const person = v.leadId === null ? undefined : personOf.get(v.leadId);
          return {
            appointmentId: v.id,
            leadId: v.leadId ?? "",
            slotAt: v.startsAt.toISOString(),
            ...(person === undefined ? { name: MASKED_NAME, visible: false } : { ...person, visible: true }),
            arrived: v.status === "completed",
            feedback: { price: v.feedbackPrice, condition: v.feedbackCondition, fit: v.feedbackFit },
          };
        }),
      };
    });
    return { registrationUrl: this.registrationUrl(property.landingToken), events: dto };
  }

  private registrationUrl(token: string | null): string | null {
    return token === null ? null : `${loadEnv().WEB_ORIGIN}/p/${token}`;
  }
}
