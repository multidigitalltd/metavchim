import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  inboundBody,
  inboundSubject,
  inboundToken,
  replyAddressFor,
  type InboundEmailPayload,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { EmailService } from "../../core/email.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
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

export interface InboxMessageDto {
  id: string;
  direction: string;
  subject: string;
  body: string;
  fromEmail?: string;
  readAt: Date | null;
  createdAt: Date;
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
    const existing = await this.prisma.emailReplyToken.findUnique({
      where: { tenantId_contactId: { tenantId, contactId } },
      select: { id: true },
    });
    if (existing !== null) return replyAddressFor(config.address, existing.id);
    const id = ulid();
    try {
      await this.prisma.emailReplyToken.create({ data: { id, tenantId, contactId } });
      return replyAddressFor(config.address, id);
    } catch {
      // מרוץ בין שתי שליחות לאותו לקוח — הראשון ניצח, משתמשים בשלו
      const raced = await this.prisma.emailReplyToken.findUnique({
        where: { tenantId_contactId: { tenantId, contactId } },
        select: { id: true },
      });
      return raced === null ? null : replyAddressFor(config.address, raced.id);
    }
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

    const body = inboundBody(payload);
    if (body === "") return; // אין תוכן — אין מה להציג

    const { tenantId, contactId } = mapping;
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      // הכרטיס עשוי להימחק אחרי שהטוקן הונפק — תשובה יתומה מדולגת
      const contact = await tx.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true },
      });
      if (contact === null) return;

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
        return;
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
      const snippet = body.length > 120 ? `${body.slice(0, 120)}…` : body;
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
    });
  }

  /** התיבה: שיחה אחת ללקוח, החדשה ראשונה, עם מונה שלא-נקראו. */
  async listThreads(): Promise<InboxThreadDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const messages = await tx.emailMessage.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          contactId: true,
          subject: true,
          body: true,
          direction: true,
          readAt: true,
          createdAt: true,
        },
      });
      const threads = new Map<
        string,
        { last: (typeof messages)[number]; unread: number }
      >();
      for (const message of messages) {
        const thread = threads.get(message.contactId);
        if (thread === undefined) {
          threads.set(message.contactId, {
            last: message,
            unread: message.direction === "in" && message.readAt === null ? 1 : 0,
          });
        } else if (message.direction === "in" && message.readAt === null) {
          thread.unread += 1;
        }
      }

      const contactIds = [...threads.keys()];
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
      const rows = await tx.emailMessage.findMany({
        where: { tenantId, contactId },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
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
        })),
      };
    });
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
  async reply(contactId: string, body: string): Promise<void> {
    const ctx = TenantContext.current();
    const tenantId = ctx.tenantId;

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
    });

    await this.prisma.withTenant(async (tx) => {
      await tx.emailMessage.create({
        data: {
          id: ulid(),
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
