import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { MatchingController } from "./matching.controller";
import { MatchingService } from "./matching.service";

@Module({
  imports: [ContactsModule],
  controllers: [MatchingController],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
