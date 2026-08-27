import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ATTACHMENT_MAX_COUNT,
  EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES,
  emailAttachmentKind,
  inboundBody,
  inboundSubject,
  inboundToken,
  replyAddressFor,
  safeAttachmentName,
  type InboundEmailPayload,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { EmailService } from "../../core/email.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { ContactsService } from "../contacts/contacts.service";

/** שורת תיבה — שיחה אחת עם לקוח, בתמצית. */
export interface InboxThreadDto {
  contactId: string;
  contactName: string;
  lastSubject: string;
  lastSnippet: string;
  lastDirection: string;
  lastAt: Date;
  unread: number;
  /** מזהה הקונה — קישור לכרטיס, כשקיים. */
  buyerId?: string;
}

export interface InboxAttachmentDto {
  id: string;
  name: string;
  /** image | video | file — המסך בוחר תצוגה לפיו */
  kind: string;
  contentType: string;
  sizeBytes: number;
}

export interface InboxMessageDto {
  id: string;
  direction: string;
  subject: string;
  body: string;
  fromEmail?: string;
  readAt: Date | null;
  createdAt: Date;
  attachments: InboxAttachmentDto[];
}

/**
 * תיבת הדואר הפנימית — תשובות של לקוחות נכנסות למערכת.
 *
 * ## הזרימה
 *
 * מייל שהמערכת שולחת ללקוח (הצעה, הסכם) נושא Reply-To ייחודי:
 * `local+<token>@inbound`. הלקוח לוחץ "השב" כרגיל; התשובה מגיעה
 * לספק, נדחפת אלינו כ-Webhook, והטוקן מזהה את המשרד ואת הלקוח.
 * ההודעה נכנסת לתיבה, לציר הלקוח, ולסוכן האחראי יוצאת התראה.
 * הסוכן עונה **מתוך המערכת** — מאותה סיבה שתשובת Gmail נשלחת
 * מהכרטיס: התיעוד. גם התשובה נושאת Reply-To, והשיחה ממשיכה.
 *
 * ## למה לא MX על הדומיין של המשרד
 *
 * רשומת MX הייתה מנתבת אלינו את *כל* הדואר של המשרד — כולל התיבות
 * הקיימות שלו ב-Google/Outlook — ותקלה אחת הייתה משביתה משרד שלם.
 * ‏Reply-To נוגע רק בתשובות למיילים שהמערכת שלחה, לא דורש DNS,
 * ועובד גם למשרד שלא חיבר דומיין.
 *
 * ## גבול אמון
 *
 * כל שדה בהודעה נכנסת — כולל הטוקן — ניתן לזיוף על ידי כל שולח
 * בעולם. הטוקן הוא **מפתח חיפוש** בלבד: צורה לא-חוקית מדולגת,
 * וטוקן לא-מוכר נבלע בשקט (200 — הספק לא ינסה שוב לנצח). התיבה
 * היא תיבת דואר: מציגים מה שהגיע, לא סומכים עליו.
 */
@Injectable()
export class EmailInboxService {
  private readonly logger = new Logger(EmailInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly contacts: ContactsService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** כתובת ה-Inbound והסוד — הגדרות הפלטפורמה קודם, סביבה אחריהן. */
  async inboundConfig(): Promise<{ address: string; secret: string } | null> {
    const env = loadEnv();
    const address =
      (await this.platformSettings.get("emailInboundAddress")) ?? env.EMAIL_INBOUND_ADDRESS;
    const secret =
      (await this.platformSettings.get("emailInboundSecret")) ?? env.EMAIL_INBOUND_SECRET;
    return address && secret ? { address, secret } : null;
  }

  /**
   * כתובת ה-Reply-To ללקוח — טוקן קיים או חדש. `null` = התיבה
   * אינה מוגדרת בפלטפורמה, והמייל יוצא בלי Reply-To כמו תמיד.
   *
   * הטבלה מחוץ ל-RLS (כמו lead_webhooks) — והכתיבה כאן היא בדיוק
   * הסיבה שהמזהים באים תמיד מהשורה שבגינה נשלח המייל, לא מקלט.
   */
  async replyAddressFor(tenantId: string, contactId: string): Promise<string | null> {
    const config = await this.inboundConfig();
    if (config === null) return null;
    /*
     * לכרטיס יכולים להיות כמה טוקנים — מיזוג כפילויות מעביר את
     * הטוקנים של הכפיל לשורד, וכולם ממשיכים לפעול. שליחה חדשה
     * משתמשת בוותיק שבהם; מרוץ בין שתי שליחות מנפיק שניים, ושניהם
     * תקפים — כפילות כאן זולה מהתנגשות.
     */
    const existing = await this.prisma.emailReplyToken.findFirst({
      where: { tenantId, contactId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (existing !== null) return replyAddressFor(config.address, existing.id);
    const id = ulid();
    await this.prisma.emailReplyToken.create({ data: { id, tenantId, contactId } });
    return replyAddressFor(config.address, id);
  }

  /**
   * קליטת Webhook נכנס. מחזירה תמיד בשקט: תשובת שגיאה הייתה גורמת
   * לספק לנסות שוב ושוב הודעה שלעולם לא תיקלט.
   */
  async processInbound(payload: InboundEmailPayload): Promise<void> {
    const token = inboundToken(payload);
    if (token === null) return;
    const mapping = await this.prisma.emailReplyToken.findUnique({
      where: { id: token },
      select: { tenantId: true, contactId: true },
    });
    if (mapping === null) {
      this.logger.warn("תשובת אימייל עם טוקן לא מוכר — דולגה");
      return;
    }

    /*
     * קבצים מצורפים — סינון מוקדם, לפני כל כתיבה: רק סוגים מהרשימה
     * הסגורה, עד הגבולות. הודעה יכולה להיות קובץ בלבד ("שלחתי לך
     * את האישור") — ולכן גוף ריק עם קבצים תקפים אינו דילוג.
     */
    const body = inboundBody(payload);
    const incoming = payload.Attachments.slice(0, EMAIL_ATTACHMENT_MAX_COUNT)
      .map((a) => {
        const kind = emailAttachmentKind(a.ContentType);
        if (kind === null || a.Content === "") return null;
        const content = Buffer.from(a.Content, "base64");
        if (content.length === 0 || content.length > EMAIL_ATTACHMENT_MAX_BYTES) return null;
        return {
          kind,
          content,
          name: safeAttachmentName(a.Name),
          contentType: a.ContentType.split(";")[0]?.trim().toLowerCase() ?? "",
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
    if (payload.Attachments.length > incoming.length) {
      this.logger.log(
        `תשובת מייל: ${payload.Attachments.length - incoming.length} קבצים דולגו (סוג/גודל)`,
      );
    }
    if (body === "" && incoming.length === 0) return; // אין תוכן — אין מה להציג

    const { tenantId, contactId } = mapping;
    const stored = await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      // הכרטיס עשוי להימחק אחרי שהטוקן הונפק — תשובה יתומה מדולגת
      const contact = await tx.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true },
      });
      if (contact === null) return null;

      const id = ulid();
      try {
        await tx.emailMessage.create({
          data: {
            id,
            tenantId,
            contactId,
            direction: "in",
            subject: inboundSubject(payload),
            body,
            fromEmail: payload.From.slice(0, 320) || null,
            providerMessageId: payload.MessageID === "" ? null : payload.MessageID,
          },
        });
      } catch {
        // אותו MessageID פעם שנייה — הספק שלח שוב; ההודעה כבר אצלנו
        return null;
      }

      /*
       * ציר הלקוח והתראה — "כלום לא נשכח". ההודעה המלאה בתיבה;
       * לציר נכנסת תמצית. אינטראקציה חייבת הורה (קונה או ליד) —
       * לקוח בלי שניהם נשאר עם ההודעה בתיבה בלבד.
       */
      const buyer = await tx.buyer.findFirst({
        where: { tenantId, contactId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, ownerUserId: true },
      });
      const lead =
        buyer === null
          ? await tx.lead.findFirst({
              where: { tenantId, contactId },
              orderBy: { createdAt: "desc" },
              select: { id: true, assignedToUserId: true },
            })
          : null;
      const snippet =
        body === ""
          ? `📎 ${incoming.length} קבצים מצורפים`
          : body.length > 120
            ? `${body.slice(0, 120)}…`
            : body;
      if (buyer !== null || lead !== null) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId,
            ...(buyer !== null ? { buyerId: buyer.id } : { leadId: lead?.id }),
            kind: "system",
            direction: "in",
            content: `📧 תשובה במייל: ${snippet}`,
            createdBy: null,
          },
        });
      }
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId,
          // הסוכן האחראי; אין כזה — כל המשרד רואה
          userId: buyer?.ownerUserId ?? lead?.assignedToUserId ?? null,
          type: "email_reply",
          title: "📧 לקוח ענה במייל",
          body: snippet,
          ...(buyer !== null
            ? { entityType: "buyer", entityId: buyer.id }
            : lead !== null
              ? { entityType: "lead", entityId: lead.id }
              : {}),
        },
      });
      return id;
    });

    /*
     * הקבצים נכתבים **אחרי** הטרנזקציה: העלאה של עשרות MB לאחסון
     * בתוך טרנזקציה פתוחה מחזיקה חיבור מסד לאורך ההעלאה. הודעה
     * כפולה כבר הוכרעה בפנים (null) — Webhook חוזר לא כותב קובץ
     * פעמיים; כשל בקובץ אחד אינו מפיל את השאר, והטקסט כבר בתיבה.
     */
    if (stored === null || incoming.length === 0) return;
    for (const attachment of incoming) {
      try {
        const attachmentId = ulid();
        const s3Key = `tenants/${tenantId}/email-attachments/${stored}/${attachmentId}`;
        await this.storage.put(s3Key, attachment.content, attachment.contentType);
        await this.prisma.withExplicitTenant(tenantId, (tx) =>
          tx.emailAttachment.create({
            data: {
              id: attachmentId,
              tenantId,
              messageId: stored,
              name: attachment.name,
              contentType: attachment.contentType,
              kind: attachment.kind,
              sizeBytes: attachment.content.length,
              s3Key,
            },
          }),
        );
      } catch (error: unknown) {
        this.logger.error(`שמירת קובץ מצורף נכשלה: ${String(error)}`);
      }
    }
  }

  /** התיבה: שיחה אחת ללקוח, החדשה ראשונה, עם מונה שלא-נקראו. */
  async listThreads(): Promise<InboxThreadDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      /*
       * ‏`distinct` על הלקוח, לא חיתוך של זרם ההודעות: חיתוך גולמי
       * היה מעלים שיחה שההודעה שלה נדחקה מעבר לגבול — כולל שיחה עם
       * לא-נקראו שהתג בסרגל ממשיך לספור, בלי שום דרך לפתוח אותה
       * (ביקורת Codex). כאן הגבול הוא על **שיחות**: 100 האחרונות.
       */
      const lastPerContact = await tx.emailMessage.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        distinct: ["contactId"],
        take: 100,
        select: {
          contactId: true,
          subject: true,
          body: true,
          direction: true,
          createdAt: true,
        },
      });
      const contactIds = lastPerContact.map((m) => m.contactId);
      const unreadRows = await tx.emailMessage.groupBy({
        by: ["contactId"],
        where: { tenantId, contactId: { in: contactIds }, direction: "in", readAt: null },
        _count: { _all: true },
      });
      const unreadByContact = new Map(
        unreadRows.map((row) => [row.contactId, row._count._all]),
      );
      const threads = new Map(
        lastPerContact.map((message) => [
          message.contactId,
          { last: message, unread: unreadByContact.get(message.contactId) ?? 0 },
        ]),
      );
      const [names, buyers] = await Promise.all([
        this.contacts.getByIds(tx, contactIds),
        tx.buyer.findMany({
          where: { tenantId, contactId: { in: contactIds }, deletedAt: null },
          select: { id: true, contactId: true },
        }),
      ]);
      const buyerByContact = new Map(buyers.map((b) => [b.contactId, b.id]));

      return [...threads.entries()].map(([contactId, thread]) => {
        const buyerId = buyerByContact.get(contactId);
        return {
          contactId,
          contactName: names.get(contactId)?.name ?? "לקוח",
          lastSubject: thread.last.subject,
          lastSnippet:
            thread.last.body.length > 120
              ? `${thread.last.body.slice(0, 120)}…`
              : thread.last.body,
          lastDirection: thread.last.direction,
          lastAt: thread.last.createdAt,
          unread: thread.unread,
          ...(buyerId === undefined ? {} : { buyerId }),
        };
      });
    });
  }

  /** השיחה עם לקוח אחד — מהישן לחדש, כמו שקוראים שיחה. */
  async thread(contactId: string): Promise<{ contactName: string; messages: InboxMessageDto[] }> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const contact = await this.contacts.getById(tx, contactId);
      if (contact === null) throw new NotFoundException("הלקוח לא נמצא");
      /*
       * החדשות תחילה ואז היפוך לתצוגה: שיחה ארוכה מ-200 מציגה את
       * הסוף — הרלוונטי — ולא את הפתיחה מלפני שנה, ש"קוראת" בטעות
       * גם את מה שלא הוצג (ביקורת Codex).
       */
      const rows = (
        await tx.emailMessage.findMany({
          where: { tenantId, contactId },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      ).reverse();
      const attachmentRows = await tx.emailAttachment.findMany({
        where: { tenantId, messageId: { in: rows.map((r) => r.id) } },
        orderBy: { createdAt: "asc" },
        select: { id: true, messageId: true, name: true, kind: true, contentType: true, sizeBytes: true },
      });
      const attachmentsByMessage = new Map<string, InboxAttachmentDto[]>();
      for (const a of attachmentRows) {
        const list = attachmentsByMessage.get(a.messageId) ?? [];
        list.push({
          id: a.id,
          name: a.name,
          kind: a.kind,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
        });
        attachmentsByMessage.set(a.messageId, list);
      }
      return {
        contactName: contact.name,
        messages: rows.map((row) => ({
          id: row.id,
          direction: row.direction,
          subject: row.subject,
          body: row.body,
          ...(row.fromEmail === null ? {} : { fromEmail: row.fromEmail }),
          readAt: row.readAt,
          createdAt: row.createdAt,
          attachments: attachmentsByMessage.get(row.id) ?? [],
        })),
      };
    });
  }

  /** הזרמת קובץ מצורף — דרך ה-API, לא ישירות מהאחסון הפנימי. */
  async attachmentRaw(attachmentId: string): Promise<{
    body: NodeJS.ReadableStream;
    contentType: string;
    contentLength?: number;
    name: string;
    kind: string;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.emailAttachment.findFirst({
        where: { id: attachmentId, tenantId },
        select: { s3Key: true, contentType: true, sizeBytes: true, name: true, kind: true },
      }),
    );
    if (row === null) throw new NotFoundException("הקובץ לא נמצא");
    const obj = await this.storage.getObject(row.s3Key);
    return {
      body: obj.body as NodeJS.ReadableStream,
      /*
       * הסוג שנשמר בקליטה (מהרשימה הסגורה) ולא מה שהאחסון זוכר —
       * ההכרעה הבטוחה כבר התקבלה פעם אחת, בכניסה.
       */
      contentType: row.contentType,
      ...(obj.contentLength !== undefined ? { contentLength: obj.contentLength } : {}),
      name: row.name,
      kind: row.kind,
    };
  }

  /** סימון השיחה כנקראה — בכניסה אליה, לא בהודעה-הודעה. */
  async markRead(contactId: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant((tx) =>
      tx.emailMessage.updateMany({
        where: { tenantId: ctx.tenantId, contactId, direction: "in", readAt: null },
        data: { readAt: new Date(), readBy: ctx.userId === "" ? null : ctx.userId },
      }),
    );
  }

  /**
   * תשובת הסוכן — נשלחת מכתובת המשרד (או הפלטפורמה), נרשמת בתיבה
   * ובציר. הכתובת נשלפת מהכרטיס לפי מזההו ולא מהמסך — מסך שמכתיב
   * יעד היה הופך את התיבה לצינור שליחה לכל כתובת (אותו כלל כמו
   * בתשובת Gmail).
   */
  async reply(
    contactId: string,
    body: string,
    files: readonly { name: string; contentType: string; content: Buffer }[] = [],
  ): Promise<void> {
    const ctx = TenantContext.current();
    const tenantId = ctx.tenantId;

    /*
     * הקבצים היוצאים באותה רשימה סגורה כמו הנכנסים, ובתקרת הספק
     * להודעה יוצאת. הבדיקה כאן ולא רק במסך — המסך הוא נוחות.
     */
    if (files.length > EMAIL_ATTACHMENT_MAX_COUNT) {
      throw new BadRequestException(`עד ${EMAIL_ATTACHMENT_MAX_COUNT} קבצים בהודעה`);
    }
    const outgoing = files.map((file) => {
      const kind = emailAttachmentKind(file.contentType);
      if (kind === null) {
        throw new BadRequestException(`סוג הקובץ אינו נתמך: ${safeAttachmentName(file.name)}`);
      }
      return {
        kind,
        content: file.content,
        name: safeAttachmentName(file.name),
        contentType: file.contentType.split(";")[0]?.trim().toLowerCase() ?? "",
      };
    });
    const totalBytes = outgoing.reduce((sum, f) => sum + f.content.length, 0);
    if (totalBytes > EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES) {
      throw new BadRequestException(
        `סך הקבצים בהודעה יוצאת מוגבל ל-${Math.floor(EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES / (1024 * 1024))}MB — שלחו בכמה הודעות`,
      );
    }

    const target = await this.prisma.withTenant(async (tx) => {
      const to = await this.contacts.emailFor(tx, contactId);
      if (to === undefined || to === "") {
        throw new BadRequestException("ללקוח אין כתובת אימייל בכרטיס");
      }
      const lastIn = await tx.emailMessage.findFirst({
        where: { tenantId, contactId, direction: "in" },
        orderBy: { createdAt: "desc" },
        select: { subject: true },
      });
      return { to, subject: lastIn?.subject ?? "הודעה מהמשרד" };
    });

    const subject = target.subject.startsWith("Re:") ? target.subject : `Re: ${target.subject}`;
    const replyTo = await this.replyAddressFor(tenantId, contactId);
    // required: מסך שמראה "נשלח" אחרי שלא נשלח הוא תיעוד כוזב
    await this.email.send(target.to, subject, body, {
      tenantId,
      required: true,
      ...(replyTo === null ? {} : { replyTo }),
      ...(outgoing.length === 0
        ? {}
        : {
            attachments: outgoing.map((f) => ({
              name: f.name,
              contentType: f.contentType,
              content: f.content,
            })),
          }),
    });

    const messageId = ulid();
    await this.prisma.withTenant(async (tx) => {
      await tx.emailMessage.create({
        data: {
          id: messageId,
          tenantId,
          contactId,
          direction: "out",
          subject: subject.slice(0, 200),
          body: body.length > 5000 ? `${body.slice(0, 5000)}…` : body,
          readAt: new Date(),
          createdBy: ctx.userId === "" ? null : ctx.userId,
        },
      });
      await this.recordReplyOnTimeline(tx, tenantId, contactId, body);
      await this.audit.record(tx, {
        action: "email_inbox.reply",
        entityType: "contact",
        entityId: contactId,
      });
    });

    // עותקי הקבצים נשמרים גם אצלנו — מה שנשלח ללקוח מופיע בשיחה,
    // מחוץ לטרנזקציה מאותה סיבה כמו בקליטה
    for (const file of outgoing) {
      try {
        const attachmentId = ulid();
        const s3Key = `tenants/${tenantId}/email-attachments/${messageId}/${attachmentId}`;
        await this.storage.put(s3Key, file.content, file.contentType);
        await this.prisma.withTenant((tx) =>
          tx.emailAttachment.create({
            data: {
              id: attachmentId,
              tenantId,
              messageId,
              name: file.name,
              contentType: file.contentType,
              kind: file.kind,
              sizeBytes: file.content.length,
              s3Key,
            },
          }),
        );
      } catch (error: unknown) {
        this.logger.error(`שמירת עותק קובץ יוצא נכשלה: ${String(error)}`);
      }
    }
  }

  private async recordReplyOnTimeline(
    tx: TenantTx,
    tenantId: string,
    contactId: string,
    body: string,
  ): Promise<void> {
    const buyer = await tx.buyer.findFirst({
      where: { tenantId, contactId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const lead =
      buyer === null
        ? await tx.lead.findFirst({
            where: { tenantId, contactId },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          })
        : null;
    if (buyer === null && lead === null) return;
    const snippet = body.length > 120 ? `${body.slice(0, 120)}…` : body;
    await tx.interaction.create({
      data: {
        id: ulid(),
        tenantId,
        ...(buyer !== null ? { buyerId: buyer.id } : { leadId: lead?.id }),
        kind: "system",
        direction: "out",
        content: `📧 נשלחה תשובה במייל: ${snippet}`,
        createdBy: TenantContext.current().userId || null,
      },
    });
  }
}
