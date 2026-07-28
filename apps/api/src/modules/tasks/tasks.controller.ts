import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { TasksService, type TaskDto } from "./tasks.service";

/**
 * משימות אישיות — כל הפעולות בהקשר המשתמש הנוכחי בלבד (ה-Service מסנן
 * לפי assignedToUserId). calendar.manage נדרש לכל התפקידים הפעילים.
 */
const CreateTaskSchema = z
  .object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    dueAt: z.coerce.date().optional(),
    entityType: z.enum(["lead", "buyer", "property"]).optional(),
    entityId: IdSchema.optional(),
  })
  .strict()
  .refine((v) => (v.entityId === undefined) === (v.entityType === undefined), {
    message: "קישור לישות דורש גם סוג וגם מזהה",
  });

const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    notes: z.string().max(2000).optional(),
    dueAt: z.coerce.date().nullable().optional(),
    status: z.enum(["open", "done"]).optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({ status: z.enum(["open", "done"]).optional() })
  .strict();

const IdParam = new ZodValidationPipe(IdSchema);

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequireCapability("calendar.manage")
  list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<TaskDto[]> {
    return this.tasks.list(query.status);
  }

  @Post()
  @RequireCapability("calendar.manage")
  create(
    @Body(new ZodValidationPipe(CreateTaskSchema)) body: z.infer<typeof CreateTaskSchema>,
  ): Promise<TaskDto> {
    return this.tasks.create(body);
  }

  @Patch(":id")
  @RequireCapability("calendar.manage")
  update(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) body: z.infer<typeof UpdateTaskSchema>,
  ): Promise<TaskDto> {
    return this.tasks.update(id, body);
  }

  @Delete(":id")
  @RequireCapability("calendar.manage")
  @HttpCode(204)
  async remove(@Param("id", IdParam) id: string): Promise<void> {
    await this.tasks.remove(id);
  }
}
