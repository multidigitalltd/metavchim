import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { CryptoService } from "./crypto.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
import { OutboxService } from "./outbox.service";
import { PrismaService } from "./prisma.service";

/** שירותי תשתית רוחביים — זמינים לכל מודול בלי ייבוא חוזר. */
@Global()
@Module({
  providers: [PrismaService, CryptoService, AuditService, OutboxService, OutboxDispatcherService],
  exports: [PrismaService, CryptoService, AuditService, OutboxService],
})
export class CoreModule {}
