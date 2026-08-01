import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { CryptoService } from "./crypto.service";
import { EmailService } from "./email.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
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
    StorageService,
  ],
  exports: [
    PrismaService,
    CryptoService,
    EmailService,
    AuditService,
    OutboxService,
    PlatformSettingsService,
    StorageService,
  ],
})
export class CoreModule {}
