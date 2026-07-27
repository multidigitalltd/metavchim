import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./common/auth.guard";
import { SessionMiddleware } from "./common/session.middleware";
import { CoreModule } from "./core/core.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BuyersModule } from "./modules/buyers/buyers.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { HealthModule } from "./modules/health/health.module";
import { MatchingModule } from "./modules/matching/matching.module";
import { PropertiesModule } from "./modules/properties/properties.module";

/**
 * מודול-העל. כל Endpoint מוגן כברירת מחדל (AuthGuard גלובלי);
 * SessionMiddleware קובע את הקשר הדייר לכל הבקשה (docs/04 §2).
 * מודולים עתידיים: Leads, Offers, Calendar, Collaboration, Messaging, AI, Voice.
 */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    HealthModule,
    ContactsModule,
    PropertiesModule,
    BuyersModule,
    MatchingModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes("*");
  }
}
