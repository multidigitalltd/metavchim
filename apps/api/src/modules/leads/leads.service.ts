import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { OPEN_LEAD_STATUSES, leadDeletionRejectionReason, type Page } from "@metavchim/shared";
import { lockContact } from "../../common/locks";
import { assertLeadAccess, ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

export interface LeadDto {
  id: string;
  /**
   * האימייל אופציונלי: ליד שנפתח מתיבת הדואר מביא איתו את כתובת
   * השולח, וזו הדרך הטבעית להשיב לו. ליד משיחה נכנסת לא תמיד יודע
   * אותה, ולכן השדה אינו חובה.
   */
  contact: { id: string; name: string; phone: string; email?: string };
  source: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  requiresHumanReason?: string;
  summary?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * המספר שאליו הלקוח התקשר.
 *
 * `label` קיים רק כשהמספר מוגדר כמספר וירטואלי; בלעדיו מוצג המספר
 * עצמו, וזה עדיין שימושי — משרד שרואה מספר לא מוכר חוזר בלידים
 * יודע שכדאי להגדיר אותו.
 */
export interface DialedNumberInfo {
  phone: string;
  label?: string;
}

export interface InteractionDto {
  id: string;
  kind: string;
  direction?: string;
  content: string;
  createdAt: Date;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: {
    contactName: string;
    contactPhone: string;
    /** נשמר על כרטיס איש הקשר — פנייה מיובאת מביאה איתה את הכתובת */
    contactEmail?: string;
    source: string;
    intent: string;
    summary?: string;
    requiresHuman?: boolean;
    requiresHumanReason?: string;
  }): Promise<{ id: string; merged: boolean; visible: boolean }> {
    const ctx = TenantContext.current();
    const id = ulid();
    // ליד פתוח קיים לאותו איש קשר ⇒ לא מפצלים ציר זמן: הפנייה מצטרפת אליו
    let mergedInto: string | null = null;
    // המיזוג הוא כלל-משרדי, אבל הרשאת הצפייה לא — סוכן עם view_own שקלט
    // פנייה לליד של סוכן אחר לא ינווט אליו (ביקורת Codex)
    let mergedVisible = true;

    await this.prisma.withTenant(async (tx) => {
      const contact = await this.contacts.findOrCreateByPhone(tx, {
        name: input.contactName,
        phone: input.contactPhone,
      });
      /*
       * השלמה, לא דריסה: כתובת שכבר על הכרטיס הוקלדה או נקלטה
       * ממקור חי, וקובץ ישן שמיובא אחריה לא אמור למחוק אותה.
       */
      if (input.contactEmail) {
        const existing = await this.contacts.emailFor(tx, contact.id);
        if (existing === undefined) {
          await this.contacts.setEmail(tx, contact.id, input.contactEmail);
        }
      }
      // נעילה פר איש-קשר: שתי קליטות מקבילות לא יעברו שתיהן את בדיקת
      // "אין ליד פתוח" וייצרו כפילות — אין אילוץ ייחודיות בסכימה (ביקורת Codex)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-intake:${ctx.tenantId}:${contact.id}`}, 0))`;
      const open = await tx.lead.findFirst({
        where: { tenantId: ctx.tenantId, contactId: contact.id, status: { in: [...OPEN_LEAD_STATUSES] } },
        select: { id: true, assignedToUserId: true },
      });
      if (open) {
        mergedInto = open.id;
        mergedVisible = ctx.capabilities.has("leads.view_all") || open.assignedToUserId === ctx.userId;
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: open.id,
            kind: "note",
            content: `פנייה נוספת נקלטה: ${input.summary?.trim() || "ללא פירוט"}`,
            createdBy: ctx.userId,
          },
        });
        // אסקלציה לא הולכת לאיבוד במיזוג: פנייה חוזרת שמסומנת "דורש
        // אדם" מדליקה את הדגל על הליד הקיים (ביקורת Codex)
        if (input.requiresHuman) {
          await tx.lead.update({
            where: { id: open.id },
            data: { requiresHuman: true, requiresHumanReason: input.requiresHumanReason ?? null },
          });
        }
        // הליד של סוכן אחר — הוא צריך לדעת שנקלטה פנייה בשמו
        if (!mergedVisible && open.assignedToUserId !== null) {
          await tx.notification.create({
            data: {
              id: ulid(),
              tenantId: ctx.tenantId,
              userId: open.assignedToUserId,
              type: "lead_repeat_inquiry",
              title: "📥 פנייה נוספת בליד שלך",
              body: `${input.contactName} פנה שוב — הפנייה נוספה לציר הזמן של הליד.`,
              entityType: "lead",
              entityId: open.id,
            },
          });
        }
        await this.audit.record(tx, {
          action: "lead.repeat_inquiry",
          entityType: "lead",
          entityId: open.id,
        });
        return;
      }
      // ליד חוזר: לאיש הקשר ליד קודם שנסגר — פנייה מחודשת היא איתות קנייה חזק
      const previous = await tx.lead.findFirst({
        where: { tenantId: ctx.tenantId, contactId: contact.id, status: { in: ["converted", "closed"] } },
        select: { id: true },
      });
      await tx.lead.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          contactId: contact.id,
          source: input.source,
          intent: input.intent,
          status: "new",
          assignedToUserId: ctx.userId,
          requiresHuman: input.requiresHuman ?? false,
          requiresHumanReason: input.requiresHumanReason ?? null,
          summary: input.summary ?? null,
        },
      });
      if (input.summary) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: id,
            kind: "note",
            content: input.summary,
            createdBy: ctx.userId,
          },
        });
      }
      if (previous) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: id,
            kind: "system",
            content: "🔁 ליד חוזר — לאיש הקשר ליד קודם שנסגר. ההיסטוריה המלאה בתיק הלקוח.",
            createdBy: ctx.userId,
          },
        });
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            type: "lead_returned",
            title: "🔁 ליד חוזר",
            body: `${input.contactName} פנה שוב אחרי שהליד הקודם נסגר — שווה עדיפות.`,
            entityType: "lead",
            entityId: id,
          },
        });
      }
      await this.audit.record(tx, { action: "lead.create", entityType: "lead", entityId: id });
      await this.outbox.emit(tx, "lead.created", {
        leadId: id,
        tenantId: ctx.tenantId,
        source: input.source,
        requiresHuman: input.requiresHuman ?? false,
      });
    });

    return { id: mergedInto ?? id, merged: mergedInto !== null, visible: mergedVisible };
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      // הרשאה לפני הכתיבה: סוכן שאינו רואה את הליד גם אינו משנה אותו
      await assertLeadAccess(tx, ctx.tenantId, id);
      const lead = await tx.lead.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!lead) throw new NotFoundException("ליד לא נמצא");
      await tx.lead.update({
        where: { id },
        data: {
          status,
          requiresHuman: status === "new" ? lead.requiresHuman : false,
          ...(lead.firstResponseAt === null && status !== "new"
            ? { firstResponseAt: new Date() }
            : {}),
        },
      });
      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          leadId: id,
          kind: "status_change",
          content: status,
          createdBy: ctx.userId,
        },
      });
      // הליד טופל — משימת אסקלציית ה-SLA (אם נוצרה) נסגרת אוטומטית
      if (status !== "new") {
        await tx.task.updateMany({
          where: { tenantId: ctx.tenantId, sourceKey: `lead-sla:${id}`, status: "open" },
          data: { status: "done" },
        });
      }
      await this.audit.record(tx, {
        action: "lead.status",
        entityType: "lead",
        entityId: id,
        metadata: { status },
      });
    });
  }

  /**
   * מחיקת ליד שאינו רלוונטי — ספאם, טעות במספר, פנייה שאינה נדל"ן.
   *
   * מחיקה קשה ולא `deletedAt`: מה שנמחק כאן הוא שם וטלפון של מישהו
   * שלא ביקש להיות במאגר, ומחיקה רכה שמשאירה אותו בטבלה היא בדיוק מה
   * שהמשרד חשב שהוא מנע (docs/04 §5).
   *
   * מה קורה למה שמצביע על הליד:
   * - **ציר הזמן** נמחק איתו — הוא חלק מהליד, ולא היסטוריה עצמאית.
   * - **הצעה פעילה בשוק השת"פ** יורדת מהשוק. רישום שכבר נמכר נשאר:
   *   הוא הרשומה של עסקה שקרתה, והוא גם השומר שמונע מכירה חוזרת.
   * - **פגישות ושיחות** נשארות ומאבדות את הקישור בלבד — ליומן ולמוקד
   *   יש חיים משל עצמם, ומחיקת פגישה שנקבעה היא לא מה שביקשו.
   * - **משימות** על הליד נמחקות; משימה שכבר נדחפה ליומן Google עוברת
   *   את אותו מסלול כמו ב-`TasksService.remove`, אחרת האירוע נשאר
   *   ביומן בלי מזהה שמצביע עליו.
   * - **איש הקשר** נמחק רק אם לא נשאר לו שום קשר אחר במשרד. הוא נוצר
   *   בשביל הליד הזה; אם הוא גם קונה, גם בעל נכס או גם ליד אחר —
   *   הוא נשאר, ומחיקת הליד לא נוגעת בו.
   */
  async remove(id: string): Promise<{ contactDeleted: boolean }> {
    const ctx = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      // הרשאה לפני הכתיבה, כמו בכל פעולה על ליד
      await assertLeadAccess(tx, ctx.tenantId, id);
      const lead = await tx.lead.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { status: true, source: true, contactId: true },
      });
      if (!lead) throw new NotFoundException("ליד לא נמצא");
      const rejection = leadDeletionRejectionReason(lead.status);
      if (rejection) throw new BadRequestException(rejection);

      /*
       * רישום בשוק שלא נמכר **נמחק** ולא רק יורד לסטטוס `withdrawn`:
       * על השורה יושב צילום מוצפן של השם והטלפון, ו"הסרה מהשוק"
       * שמשאירה אותו הייתה הופכת את הבטחת המחיקה לחצי הבטחה
       * (ביקורת Codex). רישום שכבר נמכר נשאר — הוא התיעוד של עסקה
       * שקרתה ושל הקרדיטים שעברו בה, והצילום שבו כבר בידי הקונה.
       */
      await tx.sharedLead.deleteMany({
        where: { tenantId: ctx.tenantId, originLeadId: id, status: { not: "sold" } },
      });
      await tx.interaction.deleteMany({ where: { tenantId: ctx.tenantId, leadId: id } });
      await tx.appointment.updateMany({
        where: { tenantId: ctx.tenantId, leadId: id },
        data: { leadId: null },
      });
      await tx.call.updateMany({
        where: { tenantId: ctx.tenantId, leadId: id },
        data: { leadId: null },
      });
      await tx.notification.deleteMany({
        where: { tenantId: ctx.tenantId, entityType: "lead", entityId: id },
      });
      await tx.task.updateMany({
        where: {
          tenantId: ctx.tenantId,
          entityType: "lead",
          entityId: id,
          googleEventId: { not: null },
        },
        data: { status: "done", deletedAfterSync: true, googleSyncedAt: null },
      });
      await tx.task.deleteMany({
        where: {
          tenantId: ctx.tenantId,
          entityType: "lead",
          entityId: id,
          googleEventId: null,
        },
      });
      /*
       * בקשות טופס הלקוח שהצביעו על הליד — כולל מה שהלקוח מילא.
       * קישור ששרד את הכרטיס הוא טופס שממשיך לעבוד ומצביע על
       * כרטיס שאיננו.
       */
      await tx.intakeRequest.deleteMany({
        where: { tenantId: ctx.tenantId, subject: "lead", subjectId: id },
      });
      /*
       * המחיקה עצמה מותנית בסטטוס, ולא רק בבדיקה שלמעלה: המרה
       * שרצה במקביל מסמנת `converted` ב-CAS משלה, והקריאה שלנו
       * הספיקה לראות ליד פתוח. מחיקה לא מותנית הייתה מוחקת ליד
       * שהומר בשנייה שעברה, ומשאירה את כרטיס הקונה שנוצר ממנו בלי
       * מקור (ביקורת Codex).
       */
      const deleted = await tx.lead.deleteMany({
        where: { id, tenantId: ctx.tenantId, status: { not: "converted" } },
      });
      if (deleted.count === 0) {
        throw new BadRequestException("הליד הומר בזמן המחיקה — מחקו את הכרטיס שנוצר ממנו");
      }

      const contactDeleted = await this.deleteContactIfOrphan(tx, lead.contactId);
      await this.audit.record(tx, {
        action: "lead.delete",
        entityType: "lead",
        entityId: id,
        // מזהים וסטטוס בלבד — ביומן הביקורת לא נשמר מה שנמחק
        metadata: { status: lead.status, source: lead.source, contactDeleted },
      });
      return { contactDeleted };
    });
  }

  /**
   * איש קשר שנשאר בלי אף קשר במשרד נמחק איתו.
   *
   * הרשימה כאן היא כל מי שמצביע על `contacts`; שכחה של טבלה אחת
   * פירושה כרטיס קונה או הסכם חתום שמצביעים על איש קשר שאיננו.
   * `contact_phones` ו-`contact_links` יורדים ב-Cascade של המסד.
   */
  private async deleteContactIfOrphan(tx: TenantTx, contactId: string): Promise<boolean> {
    const tenantId = TenantContext.current().tenantId;
    /*
     * הנעילה לפני הספירה, לא אחריה: ליד נכנס מאותו טלפון שמגיע
     * בדיוק עכשיו ממחזר את הכרטיס הזה, ובלי מפתחות זרים המסד לא
     * יעצור מחיקה שתשאיר אותו מצביע על כלום. מי שממחזר נועל את אותו
     * מפתח וקורא שוב אחרי הנעילה (ראו `common/locks.ts`).
     */
    await lockContact(tx, contactId);
    const [leads, buyers, properties, agreements, calls, messages, linkedTo] = await Promise.all([
      tx.lead.count({ where: { tenantId, contactId } }),
      tx.buyer.count({ where: { tenantId, contactId } }),
      /*
       * גם שוכר הוא קשר. בלי הענף השני, מחיקת ליד של אדם שהוא
       * **רק** השוכר בנכס הייתה מוחקת את איש הקשר — ומכיוון שלנכס
       * אין מפתח זר לכוונה, `occupant_contact_id` היה נשאר מצביע על
       * שורה שאיננה והשוכר היה נעלם מהכרטיס (ביקורת Codex, P1).
       */
      tx.property.count({
        where: {
          tenantId,
          OR: [{ ownerContactId: contactId }, { occupantContactId: contactId }],
        },
      }),
      tx.agreement.count({ where: { tenantId, contactId } }),
      tx.call.count({ where: { tenantId, contactId } }),
      tx.message.count({ where: { tenantId, contactId } }),
      // הוא בן/בת הזוג על כרטיס של מישהו אחר
      tx.contactLink.count({ where: { tenantId, relatedContactId: contactId } }),
    ]);
    if (leads + buyers + properties + agreements + calls + messages + linkedTo > 0) return false;
    await tx.contact.delete({ where: { id: contactId } });
    return true;
  }

  async addNote(id: string, content: string): Promise<InteractionDto> {
    const ctx = TenantContext.current();
    const noteId = ulid();
    await this.prisma.withTenant(async (tx) => {
      await assertLeadAccess(tx, ctx.tenantId, id);
      await tx.interaction.create({
        data: {
          id: noteId,
          tenantId: ctx.tenantId,
          leadId: id,
          kind: "note",
          content,
          createdBy: ctx.userId,
        },
      });
    });
    return { id: noteId, kind: "note", content, createdAt: new Date() };
  }

  async getById(
    id: string,
  ): Promise<{ lead: LeadDto; timeline: InteractionDto[]; dialedNumber?: DialedNumberInfo }> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const row = await tx.lead.findFirst({
        where: { id, tenantId, ...ownershipFilter("leads.view_all", "assignedToUserId") },
      });
      if (!row) throw new NotFoundException("ליד לא נמצא");
      const contact = await this.contacts.getById(tx, row.contactId);
      if (!contact) throw new NotFoundException("איש קשר לא נמצא");
      const interactions = await tx.interaction.findMany({
        where: { tenantId, leadId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        lead: toLeadDto(row, contact),
        ...(await this.dialedNumberFor(tx, tenantId, id)),
        timeline: interactions.map((i) => ({
          id: i.id,
          kind: i.kind,
          direction: i.direction ?? undefined,
          content: i.content,
          createdAt: i.createdAt,
        })),
      };
    });
  }

  /**
   * המספר שאליו הלקוח התקשר, ושם המספר הווירטואלי אם מוגדר.
   *
   * זו התשובה ל"מאיפה הגיע הליד הזה" ברזולוציה שהמקור לבדו אינו
   * נותן: משרד שמריץ שלוש מודעות באותו ערוץ רואה שלוש שורות עם
   * אותו מקור, והמספר הוא מה שמפריד ביניהן.
   *
   * השיחה **הראשונה** ולא האחרונה: הליד נפתח מהשיחה שיצרה אותו,
   * ושיחות המשך יוצאות מהמשרד למספרים אחרים לגמרי — הצגתן הייתה
   * מייחסת את הליד לקמפיין שגוי.
   *
   * שתי שאילתות קלות ורק במסך הפרטים; ברשימה הן היו מוכפלות בכל
   * שורה בלי שאיש ביקש את הנתון.
   */
  private async dialedNumberFor(
    tx: TenantTx,
    tenantId: string,
    leadId: string,
  ): Promise<{ dialedNumber?: DialedNumberInfo }> {
    const call = await tx.call.findFirst({
      where: { tenantId, leadId, dialedNumber: { not: null } },
      orderBy: { occurredAt: "asc" },
      select: { dialedNumber: true, dialedLabel: true },
    });
    const phone = call?.dialedNumber;
    if (phone === undefined || phone === null) return {};
    /*
     * השם מהצילום שעל השיחה, ולא מההגדרה החיה.
     *
     * ההגדרה יכולה להימחק או לשנות שם, וזה לא אמור לשנות את מה
     * שכתוב על ליד שכבר נפתח: "הגיע מקמפיין פייסבוק ינואר" הוא
     * עובדה היסטורית. שאילתה על הטבלה החיה הייתה הופכת לידים
     * ישנים ל"מספר לא מוגדר" ברגע שמנקים קמפיין שהסתיים.
     */
    const label = call?.dialedLabel;
    return {
      dialedNumber: {
        phone,
        ...(label !== null && label !== undefined && label !== "" ? { label } : {}),
      },
    };
  }

  /** פילוח לפי סטטוס מכל המאגר — לגרף המשפך בדשבורד. */
  async breakdown(): Promise<{ total: number; byStatus: Record<string, number> }> {
    const tenantId = TenantContext.current().tenantId;
    const where = {
      tenantId,
      ...ownershipFilter("leads.view_all", "assignedToUserId"),
    };
    const rows = await this.prisma.withTenant((tx) =>
      tx.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      byStatus[row.status] = row._count._all;
      total += row._count._all;
    }
    return { total, byStatus };
  }

  async list(query: {
    status?: string;
    requiresHuman?: boolean;
    cursor?: string;
    limit: number;
  }): Promise<Page<LeadDto>> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const rows = await tx.lead.findMany({
        where: {
          tenantId,
          ...ownershipFilter("leads.view_all", "assignedToUserId"),
          ...(query.status ? { status: query.status } : {}),
          ...(query.requiresHuman !== undefined ? { requiresHuman: query.requiresHuman } : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      // שאילתה אחת לכל אנשי הקשר בעמוד, לא אחת לכל שורה
      const contactsById = await this.contacts.getByIds(
        tx,
        page.map((row) => row.contactId),
      );
      const items: LeadDto[] = [];
      for (const row of page) {
        const contact = contactsById.get(row.contactId);
        if (contact) items.push(toLeadDto(row, contact));
      }
      return { items, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
    });
  }

  /**
   * לידים שהכדור אצל המתווך — **הוותיקים ראשונים**.
   *
   * ## למה שיטה ייעודית ולא `list` עם סינון אחריה
   *
   * `list` מחזירה עמוד לפי `id` יורד, כלומר את ה**חדשים**, וסינון
   * הסטטוס קורה אחריה. משרד עם יותר לידים מגודל העמוד היה מאבד
   * בשקט בדיוק את הליד שרשימת החזרות קיימת בשבילו: הוותיק ביותר,
   * זה שממתין הכי הרבה זמן (ביקורת Codex).
   *
   * כאן הסטטוס מסונן במסד והמיון הוא לפי מועד הכניסה בסדר עולה —
   * ולכן חיתוך התקרה מוריד את החדשים, שהם הפחות דחופים. חיתוך שמסיר
   * את הצד הלא-נכון של הרשימה הוא באג; חיתוך שמסיר את הזנב הוא
   * החלטה.
   *
   * `waiting_customer` אינו כאן בכוונה: שם ממתינים **ללקוח**, ולכן
   * אין למה לחזור אליו.
   */
  async openAwaitingResponse(limit: number): Promise<LeadDto[]> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const rows = await tx.lead.findMany({
        where: {
          tenantId,
          ...ownershipFilter("leads.view_all", "assignedToUserId"),
          status: { in: ["new", "in_progress"] },
        },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      const contactsById = await this.contacts.getByIds(
        tx,
        rows.map((row) => row.contactId),
      );
      const items: LeadDto[] = [];
      for (const row of rows) {
        const contact = contactsById.get(row.contactId);
        if (contact) items.push(toLeadDto(row, contact));
      }
      return items;
    });
  }

  /**
   * הלידים החיים שמשימות מצביעות עליהם — לפי מזהה, בלי תלות בסטטוס.
   *
   * ## למה לא לעשות שימוש חוזר ב-`openAwaitingResponse`
   *
   * זה נראה כמו חיסכון בשאילתה והתברר כביטול של מקור שלם. אותה
   * שליפה מחזירה `new` ו-`in_progress` בלבד, וכל איש קשר בה כבר
   * נכנס לרשימה כ„פנייה שממתינה” — סיבה שגוברת על „משימה”. התוצאה:
   * משימה על ליד משם לעולם אינה הסיבה המוצגת, ומשימה על ליד
   * ב-`waiting_customer` — „לחזור אליו ביום שישי”, בדיוק המשימה
   * שכן צריך להזכיר — נשמטה כליל. מקור המשימות היה מפורסם וכבוי
   * (ביקורת Codex).
   *
   * `waiting_customer` שייך כאן ולא שם: אין למה לחזור ללקוח שממתינים
   * לו — **אלא אם** המתווך רשם לעצמו משימה לחזור, וזה בדיוק המקרה.
   *
   * הסטטוסים הסגורים (`converted`, `closed`) נשארים בחוץ: משימה על
   * ליד שהסתיים אינה חזרה לאיש.
   */
  async activeByIds(ids: readonly string[]): Promise<LeadDto[]> {
    if (ids.length === 0) return [];
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const rows = await tx.lead.findMany({
        where: {
          tenantId,
          ...ownershipFilter("leads.view_all", "assignedToUserId"),
          id: { in: [...new Set(ids)] },
          status: { in: [...OPEN_LEAD_STATUSES] },
        },
      });
      const contactsById = await this.contacts.getByIds(
        tx,
        rows.map((row) => row.contactId),
      );
      const items: LeadDto[] = [];
      for (const row of rows) {
        const contact = contactsById.get(row.contactId);
        if (contact) items.push(toLeadDto(row, contact));
      }
      return items;
    });
  }
}

function toLeadDto(
  row: {
    id: string;
    source: string;
    intent: string;
    status: string;
    requiresHuman: boolean;
    requiresHumanReason: string | null;
    summary: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  contact: { id: string; name: string; phone: string; email?: string },
): LeadDto {
  return {
    id: row.id,
    contact,
    source: row.source,
    intent: row.intent,
    status: row.status,
    requiresHuman: row.requiresHuman,
    requiresHumanReason: row.requiresHumanReason ?? undefined,
    summary: row.summary ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
