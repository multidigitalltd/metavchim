import { Injectable, Logger } from "@nestjs/common";
import {
  autoReplyReason,
  inboundDestination,
  inboundHeaders,
  inboundReturnPath,
  inboundToken,
  parseSenderEmail,
  type InboundEmailPayload,
} from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";
import { EmailInboxService } from "../email-inbox/email-inbox.service";
import { SupportInboxService } from "../support/support-inbox.service";

/**
 * ‎**דלת אחת לכל הדואר הנכנס — ולא שתיים שמתנהגות הפוך.**
 *
 * ## מה היה שבור
 *
 * היו שני נתיבים ציבוריים, כל אחד בתוך המודול שלו:
 *
 * | נתיב | מה עשה עם טוקן שאינו מוכר |
 * |---|---|
 * | `public/email/inbound` | **זרק בשקט** |
 * | `public/support/inbound` | פתח פנייה חדשה |
 *
 * זה עבד כל עוד לכל אחד הייתה כתובת נפרדת אצל הספק. ברגע שכל הדואר
 * של הדומיין נכנס לשרת אחד — כלומר Webhook אחד — ההתנהגות תלויה
 * ב**איזו כתובת URL הוגדרה שם**, וזה פרט הגדרה ולא החלטה. מי
 * שהגדיר את הנתיב של תיבת הלקוחות מאבד כל מייל שאינו תשובה: הוא
 * נזרק, אין לו שורה בשום מקום, ואיש אינו יודע שהוא היה.
 *
 * ## ההכרעה עברה לכאן
 *
 * שני הנתיבים עוברים דרך השירות הזה, ולכן **אין הבדל ביניהם**. מי
 * שכבר הגדיר אחד מהם אצל הספק אינו צריך לשנות דבר, ואי אפשר לאבד
 * דואר בגלל בחירת כתובת.
 *
 * הפרדת המודול אינה קוסמטית: `SupportModule` היה צריך את
 * `EmailInboxModule` כדי למסור לו תשובות לקוחות, ולוּ גם הכיוון
 * ההפוך היה נדרש — נוצר מעגל. מודול שלישי שמייבא את שניהם, ואיש
 * אינו מייבא אותו, פותר את זה בלי `forwardRef`.
 */
@Injectable()
export class InboundMailService {
  private readonly logger = new Logger(InboundMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportInboxService,
    private readonly tenantInbox: EmailInboxService,
  ) {}

  /**
   * מנתב הודעה נכנסת. לעולם אינו זורק: הקורא הוא Webhook ציבורי,
   * ושגיאה שם פירושה שהספק ינסה שוב לנצח.
   */
  async route(payload: InboundEmailPayload): Promise<void> {
    /*
     * ‎**מה שמכונה שלחה אינו פנייה.**
     *
     * הבדיקה כאן ולא בתוך אחד השירותים, כי היא נכונה לשני הכיוונים:
     * הודעת אי-מסירה אינה פנייה לתמיכה **וגם** אינה תשובת לקוח.
     * דומיין שלם מקבל „מחוץ למשרד”, אי-מסירה ואישורי קריאה, וכל
     * אחת מהן הייתה פותחת פנייה עם מספר משלה — ומענה אוטומטי
     * לתשובה שלנו סוגר לולאה.
     */
    const senderEmail = parseSenderEmail(payload.From ?? "");
    const automated = autoReplyReason({
      subject: payload.Subject ?? "",
      headers: inboundHeaders(payload),
      returnPath: inboundReturnPath(payload),
      fromEmail: senderEmail ?? undefined,
    });
    if (automated !== null) {
      this.logger.log(`הודעה נכנסת לא נקלטה: ${automated}`);
      return;
    }

    const token = inboundToken(payload);
    const [supportThread, tenantToken] =
      token === null
        ? [null, null]
        : await Promise.all([
            this.prisma.supportThread.findUnique({
              where: { replyToken: token },
              select: { id: true },
            }),
            this.prisma.emailReplyToken.findUnique({
              where: { id: token },
              select: { id: true },
            }),
          ]);

    const destination = inboundDestination({
      supportThread: supportThread !== null,
      tenantToken: tenantToken !== null,
    });

    switch (destination.kind) {
      case "drop":
        this.logger.error(`הודעה נכנסת נזרקה: ${destination.reason}`);
        return;
      case "tenant_reply":
        // תשובת לקוח של משרד — לא פנייה לתמיכה
        await this.tenantInbox.processInbound(payload);
        return;
      case "support_thread":
      case "support_new":
        await this.support.processInbound(payload);
        return;
    }
  }
}
