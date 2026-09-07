import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { EmailInboxModule } from "../email-inbox/email-inbox.module";
import { PropertiesModule } from "../properties/properties.module";
import { PropertyPitchController } from "./property-pitch.controller";
import { PropertyPitchService } from "./property-pitch.service";

@Module({
  imports: [ContactsModule, EmailInboxModule, PropertiesModule],
  controllers: [PropertyPitchController],
  providers: [PropertyPitchService],
})
export class PropertyPitchModule {}
