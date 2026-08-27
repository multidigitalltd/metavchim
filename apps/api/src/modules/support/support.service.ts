import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  MAX_SUPPORT_SCREENSHOT_BYTES,
  SUPPORT_KIND_LABEL,
  sanitizeSupportContext,
  triageTicket,
  type SupportContext,
  type SupportKind,
  type SupportStatus,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { EmailService } from "../../core/email.service";
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

/** מה שהתמיכה רואה — כולל ההקשר הטכני ושם המשרד. */
export interface SupportTicketAdminDto extends SupportTicketDto {
  tenantId: string;
  tenantName: string;
  userEmail: string;
  context: SupportContext;
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
      select: { name: true, email: true },
    });

    await this.prisma.withTenant(async (tx) => {
      await tx.supportTicket.create({
        data: {
          id,
          tenantId,
          userId,
          userName: user?.name ?? "—",
          userEmail: user?.email ?? "—",
          kind: input.kind,
          message: input.message,
          area: triage.area,
          severity: triage.severity,
          context: context as object,
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
    void this.notifyDesk(id, input, triage.area, triage.hints, user?.email ?? "—");
    return { id };
  }

  /** התראה לכתובת התמיכה. כישלון נרשם ביומן ואינו נזרק למשתמש. */
  private async notifyDesk(
    id: string,
    input: { kind: SupportKind; message: string },
    area: string,
    hints: string[],
    from: string,
  ): Promise<void> {
    try {
      const to = await this.platformSettings.get("supportEmail");
      if (to === undefined || to === "") return;
      // גם ההתראה הפנימית — כדי ש„השב” עליה יגיע לתיבת התמיכה
      const sender = await this.inbox.outgoingSender();
      await this.email.send(
        to,
        `פנייה חדשה: ${SUPPORT_KIND_LABEL[input.kind]} · ${area}`,
        [
          `מאת: ${from}`,
          ...hints.map((h) => `• ${h}`),
          "",
          input.message,
          "",
          `מזהה הפנייה: ${id}`,
        ].join("\n"),
        sender === null ? {} : { sender },
      );
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
  async listForDesk(filter: { status?: SupportStatus }): Promise<SupportTicketAdminDto[]> {
    const rows = await this.prisma.withSupportDesk(async (tx) =>
      tx.supportTicket.findMany({
        where: filter.status === undefined ? {} : { status: filter.status },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
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
      context: (r.context ?? {}) as SupportContext,
    }));
  }

  /** עדכון סטטוס ו/או מענה. המענה נשלח גם במייל לפונה עצמו. */
  async respond(
    ticketId: string,
    input: { status?: SupportStatus; reply?: string },
  ): Promise<{ ok: true }> {
    const updated = await this.prisma.withSupportDesk(async (tx) => {
      const row = await tx.supportTicket.findFirst({ where: { id: ticketId } });
      if (!row) throw new NotFoundException("הפנייה לא נמצאה");
      const replied = input.reply !== undefined && input.reply !== "";
      /*
       * מענה מקדם מ"נפתחה" ל"בטיפול" מעצמו, אלא אם נבחר סטטוס אחר
       * במפורש. בלי זה כל פנייה שנענתה נשארה בתור הפתוח, והתור חדל
       * לשקף מה עוד ממתין — כלומר מפסיקים להסתכל עליו.
       */
      const status =
        input.status ?? (replied && row.status === "open" ? "in_progress" : undefined);
      return tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          ...(status === undefined ? {} : { status }),
          ...(replied ? { reply: input.reply, repliedAt: new Date() } : {}),
        },
      });
    });

    if (input.reply !== undefined && input.reply !== "") {
      try {
        /*
         * ‎**מכתובת התמיכה, ולא מ-`no-reply`.**
         *
         * זו תשובה שאדם כתב לאדם, והנמען עונה עליה — הוא לוחץ „השב”
         * בתיבה שלו. כשהיא יוצאת מהשולח הכללי התשובה שלו נוחתת
         * בתיבה שאיש אינו קורא, והשיחה נגמרת בלי שמישהו יידע. אותה
         * תשובה בדיוק **מהתיבה הנכנסת** כבר יצאה מהכתובת הנכונה,
         * וכאן היא לא — שני נתיבים לאותו דבר, ואחד מהם שקט.
         *
         * ריק = התיבה לא הוגדרה, וההתנהגות נשארת כשהייתה.
         */
        const sender = await this.inbox.outgoingSender();
        await this.email.send(
          updated.userEmail,
          "תשובה לפנייה שלך לתמיכה",
          input.reply,
          sender === null ? {} : { sender },
        );
      } catch (error) {
        // התשובה כבר שמורה ומוצגת במערכת; המייל הוא תזכורת, לא הערוץ
        this.logger.warn(`שליחת תשובת תמיכה נכשלה: ${(error as Error).message}`);
      }
    }
    return { ok: true };
  }

  private toDto(row: {
    id: string;
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
