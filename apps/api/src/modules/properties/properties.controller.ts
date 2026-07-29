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
  PhoneSchema,
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
  // בעל הנכס (המוכר) — contact לפי טלפון; מזין את התיק המאוחד (docs/03)
  ownerName: z.string().min(2).max(120).optional(),
  ownerPhone: PhoneSchema.optional(),
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
    const { marketingTitle, marketingDescription, internalNotes, ownerName, ownerPhone, ...fields } =
      body;
    return this.properties.create({
      fields,
      marketingTitle,
      marketingDescription,
      internalNotes,
      ...(ownerName !== undefined && ownerPhone !== undefined
        ? { owner: { name: ownerName, phone: ownerPhone } }
        : {}),
    });
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
    const { ownerName, ownerPhone, ...rest } = body;
    return this.properties.update(id, {
      ...rest,
      ...(ownerName !== undefined && ownerPhone !== undefined
        ? { owner: { name: ownerName, phone: ownerPhone } }
        : {}),
    });
  }

  /** עדכון שיווק לבעל הנכס — נוסח מוכן + קישור wa.me; מתועד ב-Hub. */
  @Post(":id/owner-update")
  @RequireCapability("properties.edit")
  @HttpCode(200)
  async ownerUpdate(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ waUrl: string; message: string }> {
    return this.properties.prepareOwnerUpdate(id);
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
