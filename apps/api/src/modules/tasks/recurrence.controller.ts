import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RecurrenceService, type RecurrenceDto } from "./recurrence.service";

/**
 * כללי המשימות האוטומטיות של המשרד.
 *
 * `settings.manage` ולא `calendar.manage`: הכלל שייך למשרד ומייצר
 * משימות גם לסוכנים אחרים, ולכן זו הגדרה של המשרד ולא ניהול היומן
 * האישי. הקריאה פתוחה לכל מי שמנהל את היומן, כדי שסוכן יבין מאיפה
 * הגיעה המשימה שצצה אצלו.
 */

const RecurrenceSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    notes: z.string().max(2000).optional(),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    /** null = לכל סוכן פעיל במשרד; מזהה = לסוכן אחד. */
    assignedToUserId: IdSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

@Controller("task-recurrences")
export class RecurrenceController {
  constructor(private readonly recurrences: RecurrenceService) {}

  @Get()
  @RequireCapability("calendar.manage")
  list(): Promise<RecurrenceDto[]> {
    return this.recurrences.list();
  }

  @Post()
  @RequireCapability("settings.manage")
  create(
    @Body(new ZodValidationPipe(RecurrenceSchema)) body: z.infer<typeof RecurrenceSchema>,
  ): Promise<RecurrenceDto> {
    return this.recurrences.create(body);
  }

  @Patch(":id")
  @RequireCapability("settings.manage")
  update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RecurrenceSchema)) body: z.infer<typeof RecurrenceSchema>,
  ): Promise<RecurrenceDto> {
    return this.recurrences.update(id, body);
  }

  @Delete(":id")
  @RequireCapability("settings.manage")
  @HttpCode(204)
  async remove(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.recurrences.remove(id);
  }
}
