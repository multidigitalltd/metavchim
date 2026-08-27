import { Module } from "@nestjs/common";
import { ContactErasureService } from "./contact-erasure.service";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";
import { DuplicatesService } from "./duplicates.service";

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, DuplicatesService, ContactErasureService],
  // מיוצא כדי שמחיקת נכס לצמיתות תוכל למחוק כרטיס שנשאר בלי אף עוגן
  exports: [ContactsService, ContactErasureService],
})
export class ContactsModule {}
