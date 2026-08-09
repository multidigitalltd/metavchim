import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { computeReadiness, limitState, type Page, type PropertyFields } from "@metavchim/shared";
import {
  PROPERTY_TYPE_LABELS_HE,
  freeTextTerms,
  normalizeRange,
  priceRangeAgorot,
} from "@metavchim/shared";

/** סוגי נכס שהתווית העברית שלהם מכילה את המונח שהוקלד. */
function propertyTypesFor(term: string): string[] {
  const needle = term.toLowerCase();
  return Object.entries(PROPERTY_TYPE_LABELS_HE)
    .filter(([, label]) => label.toLowerCase().includes(needle))
    .map(([value]) => value);
}
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { MatchingService } from "../matching/matching.service";
import { MessagingService } from "../messaging/messaging.service";
import { mediaRawPath } from "./media.service";
import { fieldsToColumns, rowToFields, type PropertyDto } from "./property.mapper";

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly matching: MatchingService,
    private readonly contacts: ContactsService,
    private readonly messaging: MessagingService,
    private readonly plans: PlanCatalogService,
  ) {}

  /**
   * מכסת הנכסים של המסלול.
   *
   * נבדקת על **הנכס הבא** ולא על המצב הקיים, ולכן משרד שחרג אחרי
   * שינוי תמחור ממשיך לראות ולערוך את מה שיש לו — רק ההוספה נחסמת.
   * נכסים בארכיון נספרים כמו כל השאר: הם עדיין במסד ועדיין ניתנים
   * לשחזור, ולכן לא היו מכסת חינם.
   */
  /**
   * מכסת הנכסים של המסלול — **בתוך הטרנזקציה שכותבת**.
   *
   * הבדיקה קיבלה `tx` ולא פותחת אחת משלה, ולפניה ננעל מנעול ייעוץ
   * ברמת הדייר. שתי בקשות מקבילות שספרו את אותו מצב לפני שאחת מהן
   * כתבה היו שתיהן עוברות, והמכסה הייתה נחצית בשקט — במיוחד בייבוא,
   * ששולח הרבה יצירות ברצף (ביקורת Codex).
   *
   * המנעול הוא `pg_advisory_xact_lock` ולא נעילת שורה: אין שורה
   * שמייצגת "המכסה של הדייר", והוא משתחרר מעצמו בסוף הטרנזקציה —
   * גם כשהיא נכשלת.
   *
   * הספירה חייבת לרוץ בהקשר דייר: `properties` תחת FORCE RLS, ובלי
   * `app.tenant_id` היא מחזירה אפס שורות **בלי שגיאה** — כלומר מכסה
   * שלעולם אינה נחצית, ובדיקה שנראית עובדת.
   */
  private async assertCanAddProperty(tx: TenantTx, tenantId: string): Promise<void> {
    const plan = await this.plans.forTenant(tenantId, tx);
    /*
     * מסלול שאי אפשר לפתור — חוסם, לא פותח.
     *
     * `tenants.plan` הוא varchar בלי מפתח זר, ולכן קוד ישן או שגוי
     * אפשרי. `undefined` שהומר ל-null היה נקרא כ"ללא הגבלה", כלומר
     * דווקא המשרד עם המצב השבור היה מקבל מכסה אינסופית. אותו כיוון
     * בטוח כמו `planAllows(undefined) === false` (ביקורת Codex).
     */
    if (plan === undefined) {
      throw new BadRequestException("המסלול של המשרד אינו מוגדר — פנו לתמיכה");
    }
    const limit = plan.maxProperties;
    if (limit === null) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`property-quota:${tenantId}`}))`;
    /*
      * נכסים בארכיון אינם נספרים.
      *
      * `softDelete` רק מסמן `deletedAt`, וכל קריאה רגילה מסננת אותם.
      * ספירה שכוללת אותם הייתה חוסמת משרד **לצמיתות**: הוא מוחק נכס
      * כדי לפנות מקום, המונה לא יורד, ובסוף אין לו אף נכס גלוי והוא
      * עדיין חסום (ביקורת Codex).
      */
     const used = await tx.property.count({ where: { tenantId, deletedAt: null } });
    if (limitState(used, limit).blocked) {
      throw new BadRequestException(
        `מסלול "${plan.name}" כולל ${limit} נכסים. לתוספת נכסים יש לשדרג מסלול.`,
      );
    }
  }

  async create(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    /** בעל הנכס (המוכר) — נקשר כ-contact לפי טלפון (docs/03: אדם אחד) */
    owner?: { name: string; phone: string };
  }): Promise<PropertyDto> {
    const id = await this.persist(input);
    // חישוב התאמות — סינכרוני בשלב זה; יעבור לתור BullMQ עם עליית ה-Workers (docs/07 §5).
    await this.matching.recomputeForProperty(id);
    return this.getById(id);
  }

  /**
   * ייבוא בכמות (docs/08 §6): ההצלחה נקבעת בגבול הטרנזקציה — ברגע שהנכס
   * נשמר הוא "נוצר", גם אם חישוב ההתאמות שאחריו נכשל זמנית (best-effort;
   * יחושב מחדש בעריכה הבאה). כך אין דיווח-כזב של נכס שכבר קיים ואין כפילויות
   * בניסיון חוזר. גם חוסך N חישובי-התאמה סינכרוניים בבקשה אחת (docs/07 §5).
   */
  async createForImport(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    /** שימור סטטוס בייבוא-חזרה של קובץ מיוצא (Round-trip); ברירת מחדל: טיוטה. */
    status?: string;
  }): Promise<string> {
    // גם בייבוא: קובץ של אלף נכסים לא אמור לעקוף מכסה שהוספה ידנית
    // נחסמת בה. הבדיקה עצמה בתוך persist, באותה טרנזקציה של הכתיבה.
    const id = await this.persist(input);
    try {
      await this.matching.recomputeForProperty(id);
    } catch {
      // הנכס כבר נשמר; חישוב ההתאמות אינו חלק מהצלחת היצירה.
    }
    return id;
  }

  /** יוצר את רשומת הנכס בטרנזקציה יחידה ומחזיר את המזהה — גבול ההצלחה. */
  private async persist(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    status?: string;
    owner?: { name: string; phone: string };
  }): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();
    const readiness = computeReadiness(input.fields, {
      hasTitle: Boolean(input.marketingTitle),
      hasDescription: Boolean(input.marketingDescription),
    });

    await this.prisma.withTenant(async (tx) => {
      // המכסה נבדקת כאן ולא לפני הקריאה: אותה טרנזקציה שכותבת היא
      // זו שסופרת, ולכן שתי בקשות מקבילות לא יכולות לעבור יחד
      await this.assertCanAddProperty(tx, tenantId);
      const ownerContact = input.owner
        ? await this.contacts.findOrCreateByPhone(tx, input.owner)
        : null;
      await tx.property.create({
        data: {
          id,
          tenantId,
          ownerContactId: ownerContact?.id ?? null,
          status: input.status ?? "draft",
          marketingTitle: input.marketingTitle ?? null,
          marketingDescription: input.marketingDescription ?? null,
          internalNotes: input.internalNotes ?? null,
          readinessScore: readiness.score,
          ...(fieldsToColumns(input.fields) as object),
        },
      });
      await this.audit.record(tx, { action: "property.create", entityType: "property", entityId: id });
      await this.outbox.emit(tx, "property.updated", {
        propertyId: id,
        tenantId,
        changedFields: Object.keys(input.fields),
      });
      if (readiness.score >= 80) {
        await this.outbox.emit(tx, "property.ready", {
          propertyId: id,
          tenantId,
          readinessScore: readiness.score,
        });
      }
    });

    return id;
  }

  async update(id: string, patch: Partial<PropertyFields> & {
    status?: string;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    owner?: { name: string; phone: string };
  }): Promise<PropertyDto> {
    const tenantId = TenantContext.current().tenantId;
    const { status, marketingTitle, marketingDescription, internalNotes, owner, ...fieldPatch } =
      patch;

    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.property.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException("נכס לא נמצא");

      const ownerContact = owner ? await this.contacts.findOrCreateByPhone(tx, owner) : null;
      const mergedFields = { ...rowToFields(existing), ...fieldPatch };
      const readiness = computeReadiness(mergedFields, {
        hasTitle: Boolean(marketingTitle ?? existing.marketingTitle),
        hasDescription: Boolean(marketingDescription ?? existing.marketingDescription),
      });

      await tx.property.update({
        where: { id },
        data: {
          ...(fieldsToColumns(fieldPatch) as object),
          ...(status !== undefined ? { status } : {}),
          ...(marketingTitle !== undefined ? { marketingTitle } : {}),
          ...(marketingDescription !== undefined ? { marketingDescription } : {}),
          ...(internalNotes !== undefined ? { internalNotes } : {}),
          ...(ownerContact ? { ownerContactId: ownerContact.id } : {}),
          readinessScore: readiness.score,
        },
      });
      // נכס שיצא משיווק — ההתאמות המוצעות מתבטלות; אין להציע נכס שנמכר
      // (ביקורת Codex, PR #1). החלטות ידניות (offered/dismissed) נשמרות כהיסטוריה.
      if (status !== undefined && !["draft", "active"].includes(status)) {
        await tx.match.deleteMany({ where: { propertyId: id, status: "suggested" } });
        // מעבר אמיתי החוצה משיווק — סגירת מעגל מול קונים מעוניינים:
        // Worker יוצר משימות "הצע חלופה" לסוכנים (docs/01 — שום עסקה
        // לא נופלת בין הכיסאות)
        if (["draft", "active"].includes(existing.status)) {
          await this.outbox.emit(tx, "property.delisted", {
            propertyId: id,
            tenantId,
            newStatus: status,
          });
        }
      }
      await this.audit.record(tx, {
        action: "property.update",
        entityType: "property",
        entityId: id,
        metadata: { changedFields: Object.keys(patch) },
      });
      await this.outbox.emit(tx, "property.updated", {
        propertyId: id,
        tenantId,
        changedFields: Object.keys(patch),
      });
    });

    await this.matching.recomputeForProperty(id);
    return this.getById(id);
  }

  async getById(id: string): Promise<PropertyDto> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.property.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId, deletedAt: null },
      });
      if (!row) throw new NotFoundException("נכס לא נמצא");
      const fields = rowToFields(row);
      const readiness = computeReadiness(fields, {
        hasTitle: Boolean(row.marketingTitle),
        hasDescription: Boolean(row.marketingDescription),
      });
      const ownerContact = row.ownerContactId
        ? await this.contacts.getById(tx, row.ownerContactId)
        : null;
      return {
        ...fields,
        id: row.id,
        status: row.status,
        marketingTitle: row.marketingTitle ?? undefined,
        marketingDescription: row.marketingDescription ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        readinessScore: row.readinessScore,
        missingFields: readiness.missingFields,
        ...(ownerContact
          ? {
              ownerContact: {
                id: ownerContact.id,
                name: ownerContact.name,
                phone: ownerContact.phone,
                ...(ownerContact.email ? { email: ownerContact.email } : {}),
              },
            }
          : {}),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async list(query: {
    status?: string;
    city?: string;
    q?: string;
    minPrice?: number;
    maxPrice?: number;
    minRooms?: number;
    maxRooms?: number;
    cursor?: string;
    limit: number;
  }): Promise<Page<PropertyDto>> {
    const price = priceRangeAgorot(query.minPrice, query.maxPrice);
    const rooms = normalizeRange(query.minRooms, query.maxRooms);
    const terms = freeTextTerms(query.q);

    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.property.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          ...(query.status ? { status: query.status } : {}),
          ...(query.city ? { city: query.city } : {}),
          ...(price.min !== undefined || price.max !== undefined
            ? {
                priceAgorot: {
                  ...(price.min !== undefined ? { gte: price.min } : {}),
                  ...(price.max !== undefined ? { lte: price.max } : {}),
                },
              }
            : {}),
          ...(rooms.min !== undefined || rooms.max !== undefined
            ? {
                rooms: {
                  ...(rooms.min !== undefined ? { gte: rooms.min } : {}),
                  ...(rooms.max !== undefined ? { lte: rooms.max } : {}),
                },
              }
            : {}),
          /*
           * כל מונח חייב להתאים, וכל אחד יכול להתאים בשדה אחר —
           * כך ש"פנטהאוז רמת גן" מוצא נכס שסוגו פנטהאוז ועירו רמת גן.
           * AND בין המונחים, OR בין השדות; הנימוק המלא ב-list-filters.
           *
           * החיפוש כבר לא מוגבל לכתובת: הוא מכסה גם את הכותרת
           * השיווקית, התיאור, סוג הנכס וההערות הפנימיות — שם יושב
           * מה שהמתווך באמת זוכר על הנכס.
           */
          ...(terms.length > 0
            ? {
                AND: terms.map((term) => ({
                  OR: [
                    /*
                     * סוג הנכס נשמר באנגלית (apartment), והמסך מבטיח
                     * חיפוש בעברית. בלי התרגום הזה "דירה" לא היה
                     * מוצא דירה אלא במקרה, אם המילה הופיעה בשדה טקסט
                     * אחר (ביקורת Codex).
                     */
                    ...(propertyTypesFor(term).length > 0
                      ? [{ propertyType: { in: propertyTypesFor(term) } }]
                      : []),
                    { street: { contains: term, mode: "insensitive" as const } },
                    { neighborhood: { contains: term, mode: "insensitive" as const } },
                    { city: { contains: term, mode: "insensitive" as const } },
                    { marketingTitle: { contains: term, mode: "insensitive" as const } },
                    { marketingDescription: { contains: term, mode: "insensitive" as const } },
                    { internalNotes: { contains: term, mode: "insensitive" as const } },
                  ],
                })),
              }
            : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" }, // ULID ממוין-זמן — חדש ראשון
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);

      // תמונה ראשית לכל נכס בעמוד — שאילתת מדיה אחת; הנתיב מוזרם דרך ה-API
      const media = await tx.propertyMedia.findMany({
        where: { tenantId: TenantContext.current().tenantId, propertyId: { in: pageRows.map((r) => r.id) } },
        orderBy: { sortOrder: "asc" },
        select: { propertyId: true, id: true },
      });
      const primaryIdByProperty = new Map<string, string>();
      for (const m of media) {
        if (!primaryIdByProperty.has(m.propertyId)) primaryIdByProperty.set(m.propertyId, m.id);
      }

      // מספר הקונים הממתינים לכל נכס — זו הפעולה הבאה שהמתווך מחפש
      // ברשימה ("יש 17 קונים, שלח להם"). שאילתה מקובצת אחת על האינדקס
      // (tenantId, propertyId), לא שאילתה לכל שורה.
      const matchCounts = await tx.match.groupBy({
        by: ["propertyId"],
        where: {
          tenantId: TenantContext.current().tenantId,
          propertyId: { in: pageRows.map((r) => r.id) },
          status: "suggested",
        },
        _count: { _all: true },
      });
      const matchCountByProperty = new Map(
        matchCounts.map((row) => [row.propertyId, row._count._all]),
      );

      const items = pageRows.map((row) => {
        const fields = rowToFields(row);
        const readiness = computeReadiness(fields, {
          hasTitle: Boolean(row.marketingTitle),
          hasDescription: Boolean(row.marketingDescription),
        });
        const primaryId = primaryIdByProperty.get(row.id);
        return {
          ...fields,
          id: row.id,
          status: row.status,
          marketingTitle: row.marketingTitle ?? undefined,
          readinessScore: row.readinessScore,
          missingFields: readiness.missingFields,
          thumbnailUrl: primaryId ? mediaRawPath(row.id, primaryId) : undefined,
          suggestedMatchCount: matchCountByProperty.get(row.id) ?? 0,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } satisfies PropertyDto & { thumbnailUrl?: string; suggestedMatchCount: number };
      });
      return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    });
  }

  /**
   * עדכון לבעל הנכס בוואטסאפ (docs/01 — שקיפות): משפך השיווק של הנכס
   * בהודעה אחת — כמה קונים הותאמו, כמה קיבלו הצעה, כמה פתחו וכמה סימנו
   * עניין. המתווך רק לוחץ שלח; ההודעה מתועדת ב-Messages Hub.
   */
  async prepareOwnerUpdate(id: string): Promise<{ waUrl: string; message: string }> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");
      if (!property.ownerContactId) {
        throw new NotFoundException("לנכס לא הוגדר בעל נכס — הוסיפו שם וטלפון בעריכת הנכס");
      }
      const owner = await this.contacts.getById(tx, property.ownerContactId);
      if (!owner) throw new NotFoundException("איש הקשר של בעל הנכס לא נמצא");

      // התאמות שהסוכן דחה כלא-רלוונטיות לא נספרות — לא מנפחים את
      // המספר שמדווח למוכר (ביקורת Codex, P1; תואם listForProperty)
      const matches = await tx.match.findMany({
        where: { tenantId, propertyId: id, status: { not: "dismissed" } },
        select: { id: true },
      });
      const offers = await tx.offer.findMany({
        where: { tenantId, matchId: { in: matches.map((m) => m.id) } },
        select: { status: true, openCount: true },
      });
      const opened = offers.filter((o) => o.openCount > 0).length;
      const interested = offers.filter((o) => o.status === "interested").length;

      const title =
        property.marketingTitle ?? [property.city ?? "", "הנכס"].filter(Boolean).join(" — ");
      const message = [
        `שלום ${owner.name}, עדכון שיווק על "${title}":`,
        `• ${matches.length} קונים מתאימים אותרו במערכת`,
        `• ${offers.length} הצעות נשלחו`,
        `• ${opened} פתחו את פרטי הנכס`,
        `• ${interested} סימנו שהם מעוניינים`,
        "נמשיך לעדכן בכל התקדמות. לשאלות — אפשר להשיב כאן.",
      ].join("\n");

      await this.messaging.recordOutbound(tx, {
        contactId: owner.id,
        channel: "whatsapp",
        provider: "walink",
        body: message,
      });
      await this.audit.record(tx, {
        action: "property.owner_update",
        entityType: "property",
        entityId: id,
      });

      const phoneDigits = owner.phone.replace(/\D/gu, "");
      return { waUrl: `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`, message };
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.property.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException("נכס לא נמצא");
      await tx.property.update({ where: { id }, data: { deletedAt: new Date(), status: "archived" } });
      await tx.match.deleteMany({ where: { propertyId: id, status: "suggested" } });
      // גם מחיקה רכה היא ירידה משיווק — קונים מעוניינים מקבלים משימת
      // חלופה בדיוק כמו במכירה (ביקורת Codex, PR #21)
      if (["draft", "active"].includes(existing.status)) {
        await this.outbox.emit(tx, "property.delisted", {
          propertyId: id,
          tenantId: TenantContext.current().tenantId,
          newStatus: "archived",
        });
      }
      await this.audit.record(tx, { action: "property.delete", entityType: "property", entityId: id });
    });
  }
}
