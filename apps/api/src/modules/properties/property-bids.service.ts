import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  bidSummarySentences,
  bidsSummary,
  groupBidThreads,
  statusAfterNext,
  type BidDecision,
  type BidEvent,
  type BidSide,
  type BidStatus,
  type BidsSummary,
  type PropertyBidCreate,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { lockProperty } from "../../common/locks";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

/**
 * ‏הצעות מחיר ומו״מ על נכס (docs/03 — property_bids).
 *
 * ## ‏מי רואה את מי
 *
 * ‏הנכס הוא של המשרד, ולכן כל מי שרואה את הכרטיס רואה שיש מו״מ
 * ‏וכמה: מספר ההצעות והסכומים. **שמות** של קונים מוצגים רק למי
 * ‏שרשאי לראות את הקונה (`buyers.view_all`, או הקונים שלי) — קונה
 * ‏של סוכן אחר מופיע כ„קונה של סוכן אחר”. הסכום אינו פרט אישי;
 * ‏השם כן.
 *
 * ## ‏למה נעילת הנכס
 *
 * ‏„על השולחן” הוא הצעד האחרון בשרשור, וזה נקבע בכתיבה: הצעד החדש
 * ‏סוגר את הקודם. שני צעדים במקביל בלי נעילה היו משאירים שניים
 * ‏פתוחים באותו שרשור.
 */

export interface BidThreadDto {
  /** ‏השם רק למי שרשאי לראות את הקונה; אחרת „קונה של סוכן אחר” */
  buyer: { id: string; name: string; visible: boolean };
  events: BidEvent[];
  open: BidEvent | null;
  outcome: BidDecision | null;
  lastAt: string;
}

export interface PropertyBidsDto {
  threads: BidThreadDto[];
  summary: BidsSummary;
  /** ‏המשפטים למוכר — אותם משפטים שנכנסים לדוח */
  sentences: string[];
  /** ‏קונים שכבר נגעו בנכס (סיור, התאמה) ורשאים להיראות — לבורר בטופס */
  buyerOptions: { id: string; name: string }[];
}

function toEvent(row: {
  id: string;
  buyerId: string;
  side: string;
  amountAgorot: bigint;
  status: string;
  note: string | null;
  createdAt: Date;
}): BidEvent {
  return {
    id: row.id,
    buyerId: row.buyerId,
    side: row.side as BidSide,
    amountAgorot: Number(row.amountAgorot),
    status: row.status as BidStatus,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

const MASKED_NAME = "קונה של סוכן אחר";

@Injectable()
export class PropertyBidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
  ) {}

  async list(propertyId: string): Promise<PropertyBidsDto> {
    return this.prisma.withTenant(async (tx) => {
      await this.assertProperty(tx, propertyId);
      return this.listIn(tx, propertyId);
    });
  }

  async create(propertyId: string, input: PropertyBidCreate): Promise<PropertyBidsDto> {
    const ctx = TenantContext.current();
    const tenantId = ctx.tenantId;
    return this.prisma.withTenant(async (tx) => {
      await this.assertProperty(tx, propertyId);
      await lockProperty(tx, tenantId, propertyId);
      /* ‏רושמים הצעה רק לקונה שרואים — אותו כלל כמו בבורר שבטופס */
      const buyer = await tx.buyer.findFirst({
        where: { id: input.buyerId, tenantId, deletedAt: null, ...ownershipFilter("buyers.view_all", "ownerUserId") },
        select: { id: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");
      /* ‏הצעד החדש סוגר את ההצעה הפתוחה של אותו שרשור */
      const previous = await tx.propertyBid.findFirst({
        where: { tenantId, propertyId, buyerId: input.buyerId, status: "open" },
        select: { id: true, side: true },
      });
      if (previous) {
        await tx.propertyBid.update({
          where: { id: previous.id },
          data: { status: statusAfterNext(previous.side as BidSide, input.side) },
        });
      }
      await tx.propertyBid.create({
        data: {
          id: ulid(),
          tenantId,
          propertyId,
          buyerId: input.buyerId,
          side: input.side,
          amountAgorot: BigInt(input.amountAgorot),
          note: input.note === undefined || input.note === "" ? null : input.note,
          createdByUserId: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "property.bid_recorded",
        entityType: "property",
        entityId: propertyId,
        metadata: { buyerId: input.buyerId, side: input.side, amountAgorot: input.amountAgorot },
      });
      return this.listIn(tx, propertyId);
    });
  }

  async decide(propertyId: string, bidId: string, status: BidDecision): Promise<PropertyBidsDto> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      await this.assertProperty(tx, propertyId);
      await lockProperty(tx, tenantId, propertyId);
      const bid = await tx.propertyBid.findFirst({
        where: { id: bidId, tenantId, propertyId },
        select: { id: true, status: true, buyerId: true },
      });
      if (!bid) throw new NotFoundException("הצעה לא נמצאה");
      if (bid.status !== "open") throw new ConflictException("ההצעה כבר אינה על השולחן");
      await tx.propertyBid.update({ where: { id: bidId }, data: { status, decidedAt: new Date() } });
      await this.audit.record(tx, {
        action: "property.bid_decided",
        entityType: "property",
        entityId: propertyId,
        metadata: { bidId, buyerId: bid.buyerId, status },
      });
      return this.listIn(tx, propertyId);
    });
  }

  /** ‏המשפטים למוכר בלבד — לדוח הפעילות. בלי שמות, ולכן בלי שאלת ראייה. */
  async sentencesFor(tx: TenantTx, propertyId: string): Promise<string[]> {
    const threads = await this.threadsIn(tx, propertyId);
    return bidSummarySentences(bidsSummary(threads));
  }

  private async assertProperty(tx: TenantTx, propertyId: string): Promise<void> {
    const property = await tx.property.findFirst({
      where: { id: propertyId, tenantId: TenantContext.current().tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!property) throw new NotFoundException("נכס לא נמצא");
  }

  /** ‏השרשורים של קונים קיימים — קונה שנמחק יוצא עם השרשור שלו. */
  private async threadsIn(tx: TenantTx, propertyId: string) {
    const tenantId = TenantContext.current().tenantId;
    const rows = await tx.propertyBid.findMany({
      where: { tenantId, propertyId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const threads = groupBidThreads(rows.map(toEvent));
    if (threads.length === 0) return threads;
    const alive = await tx.buyer.findMany({
      where: { tenantId, id: { in: threads.map((t) => t.buyerId) }, deletedAt: null },
      select: { id: true },
    });
    const aliveIds = new Set(alive.map((b) => b.id));
    return threads.filter((t) => aliveIds.has(t.buyerId));
  }

  private async listIn(tx: TenantTx, propertyId: string): Promise<PropertyBidsDto> {
    const tenantId = TenantContext.current().tenantId;
    const threads = await this.threadsIn(tx, propertyId);
    const [viewed, matched] = await Promise.all([
      tx.appointment.findMany({ where: { tenantId, propertyId, buyerId: { not: null } }, select: { buyerId: true }, take: 200 }),
      tx.match.findMany({ where: { tenantId, propertyId }, select: { buyerId: true }, take: 200 }),
    ]);
    const relatedIds = new Set<string>();
    for (const row of viewed) if (row.buyerId !== null) relatedIds.add(row.buyerId);
    for (const row of matched) relatedIds.add(row.buyerId);
    /* ‏רק מי שרלוונטי — בשרשור או נגע בנכס — ורק מי שרשאים לראות */
    const wanted = [...new Set([...threads.map((t) => t.buyerId), ...relatedIds])];
    const visible = wanted.length === 0
      ? []
      : await tx.buyer.findMany({
          where: { tenantId, deletedAt: null, id: { in: wanted }, ...ownershipFilter("buyers.view_all", "ownerUserId") },
          select: { id: true, contactId: true },
        });
    const contactsById = await this.contacts.getByIds(tx, visible.map((b) => b.contactId));
    const nameOf = new Map<string, string>();
    for (const b of visible) {
      const c = contactsById.get(b.contactId);
      if (c) nameOf.set(b.id, c.name);
    }
    const dtoThreads: BidThreadDto[] = threads.map((t) => {
      const name = nameOf.get(t.buyerId);
      return {
        buyer: name === undefined ? { id: t.buyerId, name: MASKED_NAME, visible: false } : { id: t.buyerId, name, visible: true },
        events: t.events,
        open: t.open,
        outcome: t.outcome,
        lastAt: t.lastAt,
      };
    });
    const summary = bidsSummary(threads);
    const buyerOptions = [...relatedIds]
      .filter((id) => nameOf.has(id))
      .map((id) => ({ id, name: nameOf.get(id)! }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
    return { threads: dtoThreads, summary, sentences: bidSummarySentences(summary), buyerOptions };
  }
}
