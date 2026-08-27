import { Module } from "@nestjs/common";
import { CallsModule } from "../calls/calls.module";
import { ContactsModule } from "../contacts/contacts.module";
import { ExclusivityModule } from "../exclusivity/exclusivity.module";
import { MessagingModule } from "../messaging/messaging.module";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarSyncService } from "./calendar-sync.service";
import { GoogleCalendarController } from "./google-calendar.controller";
import { GoogleCalendarService } from "./google-calendar.service";
import { ViewingReminderService } from "./viewing-reminder.service";

@Module({
  // ההקלטה של פגישה נשמרת כשורת `calls` — אותו צינור תמלול
  // התזכורת שולחת ללקוח: אנשי הקשר לפענוח, והוואטסאפ למסירה
  imports: [CallsModule, ExclusivityModule, ContactsModule, MessagingModule],
  controllers: [CalendarController, GoogleCalendarController],
  providers: [
    CalendarService,
    GoogleCalendarService,
    CalendarSyncService,
    // סבב התזכורות יושב כאן כי הוא קורא פגישות — ראו הקובץ עצמו
    ViewingReminderService,
  ],
  // הסוכן קובע פגישות דרך אותו שירות שהמסך משתמש בו
  exports: [CalendarService],
})
export class CalendarModule {}
