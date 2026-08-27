import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ATTACHMENT_MAX_COUNT,
  EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES,
  emailAttachmentKind,
  inboundBody,
  inboundProviderMessageId,
  inboundSubject,
  inboundToken,
  replyAddressFor,
  safeAttachmentName,
  type InboundEmailPayload,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { EmailRejectedError, EmailService } from "../../core/email.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";
import { ContactsService } from "../contacts/contacts.service";

/**
 * ניסיונות סימון ההשלמה של קובץ מצורף.
 *
 * הסימון הוא עדכון עמודה אחת לפי מפתח; כישלון בו הוא כמעט תמיד
 * רגעי. שלושה ניסיונות עולים מילישניות ומכסים את המקרה השכיח,
 * ובעותקים היוצאים הם רשת הביטחון **היחידה** — שם אין מסירה חוזרת.
 */
const MARK_UPLOADED_ATTEMPTS = 3;

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
  /**
   * ‎`pending` | `sent` | `failed` | `unknown` — ביוצאות בלבד.
   *
   * מוחזר כדי שהמסך יוכל לומר „לא נשלחה”. תשובה שנכשלה ונראית
   * ככל השאר היא בדיוק התיעוד הכוזב שהשדה הזה נועד למנוע.
   */
  sendState?: string;
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
    private readonly waSend: WhatsAppSendService,
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
      // השם דרך ContactsService — מוצפן במסד, ונחוץ להתראה בוואטסאפ
      const contact = await this.contacts.getById(tx, contactId);
      if (contact === null) return null;

      const id = ulid();
      /*
       * ‎**`createMany` עם `skipDuplicates`, ולא `create` בתוך `try`.**
       *
       * הניסוח הקודם תפס את שגיאת האינדקס הייחודי וחזר בשקט. שתי
       * בעיות, והשנייה היא החמורה:
       *
       * ‎**1 · שגיאה בתוך טרנזקציה מבטלת אותה.** Postgres מסמן את
       * הטרנזקציה כמבוטלת ברגע ששאילתה בתוכה נכשלה; תפיסה ב-JS אינה
       * משחזרת אותה. כאן לא רצה שום שאילתה אחרי התפיסה ולכן זה לא
       * התפוצץ — אבל זו הסתמכות על מה שהקוד **אינו** עושה, ושורה
       * אחת שתתווסף מתחתיה תשבור אותה.
       *
       * ‎**2 · `catch` ריק בולע כל שגיאה, לא רק כפילות.** תקלת רשת
       * רגעית למסד נראתה בדיוק כמו „הספק שלח שוב”: הוובהוק נענה
       * באישור, וההודעה של הלקוח **אבדה לתמיד** (ביקורת Codex).
       *
       * ‎`skipDuplicates` הוא `ON CONFLICT DO NOTHING` — אין שגיאה,
       * אין ביטול טרנזקציה, וכפילות מובחנת מכשל אמיתי לפי `count`.
       * זה גם מה שכבר נעשה ב-`recordAuto`.
       */
      const written = await tx.emailMessage.createMany({
        data: [
          {
            id,
            tenantId,
            contactId,
            direction: "in",
            subject: inboundSubject(payload),
            body,
            fromEmail: payload.From.slice(0, 320) || null,
            providerMessageId: inboundProviderMessageId(payload),
          },
        ],
        skipDuplicates: true,
      });
      /*
       * ‎**אותו MessageID פעם שנייה — וזו אינה בהכרח „כבר טופל”.**
       *
       * הקבצים נכתבים אחרי הטרנזקציה. אם התהליך נפל באמצע, השורה
       * של ההודעה קיימת אבל חלק מהקבצים לא נשמרו — ואין להם מצב
       * ממתין ואין תהליך רקע שמשלים אותם. חזרה בשקט כאן פירושה
       * שקובץ שהלקוח שלח **נעלם לתמיד**, והמסירה החוזרת של הספק,
       * שהיא ההזדמנות היחידה להשלים אותו, נזרקת (ביקורת Codex).
       *
       * לכן מוחזר מזהה ההודעה הקיימת, ולולאת הקבצים ממשיכה מהמקום
       * שנעצר. ההתראה והציר **אינם** נכתבים שוב — הם כבר נכתבו.
       */
      if (written.count === 0) {
        /*
         * אותו כלל שנכתב בו — מזהה שכולו רווחים אינו מזהה, ולכן
         * גם אין לחפש לפיו. שני הצדדים חייבים להסכים, אחרת הכתיבה
         * שומרת `null` והחיפוש מחפש מחרוזת ריקה.
         */
        const providerMessageId = inboundProviderMessageId(payload);
        const existing =
          providerMessageId === null
            ? null
            : await tx.emailMessage.findUnique({
                where: { tenantId_providerMessageId: { tenantId, providerMessageId } },
                select: { id: true },
              });
        if (existing === null) return null;
        return { messageId: existing.id, fresh: false, notifyUserId: null, customerName: "" };
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
      return {
        messageId: id,
        fresh: true,
        notifyUserId: buyer?.ownerUserId ?? lead?.assignedToUserId ?? null,
        customerName: contact.name,
      };
    });

    /*
     * הקבצים נכתבים **אחרי** הטרנזקציה: העלאה של עשרות MB לאחסון
     * בתוך טרנזקציה פתוחה מחזיקה חיבור מסד לאורך ההעלאה. כשל בקובץ
     * אחד אינו מפיל את השאר, והטקסט כבר בתיבה.
     *
     * ‎**ומסירה חוזרת ממשיכה מהמקום שנעצר.** מה שכבר נשמר מזוהה לפי
     * שם וגודל — הספק מוסר את **אותו** מייל, ולכן שני קבצים בעלי שם
     * וגודל זהים באותה הודעה הם אותו קובץ לכל דבר. מונה ולא קבוצה,
     * כדי ששני עותקים שנשלחו לא יצטמצמו לאחד.
     */
    if (stored === null) return;
    /*
     * ‎**מה שכבר נשמר מזוהה במקומו בהודעה, לא בשם ובגודל.**
     *
     * ההשוואה בזיכרון הכריעה **אחרי** הקריאה, ולכן הייתה חסרת ערך
     * מול מרוץ: ספק שמוסר שוב בזמן שהמסירה הראשונה עדיין מעלה —
     * וזה בדיוק המצב שגורם למסירה חוזרת — נותן לשתי הבקשות את אותה
     * תמונת מצב חלקית, ושתיהן מעלות ומכניסות את אותם קבצים (ביקורת
     * Codex).
     *
     * ‎`ordinal` מעביר את ההכרעה למסד: המפתח באחסון נגזר מההודעה
     * ומהמקום, שני הכותבים מחשבים **אותו מפתח בדיוק** ומעלים אותם
     * בתים, והאילוץ הייחודי מכריע מי כותב את השורה. אין כפילות
     * בתיבה, ואין אובייקט שני באחסון.
     */
    /*
     * ‎**„נתבע” אינו „הועלה” — ומה שלא הושלם, מושלם.**
     *
     * השורה נכתבת לפני ההעלאה ולכן קיומה אינו מעיד שהאובייקט קיים;
     * תהליך שנפל ביניהן משאיר תביעה בלי קובץ. הדילוג הוא על מה
     * ש**הושלם** בלבד, וכל השאר מועלה שוב — גם אם התביעה כבר קיימת.
     *
     * ‎**ואין כאן חכירה, ואין השתלטות.** ניסיתי אותן, והן ילדו שתי
     * תקלות: `!takeover` תיאר איך הקריאה **התחילה** ולא אם הבעלות
     * עדיין בתוקף, ושחרור תביעה שפגה מחק אובייקט שכותב אחר כבר
     * השלים (ביקורת Codex). המפתח דטרמיניסטי, ולכן העלאה חוזרת של
     * אותם בתים לאותו מפתח היא **אידמפוטנטית** — אין מה לתאם ואין
     * למי לתת בעלות. הפשטות כאן היא התכונה, לא הוויתור.
     */
    const completed = new Set<number>();
    if (!stored.fresh) {
      const rows = await this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.emailAttachment.findMany({
          where: { tenantId, messageId: stored.messageId, uploadedAt: { not: null } },
          select: { ordinal: true },
        }),
      );
      for (const row of rows) {
        if (row.ordinal !== null) completed.add(row.ordinal);
      }
      this.logger.log(
        `מסירה חוזרת של תשובת מייל — ${completed.size} מתוך ${incoming.length} קבצים הושלמו`,
      );
    }
    for (const [ordinal, attachment] of incoming.entries()) {
      if (completed.has(ordinal)) continue;
      const s3Key = `tenants/${tenantId}/email-attachments/${stored.messageId}/${ordinal}`;
      try {
        /*
         * ‎**השורה קודם, ולכן אין אובייקט בלי שורה.** זו התכונה
         * שסוגרת את חור המחיקה מהשורש: מחיקת לקוח ומחיקת משרד
         * עוברות על השורות, וכאן אין מפתח שנכתב בלי שורה שתמצא
         * אותו. אין צורך בפיצוי, ולכן אין מה שימחק בטעות קובץ חי.
         *
         * ‎`skipDuplicates` ללא `continue`: שורה קיימת ולא-מושלמת
         * היא **בדיוק** מה שבאנו להשלים.
         */
        await this.prisma.withExplicitTenant(tenantId, (tx) =>
          tx.emailAttachment.createMany({
            data: [
              {
                id: ulid(),
                tenantId,
                messageId: stored.messageId,
                ordinal,
                name: attachment.name,
                contentType: attachment.contentType,
                kind: attachment.kind,
                sizeBytes: attachment.content.length,
                s3Key,
              },
            ],
            skipDuplicates: true,
          }),
        );
        await this.storage.put(s3Key, attachment.content, attachment.contentType, tenantId);
        await this.markUploaded(tenantId, stored.messageId, ordinal);
      } catch (error: unknown) {
        /*
         * ‎**ולא מוחקים דבר.** השורה נשארת לא-מושלמת, המסירה החוזרת
         * הבאה תעלה שוב לאותו מפתח ותסמן. מחיקה כאן היא ההזדמנות
         * היחידה להשמיד קובץ של לקוח, ואין לה תמורה.
         */
        this.logger.error(`שמירת קובץ מצורף נכשלה: ${String(error)}`);
      }
    }

    // מסירה חוזרת אינה התראה חוזרת — הסוכן כבר קיבל אותה
    if (stored.fresh) {
      await this.notifyAgentOnWhatsApp(tenantId, stored.notifyUserId, stored.customerName);
    }
  }

  /**
   * "לקוח ענה במייל" — גם בוואטסאפ, לסוכן שמנוי עליו (`whatsappAccess`).
   *
   * ‏best-effort במופגן: ההתראה במערכת והדחיפה כבר יצאו, וזו תוספת.
   * טקסט חופשי עובר רק בתוך חלון 24 השעות של Meta (סוכן שמדבר עם
   * הסוכן האישי — החלון פתוח); מחוצה לו מנסים תבנית מאושרת, אם
   * הוגדרה בפלטפורמה. בלי — כלום, בשקט.
   *
   * ההודעה נושאת **את שם הלקוח בלבד**, לא את תוכן המייל: וואטסאפ
   * הוא ערוץ צד-שלישי, ותוכן ההתכתבות של הלקוח נשאר במערכת.
   */
  private async notifyAgentOnWhatsApp(
    tenantId: string,
    userId: string | null,
    customerName: string,
  ): Promise<void> {
    // בלי סוכן אחראי אין נמען — ההתראה המשרדית במערכת מכסה את זה
    if (userId === null) return;
    try {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, tenantId, isActive: true },
        select: { phone: true, whatsappAccess: true },
      });
      if (user === null || !user.whatsappAccess || !user.phone) return;

      const sent = await this.waSend.sendText(
        user.phone,
        `📧 תשובה חדשה במייל מ${customerName} — היכנסו לתיבת המייל במערכת כדי לקרוא ולהשיב.`,
      );
      if (sent) return;

      const template = await this.platformSettings.get("whatsappEmailReplyTemplate");
      const lang =
        (await this.platformSettings.get("whatsappEmailReplyTemplateLang")) ?? "he";
      if (template !== undefined && template !== "") {
        await this.waSend.sendTemplate(user.phone, template, lang, [customerName]);
      }
    } catch (error: unknown) {
      this.logger.warn(`התראת וואטסאפ על תשובת מייל נכשלה: ${String(error)}`);
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
      /*
       * ‎**רק מה שהושלם.** רשומה בלי `uploadedAt` היא תביעה על מקום
       * שטרם הועלה — קישור שבור, לא צירוף. היא תופיע ברגע שההעלאה
       * תושלם, ומסירה חוזרת משלימה תביעה שנשארה נטושה.
       */
      const attachmentRows = await tx.emailAttachment.findMany({
        where: {
          tenantId,
          messageId: { in: rows.map((r) => r.id) },
          uploadedAt: { not: null },
        },
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
          ...(row.sendState === null ? {} : { sendState: row.sendState }),
          readAt: row.readAt,
          createdAt: row.createdAt,
          attachments: attachmentsByMessage.get(row.id) ?? [],
        })),
      };
    });
  }

  /**
   * הזרמת קובץ מצורף — דרך ה-API, לא ישירות מהאחסון הפנימי.
   *
   * ‎`uploadedAt` נדרש כאן כמו ברשימה: תביעה שטרם הועלתה אינה קובץ,
   * והורדתה נכשלת מול האחסון בשגיאה שאינה אומרת דבר.
   */
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
        where: { id: attachmentId, tenantId, uploadedAt: { not: null } },
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
  ): Promise<{ state: "sent" | "unknown" }> {
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

    /*
     * ‎**הרשומה נכתבת לפני השליחה, ומאושרת אחריה.**
     *
     * הסדר היה הפוך: שולחים, ואז כותבים. כשהכתיבה נכשלה הלקוח כבר
     * קיבל את ההודעה ולמערכת לא נשאר ממנה דבר — לא בתיבה, לא בציר
     * ולא ביומן — הסוכן ראה שגיאה, ניסה שוב, והלקוח קיבל אותה
     * פעמיים (ביקורת Codex).
     *
     * זו אותה מחלקה בדיוק שתוקנה בהצעות האוטומטיות, בכיוון ההפוך:
     * שם התיעוד הקדים את השליחה וטען עליה, כאן הוא איחר אותה ואבד.
     * הכלל אחד — **פעולה חיצונית בלתי הפיכה עטופה ברשומה עמידה**.
     *
     * ‎`audit` נכתב כאן כי הוא מתעד את מה שהמשתמש **ביקש**; הציר
     * נכתב רק אחרי ההצלחה, כי הוא קביעה שההודעה נשלחה.
     */
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
          sendState: "pending",
          createdBy: ctx.userId === "" ? null : ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "email_inbox.reply",
        entityType: "contact",
        entityId: contactId,
      });
    });

    try {
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
    } catch (error: unknown) {
      /*
       * ‎**„נכשלה” רק כשידוע שלא יצאה.**
       *
       * ‎`EmailRejectedError` פירושו שהספק **ענה ודחה** — ההודעה
       * בוודאות לא יצאה, ושליחה חוזרת בטוחה. כל השאר — פסק זמן,
       * נפילת רשת, ‎5xx — הוא „איננו יודעים”: ייתכן שהספק קלט ושלח
       * ורק התשובה אבדה.
       *
       * הניסוח הראשון סימן **הכול** „נכשלה”, והמסך אמר „לא נשלחה”.
       * הסוכן היה שולח שוב, והלקוח מקבל את אותה הודעה פעמיים
       * (ביקורת Codex).
       *
       * ‎**וזו בדיוק ההבחנה שבניתי בעצמי ב-`EmailService`** בסבב
       * מוקדם יותר, על אותו שיקול בדיוק — ואז לא השתמשתי בה כאן.
       * ‎„לא ידוע” אינו „לא”, וזה נכון גם כשאני זה שכתב את הכלל.
       */
      const certainlyNotSent = error instanceof EmailRejectedError;
      await this.prisma
        .withTenant((tx) =>
          tx.emailMessage.updateMany({
            where: { id: messageId, tenantId },
            data: { sendState: certainlyNotSent ? "failed" : "unknown" },
          }),
        )
        .catch(() => this.logger.error(`סימון מצב תשובה נכשל: ${messageId}`));
      /*
       * ‎**בתוצאה עמומה הקבצים נשמרים בכל זאת.**
       *
       * ‎`unknown` פירושו שייתכן שהספק קלט ושלח — כלומר ייתכן שהלקוח
       * קיבל את הקבצים. רשומה שמצהירה „לא ידוע אם נשלחה” ומציגה
       * רשימת קבצים **ריקה** משאירה את הסוכן בלי לדעת מה אולי הגיע,
       * ברגע שהטיוטה בדפדפן נסגרת (ביקורת Codex).
       *
       * בדחייה ודאית אין מה לשמור: שום דבר לא יצא, והרשומה כבר
       * אומרת „לא נשלחה”.
       */
      if (!certainlyNotSent) {
        await this.storeOutgoingCopies(tenantId, messageId, outgoing);
        /*
         * ‎**תוצאה עמומה אינה נזרקת — היא מוחזרת.**
         *
         * הזריקה שלחה את המסך למסלול הכישלון הכללי שלו: הטיוטה
         * נשמרת, כפתור השליחה נדלק, והשיחה **אינה** נטענת מחדש —
         * כלומר השורה שכתבתי זה עתה, „לא ידוע אם נשלחה”, לא מוצגת
         * כלל. הסוכן רואה „נסו שוב” ולוחץ, והלקוח מקבל כפול
         * (ביקורת Codex).
         *
         * המצב הזה נוסף בדיוק כדי שהסוכן יראה אותו; זריקה שמונעת
         * ממנו להיטען היא התיקון שנעצר צעד לפני מי שצריך לדעת.
         *
         * דחייה ודאית ממשיכה להיזרק: שם ידוע שלא יצא דבר, והמסלול
         * הכללי — „נסו שוב” עם הטיוטה שמורה — הוא בדיוק הנכון.
         */
        this.logger.warn(
          `תשובה ללקוח הסתיימה בתוצאה עמומה — ההודעה ${messageId} סומנה „לא ידוע”: ${String(error)}`,
        );
        return { state: "unknown" };
      }
      throw error;
    }

    /*
     * ‎**מכאן הלקוח כבר קיבל את ההודעה, ולכן אין יותר „נכשל”.**
     *
     * כשל בטרנזקציה הזו הוא כשל ב**תיעוד**, לא בשליחה. הזרקתו
     * לקורא הייתה אומרת לסוכן שהתשובה לא יצאה — הוא היה שולח שוב,
     * והלקוח מקבל אותה פעמיים (ביקורת Codex). הרשומה כבר קיימת
     * ונושאת את הגוף המלא; מה שחסר הוא האישור ושורת הציר, ושניהם
     * נרשמים ברעש כדי שיהיה אפשר להשלים ידנית.
     */
    /*
     * ‎**שתי כתיבות ולא אחת, ובסדר הזה.**
     *
     * הן היו טרנזקציה משותפת, וכשל בציר — הכתיבה הכבדה מהשתיים —
     * הפיל איתו גם את סימון `sent`. ההודעה נשארה `pending` אף
     * שיצאה, והמסך המשיך לומר „בשליחה…” לנצח.
     *
     * ‎`sendState` הוא עדכון עמודה אחת לפי מפתח ראשי, והוא העובדה
     * שקובעת אם מותר לשלוח שוב; הציר הוא נוחות. אין סיבה שהראשון
     * ייפול בגלל השני, ואטומיות בין השניים אינה שווה את המחיר.
     */
    await this.prisma
      .withTenant((tx) =>
        tx.emailMessage.updateMany({
          where: { id: messageId, tenantId },
          data: { sendState: "sent" },
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `התשובה נשלחה ללקוח וסימון המצב נכשל — ההודעה ${messageId} נשארה ממתינה: ${String(error)}`,
        );
      });
    // הציר קובע „נשלחה תשובה”, ולכן הוא אחרי השליחה ולא לפניה
    await this.prisma
      .withTenant((tx) => this.recordReplyOnTimeline(tx, tenantId, contactId, body))
      .catch((error: unknown) => {
        this.logger.error(
          `התשובה נשלחה ללקוח ושורת הציר נכשלה — ההודעה ${messageId}: ${String(error)}`,
        );
      });

    await this.storeOutgoingCopies(tenantId, messageId, outgoing);
    return { state: "sent" };
  }

  /**
   * עותקי הקבצים שנשלחו — אצלנו, כדי שמה שהלקוח קיבל יופיע בשיחה.
   *
   * מחוץ לטרנזקציה מאותה סיבה כמו בקליטה: העלאה של עשרות MB בתוך
   * טרנזקציה פתוחה מחזיקה חיבור מסד לאורך ההעלאה.
   */
  private async storeOutgoingCopies(
    tenantId: string,
    messageId: string,
    outgoing: readonly { name: string; contentType: string; kind: string; content: Buffer }[],
  ): Promise<void> {
    for (const [ordinal, file] of outgoing.entries()) {
      // אותה זהות ואותו סדר כמו בקליטה: שורה, העלאה, סימון
      const s3Key = `tenants/${tenantId}/email-attachments/${messageId}/${ordinal}`;
      try {
        await this.prisma.withTenant((tx) =>
          tx.emailAttachment.createMany({
            data: [
              {
                id: ulid(),
                tenantId,
                messageId,
                ordinal,
                name: file.name,
                contentType: file.contentType,
                kind: file.kind,
                sizeBytes: file.content.length,
                s3Key,
              },
            ],
            skipDuplicates: true,
          }),
        );
        await this.storage.put(s3Key, file.content, file.contentType, tenantId);
        await this.markUploaded(tenantId, messageId, ordinal);
      } catch (error: unknown) {
        this.logger.error(`שמירת עותק קובץ יוצא נכשלה: ${String(error)}`);
      }
    }
  }

  /**
   * ‎**„הושלם” נכתב אחרי ההעלאה, ורק אז — ובניסיונות חוזרים.**
   *
   * עד לרגע הזה הרשומה מציינת בעלות על המקום בלבד. השיחה מציגה רק
   * מה שהושלם, ולכן **סימון שנכשל מסתיר קובץ שכבר נשמר** — התקלה
   * שהמסננת הזו הכניסה (ביקורת Codex).
   *
   * בקליטה יש רשת ביטחון: המסירה החוזרת של הספק תעלה שוב לאותו
   * מפתח ותסמן. בעותקים היוצאים **אין** — התשובה נשלחת פעם אחת,
   * ואיש לא יחזור. לכן כמה ניסיונות כאן, ולא הישענות על מסירה
   * שהתגובה הזו כלל אינה מבקשת.
   *
   * וכשגם הם נכשלים: הקובץ באחסון, השורה קיימת — כלומר מחיקת לקוח
   * ומחיקת משרד **כן** ימצאו אותו — והוא אינו מוצג. מצב פחוּת,
   * לא מסוכן, ורשום ביומן עם המזהה שדרוש כדי להשלים ידנית.
   */
  private async markUploaded(
    tenantId: string,
    messageId: string,
    ordinal: number,
  ): Promise<void> {
    let last: unknown = null;
    for (let attempt = 0; attempt < MARK_UPLOADED_ATTEMPTS; attempt += 1) {
      try {
        await this.prisma.withExplicitTenant(tenantId, (tx) =>
          tx.emailAttachment.updateMany({
            where: { tenantId, messageId, ordinal },
            data: { uploadedAt: new Date() },
          }),
        );
        return;
      } catch (error: unknown) {
        last = error;
      }
    }
    this.logger.error(
      `סימון השלמת קובץ מצורף נכשל — הקובץ באחסון ואינו מוצג עד להשלמה: ${messageId}/${ordinal} — ${String(last)}`,
    );
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
