import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { CalendarModule } from "../calendar/calendar.module";
import { LeadsModule } from "../leads/leads.module";
import { MatchingModule } from "../matching/matching.module";
import { PropertiesModule } from "../properties/properties.module";
import { SearchModule } from "../search/search.module";
import { TasksModule } from "../tasks/tasks.module";
import { AgentController } from "./agent.controller";
import { AgentExecuteService } from "./execute.service";
import { AgentInterpretService } from "./interpret.service";
import { AgentResolveService } from "./resolve.service";

/**
 * הסוכן אינו מחזיק נתונים משלו.
 *
 * הוא מייבא את המודולים הקיימים ומשתמש בשירותים שלהם — אותם
 * שירותים שהטפסים הידניים קוראים להם. לכן אין כאן `PrismaService`
 * ואין טבלה חדשה: מסלול קליטה שכותב למסד בעצמו מייצר רשומות
 * שנראות תקינות ומתנהגות אחרת מאלה של המסכים.
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
  ],
  controllers: [AgentController],
  providers: [AgentInterpretService, AgentResolveService, AgentExecuteService],
})
export class AgentModule {}
