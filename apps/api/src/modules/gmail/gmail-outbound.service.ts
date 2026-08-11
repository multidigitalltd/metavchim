import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { ContactsService } from "../contacts/contacts.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { GmailService, type GmailLinkRow } from "./gmail.service";

/**
 * דואר יוצא מהתיבה המחוברת — התשובה ללקוח, מתוך הכרטיס.
 *
 * המתווך עונה מהמערכת ולא מ-Gmail בגלל דבר אחד: **התיעוד**. תשובה
 * שנשלחה מהתיבה ישירות לא מותירה זכר בכרטיס, ובעוד שבוע אף אחד לא
 * זוכר מה נענה ומתי. כאן ההודעה נשלחת ונרשמת בציר הזמן באותה פעולה.
 *
 * הכתובת אינה מתקבלת מהמסך אלא נשלפת מהכרטיס לפי מזההו: מסך שיכול
 * להכתיב יעד שליחה הופך את התיבה של הסוכן לצינור לשליחת דואר לכל
 * כתובת שהיא, וזו בדיוק הדלת שלא רוצים לפתוח.
 */
@Injectable()
export class GmailOutboundService {
  private readonly logger = new Logger(GmailOutboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    private readonly contacts: ContactsService,
  ) {}

  async sendToContact(
    link: GmailLinkRow,
    input: { contactId: string; subject: string; body: string; leadId?: string },
  ): Promise<void> {
    const tenantId = link.tenantId;

    const to = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      this.contacts.emailFor(tx, input.contactId),
    );
    if (to === undefined || to === "") {
      throw new BadRequestException("ללקוח אין כתובת אימייל בכרטיס");
    }

    // ליד שנמסר מהמסך מאומת מול הלקוח **לפני** השליחה: אחרת אפשר
    // היה לתעד תשובה בכרטיס של אדם אחר
    if (input.leadId !== undefined) {
      await this.assertLeadBelongsToContact(tenantId, input.leadId, input.contactId);
    }

    await this.gmail.sendMail(link, { to, subject: input.subject, body: input.body });

    /*
     * התיעוד נכתב **אחרי** השליחה בהצלחה. הסדר ההפוך היה יוצר רישום
     * "נשלח" על מייל שנכשל — והמתווך היה ממתין לתשובה שלא תגיע.
     */
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const leadId = input.leadId ?? (await this.openLeadFor(tx, tenantId, input.contactId));
      if (leadId === null) return;

      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId,
          leadId,
          kind: "note",
          direction: "out",
          content: `מייל נשלח ל-${to}\nנושא: ${input.subject}\n\n${input.body}`.slice(0, 4000),
        },
      });
    });

    this.logger.log(`מייל יוצא נשלח (tenant ${tenantId})`);
  }

  /**
   * הליד הפתוח של הלקוח — כדי שתשובה שנשלחה מכרטיס הלקוח (ולא
   * מכרטיס ליד מסוים) תתועד במקום הנכון. אין ליד פתוח? ההודעה
   * נשלחה בכל זאת, פשוט בלי רישום — עדיף מלהיכשל בשליחה.
   */
  private async openLeadFor(
    tx: TenantTx,
    tenantId: string,
    contactId: string,
  ): Promise<string | null> {
    const lead = await tx.lead.findFirst({
      where: {
        tenantId,
        contactId,
        status: { in: ["new", "in_progress", "waiting_customer"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return lead?.id ?? null;
  }

  /** אימות שהליד שייך ללקוח — מונע תיעוד תשובה בכרטיס של אדם אחר. */
  async assertLeadBelongsToContact(
    tenantId: string,
    leadId: string,
    contactId: string,
  ): Promise<void> {
    const lead = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.lead.findFirst({ where: { id: leadId, tenantId, contactId }, select: { id: true } }),
    );
    if (!lead) throw new NotFoundException("הליד אינו שייך ללקוח הזה");
  }
}
