import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  IdSchema,
  PROPERTY_READINESS_FIELDS,
  TASK_ENTITY_TYPES,
  TASK_PRIORITIES,
} from "@metavchim/shared";
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
    priority: z.enum(TASK_PRIORITIES).optional(),
    entityType: z.enum(TASK_ENTITY_TYPES).optional(),
    entityId: IdSchema.optional(),
    /** ריק = על עצמי. אחר דורש tasks.assign — נאכף בשירות. */
    assignedToUserId: IdSchema.optional(),
    /**
     * ‎**שדה המוכנות שממנו נולדה ההצעה — ולא `sourceKey` חופשי.**
     *
     * המפתח נבנה בשרת מתוך רשימה סגורה, ובכוונה: `sourceKey` פתוח
     * היה מאפשר ללקוח לשלוח `lead-sla:<id>` או `offer:<id>` —
     * מפתחות שהמערכת עצמה משתמשת בהם — ובכך **למנוע** יצירה של
     * משימת מערכת אמיתית מאוחר יותר, כי היא תיראה כקיימת.
     *
     * מרחב שמות סגור סוגר את זה בלי להסתמך על ולידציה של מחרוזת.
     */
    suggestionField: z.enum(PROPERTY_READINESS_FIELDS).optional(),
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
    priority: z.enum(TASK_PRIORITIES).optional(),
    assignedToUserId: IdSchema.optional(),
  })
  .strict();

/**
 * `assignee`: ‎me‎ (ברירת מחדל) | ‎all‎ | מזהה סוכן.
 *
 * זהו סינון תצוגה **בתוך** ההיקף המותר ולא הרחבה שלו — מי שאין לו
 * `tasks.view_all` מקבל את שלו בלבד גם כשהוא נוקב במזהה של אחר.
 */
const ListQuerySchema = z
  .object({
    status: z.enum(["open", "done"]).optional(),
    assignee: z.union([z.literal("me"), z.literal("all"), IdSchema]).optional(),
  })
  .strict();

const EntityTypeSchema = z.enum(TASK_ENTITY_TYPES);

const IdParam = new ZodValidationPipe(IdSchema);

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequireCapability("calendar.manage")
  list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<TaskDto[]> {
    return this.tasks.list(query);
  }

  /**
   * ‎**מי במשרד אפשר למסור לו — שם ומזהה, ותו לא.**
   *
   * ‎`tasks.assign` ולא `users.manage`: זו רשימה לבחירה, לא ניהול
   * ‏צוות.
   *
   * ‎**וגם `leads.edit`, כי שתיהן שואלות את אותה שאלה.** מסירת ליד
   * ‏בין סוכנים אינה פעולת מנהל („בין סוכנים ניתן להעביר לידים
   * ‏בלבד”), וסוכן שיוצא לחופשה חייב לדעת למי למסור. בלי זה הבורר
   * ‏שנפתח לו היה נשלף ב-403, נבלע לרשימה ריקה, ומשאיר כפתור מושבת
   * ‏לנצח — פיצ'ר שנראה קיים ואינו עובד (ביקורת Codex, P1).
   *
   * ‎**מה שנחשף הוא שם ומזהה של עמית באותו משרד** — לא לקוחות, לא
   * ‏לידים, ולא פרטי קשר. אי אפשר למסור למי שאי אפשר לנקוב בשמו,
   * ‏וזה המינימום שהפעולה דורשת.
   *
   * ‎`RequireCapability` הוא „אחת מהן” (`some` ב-`AuthGuard`), ולכן
   * ‏זו הרחבה ולא החלפה: מי שיש לו `tasks.assign` ממשיך כרגיל.
   */
  @Get("assignees")
  @RequireCapability("tasks.assign", "leads.edit")
  assignees(): Promise<{ id: string; name: string }[]> {
    return this.tasks.assignees();
  }

  /**
   * המשימות של ישות אחת — הפאנל בכרטיס הנכס/הקונה/הליד.
   *
   * הקישור `entityType`/`entityId` קיים בנתונים מהיום הראשון ומעולם
   * לא הוצג: משימה שנוצרה מ-SLA של ליד נראתה כמו משימה שהוקלדה ביד,
   * בלי דרך לדעת על מי היא.
   */
  @Get("for/:entityType/:entityId")
  @RequireCapability("calendar.manage")
  listForEntity(
    @Param("entityType", new ZodValidationPipe(EntityTypeSchema)) entityType: string,
    @Param("entityId", IdParam) entityId: string,
  ): Promise<{ tasks: TaskDto[]; openSuggestionFields: string[] }> {
    return this.tasks.listForEntity(entityType, entityId);
  }

  @Post()
  @RequireCapability("calendar.manage")
  create(
    @Body(new ZodValidationPipe(CreateTaskSchema)) body: z.infer<typeof CreateTaskSchema>,
  ): Promise<TaskDto> {
    const { suggestionField, ...rest } = body;
    return this.tasks.create({
      ...rest,
      ...(suggestionField === undefined
        ? {}
        : { sourceKey: `suggestion:${suggestionField}` }),
    });
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
