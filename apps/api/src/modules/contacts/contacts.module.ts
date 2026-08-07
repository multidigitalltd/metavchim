import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";
import { DuplicatesService } from "./duplicates.service";

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, DuplicatesService],
  exports: [ContactsService],
})
export class ContactsModule {}
