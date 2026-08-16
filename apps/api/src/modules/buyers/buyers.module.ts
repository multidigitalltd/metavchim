import { Module } from "@nestjs/common";
import { CollaborationModule } from "../collaboration/collaboration.module";
import { ContactsModule } from "../contacts/contacts.module";
import { MatchingModule } from "../matching/matching.module";
import { BuyersController } from "./buyers.controller";
import { BuyersService } from "./buyers.service";

@Module({
  imports: [CollaborationModule, ContactsModule, MatchingModule],
  controllers: [BuyersController],
  providers: [BuyersService],
  exports: [BuyersService],
})
export class BuyersModule {}
