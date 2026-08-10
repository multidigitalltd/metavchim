import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  BuyerMaturitySchema,
  BuyerRequirementsSchema,
  FinancingStatusSchema,
  IdSchema,
  LeadSourceSchema,
  LeadIntentSchema,
  LeadStatusSchema,
  PhoneSchema,
  PropertyFieldsSchema,
  type Page,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { BuyersService, type BuyerDto } from "../buyers/buyers.service";
import { PropertiesService } from "../properties/properties.service";
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

const ConvertSchema = z
  .object({
    requirements: BuyerRequirementsSchema,
    financing: FinancingStatusSchema.optional(),
    maturity: BuyerMaturitySchema.optional(),
  })
  .strict();

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
  constructor(
    private readonly leads: LeadsService,
    private readonly buyers: BuyersService,
    private readonly properties: PropertiesService,
  ) {}

  @Post()
  @RequireCapability("leads.edit")
  async create(
    @Body(new ZodValidationPipe(CreateLeadSchema)) body: z.infer<typeof CreateLeadSchema>,
  ): Promise<{ id: string; merged: boolean; visible: boolean }> {
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

  /**
   * המרת ליד לקונה: יוצר קונה על אותו contact, מסמן converted, ורושם
   * בשני הצירים. יוצר ישות קונים — לכן דורש buyers.edit ולא רק leads.edit.
   */
  @Post(":id/convert")
  @RequireCapability("buyers.edit")
  async convert(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(ConvertSchema)) body: z.infer<typeof ConvertSchema>,
  ): Promise<BuyerDto> {
    return this.buyers.convertFromLead(id, body);
  }

  /**
   * המרת ליד לנכס: מי שהתקשר "יש לי דירה למכור" הוא בעל נכס, לא
   * קונה. איש הקשר של הליד הופך לבעל הנכס — אותו אדם, בלי כרטיס
   * כפול. יוצר ישות נכסים — לכן properties.edit.
   */
  @Post(":id/convert-to-property")
  @RequireCapability("properties.edit")
  async convertToProperty(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(PropertyFieldsSchema)) body: z.infer<typeof PropertyFieldsSchema>,
  ): Promise<{ id: string }> {
    const property = await this.properties.convertFromLead(id, body);
    return { id: property.id };
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
