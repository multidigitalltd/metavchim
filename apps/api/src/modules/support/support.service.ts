import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES,
  MAX_SUPPORT_SCREENSHOT_BYTES,
  SUPPORT_DESK_LIMIT,
  SUPPORT_KIND_LABEL,
  emailAttachmentKind,
  safeAttachmentName,
  sanitizeSupportContext,
  supportReplyEmail,
  supportReplySubject,
  triageTicket,
  waitingFirst,
  type SupportContext,
  type SupportKind,
  type SupportReplyContext,
  type SupportStatus,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { EmailRejectedError, EmailService } from "../../core/email.service";
import { PlatformAdminNotifierService } from "../../core/platform-admin-notifier.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { SupportInboxService } from "./support-inbox.service";

/**
 * פניות לתמיכה.
 *
 * הפנייה נשמרת ראשונה ובנפרד מהצילום. סדר הפעולות הזה נבחר בכוונה:
 * צילום מסך יכול להיכשל (דפדפן שלא תומך, משתמש שביטל, אחסון שלא
 * זמין), ופנייה שנעלמת בגלל תמונה היא בדיוק התסכול שהמערכת הזו באה
 * למנוע. מי שכתב "לא עובד לי" יקבל מענה גם בלי צילום.
 */

export interface SupportTicketDto {
  id: string;
  /** מספר הפנייה — רצף משותף עם הפניות שהגיעו במייל. */
  reference: number;
  kind: SupportKind;
  message: string;
  status: SupportStatus;
  area: string;
  severity: string;
  hasScreenshot: boolean;
  reply?: string;
  repliedAt?: string;
  createdAt: string;
  userName: string;
}

/** הודעה בשיחה — אותה צורה לשני מקורות הפניות. */
export interface SupportTicketMessageDto {
  id: string;
  direction: "in" | "out";
  body: string;
  /**
   * ‎`null` בהודעה נכנסת (אין מה לשלוח) ובתשובות שהיגרו מהעמודה
   * הישנה — שם באמת אין לנו ידיעה אם המייל יצא, ולסמן „נשלח” על
   * סמך כלום היה להנציח בדיוק את התקלה שהשדה הזה בא לחשוף.
   */
  sendState: "pending" | "sent" | "failed" | "unknown" | null;
  createdAt: string;
  attachments: { id: string; name: string; kind: string; sizeBytes: number }[];
}

/** שורה בתור של התמיכה — בלי השיחה. */
export interface SupportTicketListDto extends SupportTicketDto {
  tenantId: string;
  tenantName: string;
  userEmail: string;
  /** ריק כשלא היה טלפון בפרופיל — לא מקף שנראה כמו מספר. */
  userPhone: string | null;
  context: SupportContext;
}

/**
 * פנייה פתוחה על השולחן — כולל השיחה.
 *
 * השיחה אינה נטענת בתור אלא רק כאן: תור של מאה פניות היה מושך מאה
 * שיחות עם הצירופים שלהן, וזה בדיוק סוג העומס שהופך מסך לאיטי בלי
 * שאיש יידע למה.
 */
export interface SupportTicketAdminDto extends SupportTicketListDto {
  messages: SupportTicketMessageDto[];
}

/** זיהוי לפי Magic Bytes — ה-Content-Type של הדפדפן אינו גבול אמון. */
function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { ext: "png", mime: "image/png" };
  }
  if (
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly platformSettings: PlatformSettingsService,
    /*
     * לא בשביל התיבה הנכנסת, אלא בשביל **השולח**: כל מה שיוצא
     * מהתמיכה יוצא מאותה כתובת. ראו `outgoingSender`.
     */
    private readonly inbox: SupportInboxService,
    private readonly admins: PlatformAdminNotifierService,
  ) {}

  async create(input: {
    kind: SupportKind;
    message: string;
    context: SupportContext;
  }): Promise<{ id: string }> {
    const { tenantId, userId } = TenantContext.current();
    const context = sanitizeSupportContext(input.context);
    const triage = triageTicket(input.kind, context);
    const id = ulid();

    /*
     * שם המשתמש ואימיילו מצולמים לתוך הפנייה. `users` יושבת מחוץ
     * ל-RLS ואפשר לקרוא ממנה, אבל משתמש שיוסר מהמשרד היה הופך פנייה
     * פתוחה לאנונימית — והתמיכה עונה לבן אדם, לא למזהה.
     */
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, phone: true },
    });
    /*
     * ‎**גם הטלפון, ולא רק המייל.** תקלה חוסמת נסגרת בשיחה; בלי
     * המספר על הפנייה התמיכה נאלצה לחפש את המשתמש בנפרד, וזה החיכוך
     * שגורם להסתפק בשרשור מיילים. ריק = לא היה טלפון בפרופיל, וזה
     * מוצג ככה ולא כמקף שנראה כמו מספר חסר.
     */
    const phone = user?.phone?.trim() ?? "";

    await this.prisma.withTenant(async (tx) => {
      await tx.supportTicket.create({
        data: {
          id,
          tenantId,
          userId,
          userName: user?.name ?? "—",
          userEmail: user?.email ?? "—",
          ...(phone === "" ? {} : { userPhone: phone }),
          kind: input.kind,
          message: input.message,
          area: triage.area,
          severity: triage.severity,
          context: context as object,
        },
      });
      /*
       * ‎**מה שנכתב הוא ההודעה הראשונה בשיחה**, ולא רק שדה על
       * הפנייה. בלעדיה השיחה במסך מתחילה מהתשובה, והשאלה נעלמת —
       * וזו בדיוק המחצית שהתומך צריך כדי לענות.
       */
      await tx.supportTicketMessage.create({
        data: {
          id: ulid(),
          ticketId: id,
          tenantId,
          direction: "in",
          body: input.message,
          createdBy: userId,
        },
      });
      await this.audit.record(tx, {
        action: "support.ticket.create",
        entityType: "support_ticket",
        entityId: id,
        metadata: { kind: input.kind, area: triage.area, severity: triage.severity },
      });
    });

    // ההתראה אחרי השמירה ומחוץ לטרנזקציה: שרת דואר שנופל לא יבטל פנייה
    void this.notifyDesk(id, input, triage.area, triage.hints, user?.email ?? "—", phone);
    return { id };
  }

  /**
   * ‎**התראה לכל מנהלי הפלטפורמה — ולא לכתובת אחת.**
   *
   * עד עכשיו זה הלך ל-`supportEmail` בלבד, וכשהיא לא הייתה מוגדרת
   * — לאיש. כלומר פנייה יכלה לשבת על השולחן עד שמישהו יפתח את המסך
   * מיוזמתו. `PLATFORM_ADMIN_EMAILS` הוא מי שאחראי, והוא הרשימה
   * שאין דרך לשכוח למלא: בלעדיה גם מסך הפלטפורמה עצמו סגור.
   *
   * כתובת התמיכה נשארת נמענת — היא רק אינה **הנמענת היחידה**, ואם
   * היא ממילא אחת מכתובות המנהלים היא מקבלת עותק אחד.
   *
   * כישלון שליחה נרשם ביומן ואינו נזרק: הפנייה כבר נשמרה.
   */
  private async notifyDesk(
    id: string,
    input: { kind: SupportKind; message: string },
    area: string,
    hints: string[],
    from: string,
    phone: string,
  ): Promise<void> {
    try {
      const to = await this.platformSettings.get("supportEmail");
      // גם ההתראה הפנימית — כדי ש„השב” עליה יגיע לתיבת התמיכה
      const { sender, replyTo } = await this.inbox.outgoing();
      await this.admins.notify({
        subject: `פנייה חדשה: ${SUPPORT_KIND_LABEL[input.kind]} · ${area}`,
        heading: `פנייה חדשה מהמערכת · ${area}`,
        paragraphs: [
          // הטלפון בשורה הראשונה: תקלה חוסמת נסגרת בשיחה, לא בשרשור
          phone === "" ? `מאת: ${from}` : `מאת: ${from} · ${phone}`,
          ...hints.map((h) => `• ${h}`),
          input.message,
          `מזהה הפנייה: ${id}`,
        ],
        button: { label: "לשולחן התמיכה", url: this.admins.deskUrl() },
        also: [to],
        ...(sender === null ? {} : { sender }),
        ...(replyTo === null ? {} : { replyTo }),
      });
    } catch (error) {
      this.logger.warn(`התראת תמיכה נכשלה: ${(error as Error).message}`);
    }
  }

  /**
   * צירוף הצילום לפנייה קיימת.
   *
   * בקשה נפרדת ולא שדה בגוף ה-JSON: גבול גוף ה-JSON של השרת הוא
   * 2MB, וצילום מסך ב-base64 גדל ב-33% — כלומר פנייה שנשלחת ממסך
   * גדול הייתה נדחית ברמת ה-body parser, לפני שהקוד ראה אותה.
   */
  async attachScreenshot(ticketId: string, file: Buffer): Promise<{ ok: true }> {
    if (file.length === 0) throw new BadRequestException("לא הועלה קובץ");
    if (file.length > MAX_SUPPORT_SCREENSHOT_BYTES) {
      throw new BadRequestException("הצילום גדול מדי");
    }
    const kind = sniffImage(file);
    if (!kind) throw new BadRequestException("הקובץ אינו תמונה");

    const { tenantId } = TenantContext.current();
    const key = `support/${tenantId}/${ticketId}.${kind.ext}`;
    await this.prisma.withTenant(async (tx) => {
      const ticket = await tx.supportTicket.findFirst({
        where: { id: ticketId, tenantId },
        select: { id: true },
      });
      if (!ticket) throw new NotFoundException("הפנייה לא נמצאה");
      await this.storage.put(key, file, kind.mime, tenantId);
      await tx.supportTicket.update({ where: { id: ticketId }, data: { screenshotKey: key } });
    });
    return { ok: true };
  }

  /** הפניות של המשרד — כולן, גם של סוכנים אחרים: זה תיק המשרד. */
  async listMine(): Promise<SupportTicketDto[]> {
    const { tenantId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.supportTicket.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return rows.map((r) => this.toDto(r));
    });
  }

  async screenshot(
    ticketId: string,
    scope: { platform: boolean },
  ): Promise<{ body: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
    const key = scope.platform
      ? await this.prisma.withSupportDesk(async (tx) => {
          const row = await tx.supportTicket.findFirst({
            where: { id: ticketId },
            select: { screenshotKey: true },
          });
          return row?.screenshotKey ?? null;
        })
      : await this.prisma.withTenant(async (tx) => {
          const row = await tx.supportTicket.findFirst({
            where: { id: ticketId, tenantId: TenantContext.current().tenantId },
            select: { screenshotKey: true },
          });
          return row?.screenshotKey ?? null;
        });
    if (key === null) throw new NotFoundException("אין צילום מסך לפנייה הזו");
    try {
      return await this.storage.getObject(key);
    } catch (error) {
      /*
       * שורה שמצביעה על אובייקט שאיננו — 404 ולא 500. זה לא תרחיש
       * תיאורטי: פנייה בת שנה עשויה לחיות אחרי מדיניות שמירה
       * באחסון, ו-500 היה נראה כמו תקלה במערכת התמיכה עצמה.
       */
      if (StorageService.isMissingObjectError(error)) {
        throw new NotFoundException("צילום המסך אינו זמין יותר");
      }
      throw error;
    }
  }

  /* ---------------------------- שולחן התמיכה ---------------------------- */

  /**
   * תור הפניות של הפלטפורמה. הפתוחות קודם — ולא רק מיון לפי תאריך:
   * פנייה שנפתחה לפני שבוע וממתינה חשובה מפנייה שנסגרה אתמול.
   */
  async listForDesk(filter: { status?: SupportStatus }): Promise<SupportTicketListDto[]> {
    const rows = await this.prisma.withSupportDesk(async (tx) => {
      // סינון מפורש — המנהל ביקש מצב אחד, והגבול חותך בתוכו
      if (filter.status !== undefined) {
        return tx.supportTicket.findMany({
          where: { status: filter.status },
          orderBy: { createdAt: "desc" },
          take: SUPPORT_DESK_LIMIT,
        });
      }
      /*
       * ‎**התור המלא — הממתינות ראשונות, ורק אז מה שנסגר.**
       *
       * שאילתה אחת עם `take` הייתה נותנת למאה פניות סגורות חדשות
       * למחוק מהמסך פנייה פתוחה ישנה (ביקורת Codex). לא כשורה
       * מסומנת ולא במונה — פשוט לא הייתה שם.
       */
      return waitingFirst(
        (bucket, take) =>
          tx.supportTicket.findMany({
            where: bucket === "waiting" ? { status: { not: "closed" } } : { status: "closed" },
            orderBy: { createdAt: "desc" },
            take,
          }),
        SUPPORT_DESK_LIMIT,
      );
    });
    /*
     * שמות המשרדים בשאילתה אחת. `tenants` מחוץ ל-RLS, ובלי הקיבוץ
     * הזה תור של 100 פניות היה 100 שאילתות.
     */
    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((r) => ({
      ...this.toDto(r),
      tenantId: r.tenantId,
      tenantName: nameById.get(r.tenantId) ?? "—",
      userEmail: r.userEmail,
      userPhone: r.userPhone,
      context: (r.context ?? {}) as SupportContext,
    }));
  }

  /**
   * פנייה אחת לשולחן — מה שהתור צריך כדי לפתוח אותה.
   *
   * התור המאוחד מציג שורה אחת לכל פנייה, ופותח את הפרטים בלחיצה.
   * בלי הנתיב הזה הוא היה נאלץ למשוך את **כל** הרשימה רק כדי
   * להציג אחת — ואז לשמור אותה בזיכרון כדי שהפתיחה תהיה מיידית,
   * כלומר מצב שני שמתיישן.
   */
  async oneForDesk(ticketId: string): Promise<SupportTicketAdminDto> {
    const row = await this.prisma.withSupportDesk(async (tx) =>
      tx.supportTicket.findFirst({ where: { id: ticketId } }),
    );
    if (row === null) throw new NotFoundException("הפנייה לא נמצאה");
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: row.tenantId },
      select: { name: true },
    });
    return {
      ...this.toDto(row),
      tenantId: row.tenantId,
      tenantName: tenant?.name ?? "—",
      userEmail: row.userEmail,
      userPhone: row.userPhone,
      context: (row.context ?? {}) as SupportContext,
      messages: await this.messages(ticketId),
    };
  }

  /**
   * השיחה של פנייה אחת.
   *
   * ‎`uploadedAt: { not: null }` — צירוף שנתבע ולא הועלה אינו מוצג.
   * שורה בלי חותמת פירושה שההעלאה נקטעה, וקישור להורדה שלה מחזיר
   * שגיאה; עדיף שלא יופיע מלכתחילה.
   */
  private async messages(ticketId: string): Promise<SupportTicketMessageDto[]> {
    const rows = await this.prisma.withSupportDesk((tx) =>
      tx.supportTicketMessage.findMany({
        where: { ticketId },
        orderBy: { createdAt: "asc" },
        include: { attachments: { where: { uploadedAt: { not: null } } } },
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      direction: row.direction === "out" ? "out" : "in",
      body: row.body,
      sendState: (row.sendState ?? null) as SupportTicketMessageDto["sendState"],
      createdAt: row.createdAt.toISOString(),
      attachments: row.attachments.map((file) => ({
        id: file.id,
        name: file.name,
        kind: file.kind,
        sizeBytes: file.sizeBytes,
      })),
    }));
  }

  /**
   * צירוף בתשובת התמיכה — הבתים עצמם.
   *
   * נקרא דרך `withSupportDesk` כי הוא מוגש לשולחן; הנתיב חסום
   * מאחורי PlatformAdminGuard כמו כל שאר השולחן.
   */
  async replyAttachment(
    attachmentId: string,
  ): Promise<{ body: NodeJS.ReadableStream; contentType: string; name: string }> {
    const row = await this.prisma.withSupportDesk((tx) =>
      tx.supportTicketAttachment.findFirst({
        where: { id: attachmentId, uploadedAt: { not: null } },
      }),
    );
    if (row === null) throw new NotFoundException("הצירוף לא נמצא");
    try {
      const object = await this.storage.getObject(row.s3Key);
      return { body: object.body, contentType: row.contentType, name: row.name };
    } catch (error) {
      // אותו כלל של צילום המסך: שורה שמצביעה על אובייקט שאיננו היא 404
      if (StorageService.isMissingObjectError(error)) {
        throw new NotFoundException("הצירוף אינו זמין יותר");
      }
      throw error;
    }
  }

  /** עדכון סטטוס ו/או מענה. המענה נשלח גם במייל לפונה עצמו. */
  /**
   * מענה לפנייה מהכפתור.
   *
   * ## מה היה שבור, ולמה זה לא נראה
   *
   * השליחה הייתה עטופה ב-`catch` שרשם אזהרה ליומן והמשיך, עם הערה
   * שאמרה „המייל הוא תזכורת, לא הערוץ”. הנימוק היה סביר כשהמשרד
   * ראה את התשובה גם במערכת — אבל התוצאה בפועל הייתה שהמסך הציג
   * ‎„נענה” על מייל שנדחה, ואיש לא ידע. ספק שמפסיק לקבל את כתובת
   * השולח מפסיק להעביר תשובות, והשולחן ממשיך להיראות תקין.
   *
   * עכשיו זה עובד כמו במסלול המייל, ומאותו נימוק בדיוק: השורה
   * נכתבת לפני השליחה ומסומנת אחריה. דחייה ודאית נזרקת אל המסך;
   * תוצאה עמומה (פסק זמן, 5xx) נשמרת כ-`unknown`, כי ייתכן שהפונה
   * כן קיבל — וסימון הכול ככישלון מזמין שליחה כפולה.
   *
   * ## התשובה נושאת את השאלה
   *
   * הנוסח היה „תשובה לפנייה שלך לתמיכה” ובגוף רק מה שהתומך הקליד.
   * ‎`supportReplyEmail` בונה במקומו נושא עם מספר הפנייה וגוף שמצטט
   * את מה שנשאל — ראו שם.
   */
  async respond(
    ticketId: string,
    input: {
      status?: SupportStatus;
      reply?: string;
      files?: { buffer: Buffer; originalname: string; mimetype: string; size: number }[];
    },
  ): Promise<{ ok: true; state?: "sent" | "unknown" }> {
    const replyBody = (input.reply ?? "").trim();
    const files = input.files ?? [];
    const attachments = files.map((file) => {
      const kind = emailAttachmentKind(file.mimetype);
      if (kind === null) throw new BadRequestException(`סוג קובץ שאינו נתמך: ${file.originalname}`);
      return {
        name: safeAttachmentName(file.originalname),
        contentType: file.mimetype.split(";")[0]?.trim().toLowerCase() ?? "",
        content: file.buffer,
        kind,
      };
    });
    const total = attachments.reduce((sum, file) => sum + file.content.length, 0);
    if (total > EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES) {
      throw new BadRequestException("הקבצים כבדים מדי לשליחה במייל (עד 7MB בהודעה)");
    }

    const replied = replyBody !== "" || attachments.length > 0;
    const ticket = await this.prisma.withSupportDesk(async (tx) => {
      const row = await tx.supportTicket.findFirst({ where: { id: ticketId } });
      if (!row) throw new NotFoundException("הפנייה לא נמצאה");
      return row;
    });

    /*
     * ‎**סטטוס בלי מענה מוחל מיד** — זה הנתיב של „סמן: נסגרה”
     * מהתור, ואין בו שליחה שאפשר להיכשל בה.
     */
    if (!replied) {
      if (input.status !== undefined) {
        await this.prisma.withSupportDesk((tx) =>
          tx.supportTicket.update({ where: { id: ticketId }, data: { status: input.status! } }),
        );
      }
      return { ok: true };
    }

    /*
     * ‎**השורה נכתבת לפני השליחה, ומאושרת אחריה** — אותו סדר כמו
     * בשרשורי המייל. כשהסדר הפוך והכתיבה נופלת, הפונה כבר קיבל
     * תשובה שאין לה זכר בשיחה.
     */
    const messageId = ulid();
    await this.prisma.withSupportDesk((tx) =>
      tx.supportTicketMessage.create({
        data: {
          id: messageId,
          ticketId,
          tenantId: ticket.tenantId,
          direction: "out",
          body: replyBody,
          sendState: "pending",
          createdBy: TenantContext.current().userId,
        },
      }),
    );

    if (attachments.length > 0) {
      await this.storeReplyAttachments(messageId, ticket.tenantId, attachments);
    }

    const context: SupportReplyContext = {
      reference: ticket.reference,
      original: ticket.message,
      openedAt: ticket.createdAt,
      kind: ticket.kind as SupportKind,
      ...(typeof (ticket.context as { path?: unknown } | null)?.path === "string"
        ? { screen: (ticket.context as { path: string }).path }
        : {}),
    };

    let state: "sent" | "unknown" = "sent";
    try {
      const { sender, replyTo } = await this.inbox.outgoing();
      await this.email.send(
        ticket.userEmail,
        supportReplySubject(context),
        supportReplyEmail({ body: replyBody, context }),
        {
          /*
           * ‎`required` — **זה כל השינוי.** בלעדיו דחייה של הספק
           * נבלעת, והמסך מדווח „נענה” על מייל שלא יצא.
           */
          required: true,
          ...(sender === null ? {} : { sender }),
          ...(replyTo === null ? {} : { replyTo }),
          ...(attachments.length > 0
            ? {
                attachments: attachments.map(({ name, contentType, content }) => ({
                  name,
                  contentType,
                  content,
                })),
              }
            : {}),
        },
      );
    } catch (error: unknown) {
      /*
       * ‎**„נכשלה” רק כשידוע שלא יצאה.** דחייה של הספק היא ודאות;
       * פסק זמן ו-5xx אינם, וייתכן שהפונה כן קיבל.
       */
      const certainlyNotSent = error instanceof EmailRejectedError;
      await this.prisma
        .withSupportDesk((tx) =>
          tx.supportTicketMessage.update({
            where: { id: messageId },
            data: { sendState: certainlyNotSent ? "failed" : "unknown" },
          }),
        )
        .catch(() => this.logger.error(`סימון מצב תשובת תמיכה נכשל: ${messageId}`));
      if (certainlyNotSent) throw error;
      state = "unknown";
      this.logger.warn(`תשובת תמיכה הסתיימה בתוצאה עמומה: ${messageId} — ${String(error)}`);
    }

    /*
     * ‎**הסטטוס מוחל רק אחרי שהשליחה הצליחה.**
     *
     * הוא נכתב קודם בטרנזקציה נפרדת, לפני האחסון והשליחה. „שליחה
     * וסגירה” שנדחתה על ידי הספק הותירה פנייה **סגורה** שהלקוח לא
     * קיבל עליה דבר — היא נשרה מתור הממתינות, וזו בדיוק ההיעלמות
     * השקטה שה-PR הזה בא לסגור, רק דרך אחרת (ביקורת Codex).
     *
     * דחייה ודאית זורקת למעלה לפני השורה הזו, ולכן הסטטוס נשאר
     * כשהיה והפנייה נשארת בתור. תוצאה עמומה כן מחילה אותו: ייתכן
     * שהפונה קיבל, והשארת הפנייה פתוחה על סמך ספק מזמינה מענה כפול.
     */
    const promoted =
      input.status ?? (ticket.status === "open" ? "in_progress" : undefined);
    await this.prisma
      .withSupportDesk(async (tx) => {
        if (state === "sent") {
          await tx.supportTicketMessage.update({
            where: { id: messageId },
            data: { sendState: "sent" },
          });
        }
        /*
         * ‎`reply` ו-`repliedAt` נשמרים מסונכרנים עם ההודעה
         * האחרונה. הם אינם מקור האמת יותר, אבל מסכים וקוראים
         * קיימים נשענים עליהם — והשארתם מיושנים הייתה מציגה למשרד
         * תשובה ישנה לצד חדשה.
         */
        await tx.supportTicket.update({
          where: { id: ticketId },
          data: {
            reply: replyBody.slice(0, 2000),
            repliedAt: new Date(),
            ...(promoted === undefined ? {} : { status: promoted }),
          },
        });
      })
      // המייל כבר יצא; כשל כאן הוא כשל בתיעוד ולא בשליחה
      .catch(() => this.logger.error(`אישור שליחת תשובת תמיכה נכשל: ${messageId}`));

    return { ok: true, state };
  }

  /**
   * צירופים על תשובת התמיכה — אותה מכניקה של שרשורי המייל.
   *
   * השורה נתבעת לפני ההעלאה ו-`uploadedAt` נכתב אחריה: קיום השורה
   * אינו מעיד שהאובייקט קיים, ולכן צירוף שטרם הועלה אינו מוצג.
   * ‎`ordinal` הוא מה שהופך את המפתח לדטרמיניסטי — שני ניסיונות
   * מקבילים מחשבים אותו מפתח ולא שני עותקים.
   */
  private async storeReplyAttachments(
    messageId: string,
    tenantId: string,
    attachments: { name: string; contentType: string; content: Buffer; kind: string }[],
  ): Promise<void> {
    const rows = attachments.map((attachment, ordinal) => ({
      id: ulid(),
      messageId,
      tenantId,
      ordinal,
      kind: attachment.kind,
      name: attachment.name,
      contentType: attachment.contentType,
      sizeBytes: attachment.content.length,
      s3Key: `support/tickets/${messageId}/${ordinal}`,
    }));
    await this.prisma.withSupportDesk((tx) =>
      tx.supportTicketAttachment.createMany({ data: rows, skipDuplicates: true }),
    );
    for (const [index, attachment] of attachments.entries()) {
      const row = rows[index]!;
      await this.storage.put(row.s3Key, attachment.content, attachment.contentType, tenantId);
      await this.prisma.withSupportDesk((tx) =>
        tx.supportTicketAttachment.updateMany({
          where: { messageId, ordinal: index },
          data: { uploadedAt: new Date() },
        }),
      );
    }
  }

  private toDto(row: {
    id: string;
    reference: number;
    kind: string;
    message: string;
    status: string;
    area: string;
    severity: string;
    screenshotKey: string | null;
    reply: string | null;
    repliedAt: Date | null;
    createdAt: Date;
    userName: string;
  }): SupportTicketDto {
    return {
      id: row.id,
      reference: row.reference,
      kind: row.kind as SupportKind,
      message: row.message,
      status: row.status as SupportStatus,
      area: row.area,
      severity: row.severity,
      hasScreenshot: row.screenshotKey !== null,
      ...(row.reply === null ? {} : { reply: row.reply }),
      ...(row.repliedAt === null ? {} : { repliedAt: row.repliedAt.toISOString() }),
      createdAt: row.createdAt.toISOString(),
      userName: row.userName,
    };
  }
}
