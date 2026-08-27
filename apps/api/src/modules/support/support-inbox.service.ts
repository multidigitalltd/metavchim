import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ATTACHMENT_MAX_COUNT,
  EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES,
  emailAttachmentKind,
  inboundBody,
  inboundToken,
  parseSenderEmail,
  parseSenderName,
  replyAddressFor,
  safeAttachmentName,
  supportReplyRejectionReason,
  supportSubjectOrDefault,
  type InboundEmailPayload,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";

/**
 * תיבת התמיכה של הפלטפורמה.
 *
 * ## מה זה פותר
 *
 * לכתובת התמיכה לא הייתה תיבה: פנייה במייל הגיעה לאיזושהי תיבה
 * פרטית, והתשובה יצאה משם — בלי היסטוריה, בלי שיוך למשרד, ובלי
 * שאיש אחר יכול לראות מה נענה. פניות מכפתור התמיכה שבתוך המערכת
 * ישבו במקום אחר לגמרי. שני תורים לאותה עבודה.
 *
 * ## ההבדל מתיבת המשרד
 *
 * תיבת המשרד קולטת **תשובות** למיילים שאנחנו שלחנו, וכל הודעה בה
 * נושאת טוקן שאנחנו שתלנו. כאן הפנייה הראשונה מגיעה בלי טוקן, וזו
 * כל מהותה של כתובת תמיכה: מי שכותב אינו בהכרח לקוח, ואי אפשר
 * לבלוע הודעה רק מפני שאיננו מזהים אותה.
 *
 * לכן השרשור נקבע בשתי דרגות: **טוקן אם יש** (תשובה לתשובה שלנו),
 * ואחרת **כתובת השולח** — פנייה חוזרת מאותו אדם מצטרפת לשרשור
 * הפתוח שלו במקום לפתוח שלישי.
 *
 * ## גבול אמון
 *
 * כל שדה בהודעה נכנסת נכתב על ידי מי ששלח אותה. הכתובת מנורמלת
 * ונבדקת בצורתה, הנושא נחתך, הגוף נחתך, והקבצים עוברים את אותה
 * רשימת סוגים סגורה כמו בתיבת המשרד. מה שלא עובר — נזרק בשקט,
 * בדיוק כמו שם.
 */

/** גוף הודעה נשמר עד הגבול הזה. פנייה ארוכה מזה נחתכת ולא נדחית. */
const BODY_MAX = 20_000;

@Injectable()
export class SupportInboxService {
  private readonly logger = new Logger(SupportInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** כתובת ה-Inbound של תיבת התמיכה, והסוד שבנתיב ה-Webhook. */
  private async config(): Promise<{ address: string; secret: string } | null> {
    const env = loadEnv();
    const address =
      (await this.settings.get("supportInboundAddress")) ?? env.SUPPORT_INBOUND_ADDRESS ?? "";
    const secret =
      (await this.settings.get("supportInboundSecret")) ?? env.SUPPORT_INBOUND_SECRET ?? "";
    if (address === "" || secret === "") return null;
    return { address, secret };
  }

  async webhookSecret(): Promise<string | null> {
    return (await this.config())?.secret ?? null;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.config()) !== null;
  }

  /**
   * קליטת פנייה נכנסת.
   *
   * לעולם אינה זורקת החוצה: הנתיב הציבורי מחזיר תמיד 200, כי ספק
   * הדואר חוזר על הודעה שלא נענתה וניסיון חוזר על פנייה שכבר נקלטה
   * הוא רעש. הדה-דופליקציה נשענת על `provider_message_id`.
   */
  async processInbound(payload: InboundEmailPayload): Promise<void> {
    const body = inboundBody(payload).slice(0, BODY_MAX);
    const incoming = payload.Attachments.slice(0, EMAIL_ATTACHMENT_MAX_COUNT)
      .map((attachment) => {
        const kind = emailAttachmentKind(attachment.ContentType);
        if (kind === null || attachment.Content === "") return null;
        const content = Buffer.from(attachment.Content, "base64");
        if (content.length === 0 || content.length > EMAIL_ATTACHMENT_MAX_BYTES) return null;
        return {
          kind,
          content,
          name: safeAttachmentName(attachment.Name),
          contentType: attachment.ContentType.split(";")[0]?.trim().toLowerCase() ?? "",
        };
      })
      .filter((attachment): attachment is NonNullable<typeof attachment> => attachment !== null);

    // פנייה שכולה קובץ ("מצרף צילום מסך") אינה ריקה
    if (body === "" && incoming.length === 0) return;

    const senderEmail = parseSenderEmail(payload.From ?? "");
    const senderName = parseSenderName(payload.From ?? "", senderEmail);
    const subject = supportSubjectOrDefault(payload.Subject);
    const token = inboundToken(payload);

    const thread = await this.resolveThread({ token, senderEmail, senderName, subject });
    if (thread === null) return;

    const messageId = ulid();
    try {
      await this.prisma.supportMessage.create({
        data: {
          id: messageId,
          threadId: thread.id,
          direction: "in",
          body,
          fromEmail: senderEmail,
          providerMessageId: payload.MessageID ?? null,
        },
      });
    } catch (error) {
      // אותה הודעה פעמיים (הספק שולח שוב על 5xx) — לא תקלה
      if ((error as { code?: string }).code === "P2002") return;
      throw error;
    }

    /*
     * הקבצים נשמרים **אחרי** ההודעה ולא בטרנזקציה אחת איתה: העלאה
     * לאחסון היא קריאת רשת, וטרנזקציה שמחזיקה חיבור למסד לאורכה היא
     * בדיוק מה שנועל את המסד כשספק האחסון מאט. קובץ שנכשל מדולג —
     * הפנייה עצמה כבר נקלטה, וזה מה שחשוב.
     */
    for (const attachment of incoming) {
      const attachmentId = ulid();
      const s3Key = `support/${thread.id}/${messageId}/${attachmentId}`;
      try {
        await this.storage.put(s3Key, attachment.content, attachment.contentType);
        await this.prisma.supportAttachment.create({
          data: {
            id: attachmentId,
            messageId,
            kind: attachment.kind,
            name: attachment.name,
            contentType: attachment.contentType,
            sizeBytes: attachment.content.length,
            s3Key,
          },
        });
      } catch (error) {
        this.logger.error(`שמירת קובץ בפניית תמיכה נכשלה: ${String(error)}`);
      }
    }

    await this.prisma.supportThread.update({
      where: { id: thread.id },
      // פנייה חדשה פותחת מחדש שרשור סגור — הפונה חזר, והוא מחכה
      data: { lastMessageAt: new Date(), readAt: null, status: "open" },
    });
    this.logger.log(`פניית תמיכה נקלטה: ${thread.id}`);
  }

  /**
   * לאיזה שרשור ההודעה שייכת — טוקן, ואחרת כתובת השולח.
   *
   * שיוך למשרד נעשה כאן, לפי כתובת השולח: פנייה ממשתמש מוכר נקשרת
   * למשרד שלו, וזה מה שמאפשר לתמיכה לדעת עם מי היא מדברת בלי לשאול.
   * מי שאינו מוכר מקבל שרשור בלי משרד — לא דחייה.
   */
  private async resolveThread(input: {
    token: string | null;
    senderEmail: string | null;
    senderName: string;
    subject: string;
  }): Promise<{ id: string } | null> {
    if (input.token !== null) {
      const byToken = await this.prisma.supportThread.findUnique({
        where: { replyToken: input.token },
        select: { id: true },
      });
      if (byToken !== null) return byToken;
      // טוקן לא מוכר אינו סיבה לזרוק פנייה — ממשיכים לשרשור לפי שולח
      this.logger.warn("פניית תמיכה עם טוקן לא מוכר — משויכת לפי כתובת השולח");
    }

    if (input.senderEmail !== null) {
      const open = await this.prisma.supportThread.findFirst({
        where: { contactEmail: input.senderEmail, status: "open" },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });
      if (open !== null) return open;
    }

    const tenantId =
      input.senderEmail === null
        ? null
        : ((
            await this.prisma.user.findFirst({
              where: { email: input.senderEmail, isActive: true },
              select: { tenantId: true },
            })
          )?.tenantId ?? null);

    const id = ulid();
    await this.prisma.supportThread.create({
      data: {
        id,
        replyToken: ulid(),
        tenantId,
        contactEmail: input.senderEmail,
        contactName: input.senderName,
        subject: input.subject,
      },
    });
    return { id };
  }

  /** רשימת השרשורים לשולחן התמיכה — מי מחכה, לפי הסדר. */
  async threads(): Promise<
    {
      id: string;
      subject: string;
      contactName: string;
      contactEmail: string | null;
      tenantId: string | null;
      tenantName: string | null;
      status: string;
      unread: boolean;
      lastMessageAt: Date;
    }[]
  > {
    const rows = await this.prisma.supportThread.findMany({
      orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }],
      take: 100,
      select: {
        id: true,
        subject: true,
        contactName: true,
        contactEmail: true,
        tenantId: true,
        status: true,
        readAt: true,
        lastMessageAt: true,
      },
    });
    const tenantIds = [...new Set(rows.map((row) => row.tenantId).filter((id) => id !== null))];
    const tenants =
      tenantIds.length > 0
        ? await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    return rows.map(({ readAt, ...row }) => ({
      ...row,
      tenantName: row.tenantId === null ? null : (nameById.get(row.tenantId) ?? null),
      unread: readAt === null,
    }));
  }

  /** שרשור אחד — ההודעות לפי סדר, וסימונו כנקרא. */
  async thread(threadId: string): Promise<{
    id: string;
    subject: string;
    contactName: string;
    contactEmail: string | null;
    tenantName: string | null;
    status: string;
    messages: {
      id: string;
      direction: string;
      body: string;
      createdAt: Date;
      attachments: { id: string; name: string; kind: string; sizeBytes: number }[];
    }[];
  }> {
    const row = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: 200,
          include: {
            attachments: { select: { id: true, name: true, kind: true, sizeBytes: true } },
          },
        },
      },
    });
    if (row === null) throw new NotFoundException("הפנייה לא נמצאה");

    const tenant =
      row.tenantId === null
        ? null
        : await this.prisma.tenant.findUnique({
            where: { id: row.tenantId },
            select: { name: true },
          });

    // סימון כנקרא בקריאה עצמה: פתיחת פנייה היא בדיוק "ראיתי אותה"
    await this.prisma.supportThread.update({
      where: { id: threadId },
      data: { readAt: new Date() },
    });

    return {
      id: row.id,
      subject: row.subject,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      tenantName: tenant?.name ?? null,
      status: row.status,
      messages: row.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        createdAt: message.createdAt,
        attachments: message.attachments,
      })),
    };
  }

  /**
   * תשובת התמיכה — יוצאת מכתובת המערכת, וחוזרת לאותו שרשור.
   *
   * ה-Reply-To נושא את הטוקן של השרשור, ולכן תשובת הפונה נכנסת
   * לכאן ולא פותחת פנייה חדשה. בלי כתובת Inbound מוגדרת התשובה
   * עדיין נשלחת — היא פשוט תחזור לתיבה שממנה שולחים.
   */
  async reply(
    threadId: string,
    body: string,
    files: { buffer: Buffer; originalname: string; mimetype: string; size: number }[] = [],
  ): Promise<{ ok: true }> {
    const thread = await this.prisma.supportThread.findUnique({ where: { id: threadId } });
    if (thread === null) throw new NotFoundException("הפנייה לא נמצאה");
    const rejection = supportReplyRejectionReason(thread);
    if (rejection !== null) throw new BadRequestException(rejection);

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
    if (body.trim() === "" && attachments.length === 0) {
      throw new BadRequestException("אין מה לשלוח");
    }

    const config = await this.config();
    /*
     * `replyAddressFor` מחזירה `null` כשהכתובת ארוכה מדי לתקן —
     * ואז התשובה נשלחת בלי Reply-To ייחודי, וממשיכה לעבוד.
     */
    const replyTo = config === null ? null : replyAddressFor(config.address, thread.replyToken);

    await this.email.send(
      thread.contactEmail!,
      thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
      {
        heading: "תשובה מהתמיכה",
        paragraphs: body.trim() === "" ? ["מצורף:"] : body.trim().split("\n").filter(Boolean),
      },
      {
        required: true,
        ...(replyTo !== null ? { replyTo } : {}),
        ...(attachments.length > 0
          ? { attachments: attachments.map(({ name, contentType, content }) => ({ name, contentType, content })) }
          : {}),
      },
    );

    const messageId = ulid();
    await this.prisma.supportMessage.create({
      data: {
        id: messageId,
        threadId,
        direction: "out",
        body: body.trim().slice(0, BODY_MAX),
        createdBy: TenantContext.current().userId,
      },
    });

    for (const attachment of attachments) {
      const attachmentId = ulid();
      const s3Key = `support/${threadId}/${messageId}/${attachmentId}`;
      try {
        await this.storage.put(s3Key, attachment.content, attachment.contentType);
        await this.prisma.supportAttachment.create({
          data: {
            id: attachmentId,
            messageId,
            kind: attachment.kind,
            name: attachment.name,
            contentType: attachment.contentType,
            sizeBytes: attachment.content.length,
            s3Key,
          },
        });
      } catch (error) {
        // המייל כבר יצא — כישלון שמירה כאן אינו הופך אותו ללא-נשלח
        this.logger.error(`שמירת עותק הקובץ בתשובת תמיכה נכשלה: ${String(error)}`);
      }
    }

    await this.prisma.supportThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date(), readAt: new Date() },
    });
    return { ok: true };
  }

  /** סגירה ופתיחה מחדש — הסטטוס הוא מה שמסדר את הרשימה. */
  async setStatus(threadId: string, status: "open" | "closed"): Promise<{ ok: true }> {
    await this.prisma.supportThread.update({ where: { id: threadId }, data: { status } });
    return { ok: true };
  }

  /** הזרמת קובץ מצורף — דרך ה-API, לא ישירות מהאחסון. */
  async attachmentRaw(attachmentId: string): Promise<{
    body: NodeJS.ReadableStream;
    contentType: string;
    contentLength?: number;
    name: string;
    kind: string;
  }> {
    const row = await this.prisma.supportAttachment.findUnique({
      where: { id: attachmentId },
      select: { s3Key: true, contentType: true, name: true, kind: true },
    });
    if (row === null) throw new NotFoundException("הקובץ לא נמצא");
    const object = await this.storage.getObject(row.s3Key);
    return {
      body: object.body as NodeJS.ReadableStream,
      // הסוג שנקבע בקליטה, לא מה שהאחסון זוכר
      contentType: row.contentType,
      ...(object.contentLength !== undefined ? { contentLength: object.contentLength } : {}),
      name: row.name,
      kind: row.kind,
    };
  }
}
