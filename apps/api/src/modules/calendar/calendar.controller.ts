import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CalendarService, type AppointmentDto } from "./calendar.service";

const CreateSchema = z
  .object({
    kind: z.enum(["viewing", "meeting", "call"]),
    title: z.string().max(200).optional(),
    leadId: IdSchema.optional(),
    propertyId: IdSchema.optional(),
    buyerId: IdSchema.optional(),
    startsAt: z.coerce.date(),
    durationMinutes: z.number().int().min(15).max(480).default(60),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const UpdateSchema = z
  .object({
    status: z.enum(["scheduled", "completed", "cancelled", "no_show"]).optional(),
    outcome: z.enum(["liked", "not_fit", "negotiating", "needs_other"]).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .refine((q) => q.to > q.from && q.to.getTime() - q.from.getTime() <= 90 * 24 * 60 * 60 * 1000, {
    message: "טווח תאריכים לא תקין (מקסימום 90 יום)",
  });

@Controller("appointments")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Post()
  @RequireCapability("calendar.manage")
  async create(
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ): Promise<AppointmentDto> {
    return this.calendar.create(body);
  }

  @Get()
  @RequireCapability("calendar.manage")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<AppointmentDto[]> {
    return this.calendar.list(query);
  }

  @Patch(":id")
  @RequireCapability("calendar.manage")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>,
  ): Promise<AppointmentDto> {
    return this.calendar.update(id, body);
  }
}
