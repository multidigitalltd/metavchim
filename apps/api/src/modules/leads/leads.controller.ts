import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema, LeadSourceSchema, LeadIntentSchema, LeadStatusSchema, PhoneSchema, type Page } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { LeadsService, type InteractionDto, type LeadDto } from "./leads.service";

const CreateLeadSchema = z
  .object({
    contactName: z.string().min(2).max(120),
    contactPhone: PhoneSchema,
    source: LeadSourceSchema,
    intent: LeadIntentSchema,
    summary: z.string().max(2000).optional(),
    requiresHuman: z.boolean().optional(),
    requiresHumanReason: z.string().max(500).optional(),
  })
  .strict();

const StatusSchema = z.object({ status: LeadStatusSchema }).strict();
const NoteSchema = z.object({ content: z.string().min(1).max(2000) }).strict();

const ListQuerySchema = z
  .object({
    status: LeadStatusSchema.optional(),
    requiresHuman: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    cursor: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

@Controller("leads")
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @RequireCapability("leads.edit")
  async create(
    @Body(new ZodValidationPipe(CreateLeadSchema)) body: z.infer<typeof CreateLeadSchema>,
  ): Promise<LeadDto> {
    return this.leads.create(body);
  }

  @Get()
  @RequireCapability("leads.view_own")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.output<typeof ListQuerySchema>,
  ): Promise<Page<LeadDto>> {
    return this.leads.list(query);
  }

  @Get(":id")
  @RequireCapability("leads.view_own")
  async get(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ lead: LeadDto; timeline: InteractionDto[] }> {
    return this.leads.getById(id);
  }

  @Patch(":id/status")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  async updateStatus(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(StatusSchema)) body: z.infer<typeof StatusSchema>,
  ): Promise<{ ok: true }> {
    await this.leads.updateStatus(id, body.status);
    return { ok: true };
  }

  @Post(":id/notes")
  @RequireCapability("leads.edit")
  async addNote(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(NoteSchema)) body: z.infer<typeof NoteSchema>,
  ): Promise<InteractionDto> {
    return this.leads.addNote(id, body.content);
  }
}
