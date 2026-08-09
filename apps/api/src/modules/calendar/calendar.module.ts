import { Module } from "@nestjs/common";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarSyncService } from "./calendar-sync.service";
import { GoogleCalendarController } from "./google-calendar.controller";
import { GoogleCalendarService } from "./google-calendar.service";

@Module({
  controllers: [CalendarController, GoogleCalendarController],
  providers: [CalendarService, GoogleCalendarService, CalendarSyncService],
})
export class CalendarModule {}
