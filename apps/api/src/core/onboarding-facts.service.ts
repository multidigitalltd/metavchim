import { Injectable } from "@nestjs/common";
import {
  WHATSAPP_CONNECTION_LIVE_STATUSES,
  emailDomainStatus,
  type OnboardingFacts,
} from "@metavchim/shared";
import { loadEnv } from "../config/env";
import { EmailDomainProviderService } from "./email-domain-provider.service";
import { PrismaService } from "./prisma.service";

/**
 * ‎**מצב הקליטה של משרד — מקור אחד למסך ולמסלול ההמרה.**
 *
 * ‏מסך „מה נשאר להפעיל” מציג אותו, ומסלול ההמרה בוחר לפיו למי יוצאת
 * ‏הודעה („הצעד החיוני הבא טרם הושלם”). שתי ספירות נפרדות היו נפרדות
 * ‏בעריכה הראשונה, ואז משרד היה מקבל במייל הזמנה לצעד שהמסך כבר
 * ‏מסמן כגמור.
 *
 * ‏הדייר מפורש ולא מהקשר הבקשה: הסבב של המסלול רץ בלי בקשה.
 */
@Injectable()
export class OnboardingFactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailDomainProvider: EmailDomainProviderService,
  ) {}

  async facts(tenantId: string): Promise<OnboardingFacts> {
    const env = loadEnv();

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const filled = (key: string): boolean =>
      typeof settings[key] === "string" &&
      (settings[key] as string).trim() !== "";

    const [
      activeUsers,
      properties,
      buyers,
      leadWebhooks,
      emailDomain,
      emailDomainAvailable,
      whatsappLines,
    ] =
      await Promise.all([
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.property.count({ where: { tenantId, deletedAt: null } }),
      ),
      this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.buyer.count({ where: { tenantId, deletedAt: null } }),
      ),
      this.prisma.leadWebhook.count({ where: { tenantId } }),
      /*
       * שני דגלי האימות, ולא עצם קיום השורה: דומיין שהוזן ורשומות
       * ה-DNS שלו טרם עברו — השליחה ממנו עדיין נופלת לכתובת
       * המערכת. ההכרעה עצמה ב-`emailDomainStatus` המשותפת, כדי
       * שהמסך והצעד יסכימו על „מחובר”.
       */
      this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.emailDomain.findUnique({
          where: { tenantId },
          select: { dkimVerified: true, returnPathVerified: true },
        }),
      ),
      /*
       * בלי טוקן חשבון אצל הספק נתיב החיבור דוחה את הבקשה במפורש,
       * ולכן הצעד כולו נשמט. הצגתו הייתה מפנה את המשרד למסך שאומר
       * „הפיצ'ר אינו מופעל” (ביקורת Codex).
       */
      this.emailDomainProvider.isConfigured(),
      /*
       * קו וואטסאפ ביזנס שחובר בפועל — ולא שדה שהוקלד. „ההיסטוריה
       * מסתנכרנת” ו„דרוש אמצעי תשלום” הם קו שכבר חובר; רק „מנותק”
       * ו„החיבור לא הושלם” אינם.
       */
      this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.whatsAppBusinessConnection.count({
          where: { tenantId, status: { in: [...WHATSAPP_CONNECTION_LIVE_STATUSES] } },
        }),
      ),
    ]);

    return {
      // מספר הרישיון הוא פרט חובה בהזמנה בכתב — בלעדיו ההסכמים פגומים
      officeProfileComplete:
        (tenant?.name ?? "").trim() !== "" &&
        filled("licenseNumber") &&
        filled("officePhone"),
      activeUsers,
      properties,
      buyers,
      leadWebhookConfigured: leadWebhooks > 0,
      whatsappConfigured: whatsappLines > 0,
      emailDomainAvailable,
      emailDomainVerified:
        emailDomain !== null && emailDomainStatus(emailDomain) === "verified",
      transcriptionAvailable:
        env.STT_URL !== undefined && env.STT_SECRET !== undefined,
    };
  }
}
