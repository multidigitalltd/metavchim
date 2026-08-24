import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { isTaskUrgent, type TaskPriority } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

/**
 * משימות ותזכורות (docs/01 — מודול 7).
 *
 * **מה השתנה מהגרסה הראשונה:** המשימה הייתה אישית לחלוטין — נוצרה
 * תמיד על שם היוצר, ונראתה רק לו. זה הפך את המודול לפנקס אישי:
 * מנהל משרד לא יכול היה להטיל דבר, ו"מה פתוח אצל הצוות" לא היה
 * שאלה שאפשר לשאול. עכשיו יש הפרדה בין **מי אחראי**
 * (`assignedToUserId`) לבין **מי הטיל** (`createdByUserId`), ושתי
 * יכולות נפרדות שומרות על הגבול: `tasks.assign` להטלה על אחר,
 * ו-`tasks.view_all` לראיית לוח המשרד.
 *
 * ברירת המחדל לא זזה: בלי היכולות האלה המשתמש רואה ומנהל את שלו
 * בלבד, בדיוק כמו קודם.
 */

export interface TaskDto {
  id: string;
  title: string;
  notes?: string;
  dueAt?: Date;
  status: string;
  priority: string;
  entityType?: string;
  entityId?: string;
  /** תיאור קצר של הישות המקושרת — כתובת הנכס, שם הקונה */
  entityLabel?: string;
  assignedToUserId: string;
  assigneeName?: string;
  createdByUserId?: string;
  /** מי הטיל, כשזה אינו האחראי עצמו — "הוטלה עליך בידי X" */
  assignedByName?: string;
  /** אוטומטית: נוצרה מאירוע במערכת ולא בידי אדם */
  automatic: boolean;
  /**
   * האם המשתמש הנוכחי רשאי לשנות אותה.
   *
   * נחתך בשרת ולא נמצא במסך: פאנל הישות מציג בכוונה את משימות כל
   * המשרד, וסוכן בלי `tasks.view_all` רואה שם משימה של עמית — אבל
   * `PATCH` עליה נדחה ב-404. תיבת סימון שנכשלת בכל לחיצה גרועה
   * מתיבה מנוטרלת (ביקורת Codex).
   */
  canEdit: boolean;
  createdAt: Date;
}

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  dueAt: Date | null;
  status: string;
  priority: string;
  entityType: string | null;
  entityId: string | null;
  sourceKey: string | null;
  assignedToUserId: string;
  createdByUserId: string | null;
  createdAt: Date;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contacts: ContactsService,
  ) {}

  /**
   * מי מותר לי לראות ולשנות.
   *
   * `{}` למי שמחזיק ב-`tasks.view_all`, אחרת סינון לעצמו — אותו דפוס
   * בדיוק כמו `ownershipFilter`, ומסיבה זהה: השאילתה היא האכיפה, לא
   * בדיקה שאפשר לשכוח בנתיב חדש.
   */
  private scopeFilter(): Record<string, string> {
    const ctx = TenantContext.current();
    if (ctx.capabilities.has("tasks.view_all")) return {};
    return { assignedToUserId: ctx.userId };
  }

  /**
   * על מי המשימה נרשמת.
   *
   * `undefined` או המשתמש עצמו — תמיד מותר. אחר דורש `tasks.assign`
   * **וגם** שהיעד יהיה משתמש פעיל של אותו משרד: בלי הבדיקה השנייה
   * אפשר היה להטיל משימה על מזהה משתמש של משרד אחר, כלומר לכתוב
   * שורה שנושאת מזהה זר בתוך הדייר שלנו.
   */
  private async resolveAssignee(tx: TenantTx, requested?: string): Promise<string> {
    const ctx = TenantContext.current();
    if (requested === undefined || requested === ctx.userId) return ctx.userId;
    if (!ctx.capabilities.has("tasks.assign")) {
      throw new ForbiddenException("אין הרשאה להטיל משימות על סוכנים אחרים");
    }
    const target = await this.prisma.user.findFirst({
      where: { id: requested, tenantId: ctx.tenantId, isActive: true },
      select: { id: true },
    });
    if (!target) throw new BadRequestException("הסוכן שנבחר אינו קיים או אינו פעיל");
    return target.id;
  }

  /** שמות המשתמשים לתצוגה — שאילתה אחת לכל הרשימה, לא אחת לשורה. */
  private async userNames(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter((id) => id !== "");
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique }, tenantId: TenantContext.current().tenantId },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /**
   * תיאור הישות המקושרת.
   *
   * הקישור קיים בנתונים מהיום הראשון ומעולם לא הוצג — משימה
   * "להתקשר" שנוצרה מ-SLA של ליד נראתה בדיוק כמו משימה שהוקלדה
   * ביד, בלי דרך לדעת על מי. שאילתה אחת לכל סוג, לא אחת לשורה.
   */
  private async entityLabels(
    tx: TenantTx,
    rows: readonly TaskRow[],
  ): Promise<Map<string, string>> {
    const tenantId = TenantContext.current().tenantId;
    const byType = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.entityType || !row.entityId) continue;
      byType.set(row.entityType, [...(byType.get(row.entityType) ?? []), row.entityId]);
    }
    const labels = new Map<string, string>();
    const key = (type: string, id: string): string => `${type}:${id}`;

    const propertyIds = byType.get("property") ?? [];
    if (propertyIds.length > 0) {
      const properties = await tx.property.findMany({
        where: { id: { in: propertyIds }, tenantId },
        select: { id: true, street: true, neighborhood: true, city: true, marketingTitle: true },
      });
      for (const p of properties) {
        const address = [p.street, p.neighborhood, p.city].filter(Boolean).join(", ");
        labels.set(key("property", p.id), p.marketingTitle ?? address ?? "נכס");
      }
    }

    /*
     * קונה וליד מצביעים על איש קשר, ושמו מוצפן — הפענוח עובר דרך
     * `ContactsService.getByIds`, שהוא מנה אחת ולא אחת לשורה.
     */
    const buyerIds = byType.get("buyer") ?? [];
    const leadIds = byType.get("lead") ?? [];
    const contactByEntity = new Map<string, string>();
    if (buyerIds.length > 0) {
      const buyers = await tx.buyer.findMany({
        where: { id: { in: buyerIds }, tenantId },
        select: { id: true, contactId: true },
      });
      for (const b of buyers) contactByEntity.set(key("buyer", b.id), b.contactId);
    }
    if (leadIds.length > 0) {
      const leads = await tx.lead.findMany({
        where: { id: { in: leadIds }, tenantId },
        select: { id: true, contactId: true },
      });
      for (const l of leads) contactByEntity.set(key("lead", l.id), l.contactId);
    }
    if (contactByEntity.size > 0) {
      const contacts = await this.contacts.getByIds(tx, [...new Set(contactByEntity.values())]);
      for (const [entityKey, contactId] of contactByEntity) {
        const name = contacts.get(contactId)?.name;
        if (name) labels.set(entityKey, name);
      }
    }
    return labels;
  }

  private async toDtos(tx: TenantTx, rows: readonly TaskRow[]): Promise<TaskDto[]> {
    if (rows.length === 0) return [];
    const [names, labels] = await Promise.all([
      this.userNames(rows.flatMap((r) => [r.assignedToUserId, r.createdByUserId ?? ""])),
      this.entityLabels(tx, rows),
    ]);
    const ctx = TenantContext.current();
    const canEditAny = ctx.capabilities.has("tasks.view_all");
    return rows.map((row) => {
      const delegated = row.createdByUserId !== null && row.createdByUserId !== row.assignedToUserId;
      return {
        id: row.id,
        title: row.title,
        notes: row.notes ?? undefined,
        dueAt: row.dueAt ?? undefined,
        status: row.status,
        priority: row.priority,
        entityType: row.entityType ?? undefined,
        entityId: row.entityId ?? undefined,
        ...(row.entityType && row.entityId
          ? { entityLabel: labels.get(`${row.entityType}:${row.entityId}`) }
          : {}),
        assignedToUserId: row.assignedToUserId,
        assigneeName: names.get(row.assignedToUserId),
        createdByUserId: row.createdByUserId ?? undefined,
        ...(delegated && row.createdByUserId
          ? { assignedByName: names.get(row.createdByUserId) }
          : {}),
        // משימה מאירוע מערכת נושאת sourceKey ואין לה יוצר אנושי
        automatic: row.sourceKey !== null && row.createdByUserId === null,
        // אותו כלל בדיוק שאוכף `scopeFilter` — נאמר כאן במקום להשאיר
        // למסך לנחש אותו ולטעות
        canEdit: canEditAny || row.assignedToUserId === ctx.userId,
        createdAt: row.createdAt,
      };
    });
  }

  /**
   * מי אפשר להטיל עליו — שמות בלבד.
   *
   * נתיב נפרד ולא `/settings/users`: זה דורש `users.manage`, שהיא
   * הרשאה לנהל את הצוות ולא להטיל עליו משימה. מי שיש לו
   * `tasks.assign` ואין לו ניהול משתמשים היה נשאר בלי רשימה, ולכן
   * בלי הפיצ'ר.
   *
   * מוחזרים שם ומזהה בלבד: אימייל, תפקיד ומצב נעילה אינם נחוצים
   * לבחירה מרשימה, וכל שדה מיותר הוא חשיפה מיותרת.
   */
  async assignees(): Promise<{ id: string; name: string }[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  async create(input: {
    title: string;
    notes?: string;
    dueAt?: Date;
    priority?: TaskPriority;
    entityType?: string;
    entityId?: string;
    assignedToUserId?: string;
  }): Promise<TaskDto> {
    const ctx = TenantContext.current();
    const id = ulid();

    return this.prisma.withTenant(async (tx) => {
      const assignee = await this.resolveAssignee(tx, input.assignedToUserId);
      const created = await tx.task.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          assignedToUserId: assignee,
          createdByUserId: ctx.userId,
          title: input.title,
          notes: input.notes ?? null,
          dueAt: input.dueAt ?? null,
          priority: input.priority ?? "normal",
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        },
      });
      await this.audit.record(tx, {
        action: "task.create",
        entityType: "task",
        entityId: id,
        ...(assignee !== ctx.userId ? { metadata: { assignedTo: assignee } } : {}),
      });
      /*
       * התזכורת נרשמת על **האחראי** ולא על היוצר. אחרת מנהל שמטיל
       * עשר משימות מקבל עשר תזכורות, והסוכן שאמור לבצע אותן — אף אחת.
       */
      if (input.dueAt && input.dueAt.getTime() > Date.now()) {
        await this.outbox.emit(tx, "task.created", {
          taskId: id,
          tenantId: ctx.tenantId,
          assignedToUserId: assignee,
          title: input.title,
          dueAt: input.dueAt,
        });
      }
      const [dto] = await this.toDtos(tx, [created]);
      return dto as TaskDto;
    });
  }

  /**
   * רשימת המשימות. הפתוחות (עד 200, לפי מועד) ואחריהן האחרונות
   * שבוצעו (עד 50) — שתי שאילתות נפרדות כדי שהמגבלה לעולם לא תדחוק
   * משימות פתוחות החוצה (ביקורת Codex, PR #13).
   *
   * `assignee` הוא **סינון תצוגה בתוך ההיקף המותר**, לא הרחבה שלו:
   * `scopeFilter` נפרש אחריו, ולכן מי שאין לו `tasks.view_all` לא
   * יכול לראות משימה של אחר גם אם ינקוב במזהה שלו.
   */
  async list(query: { status?: string; assignee?: string } = {}): Promise<TaskDto[]> {
    const ctx = TenantContext.current();
    const requested =
      query.assignee === undefined || query.assignee === "me"
        ? { assignedToUserId: ctx.userId }
        : query.assignee === "all"
          ? {}
          : { assignedToUserId: query.assignee };
    /*
     * ‎deletedAfterSync‎ מוסתר מכל הרשימות: המשתמש כבר מחק את
     * המשימה, והשורה שורדת רק עד שהסבב ינקה את האירוע ב-Google.
     * הצגתה הייתה נראית כמחיקה שלא עבדה.
     */
    const base = {
      tenantId: ctx.tenantId,
      deletedAfterSync: false,
      ...requested,
      ...this.scopeFilter(),
    };

    return this.prisma.withTenant(async (tx) => {
      const rows = query.status
        ? await tx.task.findMany({
            where: { ...base, status: query.status },
            orderBy: { dueAt: { sort: "asc", nulls: "last" } },
            take: 200,
          })
        : (
            await Promise.all([
              tx.task.findMany({
                where: { ...base, status: "open" },
                orderBy: { dueAt: { sort: "asc", nulls: "last" } },
                take: 200,
              }),
              tx.task.findMany({
                where: { ...base, status: "done" },
                orderBy: { updatedAt: "desc" },
                take: 50,
              }),
            ])
          ).flat();
      return this.toDtos(tx, rows);
    });
  }

  /**
   * המשימות של ישות אחת — לפאנל שבכרטיס הנכס/הקונה/הליד.
   *
   * ההיקף כאן הוא **כל המשרד** ולא רק שלי, בכוונה: כרטיס שמראה רק
   * את המשימות שלי על אותו לקוח משקר, כי הוא נראה כמו "אין מה
   * לעשות" בזמן שסוכן אחר כבר קבע איתו פגישה. הגישה לכרטיס עצמו
   * כבר נבדקה במסך שמכיל את הפאנל.
   */
  async listForEntity(entityType: string, entityId: string): Promise<TaskDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      /*
       * שתי שאילתות ולא מיון לפי סטטוס.
       *
       * `orderBy: status asc` ממיין לקסיקלית, ו-`done` קודם ל-`open`:
       * ישות עם 50 משימות שבוצעו הייתה ממלאת את התקרה ומחזירה אפס
       * פתוחות — כרטיס שמדווח "אין מה לעשות" בזמן שיש (ביקורת Codex).
       * אותו דפוס בדיוק כמו ב-`list`.
       */
      const [open, done] = await Promise.all([
        tx.task.findMany({
          where: { tenantId, entityType, entityId, status: "open", deletedAfterSync: false },
          orderBy: { dueAt: { sort: "asc", nulls: "last" } },
          take: 50,
        }),
        tx.task.findMany({
          where: { tenantId, entityType, entityId, status: "done" },
          orderBy: { updatedAt: "desc" },
          take: 20,
        }),
      ]);
      return this.toDtos(tx, [...open, ...done]);
    });
  }

  /**
   * משימות פתוחות שקשורות ללידים — לרשימת „למי לחזור”.
   *
   * ## למה שאילתה משלה ולא `list` עם סינון אחריה
   *
   * `list` מחזירה 200 משימות פתוחות **מכל הסוגים** וממיינת לפי מועד,
   * והסינון לפי „קשורה לליד” קרה אחריה. מתווך עם מאתיים משימות נכס
   * שמועדן מוקדם יותר („לצלם את הדירה”) איבד בשקט משימת חזרה תקפה —
   * בדיוק דפוס „עמוד ואז מסננים” שכבר תוקן בשני המקורות האחרים
   * (ביקורת Codex).
   *
   * ## ההיקף
   *
   * `scopeFilter` בלבד: מי שיש לו `tasks.view_all` מקבל את כל המשרד,
   * והשאר את שלו. זה נבדל מ-`list`, שברירת המחדל שלה היא „שלי” גם
   * למי שרשאי לראות הכול — ושם זה נכון, כי מסך המשימות עונה על „מה
   * עלי לעשות”. כאן השאלה היא „למי במשרד צריך לחזור”, וההודעה
   * מכריזה מספר; מספר שמסתיר את עמיתיו ממי שרשאי לראותם הוא הצהרה
   * שגויה (ביקורת Codex).
   */
  async openLinkedToLeads(limit: number): Promise<TaskDto[]> {
    const ctx = TenantContext.current();
    const tenantId = ctx.tenantId;
    // אותו סינון בעלות של `scopeFilter`, בצורה שאפשר להזריק ל-SQL
    const ownerOnly = ctx.capabilities.has("tasks.view_all") ? null : ctx.userId;
    return this.prisma.withTenant(async (tx) => {
      /*
       * המיון הוא לפי **אותו זמן שהדירוג משתמש בו** — `due_at`, ובלעדיו
       * `created_at`.
       *
       * `nulls: "last"` נראה תמים ודחק כל משימה בלי מועד יעד אל מעבר
       * לתקרה: במשרד עם יותר משימות מתוארכות מהתקרה, תזכורת בלי תאריך
       * מלפני חודשיים לא הגיעה כלל לשלב הדירוג — ושם דווקא היה נקבע
       * שהיא הוותיקה ביותר. חיתוך שמסיר את הוותיק במקום את הפחות דחוף
       * הוא בדיוק הבאג שכבר תוקן בשני המקורות האחרים (ביקורת Codex).
       *
       * `COALESCE` אינו ניתן לביטוי ב-`orderBy` של Prisma, ולכן SQL
       * גולמי בוחר מזהים ו-Prisma שולפת את השורות — אותו דפוס שבו
       * `CallsService.latestPerContactSince` משתמש, ובתוך `withTenant`
       * כך שה-RLS חל.
       */
      const ordered = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
          FROM tasks
         WHERE tenant_id = ${tenantId}
           AND deleted_after_sync = FALSE
           AND status = 'open'
           AND entity_type = 'lead'
           AND (${ownerOnly}::char(26) IS NULL OR assigned_to_user_id = ${ownerOnly})
         ORDER BY COALESCE(due_at, created_at) ASC
         LIMIT ${limit}
      `;
      const ids = ordered.map((row) => row.id);
      if (ids.length === 0) return [];
      const rows = await tx.task.findMany({ where: { tenantId, id: { in: ids } } });
      return this.toDtos(tx, rows);
    });
  }

  /**
   * כמה דורשות תשומת לב עכשיו — הבאדג' בסרגל.
   *
   * הספירה על **המשימות שלי** גם למנהל: הבאדג' אומר "מה עלי לעשות",
   * ומספר שכולל את כל המשרד הופך אותו למד עומס שאי אפשר לאפס.
   *
   * הסינון בזיכרון ולא ב-SQL כי `isTaskUrgent` היא אותה פונקציה
   * שהמסך מחלק לפיה לדליים — שני חישובים שאמורים להסכים הם שני
   * חישובים שיפסיקו להסכים.
   */
  async urgentCount(now = new Date()): Promise<number> {
    const ctx = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.task.findMany({
        where: {
          tenantId: ctx.tenantId,
          assignedToUserId: ctx.userId,
          status: "open",
          // מה שאין לו מועד לעולם אינו דחוף — לא מביאים אותו בכלל
          dueAt: { not: null, lt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000) },
        },
        select: { status: true, dueAt: true },
        take: 500,
      });
      return rows.filter((row) => isTaskUrgent(row, now)).length;
    });
  }

  async update(
    id: string,
    patch: {
      title?: string;
      notes?: string;
      dueAt?: Date | null;
      status?: string;
      priority?: TaskPriority;
      assignedToUserId?: string;
    },
  ): Promise<TaskDto> {
    const ctx = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id, tenantId: ctx.tenantId, ...this.scopeFilter() },
      });
      if (!existing) throw new NotFoundException("משימה לא נמצאה");

      /*
       * העברה לסוכן אחר עוברת באותו שער כמו יצירה — אחרת אפשר היה
       * ליצור משימה על עצמי ומיד "לעדכן" אותה על מישהו אחר, כלומר
       * לעקוף את `tasks.assign` בשתי בקשות.
       */
      const assignee =
        patch.assignedToUserId === undefined
          ? existing.assignedToUserId
          : await this.resolveAssignee(tx, patch.assignedToUserId);

      const updated = await tx.task.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(assignee !== existing.assignedToUserId ? { assignedToUserId: assignee } : {}),
          /*
           * כל שינוי שנראה ביומן מחזיר את המשימה לתור הדחיפה.
           *
           * בלי זה האירוע ב-Google נשאר עם הכותרת והשעה הישנות
           * לנצח, ומשימה שהועברה לסוכן אחר נותרת ביומן של הקודם
           * (ביקורת Codex). null = "ממתין לדחיפה", אותה מוסכמה
           * כמו על appointments.
           */
          ...(patch.title !== undefined ||
          patch.notes !== undefined ||
          patch.dueAt !== undefined ||
          patch.status !== undefined ||
          assignee !== existing.assignedToUserId
            ? { googleSyncedAt: null }
            : {}),
        },
      });
      await this.audit.record(tx, { action: "task.update", entityType: "task", entityId: id });

      // מועד חדש בעתיד למשימה פתוחה — תזכורת חדשה; הישנה תדולג בזמן
      // ריצה (ה-Worker משווה את מועד הירי ל-dueAt הנוכחי). גם העברה
      // לסוכן אחר מייצרת תזכורת — היא צריכה להגיע למי שאחראי עכשיו.
      const dueChanged =
        patch.dueAt instanceof Date && patch.dueAt.getTime() !== existing.dueAt?.getTime();
      const reassigned = assignee !== existing.assignedToUserId;
      const due = updated.dueAt;
      if ((dueChanged || reassigned) && due && due.getTime() > Date.now() && updated.status === "open") {
        await this.outbox.emit(tx, "task.created", {
          taskId: id,
          tenantId: ctx.tenantId,
          assignedToUserId: assignee,
          title: updated.title,
          dueAt: due,
        });
      }
      const [dto] = await this.toDtos(tx, [updated]);
      return dto as TaskDto;
    });
  }

  async remove(id: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id, tenantId: ctx.tenantId, ...this.scopeFilter() },
        select: { id: true, googleEventId: true },
      });
      if (!existing) throw new NotFoundException("משימה לא נמצאה");
      /*
       * מחיקה שיש לה אירוע ביומן אינה מוחקת את השורה מיד: היא
       * מסומנת כבוצעה וממתינה לדחיפה, וסבב הסנכרון הבא הוא שמוחק
       * את האירוע מ-Google ואז מנקה את השורה. מחיקה ישירה הייתה
       * מוחקת את המזהה היחיד שמצביע על האירוע, והוא היה נשאר
       * ביומן לנצח בלי דרך להגיע אליו (ביקורת Codex).
       */
      if (existing.googleEventId !== null) {
        await tx.task.update({
          where: { id },
          data: { status: "done", deletedAfterSync: true, googleSyncedAt: null },
        });
      } else {
        await tx.task.delete({ where: { id } });
      }
      await this.audit.record(tx, { action: "task.delete", entityType: "task", entityId: id });
    });
  }
}
