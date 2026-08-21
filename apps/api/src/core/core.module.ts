import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { AutomationQuotaService } from "./automation-quota.service";
import { CryptoService } from "./crypto.service";
import { EmailService } from "./email.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
import { LeadPricingService } from "./lead-pricing.service";
import { PlanCatalogService } from "./plan-catalog.service";
import { GeminiService } from "./gemini.service";
import { GeocodingService } from "./geocoding.service";
import { CreditEconomyService } from "./credit-economy.service";
import { CreditExpiryService } from "./credit-expiry.service";
import { OnboardingOutreachService } from "./onboarding-outreach.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { OutboxService } from "./outbox.service";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";

/** שירותי תשתית רוחביים — זמינים לכל מודול בלי ייבוא חוזר. */
@Global()
@Module({
  providers: [
    PrismaService,
    CryptoService,
    EmailService,
    AuditService,
    OutboxService,
    OutboxDispatcherService,
    PlatformSettingsService,
    GeocodingService,
    CreditEconomyService,
    CreditExpiryService,
    OnboardingOutreachService,
    GeminiService,
    PlanCatalogService,
    AutomationQuotaService,
    LeadPricingService,
    StorageService,
  ],
  exports: [
    PrismaService,
    CryptoService,
    EmailService,
    AuditService,
    OutboxService,
    PlatformSettingsService,
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
  ],
})
export class CoreModule {}
