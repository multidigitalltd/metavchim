import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { CallsService } from "../calls/calls.service";
import { ExclusivityService } from "../exclusivity/exclusivity.service";
import { formatJerusalemDate, formatJerusalemTime } from "@metavchim/shared";

export interface AppointmentDto {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  buyerId?: string;
  startsAt: Date;
  endsAt?: Date;
  status: string;
  outcome?: string;
  notes?: string;
}

const OUTCOME_LABELS: Record<string, string> = {
  liked: "אהב את הנכס",
  not_fit: "לא מתאים",
  negotiating: 'עוברים למו"מ',
  needs_other: "צריך נכס אחר",
};

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    // ההקלטה של פגישה נשמרת כשורת `calls` — אותו צינור תמלול בדיוק
    private readonly calls: CallsService,
    // תיעוד סיור כפעולת שיווק בתיק הבלעדיות — פריט (5) בתקנות
    private readonly exclusivity: ExclusivityService,
  ) {}

  async create(input: {
    kind: string;
    title?: string;
    leadId?: string;
    propertyId?: string;
    buyerId?: string;
    startsAt: Date;
    durationMinutes: number;
    notes?: string;
  }): Promise<AppointmentDto> {
    const ctx = TenantContext.current();
    const id = ulid();
    const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);

    await this.prisma.withTenant(async (tx) => {
      // קישורים חייבים להיות ישויות של הדייר — ידיעת ID אינה הרשאה
      if (input.leadId) {
        const lead = await tx.lead.findFirst({
          where: { id: input.leadId, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!lead) throw new NotFoundException("ליד לא נמצא");
      }
      if (input.propertyId) {
        const property = await tx.property.findFirst({
          where: { id: input.propertyId, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!property) throw new NotFoundException("נכס לא נמצא");
      }
      if (input.buyerId) {
        const buyer = await tx.buyer.findFirst({
          where: { id: input.buyerId, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!buyer) throw new NotFoundException("קונה לא נמצא");
      }

      await tx.appointment.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          kind: input.kind,
          title: input.title ?? null,
          leadId: input.leadId ?? null,
          propertyId: input.propertyId ?? null,
          buyerId: input.buyerId ?? null,
          startsAt: input.startsAt,
          endsAt,
          notes: input.notes ?? null,
          /*
           * יומן של מי. `createdBy` הוא "מי הקליד" ואינו אותו דבר:
           * מנהל שקובע סיור לסוכן צריך שהאירוע יופיע ביומן של הסוכן.
           * כרגע הם זהים — השדה קיים כדי שהעברת בעלות תהיה שינוי
           * ערך ולא שינוי מודל.
           */
          ownerUserId: ctx.userId,
          createdBy: ctx.userId,
        },
      });
      /*
       * ‎**שני צירי הזמן, לא אחד** (ביקורת Codex).
       *
       * עד כה נרשמה שורה רק כשהפגישה קושרה לליד — בזמן ש-`buyerId`
       * נשמר על הפגישה, ושכרטיס הקונה קורא ציר זמן משלו
       * (`/buyers/:id/interactions`). התוצאה: סיור שנקבע לקונה לא
       * הופיע אצלו בכלל. זה לא נראה כי שום מסך לא שלח `buyerId`;
       * ברגע שכרטיס הקונה מקבל כפתור „קביעת סיור”, זה הופך להבטחה
       * שבורה במסך עצמו.
       *
       * הדחייה (`reschedule`, למטה) כבר כותבת לשניהם — כאן זו רק
       * השלמה לאותה צורה.
       *
       * ‎**והמועד בשעון ישראל.** `toISOString()` הציג לסוכן
       * „2026-09-10T07:30:00.000Z” על סיור ב-10:30 — חותמת UTC בציר
       * זמן בעברית, בדיוק מה שכלל ה-ESLint על שעון המכשיר נלחם בו.
       */
      const scheduled = `נקבעה פגישה (${input.kind}) ל-${formatJerusalemDate(
        input.startsAt,
      )} ${formatJerusalemTime(input.startsAt)}`;
      for (const link of [
        input.leadId ? { leadId: input.leadId } : null,
        input.buyerId ? { buyerId: input.buyerId } : null,
      ]) {
        if (!link) continue;
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            ...link,
            kind: "system",
            content: scheduled,
            createdBy: ctx.userId,
          },
        });
      }
      await this.audit.record(tx, {
        action: "appointment.create",
        entityType: "appointment",
        entityId: id,
      });
      /*
       * סיור בנכס הוא "הזמנת רוכשים פוטנציאליים לבקר בנכס" — פריט (5)
       * ברשימת פעולות השיווק. הוא נרשם בתיק הבלעדיות מעצמו, כי סוכן
       * שקבע סיור לא יזכור לתעד אותו פעם שנייה כפעולת שיווק.
       *
       * **הפעולה מתוארכת לרגע התיאום ולא למועד הסיור.** הפעולה שהתקנה
       * מונה היא ההזמנה, והיא בוצעה עכשיו; מועד הביקור הוא "במועד
       * שיוסכם עליו". תיארוך למועד הסיור היה מפיל בלעדיות שסוכן שיווק
       * בזמן — סיור שתואם ביום 5 ונקבע ליום 40 היה נספר אחרי מועד
       * השליש, כלומר לא נספר כלל (ביקורת Codex). מועד הביקור נשמר
       * בפירוט, כי הוא מה שמעניין את מי שקורא את התיק.
       */
      if (input.propertyId && input.kind === "viewing") {
        await this.exclusivity.recordAuto(tx, input.propertyId, "viewing_scheduled", {
          sourceKey: `viewing:${id}`,
          performedAt: new Date(),
          detail: `סיור בנכס תואם ליום ${formatJerusalemDate(input.startsAt)}`,
        });
      }
      await this.outbox.emit(tx, "appointment.scheduled", {
        appointmentId: id,
        tenantId: ctx.tenantId,
        startsAt: input.startsAt,
        kind: input.kind,
        endsAt: new Date(input.startsAt.getTime() + input.durationMinutes * 60_000),
      });
    });

    return this.getById(id);
  }

  /**
   * דחיית פגישה למועד חדש.
   *
   * זה מה שקורה בפועל כשפגישה "לא התקיימה": הלקוח לא הגיע, והמתווך
   * צריך מועד חדש — לא לבטל ולפתוח פגישה מאפס, כי אז נשבר הקשר לנכס,
   * לקונה ולהיסטוריה.
   *
   * המועד הקודם נשמר (`rescheduledFrom`) והמונה עולה: פגישה שנדחתה
   * שלוש פעמים היא סימן שהעסקה מתקררת, ובלי המונה זה מידע שנמחק
   * בכל דחייה.
   */
  async reschedule(
    id: string,
    input: { startsAt: Date; durationMinutes: number; reason?: string },
  ): Promise<AppointmentDto> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.appointment.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new NotFoundException("פגישה לא נמצאה");
      if (existing.status === "completed") {
        throw new BadRequestException("פגישה שהתקיימה אינה נדחית — פתחו פגישת המשך");
      }

      const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
      await tx.appointment.update({
        where: { id },
        data: {
          startsAt: input.startsAt,
          endsAt,
          // חוזרת להיות פגישה שעתידה להתקיים, גם אם סומנה כ"לא הגיע"
          status: "scheduled",
          outcome: null,
          rescheduledFrom: existing.startsAt,
          rescheduleCount: existing.rescheduleCount + 1,
          /*
           * ‎**המועד החדש מקבל תזכורת משלו.** בלי האיפוס הזה, פגישה
           * שכבר נשלחה עליה תזכורת ונדחתה למחר הייתה נשארת מסומנת
           * „נשלח” — כלומר שני הצדדים היו מקבלים תזכורת למועד שכבר
           * אינו נכון, ואז שום דבר למועד האמיתי.
           */
          reminderSentAt: null,
          /*
           * ‎**וגם התשובה שניתנה למועד הישן.**
           *
           * „אישרתי שאני מגיע” נאמר על שעה מסוימת. פגישה שנדחתה
           * ונשארה מסומנת „הלקוח אישר” מציגה למתווך אישור למועד
           * שהלקוח מעולם לא ראה — והוא לא יתקשר לוודא.
           */
          reminderReply: null,
          reminderReplyAt: null,
          // איפוס חותמת הסנכרון = "צריך דחיפה מחדש" ליומן Google
          googleSyncedAt: null,
        },
      });

      /*
       * הדחייה מתועדת בציר הזמן של הלקוח ולא רק בשדה.
       *
       * "נדחתה מ-X ל-Y" הוא בדיוק סוג המידע שסוכן אחר צריך כשהוא
       * מרים את הכרטיס, והשדה לבדו אינו מספר את הסיפור.
       */
      const line = [
        `הפגישה נדחתה מ-${formatJerusalemDate(existing.startsAt)} ${formatJerusalemTime(existing.startsAt)}`,
        `ל-${formatJerusalemDate(input.startsAt)} ${formatJerusalemTime(input.startsAt)}`,
        input.reason ? `(${input.reason})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      for (const link of [
        existing.leadId ? { leadId: existing.leadId } : null,
        existing.buyerId ? { buyerId: existing.buyerId } : null,
      ]) {
        if (!link) continue;
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            ...link,
            kind: "system",
            content: line,
            createdBy: ctx.userId,
          },
        });
      }

      await this.audit.record(tx, {
        action: "appointment.reschedule",
        entityType: "appointment",
        entityId: id,
        metadata: { from: existing.startsAt.toISOString(), to: input.startsAt.toISOString() },
      });
      // תזכורת חדשה למועד החדש; הישנה תדולג בזמן ריצה
      await this.outbox.emit(tx, "appointment.scheduled", {
        appointmentId: id,
        tenantId: ctx.tenantId,
        startsAt: input.startsAt,
        kind: existing.kind,
        endsAt,
      });
    });
    return this.getById(id);
  }

  /** עדכון סטטוס/תוצאה — פולו-אפ "איך היה הסיור?" (אפיון §13). */
  async update(
    id: string,
    patch: {
      status?: string;
      outcome?: string | null;
      notes?: string | null;
      title?: string | null;
    },
  ): Promise<AppointmentDto> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.appointment.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new NotFoundException("פגישה לא נמצאה");

      // תוצאות הסיור (אהב/לא מתאים...) הן ספציפיות לנכס — רק לסוג viewing
      if (patch.outcome && existing.kind !== "viewing") {
        throw new BadRequestException("תוצאת סיור זמינה רק לפגישות מסוג סיור בנכס");
      }

      await tx.appointment.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          // תוצאה חדשה גוררת "התקיימה"; ניקוי תוצאה (null) לא נוגע בסטטוס
          ...(patch.outcome !== undefined
            ? patch.outcome === null
              ? { outcome: null }
              : { outcome: patch.outcome, status: "completed" }
            : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          /*
           * איפוס חותמת הסנכרון = "צריך דחיפה מחדש".
           *
           * זו הדרך שבה סורק היומן יודע שהשורה השתנתה. ההשוואה
           * החלופית — googleSyncedAt מול updatedAt — נשמעת מדויקת
           * יותר וברירה: כל כתיבה שולית מזיזה את updatedAt, כולל זו
           * של הדחיפה עצמה, וייצרה דחיפה נצחית.
           */
          googleSyncedAt: null,
        },
      });

      // תוצאת סיור מתועדת בציר הזמן של הליד ושל הקונה — ההיסטוריה במקום אחד
      if (patch.outcome && existing.leadId) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: existing.leadId,
            kind: "system",
            content: `סיכום פגישה: ${OUTCOME_LABELS[patch.outcome] ?? patch.outcome}`,
            createdBy: ctx.userId,
          },
        });
      }
      if (patch.outcome && existing.buyerId) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            buyerId: existing.buyerId,
            kind: "system",
            content: `סיכום סיור: ${OUTCOME_LABELS[patch.outcome] ?? patch.outcome}`,
            createdBy: ctx.userId,
          },
        });
      }
      // סיכום הסיור — או ביטולו — סוגר את משימת הפולו-אפ אוטומטית;
      // אין טעם לרדוף אחרי "איך היה?" על סיור שלא התקיים
      if (patch.outcome || patch.status === "cancelled" || patch.status === "no_show") {
        await tx.task.updateMany({
          where: { tenantId: ctx.tenantId, sourceKey: `viewing:${id}`, status: "open" },
          /* `completedAt` נרשם בכל מסלול שסוגר משימה — ראו TasksService */
          data: { status: "done", completedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        action: "appointment.update",
        entityType: "appointment",
        entityId: id,
        metadata: { changedFields: Object.keys(patch) },
      });
    });
    return this.getById(id);
  }

  /**
   * צירוף הקלטה לפגישה שהתקיימה.
   *
   * ההקלטה נשמרת כשורת `calls` עם `source: "meeting"` ולא כצינור
   * תמלול שני. `calls` היא בפועל "שיחה מוקלטת עם סיכום" — יש בה
   * הקלטה, תמלול, סטטוס וסיכום, והעובד שמתמלל אותה כבר עובד. מסלול
   * מקביל לפגישות היה משכפל אחסון, תמלול, סיכום וסטטוס: ארבעה
   * מקומות שיתחילו להיפרד ברגע שאחד מהם ישתנה.
   */
  async attachRecording(
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ callId: string; status: string }> {
    const ctx = TenantContext.current();
    const appointment = await this.prisma.withTenant(async (tx) => {
      const row = await tx.appointment.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!row) throw new NotFoundException("פגישה לא נמצאה");
      if (row.buyerId === null) return row;
      // הקונה מספק את איש הקשר, כדי שההקלטה תיקשר לכרטיס הלקוח
      const buyer = await tx.buyer.findFirst({
        where: { id: row.buyerId, tenantId: ctx.tenantId },
        select: { contactId: true },
      });
      return { ...row, contactId: buyer?.contactId ?? null };
    });

    const call = await this.calls.create({
      direction: "inbound",
      source: "meeting",
      appointmentId: id,
      ...("contactId" in appointment && appointment.contactId
        ? { contactId: appointment.contactId }
        : {}),
      ...(appointment.leadId ? { leadId: appointment.leadId } : {}),
      occurredAt: appointment.startsAt,
      outcome: "answered",
    });
    const result = await this.calls.attachRecording(call.id, file);
    return { callId: call.id, status: result.status };
  }

  async getById(id: string): Promise<AppointmentDto> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.appointment.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId },
      });
      if (!row) throw new NotFoundException("פגישה לא נמצאה");
      return toDto(row);
    });
  }

  async list(query: { from: Date; to: Date }): Promise<AppointmentDto[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.appointment.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          startsAt: { gte: query.from, lte: query.to },
        },
        orderBy: { startsAt: "asc" },
        take: 200,
      });
      return rows.map(toDto);
    });
  }
}

function toDto(row: {
  id: string;
  kind: string;
  title: string | null;
  leadId: string | null;
  propertyId: string | null;
  buyerId: string | null;
  startsAt: Date;
  endsAt: Date | null;
  status: string;
  outcome: string | null;
  notes: string | null;
}): AppointmentDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? undefined,
    leadId: row.leadId ?? undefined,
    propertyId: row.propertyId ?? undefined,
    buyerId: row.buyerId ?? undefined,
    startsAt: row.startsAt,
    endsAt: row.endsAt ?? undefined,
    status: row.status,
    outcome: row.outcome ?? undefined,
    notes: row.notes ?? undefined,
  };
}
