import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { MatchRefreshService } from "./match-refresh.service";
import { MatchingController } from "./matching.controller";
import { MatchingService } from "./matching.service";

@Module({
  imports: [ContactsModule],
  controllers: [MatchingController],
  providers: [MatchingService, MatchRefreshService],
  // הרענון מיוצא כי שמירת המשקלים מפעילה אותו — ראו SettingsController
  exports: [MatchingService, MatchRefreshService],
})
export class MatchingModule {}
