import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ulid } from "ulid";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ATTACHMENT_MAX_COUNT,
  EMAIL_OUTBOUND_ATTACHMENT_TOTAL_BYTES,
  SUPPORT_DESK_LIMIT,
  emailAttachmentKind,
  inboundBody,
  inboundProviderMessageId,
  inboundToken,
  isProviderInboundRoute,
  parseSenderEmail,
  parseSenderName,
  referenceFromSubject,
  replyAddressFor,
  subjectWithReference,
  safeAttachmentName,
  supportReplyRejectionReason,
  supportSubjectOrDefault,
  waitingFirst,
  type InboundEmailPayload,
  type SupportStatus,
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
   * ‎**זורקת בדיוק במקרה אחד: קובץ שלא נשמר.**
   *
   * כל שאר הכשלים נבלעים, כי ספק הדואר חוזר על הודעה שלא נענתה
   * וניסיון חוזר על פנייה שכבר נקלטה הוא רעש; הדה-דופליקציה נשענת
   * על `provider_message_id`.
   *
   * קובץ הוא היוצא מן הכלל: 200 אומר לספק „התקבל”, ואז אין לו סיבה
   * למסור שוב — והצילום שהלקוח צירף אבד לתמיד בעוד הפנייה נראית
   * שלמה (ביקורת Codex). המסירה החוזרת בטוחה עכשיו: ההודעה מזוהה
   * ככפילות, והקבצים ממשיכים מהמקום שנעצר לפי `(הודעה, מקום)`.
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

    /*
     * ‎**הניתוב אינו כאן.** `InboundMailService` כבר הכריע שההודעה
     * הזאת שייכת לתמיכה — הוא זה שמכיר את שני היעדים, ולכן גם
     * סינון המענים האוטומטיים יושב שם: הודעת אי-מסירה אינה פנייה
     * לתמיכה **וגם** אינה תשובת לקוח.
     *
     * מה שנשאר כאן הוא השאלה הפנימית: לאיזה שרשור.
     */
    const supportThread =
      token === null
        ? null
        : await this.prisma.supportThread.findUnique({
            where: { replyToken: token },
            select: { id: true, tenantId: true },
          });

    const thread = await this.resolveThread({
      token,
      knownThread: supportThread,
      senderEmail,
      senderName,
      subject,
    });
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
     * ‎**והקבצים אינם מדולגים במסירה חוזרת — הם מושלמים.**
     *
     * הם היו מדולגים לגמרי, וזו הייתה ההזדמנות האחרונה להשלים אותם:
     * ההודעה נראתה שלמה על השולחן, והצילום שהלקוח צירף פשוט לא היה
     * שם (ביקורת Codex). עכשיו המזהים דטרמיניסטיים — `(הודעה, מקום)`
     * ולא ULID אקראי — ולכן מסירה חוזרת ממשיכה מהמקום שנעצר במקום
     * להכפיל או לוותר.
     *
     * הקבצים נשמרים **אחרי** ההודעה ולא בטרנזקציה אחת איתה: העלאה
     * לאחסון היא קריאת רשת, וטרנזקציה שמחזיקה חיבור למסד לאורכה היא
     * בדיוק מה שנועל את המסד כשספק האחסון מאט.
     */
    /*
     * ‎**החיפוש מותנה במזהה קיים, ולא רק ב„כפילות”.**
     *
     * ‎`providerMessageId` יכול להיות `null` (פנייה בלי מזהה), ואז
     * ‎`findFirst({ providerMessageId: null })` מוצא **הודעה כלשהי**
     * בלי מזהה — כלומר תולה את הקבצים בפנייה של אדם אחר. בפועל
     * ‎`P2002` אינו יכול לקרות על `null`, כי Postgres מתייחס ל-NULL
     * כערכים שונים באינדקס ייחודי; אבל תנאי שנשען על נימוק במקום
     * על בדיקה הוא בדיוק הצורה שנשברת כשמישהו משנה את האינדקס.
     */
    const providerMessageId = inboundProviderMessageId(payload);
    const existingId =
      !duplicate
        ? messageId
        : providerMessageId === null
          ? null
          : ((
              await this.prisma.supportMessage.findFirst({
                where: { providerMessageId },
                select: { id: true },
              })
            )?.id ?? null);
    const pending =
      existingId === null
        ? 0
        : await this.storeAttachments(
            thread.id,
            thread.tenantId,
            existingId,
            incoming,
            duplicate,
          );

    await this.prisma.supportThread.update({
      where: { id: thread.id },
      // פנייה חדשה פותחת מחדש שרשור סגור — הפונה חזר, והוא מחכה
      data: { lastMessageAt: new Date(), readAt: null, status: "open" },
    });

    /*
     * ‎**קובץ שלא נשמר מבקש מסירה חוזרת — אחרי שהשרשור עודכן.**
     *
     * הכשל נבלע ב-200, ולכן לספק לא הייתה סיבה למסור שוב והצילום
     * אבד לתמיד (ביקורת Codex). זריקה **כאן** ולא במקום הכשל עצמו:
     * לפני העדכון היא הייתה משאירה את הפנייה בשרשור סגור־ונקרא,
     * כלומר מנציחה בדיוק את המצב שהמסירה החוזרת באה לתקן.
     *
     * המסירה החוזרת בטוחה: ההודעה מזוהה ככפילות לפי מזהה הספק,
     * והקבצים ממשיכים מהמקום שנעצר.
     */
    if (pending > 0) {
      throw new ServiceUnavailableException(
        `שמירת ${pending} קבצים בפניית התמיכה נכשלה — נדרשת מסירה חוזרת`,
      );
    }
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
  /**
   * ‎**הקבצים של הודעה אחת — ומה שלא הושלם, מושלם.**
   *
   * מחזיר כמה קבצים נותרו לא-מושלמים, כדי שהקורא יוכל לבקש מסירה
   * חוזרת. שקט כאן פירושו שהצילום שהלקוח צירף נעלם והפנייה נראית
   * שלמה.
   *
   * ‎**השורה קודם, ולכן אין אובייקט בלי שורה.** זו התכונה שסוגרת את
   * חור המחיקה מהשורש: מחיקת לקוח ומחיקת משרד עוברות על **שורות**,
   * וכאן אין מפתח שנכתב בלי שורה שתמצא אותו. אין צורך בפיצוי, ולכן
   * אין מה שימחק בטעות קובץ חי.
   *
   * ‎**ואין חכירה ואין השתלטות.** שתיהן נוסו בתיבת הלקוחות וילדו שתי
   * תקלות: תיאור של איך הקריאה **התחילה** במקום אם הבעלות עדיין
   * בתוקף, ושחרור תביעה שפגה שמחק אובייקט שכותב אחר כבר השלים. המפתח
   * דטרמיניסטי, ולכן העלאה חוזרת של אותם בתים לאותו מפתח היא
   * **אידמפוטנטית** — אין מה לתאם ואין למי לתת בעלות.
   *
   * ‎**וה-`threadId` במפתח, לא ה-`tenantId`.** הטבלה יושבת ברמת
   * הפלטפורמה: פנייה יכולה להגיע גם ממי שאינו לקוח של אף משרד, ואז
   * אין דייר בכלל. השרשור הוא הזהות שקיימת תמיד.
   */
  private async storeAttachments(
    threadId: string,
    tenantId: string | null,
    messageId: string,
    attachments: { kind: string; name: string; contentType: string; content: Buffer }[],
    resume: boolean,
  ): Promise<number> {
    /*
     * ‎**„נתבע” אינו „הועלה”**, ולכן הדילוג הוא על מה ש**הושלם**
     * בלבד: שורה קיימת ולא-מושלמת היא בדיוק מה שבאנו להשלים.
     */
    const completed = new Set<number>();
    if (resume) {
      const rows = await this.prisma.supportAttachment.findMany({
        where: { messageId, uploadedAt: { not: null } },
        select: { ordinal: true },
      });
      for (const row of rows) {
        if (row.ordinal !== null) completed.add(row.ordinal);
      }
      this.logger.log(
        `מסירה חוזרת של פניית תמיכה — ${completed.size} מתוך ${attachments.length} קבצים הושלמו`,
      );
    }

    let pending = 0;
    for (const [ordinal, attachment] of attachments.entries()) {
      if (completed.has(ordinal)) continue;
      const s3Key = `support/${threadId}/${messageId}/${ordinal}`;
      try {
        // ‏`skipDuplicates` ללא `continue`: התביעה כבר קיימת מהניסיון
        // הקודם, וההעלאה שאחריה היא מה שנשאר לעשות
        await this.prisma.supportAttachment.createMany({
          data: [
            {
              id: ulid(),
              messageId,
              ordinal,
              kind: attachment.kind,
              name: attachment.name,
              contentType: attachment.contentType,
              sizeBytes: attachment.content.length,
              s3Key,
            },
          ],
          skipDuplicates: true,
        });
        await this.storage.put(s3Key, attachment.content, attachment.contentType, tenantId);
        await this.prisma.supportAttachment.updateMany({
          where: { messageId, ordinal },
          data: { uploadedAt: new Date() },
        });
      } catch (error: unknown) {
        /*
         * ‎**ולא מוחקים דבר.** השורה נשארת לא-מושלמת, והמסירה החוזרת
         * הבאה תעלה שוב לאותו מפתח ותסמן. מחיקה כאן היא ההזדמנות
         * היחידה להשמיד קובץ של לקוח, ואין לה תמורה.
         */
        pending += 1;
        this.logger.error(`שמירת קובץ בפניית תמיכה נכשלה: ${String(error)}`);
      }
    }
    return pending;
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
    /** השרשור שכבר נמצא לפי הטוקן בשלב הניתוב — לא נשלף פעמיים. */
    knownThread: { id: string; tenantId: string | null } | null;
    senderEmail: string | null;
    senderName: string;
    subject: string;
  }): Promise<{ id: string; tenantId: string | null } | null> {
    if (input.knownThread !== null) return input.knownThread;
    if (input.token !== null) {
      // טוקן לא מוכר אינו סיבה לזרוק פנייה — ממשיכים לשרשור לפי שולח
      this.logger.warn("פניית תמיכה עם טוקן לא מוכר — משויכת לפי כתובת השולח");
    }

    /*
     * ‎**המספר שבנושא הוא רשת הביטחון של הטוקן.**
     *
     * מי שפותח מייל **חדש** במקום להשיב מאבד את ה-`+token`, ואז
     * ההמשך של אותה שיחה נפתח כפנייה נפרדת — ומי שמטפל מגלה שתי
     * פניות על אותו דבר בלי לדעת שהן אחת. המספר נדבק לנושא בכל
     * תשובה שיוצאת, ולכן הוא חוזר אלינו מעצמו גם בלי הטוקן.
     *
     * הוא **רק** מפתח חיפוש: הנושא הוא טקסט של שולח, וכל אחד יכול
     * לכתוב בו מספר. לכן ההצמדה מותנית גם בכתובת השולח — אחרת מי
     * שמנחש מספר היה נכנס לשרשור של אדם אחר.
     */
    const fromSubject = referenceFromSubject(input.subject);
    if (fromSubject !== null && input.senderEmail !== null) {
      const byReference = await this.prisma.supportThread.findFirst({
        where: { reference: fromSubject, contactEmail: input.senderEmail },
        select: { id: true, tenantId: true },
      });
      if (byReference !== null) return byReference;
    }

    if (input.senderEmail !== null) {
      /*
       * ‎**כל מה שאינו סגור — לא רק `open`.**
       *
       * זה האתר השלישי שבו „ממתין” נוסח בחיוב, והוא נשבר באותה
       * צורה: מרגע ש-`in_progress` נולד, מי שכתב שוב בזמן שהפנייה
       * שלו **בטיפול** קיבל שרשור שני עם מספר פנייה חדש — כלומר
       * בדיוק הפיצול שהמספר נועד למנוע (ביקורת Codex).
       *
       * ‎`not: "closed"` ולא `in [...]`: סטטוס שייוולד מחר ייכנס
       * מעצמו, וגם ערך ישן שנשאר במסד.
       */
      const waiting = await this.prisma.supportThread.findFirst({
        where: { contactEmail: input.senderEmail, status: { not: "closed" } },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true, tenantId: true },
      });
      if (waiting !== null) return waiting;
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
      /** מספר הפנייה — משותף עם פניות הכפתור. */
      reference: number;
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
     * **הממתינים נשלפים בשאילתה נפרדת, ולא לפי סדר האלפבית.**
     *
     * ‎`orderBy: { status: "asc" }` נראה כמו „פתוחים קודם” ואינו
     * כזה: `closed` קטן מ-`open` לקסיקוגרפית, ולכן הוא דחף את כל
     * הסגורים לראש. עם `take` פירושו שמאה סגורים מוחקים מהמסך את
     * כל מי שבאמת מחכה (ביקורת Codex). סדר שנשען על איות הערך הוא
     * סדר שמשתנה כשמישהו יקרא לסטטוס בשם אחר.
     *
     * הדלי הראשון מוגדר ב**שלילה** — כל מה שאינו `closed`. ניסוח
     * חיובי (`status: "open"`) היה נכון רק כשהיו שני מצבים; מרגע
     * ש-`in_progress` נולד, שרשור שמישהו לקח לטיפול נפל לדלי של
     * הסגורים ונעלם מהמסך בדיוק כשהוא באחריות מישהו (ביקורת
     * Codex). הכלל עצמו ב-`waitingFirst`, משותף עם פניות הכפתור.
     */
    const columns = {
      id: true,
      reference: true,
      subject: true,
      contactName: true,
      contactEmail: true,
      tenantId: true,
      status: true,
      readAt: true,
      lastMessageAt: true,
    } as const;
    const rows = await waitingFirst(
      (bucket, take) =>
        this.prisma.supportThread.findMany({
          where: bucket === "waiting" ? { status: { not: "closed" } } : { status: "closed" },
          orderBy: { lastMessageAt: "desc" },
          take,
          select: columns,
        }),
      SUPPORT_DESK_LIMIT,
    );
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
    reference: number;
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
            /*
             * ‎**רק מה שהועלה.** השורה נכתבת לפני ההעלאה, ולכן
             * צירוף שטרם הושלם הוא קישור שבור: הוא היה מופיע
             * בשרשור עם שם וגודל, וההורדה שלו נכשלת. אותו כלל
             * בדיוק כמו בתיבת הלקוחות.
             */
            attachments: {
              where: { uploadedAt: { not: null } },
              select: { id: true, name: true, kind: true, sizeBytes: true },
            },
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
      reference: row.reference,
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
        /*
         * ‎**המספר נדבק לנושא, וזה מה שמחזיר אותו אלינו.**
         *
         * הטוקן ב-`Reply-To` עובד רק כשהפונה **משיב**; מי שפותח
         * מייל חדש מאבד אותו, וההמשך של אותה שיחה נפתח כפנייה
         * נפרדת. המספר שורד את זה, והוא גם מה שמאפשר לפונה לצטט
         * „פנייה 1042” בטלפון.
         */
        subjectWithReference(
          thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
          thread.reference,
        ),
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
          ...(config === null
            ? {}
            : await this.sender(config.address).then((sender) =>
                sender === null ? {} : { sender },
              )),
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

    /*
     * ‎`resume: false` — התשובה נכתבת פעם אחת ואין מי שימסור אותה
     * שוב, ולכן אין תביעות קודמות להשלים. כשל כאן מדווח ביומן
     * ונשאר כשורה לא-מושלמת, שאינה מוצגת בשרשור.
     */
    await this.storeAttachments(threadId, thread.tenantId, messageId, attachments, false);

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
  /**
   * מה שיוצא מהתמיכה — שולח, וכתובת לחזור אליה.
   *
   * ציבורית כי גם **תשובה לפנייה שנפתחה במערכת** (`SupportService`)
   * שייכת לתמיכה. שם היא יצאה מהשולח הכללי, כלומר מי שהשיב עליה
   * כתב לתיבה שאיש אינו קורא — בעוד אותה תשובה בדיוק מהתיבה הנכנסת
   * כן חזרה לשרשור. שני נתיבים לאותו דבר, ואחד מהם שקט.
   *
   * ‎**`replyTo` הוא העיקר, לא `from`.** מה שמחזיר את הפונה אלינו
   * הוא הכתובת שהוא משיב אליה, ולא זו שכתובה בשורת „מאת”.
   *
   * ‎`null` בשניהם = התיבה לא הוגדרה, ונשארת התנהגות ברירת המחדל.
   */
  async outgoing(): Promise<{
    sender: { from: string; token?: string | undefined } | null;
    replyTo: string | null;
  }> {
    const config = await this.config();
    if (config === null) return { sender: null, replyTo: null };
    return { sender: await this.sender(config.address), replyTo: config.address };
  }

  /**
   * ‎**כתובת קליטה של הספק אינה שולח.**
   *
   * ‏Postmark דורשת חתימת שולח מאומתת, ו-`abc123@inbound.postmarkapp.com`
   * היא נתיב קליטה בלבד — הודעה שיוצאת ממנה נדחית, והדחייה נבלעת
   * בשני הנתיבים שקוראים לכאן (ביקורת Codex, P1). במצב הזה מוותרים
   * על שורת „מאת” ונשארים עם השולח הכללי; מה שבאמת נדרש —
   * ש**התשובה** תחזור לתיבה — נשמר ב-`Reply-To`, שאין עליו מגבלה
   * כזו.
   *
   * מי שהגדיר כתובת בדומיין שלו ואימת אותו ממשיך לשלוח ממנה.
   */
  private async sender(
    address: string,
  ): Promise<{ from: string; token?: string | undefined } | null> {
    if (isProviderInboundRoute(address)) return null;
    const token = (await this.settings.get("supportServerToken")) ?? "";
    return { from: `תמיכה מתווכים <${address}>`, ...(token === "" ? {} : { token }) };
  }

  /** סגירה ופתיחה מחדש — הסטטוס הוא מה שמסדר את הרשימה. */
  async setStatus(threadId: string, status: SupportStatus): Promise<{ ok: true }> {
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
    /*
     * ‎**אותו תנאי כמו ברשימה.** רשומה בלי `uploadedAt` היא תביעה על
     * מקום שטרם הועלה, ולכן ההורדה שלה נכשלת מול האחסון בשגיאה שאינה
     * אומרת דבר. הרשימה כבר סיננה אותה — והשער לא, כלומר אותה צורה
     * בדיוק שהארכיון נשבר בה פעמיים היום: הרשימה והשער שמכריעים
     * בכללים שונים.
     */
    const row = await this.prisma.supportAttachment.findFirst({
      where: { id: attachmentId, uploadedAt: { not: null } },
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
