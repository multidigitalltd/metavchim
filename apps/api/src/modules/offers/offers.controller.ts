import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  OffersService,
  type OfferDto,
  type OfferListItem,
  type PublicOfferView,
} from "./offers.service";

const CreateOfferSchema = z.object({ matchId: IdSchema }).strict();
const BulkOfferSchema = z
  .object({
    propertyId: IdSchema,
    minScore: z.number().int().min(50).max(100).default(85),
  })
  .strict();
const RespondSchema = z.object({ response: z.enum(["interested", "declined"]) }).strict();
const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const ListQuerySchema = z
  .object({
    status: z
      .enum(["pending_approval", "sent", "delivered", "opened", "interested", "declined"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
const ForMatchesQuerySchema = z
  .object({ matchIds: z.string().max(2800) })
  .strict();

@Controller()
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post("offers")
  @RequireCapability("offers.send")
  async create(
    @Body(new ZodValidationPipe(CreateOfferSchema)) body: z.infer<typeof CreateOfferSchema>,
  ): Promise<OfferDto> {
    return this.offers.createFromMatch(body.matchId);
  }

  /** סטטוס הצעות עבור סט התאמות — לתצוגה בכרטיס הנכס. */
  /** רשימת ההצעות של המשרד — "מה שלחתי ומה קרה איתו". */
  @Get("offers")
  @RequireCapability("offers.send")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<OfferListItem[]> {
    return this.offers.listAll(query);
  }

  @Get("offers/for-matches")
  @RequireCapability("matches.view")
  async forMatches(
    @Query(new ZodValidationPipe(ForMatchesQuerySchema)) query: z.infer<typeof ForMatchesQuerySchema>,
  ): Promise<Record<string, OfferDto>> {
    const ids = query.matchIds
      .split(",")
      .map((s) => s.trim())
      .filter((s) => IdSchema.safeParse(s).success)
      .slice(0, 100);
    const map = await this.offers.listForMatch(ids);
    return Object.fromEntries(map);
  }

  /** שליחה מרובה: הצעות לכל המתאימים מעל הסף, באישור המתווך (אפיון §10). */
  @Post("offers/bulk")
  @RequireCapability("offers.send")
  @HttpCode(200)
  async createBulk(
    @Body(new ZodValidationPipe(BulkOfferSchema)) body: z.infer<typeof BulkOfferSchema>,
  ): Promise<{
    created: number;
    skipped: number;
    awaitingSignature: { matchId: string; signUrl: string }[];
  }> {
    return this.offers.createBulk(body.propertyId, body.minScore);
  }

  /** קישור wa.me עם הודעה מוכנה — "שלח בוואטסאפ" בלחיצה (אפיון §10). */
  @Post("offers/:id/whatsapp")
  @RequireCapability("offers.send")
  @HttpCode(200)
  async prepareWhatsApp(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ waUrl: string; message: string }> {
    return this.offers.prepareWhatsApp(id);
  }

  /** דף ההצעה ללקוח קצה — ציבורי, לפי טוקן בלבד, ללא Session. */
  @Public()
  @Get("public/offers/:token")
  async view(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
  ): Promise<PublicOfferView> {
    return this.offers.publicView(token);
  }

  /** תמונות ההצעה — מוזרמות דרך ה-API (שרת האחסון פנימי בלבד). */
  @Public()
  @Get("public/offers/:token/media/:index")
  @Header("Cache-Control", "public, max-age=3600")
  async image(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
    @Param("index", new ZodValidationPipe(z.coerce.number().int().min(0).max(19))) index: number,
  ): Promise<StreamableFile> {
    const obj = await this.offers.publicImage(token, index);
    return new StreamableFile(obj.body as never, {
      type: obj.contentType ?? "application/octet-stream",
      ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
    });
  }

  @Public()
  @Post("public/offers/:token/respond")
  @HttpCode(200)
  async respond(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
    @Body(new ZodValidationPipe(RespondSchema)) body: z.infer<typeof RespondSchema>,
  ): Promise<{ ok: true }> {
    await this.offers.publicRespond(token, body.response);
    return { ok: true };
  }
}
