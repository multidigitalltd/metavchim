import { Module } from "@nestjs/common";
import { ContactErasureService } from "./contact-erasure.service";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";
import { DuplicatesService } from "./duplicates.service";

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, DuplicatesService, ContactErasureService],
  exports: [ContactsService],
})
export class ContactsModule {}
