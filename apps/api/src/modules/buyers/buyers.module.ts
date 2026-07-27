import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { MatchingModule } from "../matching/matching.module";
import { BuyersController } from "./buyers.controller";
import { BuyersService } from "./buyers.service";

@Module({
  imports: [ContactsModule, MatchingModule],
  controllers: [BuyersController],
  providers: [BuyersService],
})
export class BuyersModule {}
