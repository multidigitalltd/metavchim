import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ATTACHMENT_MAX_COUNT,
  EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES,
  emailAttachmentKind,
  inboundBody,
  inboundProviderMessageId,
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
import { EmailRejectedError, EmailService } from "../../core/email.service";
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
    /*
     * התקרה נמסרת פנימה. החיתוך היה **אחרי** הקריאה, כלומר על טקסט
     * שכבר קוצץ ל-5,000 — התקרה של התמיכה לא התקיימה מעולם, ודוח
     * שגיאה ארוך איבד עד 15,000 תווים (ביקורת Codex).
     */
    const body = inboundBody(payload, BODY_MAX);
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
    let duplicate = false;
    try {
      await this.prisma.supportMessage.create({
        data: {
          id: messageId,
          threadId: thread.id,
          direction: "in",
          body,
          fromEmail: senderEmail,
          providerMessageId: inboundProviderMessageId(payload),
        },
      });
    } catch (error) {
      // אותה הודעה פעמיים (הספק שולח שוב על 5xx) — לא תקלה
      if ((error as { code?: string }).code !== "P2002") throw error;
      duplicate = true;
    }

    /*
     * **ניסיון חוזר ממשיך עד סוף העדכון, ולא חוזר כאן.**
     *
     * הסדר כאן הוא „הודעה, קבצים, ואז מצב השרשור”, ולכן כשל זמני
     * בשלב האחרון משאיר הודעה שנכתבה בשרשור שנשאר **סגור ונקרא**.
     * הספק שולח שוב — וההסתעפות הזו הייתה חוזרת מיד, כלומר מנציחה
     * בדיוק את המצב שהניסיון החוזר בא לתקן: פנייה שיושבת בתחתית
     * הרשימה ואיש אינו רואה אותה (ביקורת Codex).
     *
     * מה שכן מדולג הוא הקבצים בלבד: הם כבר נשמרו בסבב הקודם תחת
     * מזהה ההודעה **שנוצר אז**, ושמירה חוזרת תחת מזהה חדש הייתה
     * מכפילה אותם.
     *
     * הקבצים נשמרים **אחרי** ההודעה ולא בטרנזקציה אחת איתה: העלאה
     * לאחסון היא קריאת רשת, וטרנזקציה שמחזיקה חיבור למסד לאורכה היא
     * בדיוק מה שנועל את המסד כשספק האחסון מאט. קובץ שנכשל מדולג —
     * הפנייה עצמה כבר נקלטה, וזה מה שחשוב.
     */
    if (!duplicate) {
      for (const attachment of incoming) {
        await this.storeAttachment(thread.id, thread.tenantId, messageId, attachment);
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
   * שמירת קובץ אחד — לאחסון, ואז השורה שמצביעה עליו.
   *
   * **כשלון אחרי ההעלאה מוחק את מה שהועלה.** מחיקת משרד מוצאת את
   * האובייקטים שלו דרך השורות במסד, ולכן אובייקט שנשאר בלי שורה
   * אינו „קובץ יתום” בלבד — הוא נתון של לקוח ששרד מחיקה שהובטחה
   * לו במלואה (ביקורת Codex).
   *
   * המחיקה עצמה נכשלת בשקט: כאן כבר טיפלנו בכשל אחד, ואי אפשר
   * לתלות בו את קליטת הפנייה. מה שנשאר מדווח ביומן בשמו.
   */
  private async storeAttachment(
    threadId: string,
    tenantId: string | null,
    messageId: string,
    attachment: { kind: string; name: string; contentType: string; content: Buffer },
  ): Promise<void> {
    const attachmentId = ulid();
    const s3Key = `support/${threadId}/${messageId}/${attachmentId}`;
    let uploaded = false;
    try {
      await this.storage.put(s3Key, attachment.content, attachment.contentType, tenantId);
      uploaded = true;
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
      if (uploaded) {
        await this.storage
          .delete(s3Key)
          .catch(() => this.logger.error(`ניקוי קובץ תמיכה שנשאר באחסון נכשל: ${s3Key}`));
      }
    }
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
  }): Promise<{ id: string; tenantId: string | null } | null> {
    if (input.token !== null) {
      const byToken = await this.prisma.supportThread.findUnique({
        where: { replyToken: input.token },
        select: { id: true, tenantId: true },
      });
      if (byToken !== null) return byToken;
      // טוקן לא מוכר אינו סיבה לזרוק פנייה — ממשיכים לשרשור לפי שולח
      this.logger.warn("פניית תמיכה עם טוקן לא מוכר — משויכת לפי כתובת השולח");
    }

    if (input.senderEmail !== null) {
      const open = await this.prisma.supportThread.findFirst({
        where: { contactEmail: input.senderEmail, status: "open" },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true, tenantId: true },
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
    return { id, tenantId };
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
    /*
     * **הפתוחים נשלפים בשאילתה נפרדת, ולא לפי סדר האלפבית.**
     *
     * ‎`orderBy: { status: "asc" }` נראה כמו „פתוחים קודם” ואינו
     * כזה: `closed` קטן מ-`open` לקסיקוגרפית, ולכן הוא דחף את כל
     * הסגורים לראש. עם `take: 100` פירושו שמאה סגורים מוחקים מהמסך
     * את כל מי שבאמת מחכה (ביקורת Codex). סדר שנשען על איות הערך
     * הוא סדר שמשתנה כשמישהו יקרא לסטטוס בשם אחר.
     *
     * שתי שאילתות ולא ביטוי מחושב: התור הפתוח הוא מה שמסך התמיכה
     * קיים בשבילו, והסגורים הם השלמה למי שיש מקום להציג.
     */
    const columns = {
      id: true,
      subject: true,
      contactName: true,
      contactEmail: true,
      tenantId: true,
      status: true,
      readAt: true,
      lastMessageAt: true,
    } as const;
    const open = await this.prisma.supportThread.findMany({
      where: { status: "open" },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      select: columns,
    });
    const closed =
      open.length >= 100
        ? []
        : await this.prisma.supportThread.findMany({
            where: { status: { not: "open" } },
            orderBy: { lastMessageAt: "desc" },
            take: 100 - open.length,
            select: columns,
          });
    const rows = [...open, ...closed];
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
      /** ‏pending | sent | failed | unknown — ביוצאות בלבד. */
      sendState?: string;
      attachments: { id: string; name: string; kind: string; sizeBytes: number }[];
    }[];
  }> {
    const row = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
      include: {
        messages: {
          /*
           * ‎**החדשות תחילה ואז היפוך לתצוגה** — אותו כלל כמו בתיבת
           * הלקוחות, שם הוא כבר תוקן ותועד. `asc` עם `take` מחזיר
           * את **הישנות**, כלומר פנייה חדשה נעלמת מהשולחן בזמן
           * שפתיחת השרשור מסמנת אותו כנקרא (ביקורת Codex).
           */
          orderBy: { createdAt: "desc" },
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
      // נשלפו החדשות; ההיפוך מחזיר אותן לסדר קריאה
      messages: [...row.messages].reverse().map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        createdAt: message.createdAt,
        /*
         * ‎**מצב השליחה מגיע למסך.** בלעדיו תשובה שהסתיימה בתוצאה
         * עמומה נראית ככל תשובה שנשלחה, ומזמינה שליחה חוזרת לנמען
         * שאולי כבר קיבל (ביקורת Codex) — אותו שדה, מאותה סיבה,
         * כמו בתיבת הלקוחות.
         */
        ...(message.sendState === null ? {} : { sendState: message.sendState }),
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
  ): Promise<{ ok: true; state: "sent" | "unknown" }> {
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

    /*
     * **הרשומה נכתבת לפני השליחה, ומאושרת אחריה.**
     *
     * אותו כלל שתוקן בתיבת המשרד, ובאותו נימוק: פעולה חיצונית
     * בלתי הפיכה עטופה ברשומה עמידה. כשהסדר הפוך וכתיבת ההודעה
     * נופלת, הפונה כבר קיבל תשובה שאין לה זכר בשרשור, מי שענה
     * רואה שגיאה עם הטיוטה שמורה — ושולח שוב (ביקורת Codex).
     */
    const messageId = ulid();
    await this.prisma.supportMessage.create({
      data: {
        id: messageId,
        threadId,
        direction: "out",
        body: body.trim().slice(0, BODY_MAX),
        sendState: "pending",
        createdBy: TenantContext.current().userId,
      },
    });

    let state: "sent" | "unknown" = "sent";
    try {
      await this.email.send(
        thread.contactEmail!,
        thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
        {
          heading: "תשובה מהתמיכה",
          paragraphs: body.trim() === "" ? ["מצורף:"] : body.trim().split("\n").filter(Boolean),
        },
        {
          required: true,
          /*
           * **התשובה יוצאת מכתובת התמיכה עצמה.**
           *
           * בלי זה היא יוצאת מהשולח הכללי — `no-reply` — כלומר
           * מזמינה את הפונה להשיב לכתובת שאיש אינו קורא, ומאבדת
           * את השרשור שה-Reply-To בנה (ביקורת Codex).
           */
          ...(config === null ? {} : { sender: await this.sender(config.address) }),
          ...(replyTo !== null ? { replyTo } : {}),
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
       * **„נכשלה” רק כשידוע שלא יצאה** — אותה הבחנה כמו בתיבת
       * המשרד. דחייה של הספק היא ודאות; פסק זמן ו-5xx אינם, וייתכן
       * שהפונה כן קיבל. סימון הכול כ„נכשל” מזמין שליחה חוזרת.
       */
      const certainlyNotSent = error instanceof EmailRejectedError;
      await this.prisma.supportMessage
        .update({
          where: { id: messageId },
          data: { sendState: certainlyNotSent ? "failed" : "unknown" },
        })
        .catch(() => this.logger.error(`סימון מצב תשובת תמיכה נכשל: ${messageId}`));
      if (certainlyNotSent) throw error;
      // בתוצאה עמומה הקבצים נשמרים בכל זאת — ייתכן שהפונה קיבל אותם
      state = "unknown";
      this.logger.warn(`תשובת תמיכה הסתיימה בתוצאה עמומה: ${messageId} — ${String(error)}`);
    }

    if (state === "sent") {
      await this.prisma.supportMessage
        .update({ where: { id: messageId }, data: { sendState: "sent" } })
        // המייל כבר יצא; כשל כאן הוא כשל בתיעוד ולא בשליחה
        .catch(() => this.logger.error(`אישור שליחת תשובת תמיכה נכשל: ${messageId}`));
    }

    for (const attachment of attachments) {
      await this.storeAttachment(threadId, thread.tenantId, messageId, attachment);
    }

    await this.prisma.supportThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date(), readAt: new Date() },
    });
    return { ok: true, state };
  }

  /**
   * השולח של תיבת התמיכה — הכתובת שקולטת היא גם הכתובת ששולחת.
   *
   * ‎`supportServerToken` הוא ה-Server Token של אותו שרת אצל הספק.
   * כשהוא ריק התשובה יוצאת בטוקן הכללי, ועדיין **מכתובת התמיכה**:
   * שרת אחד הוא הגדרה חסרה, לא סיבה לענות מ-`no-reply`.
   */
  private async sender(address: string): Promise<{ from: string; token?: string | undefined }> {
    const token = (await this.settings.get("supportServerToken")) ?? "";
    return { from: `תמיכה מתווכים <${address}>`, ...(token === "" ? {} : { token }) };
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
