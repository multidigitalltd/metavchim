import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  BuyerMaturitySchema,
  BuyerRequirementsSchema,
  FinancingStatusSchema,
  IdSchema,
  PhoneSchema,
  type Page,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MatchingService, type MatchDto } from "../matching/matching.service";
import { BuyersService, type BuyerDto } from "./buyers.service";

const CreateBuyerSchema = z
  .object({
    contactName: z.string().min(2).max(120),
    contactPhone: PhoneSchema,
    requirements: BuyerRequirementsSchema,
    financing: FinancingStatusSchema.optional(),
    maturity: BuyerMaturitySchema.optional(),
    source: z.string().min(1).max(60),
    agentNotes: z.string().max(4000).optional(),
  })
  .strict();

const UpdateBuyerSchema = z
  .object({
    requirements: BuyerRequirementsSchema.optional(),
    financing: FinancingStatusSchema.optional(),
    maturity: BuyerMaturitySchema.optional(),
    agentNotes: z.string().max(4000).optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    maturity: BuyerMaturitySchema.optional(),
    cursor: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const AddInteractionSchema = z
  .object({
    kind: z.enum(["note", "call"]),
    direction: z.enum(["in", "out"]).optional(),
    content: z.string().min(1).max(4000),
  })
  .strict();

const InteractionsQuerySchema = z
  .object({
    cursor: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

@Controller("buyers")
export class BuyersController {
  constructor(
    private readonly buyers: BuyersService,
    private readonly matching: MatchingService,
  ) {}

  @Post()
  @RequireCapability("buyers.edit")
  async create(
    @Body(new ZodValidationPipe(CreateBuyerSchema)) body: z.infer<typeof CreateBuyerSchema>,
  ): Promise<BuyerDto> {
    return this.buyers.create(body);
  }

  @Get()
  @RequireCapability("buyers.view_own")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<Page<BuyerDto>> {
    return this.buyers.list(query);
  }

  @Get(":id")
  @RequireCapability("buyers.view_own")
  async get(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<BuyerDto> {
    return this.buyers.getById(id);
  }

  @Patch(":id")
  @RequireCapability("buyers.edit")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateBuyerSchema)) body: z.infer<typeof UpdateBuyerSchema>,
  ): Promise<BuyerDto> {
    return this.buyers.update(id, body);
  }

  /** "נכסים מתאימים לקונה" — הצד השני של מסך ההתאמות הדו-צדי (אפיון §15). */
  @Get(":id/matches")
  @RequireCapability("matches.view")
  async matchesFor(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<MatchDto[]> {
    return this.matching.listForBuyer(id);
  }

  /** ציר ההיסטוריה של הקונה — הערות ותיעודי שיחה, מעומד (docs/01 §5). */
  @Get(":id/interactions")
  @RequireCapability("buyers.view_own")
  async interactions(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Query(new ZodValidationPipe(InteractionsQuerySchema))
    query: z.infer<typeof InteractionsQuerySchema>,
  ) {
    return this.buyers.listInteractions(id, query);
  }

  @Post(":id/interactions")
  @RequireCapability("buyers.edit")
  async addInteraction(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(AddInteractionSchema)) body: z.infer<typeof AddInteractionSchema>,
  ): Promise<{ ok: true }> {
    await this.buyers.addInteraction(id, body);
    return { ok: true };
  }
}
