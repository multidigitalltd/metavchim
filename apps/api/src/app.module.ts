import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { WebhookThrottlerGuard } from "./common/webhook-throttler.guard";
import { WEBHOOK_THROTTLER, webhookThrottleTarget } from "./common/webhook-throttle";
import { AuthGuard } from "./common/auth.guard";
import { FeatureGuard } from "./common/feature.guard";
import { FloodMiddleware } from "./common/flood.middleware";
import { OriginGuard } from "./common/origin.guard";
import { SessionMiddleware } from "./common/session.middleware";
import { CoreModule } from "./core/core.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AnnouncementsModule } from "./modules/announcements/announcements.module";
import { BillingModule } from "./modules/billing/billing.module";
import { BuyersModule } from "./modules/buyers/buyers.module";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { EmailInboxModule } from "./modules/email-inbox/email-inbox.module";
import { GmailModule } from "./modules/gmail/gmail.module";
import { CoachModule } from "./modules/coach/coach.module";
import { MentorModule } from "./modules/mentor/mentor.module";
import { InboundMailModule } from "./modules/inbound-mail/inbound-mail.module";
import { SupportModule } from "./modules/support/support.module";
import { PayoutsModule } from "./modules/payouts/payouts.module";
import { CollaborationModule } from "./modules/collaboration/collaboration.module";
import { MapsModule } from "./modules/maps/maps.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { ExportModule } from "./modules/export/export.module";
import { FeatureSignupsModule } from "./modules/feature-signups/feature-signups.module";
import { HealthModule } from "./modules/health/health.module";
import { IntakeModule } from "./modules/intake/intake.module";
import { WebhookLogModule } from "./modules/webhook-log/webhook-log.module";
import { ImportModule } from "./modules/import/import.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { MatchingModule } from "./modules/matching/matching.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { WhatsAppModule } from "./modules/messaging/whatsapp.module";
import { NavModule } from "./modules/nav/nav.module";
import { SuggestModule } from "./modules/suggest/suggest.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { AgreementsModule } from "./modules/agreements/agreements.module";
import { ExclusivityModule } from "./modules/exclusivity/exclusivity.module";
import { CallsModule } from "./modules/calls/calls.module";
import { OffersModule } from "./modules/offers/offers.module";
import { PropertyPitchModule } from "./modules/property-pitch/property-pitch.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { PropertiesModule } from "./modules/properties/properties.module";
import { FunnelModule } from "./modules/funnel/funnel.module";
import { RecruitmentModule } from "./modules/recruitment/recruitment.module";
import { SearchModule } from "./modules/search/search.module";
import { LegalModule } from "./modules/legal/legal.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { SignupModule } from "./modules/signup/signup.module";
import { TelephonyModule } from "./modules/telephony/telephony.module";
import { TasksModule } from "./modules/tasks/tasks.module";
import { VoiceIntakeModule } from "./modules/voice-intake/voice-intake.module";
import { AgentModule } from "./modules/agent/agent.module";

/**
 * מודול-העל. כל Endpoint מוגן כברירת מחדל (AuthGuard גלובלי);
 * SessionMiddleware קובע את הקשר הדייר לכל הבקשה (docs/04 §2).
 * מודולים עתידיים: Leads, Offers, Calendar, Collaboration, Messaging, AI, Voice.
 */
@Module({
  imports: [
    /*
     * ‎**שני מונים שרצים יחד, ושניהם חייבים לאשר.**
     *
     * ‏`default` — לפי IP, רשת ביטחון מול הצפה; נתיבים רגישים
     * ‏(login) מקבלים מגבלה הדוקה משלהם עם `@Throttle`. ה-IP נלקח
     * ‏אחרי trust proxy.
     *
     * ‏`webhook` — לפי **מפתח המשרד** שבנתיב, ורק על נתיבים
     * ‏שהצהירו על כך ב-`@ThrottleWebhook`. כל המרכזיות שיושבות על
     * ‏אותה מרכזיית ענן מגיעות מאותן כתובות, ולכן תקרה לפי IP
     * ‏חולקה בין כל המשרדים במקום להינתן לכל אחד: משרד עמוס אחד
     * ‏השתיק את השאר.
     *
     * ‎**ולא במקום הראשון, אלא בנוסף לו.** מונה לפי מפתח לבדו היה
     * ‏מסיר את ההגנה מפני מי שמפזר מפתחות אקראיים מכתובת אחת — כל
     * ‏מפתח מקבל דלי חדש.
     *
     * ‏ה-`limit` כאן הוא ברירת מחדל בלבד; כל נתיב מצהיר על שלו.
     */
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60_000, limit: 300 },
      {
        name: WEBHOOK_THROTTLER,
        ttl: 60_000,
        limit: 60,
        skipIf: (context) => webhookThrottleTarget(context) === undefined,
      },
    ]),
    CoreModule,
    AuthModule,
    HealthModule,
    ContactsModule,
    PropertiesModule,
    FunnelModule,
    RecruitmentModule,
    BuyersModule,
    MatchingModule,
    AgreementsModule,
    ExclusivityModule,
    CallsModule,
    OffersModule,
    PropertyPitchModule,
    PlatformModule,
    LeadsModule,
    VoiceIntakeModule,
    AgentModule,
    NavModule,
    SuggestModule,
    NotificationsModule,
    AnnouncementsModule,
    MessagingModule,
    WhatsAppModule,
    CalendarModule,
    GmailModule,
    EmailInboxModule,
    CollaborationModule,
    MapsModule,
    SettingsModule,
    LegalModule,
    SignupModule,
    BillingModule,
    TelephonyModule,
    AnalyticsModule,
    CoachModule,
    MentorModule,
    SupportModule,
    InboundMailModule,
    PayoutsModule,
    ImportModule,
    SearchModule,
    TasksModule,
    ExportModule,
    FeatureSignupsModule,
    IntakeModule,
    /* ‏השער רושם ביומן דחייה על תקרה, ולכן הוא צריך את השירות */
    WebhookLogModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: WebhookThrottlerGuard },
    /*
     * בדיקת המקור לפני האימות: בקשה משנה-מצב ממקור זר נדחית עוד
     * לפני שנגענו ב-Session או במסד. שכבה שנייה מול CSRF, לצד
     * `SameSite=Lax` על העוגייה.
     */
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    /*
     * שער הפיצ'רים אחרי שער האימות ולא לפניו: שאלה על המסלול של
     * המשרד מחייבת שכבר ידוע איזה משרד זה. הוא שקוף ל-Endpoint שלא
     * הצהיר @RequireFeature, ולכן אין לו מחיר על שאר הנתיבים.
     */
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // בלם ההצפה קודם — מקור חסום לא מגיע לפענוח session (שאילתת DB)
    consumer.apply(FloodMiddleware, SessionMiddleware).forRoutes("{*splat}");
  }
}
