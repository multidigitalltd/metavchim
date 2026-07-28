import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { OffersService, type OfferDto, type PublicOfferView } from "./offers.service";

const CreateOfferSchema = z.object({ matchId: IdSchema }).strict();
const RespondSchema = z.object({ response: z.enum(["interested", "declined"]) }).strict();
const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
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
