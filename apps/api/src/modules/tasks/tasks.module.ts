import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { RecurrenceController } from "./recurrence.controller";
import { RecurrenceService } from "./recurrence.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  // שמות הלקוחות בתיאור הישות המקושרת מוצפנים — הפענוח עובר
  // ב-ContactsService, שהוא גם מנה אחת ולא אחת לשורה
  imports: [ContactsModule],
  controllers: [TasksController, RecurrenceController],
  providers: [TasksService, RecurrenceService],
})
export class TasksModule {}
