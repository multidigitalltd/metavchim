import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { CryptoService } from "./crypto.service";
import { EmailService } from "./email.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
import { LeadPricingService } from "./lead-pricing.service";
import { PlanCatalogService } from "./plan-catalog.service";
import { GeminiService } from "./gemini.service";
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
    GeminiService,
    PlanCatalogService,
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
    GeminiService,
    PlanCatalogService,
    LeadPricingService,
    StorageService,
  ],
})
export class CoreModule {}
