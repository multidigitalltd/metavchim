import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import { z } from "zod";
import {
  emailDomainDnsRecords,
  emailDomainRejectionReason,
  emailDomainStatus,
  normalizeEmailDomain,
  senderAddressRejectionReason,
  senderNameRejectionReason,
  type EmailDomainDnsRecord,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import {
  EmailDomainProviderService,
  type ProviderDomain,
} from "../../core/email-domain-provider.service";
import { EmailDomainRecheckService } from "../../core/email-domain-recheck.service";
import { EmailService } from "../../core/email.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * חיבור הדומיין של המשרד לשליחת אימייל — מסך ההגדרות.
 *
 * הזרימה כולה משלושה צעדים שהמנהל רואה: מקלידים דומיין וכתובת
 * שולח → מקבלים שתי רשומות DNS להעתקה → לוחצים "בדקו אימות".
 * כששתי הרשומות מאומתות, מיילים ללקוחות המשרד (הסכם לחתימה)
 * יוצאים מהכתובת של המשרד במקום מכתובת הפלטפורמה.
 *
 * מה שהמשרד **לא** רואה: את הספק (Postmark) ואת טוקן ה-Account —
 * סוד פלטפורמה. הוא מקבל רק את הרשומות של הדומיין שלו.
 *
 * הכללים (אילו דומיינים, כתובת שולח, מתי "מאומת") יושבים
 * ב-`@metavchim/shared` — אותה בדיקה במסך ובשרת.
 */

const ConnectSchema = z.object({
  domain: z.string().trim().min(1).max(300),
  fromEmail: z.string().trim().toLowerCase().min(3).max(254),
  fromName: z.string().trim().min(1).max(80),
});

const SenderSchema = z.object({
  fromEmail: z.string().trim().toLowerCase().min(3).max(254),
  fromName: z.string().trim().min(1).max(80),
});

const TestSchema = z.object({
  to: z.string().trim().toLowerCase().email().max(254),
});

/** מה שהמסך מציג — בלי מזהי ספק פנימיים. */
interface EmailDomainView {
  /** האם הפיצ'ר זמין בכלל — טוקן ה-Account מוגדר בפלטפורמה. */
  available: boolean;
  connected: boolean;
  domain?: string;
  status?: "verified" | "pending";
  records?: EmailDomainDnsRecord[];
  fromEmail?: string;
  fromName?: string;
  verifiedAt?: Date | null;
  lastCheckedAt?: Date | null;
}

type EmailDomainRow = {
  id: string;
  domain: string;
  providerDomainId: string;
  dkimHost: string;
  dkimValue: string;
  returnPathHost: string;
  returnPathValue: string;
  dkimVerified: boolean;
  returnPathVerified: boolean;
  verifiedAt: Date | null;
  fromEmail: string;
  fromName: string;
  lastCheckedAt: Date | null;
};

@Controller("settings/email-domain")
export class EmailDomainController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: EmailDomainProviderService,
    private readonly recheck: EmailDomainRecheckService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  private view(row: EmailDomainRow | null, available: boolean): EmailDomainView {
    if (row === null) return { available, connected: false };
    return {
      available,
      connected: true,
      domain: row.domain,
      status: emailDomainStatus(row),
      records: emailDomainDnsRecords(row, row),
      fromEmail: row.fromEmail,
      fromName: row.fromName,
      verifiedAt: row.verifiedAt,
      lastCheckedAt: row.lastCheckedAt,
    };
  }

  @Get()
  @RequireCapability("settings.manage")
  async get(): Promise<EmailDomainView> {
    const tenantId = TenantContext.current().tenantId;
    const [row, available] = await Promise.all([
      this.prisma.withTenant((tx) =>
        tx.emailDomain.findUnique({ where: { tenantId } }),
      ),
      this.provider.isConfigured(),
    ]);
    return this.view(row, available);
  }

  /**
   * חיבור דומיין: רישום אצל הספק ושמירת הרשומות להצגה.
   *
   * הסדר — קודם הספק, אחר-כך השורה שלנו — אינו מקרי: השורה נושאת
   * שדות NOT NULL שרק הספק יודע (הרשומות, המזהה). התנגשות על
   * הייחודיות הגלובלית של הדומיין מתגלה רק בכתיבה, ואז הדומיין
   * שנוצר אצל הספק נמחק שם — לא נשאיר רישום יתום שחוסם את המשרד
   * שבאמת מחזיק בדומיין.
   */
  @Post()
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async connect(
    @Body(new ZodValidationPipe(ConnectSchema))
    body: z.infer<typeof ConnectSchema>,
  ): Promise<EmailDomainView> {
    const { tenantId, userId } = TenantContext.current();
    if (!(await this.provider.isConfigured())) {
      throw new BadRequestException(
        "חיבור דומיין טרם הופעל בפלטפורמה — פנו לתמיכה",
      );
    }

    const domain = normalizeEmailDomain(body.domain);
    const domainReason = emailDomainRejectionReason(domain);
    if (domainReason !== null) throw new BadRequestException(domainReason);
    const senderReason = senderAddressRejectionReason(body.fromEmail, domain);
    if (senderReason !== null) throw new BadRequestException(senderReason);
    const nameReason = senderNameRejectionReason(body.fromName);
    if (nameReason !== null) throw new BadRequestException(nameReason);

    const existing = await this.prisma.withTenant((tx) =>
      tx.emailDomain.findUnique({ where: { tenantId }, select: { id: true } }),
    );
    if (existing !== null) {
      throw new BadRequestException(
        "כבר מחובר דומיין למשרד — נתקו אותו לפני חיבור דומיין אחר",
      );
    }

    const created = await this.provider.createDomain(domain);
    let row: EmailDomainRow;
    try {
      row = await this.prisma.withTenant((tx) =>
        tx.emailDomain.create({
          data: {
            id: ulid(),
            tenantId,
            domain,
            provider: "postmark",
            providerDomainId: created.providerDomainId,
            dkimHost: created.dkimHost,
            dkimValue: created.dkimValue,
            returnPathHost: created.returnPathHost,
            returnPathValue: created.returnPathValue,
            dkimVerified: created.dkimVerified,
            returnPathVerified: created.returnPathVerified,
            fromEmail: body.fromEmail,
            fromName: body.fromName,
            createdBy: userId === "" ? null : userId,
          },
        }),
      );
    } catch (error) {
      /*
       * **כל** כתיבה שנכשלה מפצה את הרישום אצל הספק, לא רק התנגשות
       * הייחודיות: גם תקלת מסד חולפת משאירה דומיין רשום שם בלי שורה
       * אצלנו — והניסיון הבא של המנהל היה נתקל ב"כבר רשום אצל הספק"
       * בלי שום דרך לתקן מהמסך (ביקורת Codex). מחיקת הפיצוי עצמה
       * best-effort ובשקט: ההודעה למנהל היא העיקר, וכשל בה נרשם
       * ממילא ביומן הספק.
       */
      await this.provider.deleteDomain(created.providerDomainId).catch(() => {});
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BadRequestException(
          "הדומיין הזה כבר מחובר במערכת — אם הוא בבעלות המשרד שלכם, פנו לתמיכה",
        );
      }
      throw error;
    }

    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.email_domain_connect",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { domain, fromEmail: body.fromEmail },
      }),
    );
    return this.view(row, true);
  }

  /**
   * בדיקת אימות — הספק ניגש ל-DNS עכשיו. המימוש עצמו יושב
   * ב-`EmailDomainRecheckService`, אותו מימוש שהסורק התקופתי מריץ
   * — כדי שכפתור וסורק יכתבו את אותם דגלים באותם כללים.
   */
  @Post("verify")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async verify(): Promise<EmailDomainView> {
    const tenantId = TenantContext.current().tenantId;
    const result = await this.recheck.recheckTenant(tenantId);
    if (result === null) throw new NotFoundException("לא מחובר דומיין למשרד");
    /*
     * ביקורת רק על מעבר ראשון לאימות מלא, ורק כאן ולא בסורק:
     * היומן מתעד פעולות של בני אדם, והסורק אינו כזה (וגם אין לו
     * הקשר בקשה לרשום ממנו).
     */
    if (result.nowVerified && !result.wasVerified && result.row.verifiedAt !== null) {
      await this.prisma.withTenant((tx) =>
        this.audit.record(tx, {
          action: "settings.email_domain_verified",
          entityType: "tenant",
          entityId: tenantId,
          metadata: { domain: result.row.domain },
        }),
      );
    }
    return this.view(result.row, true);
  }

  /** עדכון כתובת השולח ושם התצוגה — על הדומיין שכבר חובר. */
  @Patch()
  @RequireCapability("settings.manage")
  async updateSender(
    @Body(new ZodValidationPipe(SenderSchema))
    body: z.infer<typeof SenderSchema>,
  ): Promise<EmailDomainView> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.emailDomain.findUnique({ where: { tenantId } }),
    );
    if (row === null) throw new NotFoundException("לא מחובר דומיין למשרד");

    const senderReason = senderAddressRejectionReason(body.fromEmail, row.domain);
    if (senderReason !== null) throw new BadRequestException(senderReason);
    const nameReason = senderNameRejectionReason(body.fromName);
    if (nameReason !== null) throw new BadRequestException(nameReason);

    const updated = await this.prisma.withTenant((tx) =>
      tx.emailDomain.update({
        where: { tenantId },
        data: { fromEmail: body.fromEmail, fromName: body.fromName },
      }),
    );
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.email_domain_sender_update",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { fromEmail: body.fromEmail },
      }),
    );
    return this.view(updated, true);
  }

  /**
   * מייל בדיקה מהכתובת של המשרד. נדרש אימות מלא — לפני כן המייל
   * היה יוצא מכתובת הפלטפורמה, והמסך היה מדווח "עובד" על החיבור
   * הלא-נכון.
   */
  @Post("test")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async test(
    @Body(new ZodValidationPipe(TestSchema))
    body: z.infer<typeof TestSchema>,
  ): Promise<{ sentTo: string }> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.emailDomain.findUnique({ where: { tenantId } }),
    );
    if (row === null) throw new NotFoundException("לא מחובר דומיין למשרד");
    if (emailDomainStatus(row) !== "verified") {
      throw new BadRequestException("הדומיין טרם אומת — השלימו את רשומות ה-DNS ובדקו אימות");
    }
    await this.email.sendTenantTest(tenantId, body.to);
    return { sentTo: body.to };
  }

  /** ניתוק: מחיקה אצל הספק ואצלנו. מיילים חוזרים לכתובת הפלטפורמה. */
  @Delete()
  @RequireCapability("settings.manage")
  @HttpCode(204)
  async disconnect(): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.emailDomain.findUnique({
        where: { tenantId },
        select: { providerDomainId: true, domain: true },
      }),
    );
    if (row === null) throw new NotFoundException("לא מחובר דומיין למשרד");
    /*
     * קודם הספק ואז השורה: אם המחיקה אצלו נכשלת, השורה נשארת
     * והמנהל מנסה שוב. הסדר ההפוך היה משאיר דומיין רשום אצל הספק
     * בלי שורה — והמשרד לא היה יכול לחבר אותו מחדש לעולם.
     */
    await this.provider.deleteDomain(row.providerDomainId);
    await this.prisma.withTenant((tx) =>
      tx.emailDomain.delete({ where: { tenantId } }),
    );
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.email_domain_disconnect",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { domain: row.domain },
      }),
    );
  }
}

/**
 * הטיפוס מיוצא לבדיקה סטטית בלבד — המסך בונה את הצורה שלו
 * מהתשובה עצמה.
 */
export type { EmailDomainView, ProviderDomain };
