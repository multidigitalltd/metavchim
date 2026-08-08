import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthGuard } from "./common/auth.guard";
import { FloodMiddleware } from "./common/flood.middleware";
import { SessionMiddleware } from "./common/session.middleware";
import { CoreModule } from "./core/core.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AnnouncementsModule } from "./modules/announcements/announcements.module";
import { BuyersModule } from "./modules/buyers/buyers.module";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { CoachModule } from "./modules/coach/coach.module";
import { CollaborationModule } from "./modules/collaboration/collaboration.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { ExportModule } from "./modules/export/export.module";
import { HealthModule } from "./modules/health/health.module";
import { ImportModule } from "./modules/import/import.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { MatchingModule } from "./modules/matching/matching.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { NavModule } from "./modules/nav/nav.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { AgreementsModule } from "./modules/agreements/agreements.module";
import { CallsModule } from "./modules/calls/calls.module";
import { OffersModule } from "./modules/offers/offers.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { PropertiesModule } from "./modules/properties/properties.module";
import { SearchModule } from "./modules/search/search.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { TasksModule } from "./modules/tasks/tasks.module";
import { VoiceIntakeModule } from "./modules/voice-intake/voice-intake.module";

/**
 * מודול-העל. כל Endpoint מוגן כברירת מחדל (AuthGuard גלובלי);
 * SessionMiddleware קובע את הקשר הדייר לכל הבקשה (docs/04 §2).
 * מודולים עתידיים: Leads, Offers, Calendar, Collaboration, Messaging, AI, Voice.
 */
@Module({
  imports: [
    // הגבלת קצב גלובלית — רשת ביטחון מול הצפה; נתיבים רגישים (login)
    // מקבלים מגבלה הדוקה משלהם עם @Throttle. ה-IP נלקח אחרי trust proxy.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    CoreModule,
    AuthModule,
    HealthModule,
    ContactsModule,
    PropertiesModule,
    BuyersModule,
    MatchingModule,
    AgreementsModule,
    CallsModule,
    OffersModule,
    PlatformModule,
    LeadsModule,
    VoiceIntakeModule,
    NavModule,
    NotificationsModule,
    AnnouncementsModule,
    MessagingModule,
    CalendarModule,
    CollaborationModule,
    SettingsModule,
    AnalyticsModule,
    CoachModule,
    ImportModule,
    SearchModule,
    TasksModule,
    ExportModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // בלם ההצפה קודם — מקור חסום לא מגיע לפענוח session (שאילתת DB)
    consumer.apply(FloodMiddleware, SessionMiddleware).forRoutes("*");
  }
}
