import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import {
  IdSchema,
  PropertyFieldsSchema,
  PropertyStatusSchema,
  type Page,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MatchingService, type MatchDto } from "../matching/matching.service";
import { PropertiesService } from "./properties.service";
import type { PropertyDto } from "./property.mapper";

const CreatePropertySchema = PropertyFieldsSchema.extend({
  marketingTitle: z.string().max(160).optional(),
  marketingDescription: z.string().max(4000).optional(),
  internalNotes: z.string().max(4000).optional(),
}).strict();

const UpdatePropertySchema = CreatePropertySchema.partial()
  .extend({ status: PropertyStatusSchema.optional() })
  .strict();

const ListQuerySchema = z
  .object({
    status: PropertyStatusSchema.optional(),
    city: z.string().max(80).optional(),
    cursor: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

@Controller("properties")
export class PropertiesController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly matching: MatchingService,
  ) {}

  @Post()
  @RequireCapability("properties.create")
  async create(
    @Body(new ZodValidationPipe(CreatePropertySchema))
    body: z.infer<typeof CreatePropertySchema>,
  ): Promise<PropertyDto> {
    const { marketingTitle, marketingDescription, internalNotes, ...fields } = body;
    return this.properties.create({ fields, marketingTitle, marketingDescription, internalNotes });
  }

  @Get()
  @RequireCapability("properties.view")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<Page<PropertyDto>> {
    return this.properties.list(query);
  }

  @Get(":id")
  @RequireCapability("properties.view")
  async get(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<PropertyDto> {
    return this.properties.getById(id);
  }

  @Patch(":id")
  @RequireCapability("properties.edit")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdatePropertySchema))
    body: z.infer<typeof UpdatePropertySchema>,
  ): Promise<PropertyDto> {
    return this.properties.update(id, body);
  }

  @Delete(":id")
  @RequireCapability("properties.delete")
  @HttpCode(204)
  async remove(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.properties.softDelete(id);
  }

  /** "מצא לי קונים" (אפיון §7) — ההתאמות כבר מחושבות; כאן רק קוראים אותן. */
  @Get(":id/matches")
  @RequireCapability("matches.view")
  async matchesFor(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<MatchDto[]> {
    return this.matching.listForProperty(id);
  }
}
