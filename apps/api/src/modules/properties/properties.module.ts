import { Module } from "@nestjs/common";
import { CollaborationModule } from "../collaboration/collaboration.module";
import { ContactsModule } from "../contacts/contacts.module";
import { LeadsModule } from "../leads/leads.module";
import { MatchingModule } from "../matching/matching.module";
import { MessagingModule } from "../messaging/messaging.module";
import { FeatureCatalogueModule } from "./feature-catalogue.module";
import { LandingController } from "./landing.controller";
import { LandingService } from "./landing.service";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { PropertiesController } from "./properties.controller";
import { PropertiesService } from "./properties.service";
import { PropertyActivityService } from "./property-activity.service";
import { PropertyTwinsController } from "./property-twins.controller";
import { PropertyTwinsService } from "./property-twins.service";

@Module({
  imports: [
    ContactsModule,
    MatchingModule,
    MessagingModule,
    LeadsModule,
    FeatureCatalogueModule,
    /*
     * הפרסום ברשת הוא **צילום** של הנכס, וצילום שאינו מתרענן
     * מזדקן: נכס שירד מ-2.3 ל-2.1 מיליון היה נשאר מוצג לרשת ב-2.3.
     * עריכת נכס מרעננת אותו, ולכן `PropertiesService` תלוי
     * ב-`ListingsService`.
     */
    CollaborationModule,
  ],
  controllers: [
    PropertiesController,
    PropertyTwinsController,
    MediaController,
    LandingController,
  ],
  providers: [
    PropertiesService,
    PropertyActivityService,
    PropertyTwinsService,
    MediaService,
    LandingService,
  ],
  exports: [PropertiesService, LandingService],
})
export class PropertiesModule {}
