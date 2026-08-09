import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  CollaborationService,
  type CoopOfferDto,
  type SharedDemandDto,
} from "./collaboration.service";

const ShareSchema = z.object({ buyerId: IdSchema }).strict();
const OfferSchema = z.object({ propertyId: IdSchema }).strict();
const RespondSchema = z.object({ response: z.enum(["interested", "declined"]) }).strict();

@RequireFeature("collaboration")
@Controller("collaboration")
export class CollaborationController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Post("share")
  @RequireCapability("collaboration.share")
  async share(
    @Body(new ZodValidationPipe(ShareSchema)) body: z.infer<typeof ShareSchema>,
  ): Promise<SharedDemandDto> {
    return this.collaboration.shareBuyer(body.buyerId);
  }

  @Delete("demands/:id")
  @RequireCapability("collaboration.share")
  @HttpCode(204)
  async unshare(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.collaboration.unshare(id);
  }

  @Get("demands")
  @RequireCapability("collaboration.offer")
  async demands(): Promise<SharedDemandDto[]> {
    return this.collaboration.listDemands();
  }

  @Post("demands/:id/offer")
  @RequireCapability("collaboration.offer")
  async offer(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(OfferSchema)) body: z.infer<typeof OfferSchema>,
  ): Promise<CoopOfferDto> {
    return this.collaboration.offerProperty(id, body.propertyId);
  }

  @Get("offers")
  @RequireCapability("collaboration.offer")
  async offers(): Promise<CoopOfferDto[]> {
    return this.collaboration.listCoopOffers();
  }

  @Patch("offers/:id/respond")
  @RequireCapability("collaboration.offer")
  @HttpCode(200)
  async respond(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RespondSchema)) body: z.infer<typeof RespondSchema>,
  ): Promise<{ ok: true }> {
    await this.collaboration.respondToCoopOffer(id, body.response);
    return { ok: true };
  }

  @Get("credits")
  @RequireCapability("collaboration.offer")
  async credits(): Promise<{ balance: number }> {
    return this.collaboration.credits();
  }
}
