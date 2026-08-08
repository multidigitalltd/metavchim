import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CallsService, type CallDto } from "./calls.service";

const OutcomeSchema = z.enum(["answered", "missed", "no_answer", "voicemail"]);

const CreateSchema = z
  .object({
    direction: z.enum(["inbound", "outbound"]),
    contactId: IdSchema.optional(),
    leadId: IdSchema.optional(),
    phone: z.string().min(6).max(30).optional(),
    occurredAt: z.coerce.date(),
    durationMinutes: z.number().int().min(0).max(600).optional(),
    outcome: OutcomeSchema,
    summary: z.string().max(4000).optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    outcome: OutcomeSchema.optional(),
    leadId: IdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

/** יומן שיחות — תיעוד ידני של שיחות שהמתווך קיים. */
@Controller("calls")
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get()
  @RequireCapability("leads.view_own")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<CallDto[]> {
    return this.calls.list(query);
  }

  @Post()
  @RequireCapability("leads.edit")
  async create(
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ): Promise<CallDto> {
    return this.calls.create(body);
  }

  @Delete(":id")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  async remove(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{ ok: true }> {
    await this.calls.remove(id);
    return { ok: true };
  }
}
