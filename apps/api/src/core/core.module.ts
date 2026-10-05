import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { ActivationNudgeService } from "./activation-nudge.service";
import { AuditService } from "./audit.service";
import { AutomationQuotaService } from "./automation-quota.service";
import { CardcomService } from "./cardcom.service";
import { CryptoService } from "./crypto.service";
import { EmailDomainProviderService } from "./email-domain-provider.service";
import { EmailDomainRecheckService } from "./email-domain-recheck.service";
import { EmailService } from "./email.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
import { LeadPricingService } from "./lead-pricing.service";
import { PlanCatalogService } from "./plan-catalog.service";
import { GeminiService } from "./gemini.service";
import { GeocodingService } from "./geocoding.service";
import { CreditEconomyService } from "./credit-economy.service";
import { CreditExpiryService } from "./credit-expiry.service";
import { OnboardingOutreachService } from "./onboarding-outreach.service";
import { Pbx015NumbersService } from "./pbx015-numbers.service";
import { PlatformAdminNotifierService } from "./platform-admin-notifier.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { TaxTablesService } from "./tax-tables.service";
import { OutboxService } from "./outbox.service";
import { PrismaService } from "./prisma.service";
import { REDIS, REDIS_PROVIDERS } from "./redis";
import { ServerErrorDigestService } from "./server-errors";
import { StorageService } from "./storage.service";
import { SweepScheduler } from "./sweeps";
import { TenantLogoService } from "./tenant-logo.service";
import { VatService } from "./vat.service";

/** שירותי תשתית רוחביים — זמינים לכל מודול בלי ייבוא חוזר. */
@Global()
@Module({
  /* ‏`SweepScheduler` מוצא את הסבבים בכל הספקים — ראו `sweeps.ts` */
  imports: [DiscoveryModule],
  providers: [
    PrismaService,
    /* ‏חיבור Redis אחד לכל השירותים — ראו `redis.ts` */
    ...REDIS_PROVIDERS,
    CryptoService,
    EmailService,
    EmailDomainProviderService,
    EmailDomainRecheckService,
    AuditService,
    OutboxService,
    OutboxDispatcherService,
    /*
     * ‎`CardcomService` הוא עטיפה חסרת מצב מעל הגדרות הפלטפורמה,
     * ‏ו„האם הסליקה מוגדרת” היא שאלה שנשאלת גם מחוץ למודול החיוב:
     * ‏הגדרות המשרד והצוות מציעים רכישת מקום, ואסור שיציעו אותה
     * ‏כשאין לאן לשלוח (ביקורת Codex).
     */
    PlatformSettingsService,
    CardcomService,
    TaxTablesService,
    PlatformAdminNotifierService,
    Pbx015NumbersService,
    GeocodingService,
    CreditEconomyService,
    CreditExpiryService,
    OnboardingOutreachService,
    ActivationNudgeService,
    GeminiService,
    PlanCatalogService,
    AutomationQuotaService,
    LeadPricingService,
    StorageService,
    TenantLogoService,
    VatService,
    SweepScheduler,
    ServerErrorDigestService,
  ],
  exports: [
    PrismaService,
    REDIS,
    CryptoService,
    EmailService,
    EmailDomainProviderService,
    EmailDomainRecheckService,
    AuditService,
    OutboxService,
    PlatformSettingsService,
    CardcomService,
    TaxTablesService,
    PlatformAdminNotifierService,
    Pbx015NumbersService,
    /*
     * חייב להיות מיוצא ולא רק מסופק: `@Global()` חושף את מה שהמודול
     * **מייצא**, ולא את מה שהוא מחזיק. בלי השורה הזו כל מודול שתלוי
     * בשירות הזה מפיל את עליית ה-API כולו — לא את המסך שלו בלבד.
     */
    GeocodingService,
    CreditEconomyService,
    GeminiService,
    PlanCatalogService,
    AutomationQuotaService,
    LeadPricingService,
    StorageService,
    TenantLogoService,
    VatService,
  ],
})
export class CoreModule {}
