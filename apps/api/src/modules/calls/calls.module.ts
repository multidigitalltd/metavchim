import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { CallsController } from "./calls.controller";
import { CallsService } from "./calls.service";

@Module({
  imports: [ContactsModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
