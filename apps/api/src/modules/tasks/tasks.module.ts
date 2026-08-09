import { Module } from "@nestjs/common";
import { RecurrenceController } from "./recurrence.controller";
import { RecurrenceService } from "./recurrence.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  controllers: [TasksController, RecurrenceController],
  providers: [TasksService, RecurrenceService],
})
export class TasksModule {}
