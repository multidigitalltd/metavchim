import type { Readable } from "node:stream";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { ContactsService, type ContactDto } from "../contacts/contacts.service";
import { TranscriptionService } from "../voice-intake/transcription.service";

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
  /** pending | running | done | failed | unavailable — null = לא הועלתה הקלטה. */
  transcriptionStatus?: string;
  transcript?: string;
  /**
   * יש קובץ להשמעה.
   *
   * שדה נפרד מ-`transcriptionStatus` ולא נגזר ממנו: שירות תמלול
   * כבוי משאיר את הסטטוס `unavailable` על הקלטה שקיימת לגמרי,
   * והשמעה אינה תלויה בתמלול. גזירה מהסטטוס הייתה מסתירה את הנגן
   * בדיוק מהמשרדים שאין להם תמלול — כלומר מי שההקלטה היא כל מה
   * שיש לו.
   */
  hasRecording: boolean;
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
  /** manual (ברירת מחדל) | meeting — הקלטה של פגישה מהיומן. */
  source?: string;
  /** הפגישה שההקלטה מתעדת, כשהמקור הוא `meeting`. */
  appointmentId?: string;
}

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly transcription: TranscriptionService,
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
          source: input.source ?? "manual",
          appointmentId: input.appointmentId ?? null,
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
      /*
       * שאילתה אחת לכל אנשי הקשר בעמוד. `Promise.all` על `toDto`
       * נראה מקבילי, אבל כל קריאה בתוכו הייתה שאילתה נפרדת על אותו
       * חיבור — כלומר עמוד של חמישים שיחות היה חמישים הלוך-ושוב.
       */
      const contactsById = await this.contacts.getByIds(
        tx,
        rows.map((row) => row.contactId).filter((id): id is string => id !== null),
      );
      return Promise.all(rows.map((row) => this.toDto(tx, row, contactsById)));
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


  /**
   * צירוף הקלטה לשיחה קיימת.
   *
   * ההקלטה נשמרת ב-S3 והתמלול מתבצע ברקע — לא בבקשה. תמלול של שיחה
   * בת עשר דקות אורך דקות על CPU, ובקשת HTTP שממתינה לו נופלת על
   * timeout ומשאירה את המתווך בלי מושג מה קרה.
   *
   * הסטטוס נכתב מיד ל-pending, כך שהמסך אומר "ממתין לתמלול" ולא
   * נראה כאילו ההעלאה לא קרתה.
   */
  async attachRecording(
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ status: string }> {
    const tenantId = TenantContext.current().tenantId;
    const available = (await this.transcription.status()).available;

    const key = `calls/${tenantId}/${id}/${ulid()}`;
    await this.storage.put(key, file.buffer, file.mimetype || "audio/webm");

    await this.prisma.withTenant(async (tx) => {
      const updated = await tx.call.updateMany({
        where: { id, tenantId },
        data: {
          recordingKey: key,
          // שירות תמלול כבוי אינו כשל אלא תצורה — המסך אומר זאת אחרת,
          // והעובד לא יאסוף את השיחה לסריקה אינסופית
          transcriptionStatus: available ? "pending" : "unavailable",
          transcript: null,
          transcribedAt: null,
        },
      });
      if (updated.count === 0) throw new NotFoundException("שיחה לא נמצאה");
      await this.audit.record(tx, {
        action: "call.recording_attached",
        entityType: "call",
        entityId: id,
      });
    });

    return { status: available ? "pending" : "unavailable" };
  }

  /**
   * ההקלטה להשמעה — הזרמה דרך ה-API ולא קישור לאחסון.
   *
   * MinIO יושב ברשת פנימית בלי כתובת ציבורית, וכתובת חתומה הייתה
   * הופכת הקלטה של לקוח לקישור שאפשר להעביר הלאה. כאן כל בקשה
   * עוברת את אותו שער של שאר המערכת, ו-RLS מוודא שהשיחה שייכת
   * למשרד — ידיעת מזהה אינה הרשאה.
   */
  async recording(
    id: string,
  ): Promise<{ body: Readable; contentType: string; contentLength?: number }> {
    const key = await this.prisma.withTenant(async (tx) => {
      const row = await tx.call.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId },
        select: { recordingKey: true },
      });
      if (!row) throw new NotFoundException("שיחה לא נמצאה");
      /*
       * שיחה בלי הקלטה אינה שגיאת שרת אלא מצב רגיל — רוב השיחות
       * אינן מוקלטות, והמסך צריך לדעת להבדיל בין "אין" ל"נכשל".
       */
      if (!row.recordingKey) throw new NotFoundException("לשיחה אין הקלטה");
      return row.recordingKey;
    });

    const object = await this.storage.getObject(key);
    return {
      body: object.body as Readable,
      contentType: object.contentType ?? "audio/wav",
      ...(object.contentLength === undefined ? {} : { contentLength: object.contentLength }),
    };
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
      transcriptionStatus?: string | null;
      transcript?: string | null;
      recordingKey?: string | null;
      createdAt: Date;
    },
    /**
     * אנשי הקשר של העמוד, כשהקורא כבר שלף אותם. חסר ⇒ שליפה בודדת,
     * וזה הנתיב של יצירה או של כרטיס יחיד.
     */
    contactsById?: Map<string, ContactDto>,
  ): Promise<CallDto> {
    const contact =
      row.contactId === null
        ? null
        : (contactsById?.get(row.contactId) ?? (await this.contacts.getById(tx, row.contactId)));
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
      hasRecording: (row.recordingKey ?? null) !== null,
      ...(row.durationMinutes !== null ? { durationMinutes: row.durationMinutes } : {}),
      outcome: row.outcome,
      ...(row.summary ? { summary: row.summary } : {}),
      ...(row.transcriptionStatus ? { transcriptionStatus: row.transcriptionStatus } : {}),
      ...(row.transcript ? { transcript: row.transcript } : {}),
      createdAt: row.createdAt,
    };
  }
}
