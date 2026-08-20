import type { Readable } from "node:stream";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { assertContactAccess, visibleContactIds } from "../../common/ownership";
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

  /**
   * יומן השיחות — **מסונן לפי בעלות, כמו כל שאר המערכת.**
   *
   * עד כה הוא החזיר את כל שיחות המשרד לכל סוכן: הסיכום, מספר
   * הטלפון והתמלול המלא של שיחות של עמיתים. זה חרג משאר המודולים —
   * סוכן עם `leads.view_own` אינו רואה את הליד של עמיתו, אבל כן ראה
   * את תמלול השיחה איתו.
   *
   * הכלל זהה ל-`assertContactAccess` בדיוק, רק בצורתו הקבוצתית.
   * שיחה שנרשמה בלי לקוח (למשל תיעוד ידני) שייכת למי שרשם אותה.
   */
  async list(query: { outcome?: string; leadId?: string; limit: number }): Promise<CallDto[]> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const visible = await visibleContactIds(tx, tenantId);
      const rows = await tx.call.findMany({
        where: {
          tenantId,
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.leadId ? { leadId: query.leadId } : {}),
          ...(visible === null
            ? {}
            : {
                OR: [
                  { contactId: { in: visible } },
                  { contactId: null, createdBy: userId },
                ],
              }),
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

  /**
   * שער השיחה הבודדת — **אותו כלל כמו ברשימה, בצורת רשומה אחת.**
   *
   * הבעלות נגזרת מהלקוח, כמו בכל ישות שאין לה בעלים משלה. שיחה
   * שנרשמה בלי לקוח שייכת למי שרשם אותה, ומנהל שרואה גם קונים וגם
   * לידים רואה הכול — בדיוק התנאי שבו `visibleContactIds` מוותר על
   * הסינון, כדי ששני המסלולים לא ייתנו תשובות שונות.
   *
   * תמיד 404 ובאותו נוסח: תשובה שונה על „קיימת אך לא שלך” הייתה
   * מסגירה את קיומה, ואת זה אין למשתמש הזה הרשאה לדעת.
   */
  private async assertCallAccess(tx: TenantTx, id: string): Promise<void> {
    const { tenantId, userId, capabilities } = TenantContext.current();
    const row = await tx.call.findFirst({
      where: { id, tenantId },
      select: { contactId: true, createdBy: true },
    });
    if (!row) throw new NotFoundException("שיחה לא נמצאה");

    if (row.contactId !== null) {
      // ההודעה מאוחדת: „איש קשר לא נמצא” היה מסגיר שהשיחה עצמה קיימת
      await assertContactAccess(tx, tenantId, row.contactId).catch(() => {
        throw new NotFoundException("שיחה לא נמצאה");
      });
      return;
    }
    const seesAll =
      capabilities.has("buyers.view_all") && capabilities.has("leads.view_all");
    if (!seesAll && row.createdBy !== userId) throw new NotFoundException("שיחה לא נמצאה");
  }

  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      // מחיקה היא פעולה על השיחה, ולכן היא עוברת את אותו שער כמו
      // הצפייה בה — אחרת סוכן היה יכול למחוק שיחה שאינו רשאי לראות
      await this.assertCallAccess(tx, id);
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

    /*
     * השער **לפני** ההעלאה, ולא אחריה. שני נימוקים, ושניהם אמיתיים:
     * צירוף הקלטה לשיחה שאינה שלי הוא כתיבה לכרטיס של עמית, ובקשה
     * שנדחית אחרי ההעלאה משאירה אובייקט ב-S3 שאף שורה אינה מצביעה
     * עליו — כלומר מסלולי המחיקה לא ימצאו אותו לעולם.
     */
    await this.prisma.withTenant((tx) => this.assertCallAccess(tx, id));

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
   * עוברת את אותו שער של שאר המערכת.
   *
   * ## למה RLS לבדו אינו מספיק כאן
   *
   * ‎`FORCE ROW LEVEL SECURITY`‎ מבודד **משרד ממשרד**, לא סוכן
   * מסוכן. שליפה לפי `{ id, tenantId }` בלבד הייתה מאפשרת לסוכן עם
   * `leads.view_own` להשמיע את שיחת הלקוח של סוכן אחר — ידיעת מזהה
   * אינה הרשאה, וזה בדיוק ה-IDOR הפנימי ש-`ownership.ts` נבנה נגדו
   * (ביקורת Codex).
   *
   * הבעלות נגזרת מאיש הקשר, כמו בכל שאר הישויות שאין להן בעלים
   * משלהן: `assertContactAccess` בודק אם הלקוח מופיע ככרטיס קונה,
   * כליד או כבעל נכס שהמשתמש רשאי לראות. שיחה שנרשמה ידנית בלי
   * איש קשר שייכת למי שרשם אותה.
   *
   * ## למה 404 ולמה בסדר הזה
   *
   * בדיקת הבעלות קודמת לבדיקת קיום ההקלטה, ושתיהן מחזירות 404
   * זהה. אחרת ההבדל בין „אין הקלטה” לבין „לא שלך” היה מסגיר לסוכן
   * אילו משיחות העמיתים שלו מוקלטות.
   */
  async recording(
    id: string,
  ): Promise<{ body: Readable; contentType: string; contentLength?: number }> {
    const key = await this.prisma.withTenant(async (tx) => {
      await this.assertCallAccess(tx, id);
      const row = await tx.call.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId },
        select: { recordingKey: true },
      });
      /*
       * שיחה בלי הקלטה אינה שגיאת שרת אלא מצב רגיל — רוב השיחות
       * אינן מוקלטות, והמסך צריך לדעת להבדיל בין "אין" ל"נכשל".
       */
      if (!row?.recordingKey) throw new NotFoundException("לשיחה אין הקלטה");
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
