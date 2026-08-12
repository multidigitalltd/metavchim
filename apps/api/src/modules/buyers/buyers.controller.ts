import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
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
    /** חיפוש חופשי — ערים מבוקשות, הערות הסוכן, סיכומי AI ומקור */
    q: z.string().max(120).optional(),
    /** בשקלים; נבדק בחפיפה מול טווח התקציב של הקונה */
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    minRooms: z.coerce.number().min(0).max(30).optional(),
    maxRooms: z.coerce.number().min(0).max(30).optional(),
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

  /**
   * ספירת קונים לפי בשלות — **בבסיס הנתונים**.
   *
   * הדשבורד חישב את הפילוח מתוך 100 הקונים שהרשימה במקרה טענה, ולכן
   * במשרד עם יותר מ-100 קונים הוא הציג התפלגות של מדגם שרירותי
   * כאילו היא של המאגר כולו (ביקורת Codex). groupBy סופר את הכול
   * בשאילתה אחת, ובלי לפענח שום PII.
   *
   * הנתיב חייב לכבד את אותו פילטר בעלות כמו הרשימה — אחרת סוכן
   * view_own היה רואה במונה קונים שאינו רשאי לראות ברשימה.
   */
  @Get("breakdown")
  @RequireCapability("buyers.view_own")
  async breakdown(): Promise<{ total: number; byMaturity: Record<string, number> }> {
    return this.buyers.breakdown();
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

  /** מה תגרור המחיקה — לפני האישור, לא אחריו. */
  @Get(":id/deletion-preview")
  @RequireCapability("buyers.delete")
  async deletionPreview(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<Awaited<ReturnType<BuyersService["deletionPreview"]>>> {
    return this.buyers.deletionPreview(id);
  }

  /**
   * ארכיון — הכרטיס יורד מהרשימות וההיסטוריה נשמרת.
   *
   * זו פעולת ברירת המחדל: "הלקוח כבר לא מחפש" אינו "הלקוח מעולם לא
   * היה". מחיקה לצמיתות היא נתיב נפרד, ורק מכרטיס שכבר בארכיון.
   */
  @Delete(":id")
  @RequireCapability("buyers.delete")
  @HttpCode(204)
  async archive(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.buyers.archive(id);
  }

  @Delete(":id/permanent")
  @RequireCapability("buyers.delete")
  @HttpCode(204)
  async purge(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.buyers.purge(id);
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
