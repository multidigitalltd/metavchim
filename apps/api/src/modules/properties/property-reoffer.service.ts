import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  REOFFER_REASON_LABELS,
  priceDropStillFresh,
  type ReofferReason,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { lockProperty } from "../../common/locks";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

/**
 * ‏„ירד המחיר — להציע שוב” (docs/03 — properties, interactions).
 *
 * ## ‏מי ברשימה
 *
 * ‏שני מקורות, שניהם נתונים שהמתווך כבר הזין: סיורים שהסתיימו עם
 * ‏משוב „המחיר גבוה”, והתאמות שנדחו עם הסיבה „המחיר לא מתאים”.
 * ‏לא „כל מי שביקר” — מי שאמר שהמיקום לא מתאים לא ישתכנע ממחיר.
 *
 * ## ‏מה נרשם כשפונים
 *
 * ‏אינטראקציה על הקונה **ועל הנכס** (`propertyId`), `whatsapp`/`out`.
 * ‏זה מה שמוריד את הקונה מהרשימה — לא לחיצה שנעלמת ברענון — וזה
 * ‏גם מה שמופיע בציר הזמן של הקונה. השליחה עצמה נשארת בידי הסוכן,
 * ‏מוואטסאפ שלו.
 *
 * ## ‏מי רואה את מי
 *
 * ‏אותו כלל כמו רשימת הקונים: `buyers.view_all` רואה את כולם, אחרת
 * ‏רק את הקונים שלי. נכס הוא של המשרד; קונה הוא של סוכן.
 *
 * ‏הרשימה נוגעת בשני כרטיסים, ולכן דורשת את **שתי** היכולות: נכסים
 * ‏וקונים. ‎`@RequireCapability` מאחד ב„או”, ולכן הבדיקה כאן, בשירות,
 * ‏גם לרשימה וגם לסימון — דריסת הרשאות שהסירה את מודול הנכסים לא
 * ‏תגלה כתובת ומחירים דרך הדלת הזו (ביקורת Codex).
 *
 * ## ‏מתי בכלל
 *
 * ‏רק כשהנכס בשיווק (`draft`/`active`) והמחיר ירד ב-30 הימים
 * ‏האחרונים; נכס שנמכר בינתיים אינו מציע דבר. ונספרות רק התנגדויות
 * ‏**שלפני** ההורדה: מי שביקר אחריה ואמר „עדיין יקר” ראה כבר את
 * ‏המחיר החדש.
 */

const MARKETABLE_STATUSES = ["draft", "active"] as const;

function assertMayReoffer(): void {
  const caps = TenantContext.current().capabilities;
  if (!caps.has("properties.view")) throw new ForbiddenException("מודול הנכסים חסום עבורך, פנו למנהל המשרד");
  if (!caps.has("buyers.view_own") && !caps.has("buyers.view_all")) {
    throw new ForbiddenException("מודול הקונים חסום עבורך, פנו למנהל המשרד");
  }
}

/** ‏יש ירידת מחיר חיה — טרייה, ועל נכס שעדיין בשיווק. */
function dropIsLive(p: { status: string; priceAgorot: bigint | null; previousPriceAgorot: bigint | null; priceChangedAt: Date | null }): p is typeof p & { priceChangedAt: Date } {
  return (
    (MARKETABLE_STATUSES as readonly string[]).includes(p.status) &&
    p.priceAgorot !== null &&
    p.previousPriceAgorot !== null &&
    p.priceChangedAt !== null &&
    p.previousPriceAgorot > p.priceAgorot &&
    priceDropStillFresh(p.priceChangedAt)
  );
}

export interface ReofferCandidateDto {
  buyerId: string;
  name: string;
  phone?: string;
  reasons: ReofferReason[];
  reasonLabels: string[];
  /** ‏הסיור האחרון שבו נאמר „גבוה” — כדי לומר „ביקר ב-…” */
  lastViewingAt: string | null;
  contactedAt: string | null;
}

export interface ReofferDto {
  drop: { fromAgorot: number; toAgorot: number; changedAt: string } | null;
  propertyLabel: string;
  candidates: ReofferCandidateDto[];
}

function labelOf(p: { marketingTitle: string | null; street: string | null; houseNumber: string | null; city: string | null }): string {
  const address = [[p.street, p.houseNumber].filter(Boolean).join(" "), p.city].filter((part) => part).join(", ");
  return p.marketingTitle || address || "הנכס";
}

@Injectable()
export class PropertyReofferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
  ) {}

  async candidates(propertyId: string): Promise<ReofferDto> {
    assertMayReoffer();
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: {
          status: true, priceAgorot: true, previousPriceAgorot: true, priceChangedAt: true,
          marketingTitle: true, street: true, houseNumber: true, city: true,
        },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");
      const propertyLabel = labelOf(property);
      if (!dropIsLive(property)) return { drop: null, propertyLabel, candidates: [] };
      const since = property.priceChangedAt;

      const [viewings, dismissed] = await Promise.all([
        tx.appointment.findMany({
          where: {
            tenantId, propertyId, kind: "viewing", status: "completed", feedbackPrice: "high", buyerId: { not: null },
            startsAt: { lt: since },
          },
          select: { buyerId: true, startsAt: true },
          orderBy: { startsAt: "desc" },
          take: 200,
        }),
        tx.match.findMany({
          where: { tenantId, propertyId, dismissReason: "price", dismissedAt: { lt: since } },
          select: { buyerId: true },
          take: 200,
        }),
      ]);
      const reasons = new Map<string, { reasons: Set<ReofferReason>; lastViewingAt: Date | null }>();
      for (const row of viewings) {
        const entry = reasons.get(row.buyerId!) ?? { reasons: new Set<ReofferReason>(), lastViewingAt: null };
        entry.reasons.add("said_price_high");
        if (entry.lastViewingAt === null || row.startsAt > entry.lastViewingAt) entry.lastViewingAt = row.startsAt;
        reasons.set(row.buyerId!, entry);
      }
      for (const row of dismissed) {
        const entry = reasons.get(row.buyerId) ?? { reasons: new Set<ReofferReason>(), lastViewingAt: null };
        entry.reasons.add("dismissed_on_price");
        reasons.set(row.buyerId, entry);
      }
      const ids = [...reasons.keys()];
      if (ids.length === 0) return { drop: dropOf(property), propertyLabel, candidates: [] };

      const buyers = await tx.buyer.findMany({
        where: { tenantId, id: { in: ids }, deletedAt: null, ...ownershipFilter("buyers.view_all", "ownerUserId") },
        select: { id: true, contactId: true },
      });
      const contactsById = await this.contacts.getByIds(tx, buyers.map((b) => b.contactId));
      const contacted = await tx.interaction.findMany({
        where: { tenantId, propertyId, buyerId: { in: buyers.map((b) => b.id) }, kind: "whatsapp", direction: "out", createdAt: { gte: since } },
        select: { buyerId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      const contactedAt = new Map<string, Date>();
      for (const row of contacted) if (row.buyerId !== null && !contactedAt.has(row.buyerId)) contactedAt.set(row.buyerId, row.createdAt);

      const candidates: ReofferCandidateDto[] = [];
      for (const buyer of buyers) {
        const contact = contactsById.get(buyer.contactId);
        const entry = reasons.get(buyer.id);
        if (!contact || !entry) continue;
        const list = [...entry.reasons];
        candidates.push({
          buyerId: buyer.id,
          name: contact.name,
          ...(contact.phone === undefined ? {} : { phone: contact.phone }),
          reasons: list,
          reasonLabels: list.map((r) => REOFFER_REASON_LABELS[r]),
          lastViewingAt: entry.lastViewingAt === null ? null : entry.lastViewingAt.toISOString(),
          contactedAt: contactedAt.get(buyer.id)?.toISOString() ?? null,
        });
      }
      /* ‏מי שטרם פנו אליו קודם; בתוכם — מי שביקר לאחרונה */
      candidates.sort((a, b) => {
        if ((a.contactedAt === null) !== (b.contactedAt === null)) return a.contactedAt === null ? -1 : 1;
        return (b.lastViewingAt ?? "").localeCompare(a.lastViewingAt ?? "");
      });
      return { drop: dropOf(property), propertyLabel, candidates };
    });
  }

  /**
   * ‏„פניתי” — נרשם על הקונה ועל הנכס; הרשימה מתעדכנת מזה, לא מהמסך.
   *
   * ‏פעם אחת לכל הורדת מחיר: הנכס ננעל, ופנייה שכבר נרשמה אחרי
   * ‏ההורדה מחזירה 409 במקום שורה כפולה בציר הזמן ובביקורת (לחיצה
   * ‏כפולה, ניסיון חוזר אחרי תשובה שאבדה).
   */
  async markContacted(propertyId: string, buyerId: string): Promise<{ contactedAt: string }> {
    assertMayReoffer();
    const ctx = TenantContext.current();
    const tenantId = ctx.tenantId;
    return this.prisma.withTenant(async (tx) => {
      await lockProperty(tx, tenantId, propertyId);
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: {
          status: true, priceAgorot: true, previousPriceAgorot: true, priceChangedAt: true,
          marketingTitle: true, street: true, houseNumber: true, city: true,
        },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");
      if (!dropIsLive(property)) throw new ConflictException("המחיר לא ירד לאחרונה, או שהנכס כבר אינו בשיווק");
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, tenantId, deletedAt: null, ...ownershipFilter("buyers.view_all", "ownerUserId") },
        select: { id: true },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");
      const already = await tx.interaction.findFirst({
        where: { tenantId, propertyId, buyerId, kind: "whatsapp", direction: "out", createdAt: { gte: property.priceChangedAt } },
        select: { id: true },
      });
      if (already) throw new ConflictException("כבר פנית לקונה הזה אחרי הורדת המחיר");
      const now = new Date();
      await tx.interaction.create({
        data: {
          id: ulid(), tenantId, buyerId, propertyId, kind: "whatsapp", direction: "out",
          content: `הצעה חוזרת אחרי הורדת מחיר — ${labelOf(property)}`,
          createdBy: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "property.reoffer_sent",
        entityType: "property",
        entityId: propertyId,
        metadata: { buyerId },
      });
      return { contactedAt: now.toISOString() };
    });
  }
}

function dropOf(p: { priceAgorot: bigint | null; previousPriceAgorot: bigint | null; priceChangedAt: Date | null }): ReofferDto["drop"] {
  if (p.priceAgorot === null || p.previousPriceAgorot === null || p.priceChangedAt === null) return null;
  return { fromAgorot: Number(p.previousPriceAgorot), toAgorot: Number(p.priceAgorot), changedAt: p.priceChangedAt.toISOString() };
}
