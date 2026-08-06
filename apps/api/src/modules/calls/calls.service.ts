import { Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

/**
 * יומן שיחות.
 *
 * כרגע השיחות מתועדות ידנית בידי המתווך. הטבלה בנויה כך שכשייכנס
 * חיבור לספק טלפוניה, שיחות אוטומטיות ייכנסו לאותו מסך עם
 * source="provider" — בלי מיגרציה ובלי מסך שני.
 */

export interface CallDto {
  id: string;
  direction: "inbound" | "outbound";
  source: string;
  contactId?: string;
  contactName?: string;
  leadId?: string;
  phone?: string;
  occurredAt: Date;
  durationMinutes?: number;
  outcome: string;
  summary?: string;
  createdAt: Date;
}

export interface CreateCallInput {
  direction: "inbound" | "outbound";
  contactId?: string;
  leadId?: string;
  phone?: string;
  occurredAt: Date;
  durationMinutes?: number;
  outcome: string;
  summary?: string;
}

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateCallInput): Promise<CallDto> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      // ליד שהוזן — משמש גם למילוי איש הקשר, כדי שהשיחה תיקשר לכרטיס
      let contactId = input.contactId;
      if (contactId === undefined && input.leadId !== undefined) {
        const lead = await tx.lead.findFirst({
          where: { id: input.leadId, tenantId },
          select: { contactId: true },
        });
        contactId = lead?.contactId;
      }

      const row = await tx.call.create({
        data: {
          id: ulid(),
          tenantId,
          direction: input.direction,
          source: "manual",
          contactId: contactId ?? null,
          leadId: input.leadId ?? null,
          phoneEncrypted: input.phone ? this.crypto.encrypt(input.phone) : null,
          phoneHash: input.phone ? this.crypto.phoneHash(input.phone) : null,
          occurredAt: input.occurredAt,
          durationMinutes: input.durationMinutes ?? null,
          outcome: input.outcome,
          summary: input.summary ?? null,
          createdBy: userId,
        },
      });

      await this.audit.record(tx, {
        action: "call.log",
        entityType: "call",
        entityId: row.id,
        metadata: { direction: input.direction, outcome: input.outcome },
      });

      return this.toDto(tx, row);
    });
  }

  async list(query: { outcome?: string; leadId?: string; limit: number }): Promise<CallDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.call.findMany({
        where: {
          tenantId,
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.leadId ? { leadId: query.leadId } : {}),
        },
        orderBy: { occurredAt: "desc" },
        take: query.limit,
      });
      return Promise.all(rows.map((row) => this.toDto(tx, row)));
    });
  }

  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.call.deleteMany({ where: { id, tenantId } });
      if (result.count === 0) throw new NotFoundException("שיחה לא נמצאה");
      await this.audit.record(tx, { action: "call.delete", entityType: "call", entityId: id });
    });
  }

  private async toDto(
    tx: TenantTx,
    row: {
      id: string;
      direction: string;
      source: string;
      contactId: string | null;
      leadId: string | null;
      phoneEncrypted: string | null;
      occurredAt: Date;
      durationMinutes: number | null;
      outcome: string;
      summary: string | null;
      createdAt: Date;
    },
  ): Promise<CallDto> {
    const contact = row.contactId ? await this.contacts.getById(tx, row.contactId) : null;
    return {
      id: row.id,
      direction: row.direction as "inbound" | "outbound",
      source: row.source,
      ...(row.contactId ? { contactId: row.contactId } : {}),
      ...(contact ? { contactName: contact.name } : {}),
      ...(row.leadId ? { leadId: row.leadId } : {}),
      // הטלפון של איש הקשר מנצח — הוא המקור המעודכן
      ...(contact?.phone
        ? { phone: contact.phone }
        : row.phoneEncrypted
          ? { phone: this.crypto.decrypt(row.phoneEncrypted) }
          : {}),
      occurredAt: row.occurredAt,
      ...(row.durationMinutes !== null ? { durationMinutes: row.durationMinutes } : {}),
      outcome: row.outcome,
      ...(row.summary ? { summary: row.summary } : {}),
      createdAt: row.createdAt,
    };
  }
}
