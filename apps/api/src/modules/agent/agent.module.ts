import { Module } from "@nestjs/common";
import { AgreementsModule } from "../agreements/agreements.module";
import { ExclusivityModule } from "../exclusivity/exclusivity.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { BuyersModule } from "../buyers/buyers.module";
import { CalendarModule } from "../calendar/calendar.module";
import { CallsModule } from "../calls/calls.module";
import { CollaborationModule } from "../collaboration/collaboration.module";
import { EmailInboxModule } from "../email-inbox/email-inbox.module";
import { ContactsModule } from "../contacts/contacts.module";
import { LeadsModule } from "../leads/leads.module";
import { MatchingModule } from "../matching/matching.module";
import { MessagingModule } from "../messaging/messaging.module";
import { SupportModule } from "../support/support.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OffersModule } from "../offers/offers.module";
import { PropertiesModule } from "../properties/properties.module";
import { SearchModule } from "../search/search.module";
import { TasksModule } from "../tasks/tasks.module";
import { AgentController } from "./agent.controller";
import { AgentEventsService } from "./agent-events.service";
import { AgentConversationService } from "./agent-conversation.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentExecuteService } from "./execute.service";
import { AgentInterpretService } from "./interpret.service";
import { AgentResolveService } from "./resolve.service";

/**
 * הסוכן אינו מחזיק **נתוני CRM** משלו.
 *
 * הוא מייבא את המודולים הקיימים ומשתמש בשירותים שלהם — אותם
 * שירותים שהטפסים הידניים קוראים להם. מסלול קליטה שכותב רשומות
 * עסקיות למסד בעצמו מייצר רשומות שנראות תקינות ומתנהגות אחרת
 * מאלה של המסכים.
 *
 * הטבלה היחידה של הסוכן היא היומן שלו עצמו (`agent_events`) —
 * תיעוד של מה שהובן ובוצע, לא נתון עסקי: שום מסך ושום התאמה
 * אינם קוראים ממנה.
 */
@Module({
  imports: [
    PropertiesModule,
    BuyersModule,
    LeadsModule,
    SearchModule,
    MatchingModule,
    TasksModule,
    CalendarModule,
    CallsModule,
    AnalyticsModule,
    CollaborationModule,
    // „קישור לחתימה על הזמנה בכתב” — דרך אותו שירות שהכרטיס משתמש בו
    AgreementsModule,
    // בלעדיות — „מה בסיכון” ותיעוד פעולת שיווק, דרך אותו שירות כמו הפאנל
    ExclusivityModule,
    // שם הלקוח מוצפן במסד — רק ContactsService מפענח אותו
    ContactsModule,
    // „מי פתח ולא הגיב” — אותה רשימה שמסך ההצעות מציג
    OffersModule,
    // „מה חדש” — אותו תנאי ראות שהמסך משתמש בו
    NotificationsModule,
    // „שלח מייל ללקוח” — אותו נתיב כמו תשובה מתיבת המייל
    EmailInboxModule,
    // „תשלח לו בוואטסאפ” — אותו ערוץ walink כמו הצעה מהמסך
    MessagingModule,
    // „תפתח פנייה לתמיכה” — אותו שירות כמו כפתור התמיכה
    SupportModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentInterpretService,
    AgentResolveService,
    AgentExecuteService,
    AgentEventsService,
    AgentMemoryService,
    AgentConversationService,
  ],
  // הסוכן האישי בוואטסאפ מדבר עם אותו מנוע בדיוק — לא מסלול מקביל
  exports: [AgentInterpretService, AgentResolveService, AgentExecuteService],
})
export class AgentModule {}
