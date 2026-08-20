import { Module } from "@nestjs/common";
import { CallsModule } from "../calls/calls.module";
import { ExclusivityModule } from "../exclusivity/exclusivity.module";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarSyncService } from "./calendar-sync.service";
import { GoogleCalendarController } from "./google-calendar.controller";
import { GoogleCalendarService } from "./google-calendar.service";

@Module({
  // ההקלטה של פגישה נשמרת כשורת `calls` — אותו צינור תמלול
  imports: [CallsModule, ExclusivityModule],
  controllers: [CalendarController, GoogleCalendarController],
  providers: [CalendarService, GoogleCalendarService, CalendarSyncService],
  // הסוכן קובע פגישות דרך אותו שירות שהמסך משתמש בו
  exports: [CalendarService],
})
export class CalendarModule {}
