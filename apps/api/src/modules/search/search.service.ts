import { Injectable } from "@nestjs/common";
import { filterVisibleNotes, normalizeIsraeliPhone } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ownershipFilter } from "../../common/ownership";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";

/**
 * חיפוש גלובלי (docs/06 §3 — "שיחה נכנסת: מי זה?"):
 * - קלט שנראה כטלפון מנורמל ל-E.164 ומחופש ב-phone_hash — התאמה מדויקת
 *   בלי לפענח אף רשומה (docs/04 §4).
 * - טקסט חופשי מחפש נכסים לפי כתובת/כותרת, ואנשי קשר לפי שם (פענוח
 *   בזיכרון תחת הדייר בלבד, מוגבל ל-1,000 האחרונים).
 * - קונים ולידים מסוננים לפי בעלות — סוכן עם view_own לא מגלה בחיפוש
 *   את הלקוחות של סוכן אחר (docs/04 §3).
 */

export interface SearchResults {
  /** זהות בהתאמת-טלפון מדויקת — "מי מתקשר אליי?" */
  contact: { id: string; name: string; phone: string } | null;
  properties: {
    id: string;
    city: string | null;
    street: string | null;
    neighborhood: string | null;
    marketingTitle: string | null;
    status: string;
  }[];
  buyers: { id: string; name: string; maturity: string; cities: string[] }[];
  leads: { id: string; name: string; status: string; requiresHuman: boolean }[];
  /* --- טקסט חופשי שנכתב בתוך המערכת: לא רק "מי", גם "מה נאמר" --- */
  appointments: { id: string; title: string; kind: string; startsAt: Date; status: string }[];
  tasks: { id: string; title: string; status: string; dueAt: Date | null }[];
  calls: { id: string; summary: string; occurredAt: Date; direction: string }[];
  /** הערות ותיעודי שיחה על לידים וקונים. */
  notes: {
    id: string;
    content: string;
    createdAt: Date;
    leadId: string | null;
    buyerId: string | null;
  }[];
}

/** תוצאה ריקה — נקודת פתיחה אחת לכל מסלולי החיפוש. */
const EMPTY: SearchResults = {
  contact: null,
  properties: [],
  buyers: [],
  leads: [],
  appointments: [],
  tasks: [],
  calls: [],
  notes: [],
};

const GROUP_LIMIT = 8;
/**
 * הערות נשלפות בעודף ומסוננות לפי בעלות אחרי כן (ראו visibleNotes) —
 * בלי העודף, סינון של סוכן עם view_own היה מרוקן את הקבוצה כמעט תמיד.
 */
const NOTE_CANDIDATE_LIMIT = 60;
/** כמה אנשי קשר אחרונים מפוענחים לחיפוש שם — תקרת עלות קבועה לבקשה. */
const NAME_SCAN_LIMIT = 1000;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async search(query: string): Promise<SearchResults> {
    const ctx = TenantContext.current();
    const canProperties = ctx.capabilities.has("properties.view");
    const canBuyers =
      ctx.capabilities.has("buyers.view_all") || ctx.capabilities.has("buyers.view_own");
    const canLeads =
      ctx.capabilities.has("leads.view_all") || ctx.capabilities.has("leads.view_own");

    const phone = normalizeIsraeliPhone(query);
    return phone !== undefined
      ? this.searchByPhone(phone, { canProperties, canBuyers, canLeads })
      : this.searchByText(query, { canProperties, canBuyers, canLeads });
  }

  private async searchByPhone(
    phone: string,
    can: { canProperties: boolean; canBuyers: boolean; canLeads: boolean },
  ): Promise<SearchResults> {
    const tenantId = TenantContext.current().tenantId;
    const phoneHash = this.crypto.phoneHash(phone);

    return this.prisma.withTenant(async (tx) => {
      const contact = await tx.contact.findUnique({
        where: { tenantId_phoneHash: { tenantId, phoneHash } },
        select: { id: true, nameEncrypted: true, phoneEncrypted: true },
      });
      if (!contact) return EMPTY;

      const identity = {
        id: contact.id,
        name: this.crypto.decrypt(contact.nameEncrypted),
        phone: this.crypto.decrypt(contact.phoneEncrypted),
      };
      const [properties, buyers, leads] = await Promise.all([
        can.canProperties
          ? tx.property.findMany({
              where: { tenantId, ownerContactId: contact.id, deletedAt: null },
              select: {
                id: true, city: true, street: true, neighborhood: true,
                marketingTitle: true, status: true,
              },
              take: GROUP_LIMIT,
            })
          : [],
        can.canBuyers
          ? tx.buyer.findMany({
              where: {
                tenantId,
                contactId: contact.id,
                deletedAt: null,
                ...ownershipFilter("buyers.view_all", "ownerUserId"),
              },
              select: { id: true, maturity: true, cities: true },
              take: GROUP_LIMIT,
            })
          : [],
        can.canLeads
          ? tx.lead.findMany({
              where: {
                tenantId,
                contactId: contact.id,
                ...ownershipFilter("leads.view_all", "assignedToUserId"),
              },
              select: { id: true, status: true, requiresHuman: true },
              take: GROUP_LIMIT,
            })
          : [],
      ]);

      // זהות איש הקשר נחשפת רק למי שרואה לפחות ישות מקושרת אחת, או
      // לבעל ראייה משרדית (view_all) — משתמש view_own שמחפש טלפון של
      // לקוח של סוכן אחר מקבל "אין תוצאות", בדיוק כמו ברשימות (docs/04 §3).
      const ctx = TenantContext.current();
      const officeWide =
        ctx.capabilities.has("buyers.view_all") || ctx.capabilities.has("leads.view_all");
      const anyVisible = properties.length + buyers.length + leads.length > 0;
      if (!anyVisible && !officeWide) {
        return EMPTY;
      }

      // שיחות מהמספר הזה — התשובה ל"מי התקשר אליי" כוללת גם את
      // ההיסטוריה של השיחות איתו, לא רק את הכרטיס
      const calls = await tx.call.findMany({
        where: { tenantId, contactId: contact.id },
        select: { id: true, summary: true, occurredAt: true, direction: true },
        orderBy: { occurredAt: "desc" },
        take: GROUP_LIMIT,
      });

      return {
        ...EMPTY,
        contact: identity,
        properties,
        buyers: buyers.map((b) => ({ ...b, name: identity.name })),
        leads: leads.map((l) => ({ ...l, name: identity.name })),
        calls: calls.map((c) => ({ ...c, summary: c.summary ?? "" })),
      };
    });
  }

  private async searchByText(
    query: string,
    can: { canProperties: boolean; canBuyers: boolean; canLeads: boolean },
  ): Promise<SearchResults> {
    const tenantId = TenantContext.current().tenantId;
    const needle = query.toLowerCase();

    return this.prisma.withTenant(async (tx) => {
      // "דיזנגוף 10 תל אביב" — כל מילה חייבת להופיע באחד משדות הכתובת
      // (AND על מילים, OR על שדות), כולל מספר בית; עד 5 מילים.
      const tokens = query.split(/\s+/u).filter((t) => t.length > 0).slice(0, 5);
      const properties = can.canProperties
        ? await tx.property.findMany({
            where: {
              tenantId,
              deletedAt: null,
              AND: tokens.map((token) => ({
                OR: [
                  { city: { contains: token, mode: "insensitive" as const } },
                  { street: { contains: token, mode: "insensitive" as const } },
                  { neighborhood: { contains: token, mode: "insensitive" as const } },
                  { houseNumber: { contains: token, mode: "insensitive" as const } },
                  { marketingTitle: { contains: token, mode: "insensitive" as const } },
                ],
              })),
            },
            select: {
              id: true, city: true, street: true, neighborhood: true,
              marketingTitle: true, status: true,
            },
            orderBy: { updatedAt: "desc" },
            take: GROUP_LIMIT,
          })
        : [];

      /*
       * טקסט חופשי שנכתב בתוך המערכת: כותרות ופתקים ביומן, משימות,
       * סיכומי שיחות והערות. אלה לא מכילים PII מוצפן, ולכן אפשר לחפש
       * בהם ישירות במסד. משימות מסוננות לבעליהן — סוכן לא רואה את
       * המשימות של סוכן אחר בחיפוש (docs/04 §3).
       */
      const { userId } = TenantContext.current();
      const like = { contains: query, mode: "insensitive" as const };
      const [appointments, tasks, calls, notes] = await Promise.all([
        tx.appointment.findMany({
          where: { tenantId, OR: [{ title: like }, { notes: like }] },
          select: { id: true, title: true, kind: true, startsAt: true, status: true },
          orderBy: { startsAt: "desc" },
          take: GROUP_LIMIT,
        }),
        tx.task.findMany({
          where: {
            tenantId,
            assignedToUserId: userId,
            OR: [{ title: like }, { notes: like }],
          },
          select: { id: true, title: true, status: true, dueAt: true },
          orderBy: { createdAt: "desc" },
          take: GROUP_LIMIT,
        }),
        tx.call.findMany({
          where: { tenantId, summary: like },
          select: { id: true, summary: true, occurredAt: true, direction: true },
          orderBy: { occurredAt: "desc" },
          take: GROUP_LIMIT,
        }),
        /*
         * מועמדים בלבד — הסינון לפי בעלות נעשה מיד אחרי, ולכן שולפים
         * יותר מהתקרה כדי שלא נישאר עם רשימה ריקה אחרי הסינון.
         */
        tx.interaction.findMany({
          where: { tenantId, content: like },
          select: { id: true, content: true, createdAt: true, leadId: true, buyerId: true },
          orderBy: { createdAt: "desc" },
          take: NOTE_CANDIDATE_LIMIT,
        }),
      ]);

      const freeText = {
        appointments: appointments.map((a) => ({ ...a, title: a.title ?? "פגישה" })),
        tasks,
        calls: calls.map((c) => ({ ...c, summary: c.summary ?? "" })),
        notes: await this.visibleNotes(tx, tenantId, notes),
      };

      if (!can.canBuyers && !can.canLeads) {
        return { ...EMPTY, properties, ...freeText };
      }

      // חיפוש שם: פענוח בזיכרון של אנשי הקשר האחרונים בלבד — PII לעולם
      // לא נחשף למנוע ה-DB כטקסט גלוי, והעלות חסומה ב-NAME_SCAN_LIMIT.
      const recent = await tx.contact.findMany({
        where: { tenantId },
        select: { id: true, nameEncrypted: true },
        orderBy: { updatedAt: "desc" },
        take: NAME_SCAN_LIMIT,
      });
      const nameById = new Map<string, string>();
      for (const c of recent) {
        const name = this.crypto.decrypt(c.nameEncrypted);
        if (name.toLowerCase().includes(needle)) nameById.set(c.id, name);
      }
      const matchedIds = [...nameById.keys()];
      if (matchedIds.length === 0) {
        return { ...EMPTY, properties, ...freeText };
      }

      const [buyers, leads] = await Promise.all([
        can.canBuyers
          ? tx.buyer.findMany({
              where: {
                tenantId,
                contactId: { in: matchedIds },
                deletedAt: null,
                ...ownershipFilter("buyers.view_all", "ownerUserId"),
              },
              select: { id: true, maturity: true, cities: true, contactId: true },
              take: GROUP_LIMIT,
            })
          : [],
        can.canLeads
          ? tx.lead.findMany({
              where: {
                tenantId,
                contactId: { in: matchedIds },
                ...ownershipFilter("leads.view_all", "assignedToUserId"),
              },
              select: { id: true, status: true, requiresHuman: true, contactId: true },
              take: GROUP_LIMIT,
            })
          : [],
      ]);

      return {
        ...EMPTY,
        properties,
        ...freeText,
        buyers: buyers.map((b) => ({
          id: b.id,
          maturity: b.maturity,
          cities: b.cities,
          name: nameById.get(b.contactId) ?? "",
        })),
        leads: leads.map((l) => ({
          id: l.id,
          status: l.status,
          requiresHuman: l.requiresHuman,
          name: nameById.get(l.contactId) ?? "",
        })),
      };
    });
  }

  /**
   * סינון הערות ותיעודים לפי בעלות. ההערות עצמן אינן נושאות בעלים —
   * הן תלויות בליד או בקונה שאליו הן מקושרות, ולכן הנראות נגזרת משם,
   * בדיוק כמו ב-listInteractions (docs/04 §3).
   *
   * בלי זה סוכן עם view_own היה מוצא בחיפוש חופשי הערות על הלקוחות של
   * סוכן אחר — וזה בדיוק המידע המסחרי הרגיש ביותר במערכת (תקציב,
   * מניעים, מצב מו"מ).
   */
  private async visibleNotes(
    tx: TenantTx,
    tenantId: string,
    candidates: {
      id: string;
      content: string;
      createdAt: Date;
      leadId: string | null;
      buyerId: string | null;
    }[],
  ): Promise<typeof candidates> {
    const ctx = TenantContext.current();
    const seesAllLeads = ctx.capabilities.has("leads.view_all");
    const seesAllBuyers = ctx.capabilities.has("buyers.view_all");
    if (seesAllLeads && seesAllBuyers) return candidates.slice(0, GROUP_LIMIT);

    const leadIds = [...new Set(candidates.map((n) => n.leadId).filter((id): id is string => id !== null))];
    const buyerIds = [...new Set(candidates.map((n) => n.buyerId).filter((id): id is string => id !== null))];

    const [leads, buyers] = await Promise.all([
      leadIds.length > 0
        ? tx.lead.findMany({
            where: {
              tenantId,
              id: { in: leadIds },
              ...ownershipFilter("leads.view_all", "assignedToUserId"),
            },
            select: { id: true },
          })
        : [],
      buyerIds.length > 0
        ? tx.buyer.findMany({
            where: {
              tenantId,
              id: { in: buyerIds },
              deletedAt: null,
              ...ownershipFilter("buyers.view_all", "ownerUserId"),
            },
            select: { id: true },
          })
        : [],
    ]);
    return filterVisibleNotes(
      candidates,
      { leadIds: new Set(leads.map((l) => l.id)), buyerIds: new Set(buyers.map((b) => b.id)) },
      GROUP_LIMIT,
    );
  }
}