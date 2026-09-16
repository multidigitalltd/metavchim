import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z } from "zod";
import { ComparisonCreateSchema, ComparisonInterestSchema, IdSchema, type ComparisonCreate } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { objectResponse } from "../../common/object-response";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ComparisonService, type ComparisonDto, type PublicComparisonView } from "./comparison.service";

/**
 * ‏דף השוואה לקונה — יצירה ושליחה עם `offers.send` (אותה יכולת של
 * ‏הצעה בודדת), רשימה למי שרואה את הקונה, ודף ציבורי לפי טוקן.
 */
const IdParam = new ZodValidationPipe(IdSchema);
const TokenParam = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{43}$/u));

@Controller()
export class ComparisonController {
  constructor(private readonly comparisons: ComparisonService) {}

  @Post("buyers/:id/comparisons")
  @RequireCapability("offers.send")
  create(
    @Param("id", IdParam) buyerId: string,
    @Body(new ZodValidationPipe(ComparisonCreateSchema)) body: ComparisonCreate,
  ): Promise<ComparisonDto> {
    return this.comparisons.create(buyerId, body.propertyIds);
  }

  @Get("buyers/:id/comparisons")
  @RequireCapability("buyers.view_own", "buyers.view_all")
  list(@Param("id", IdParam) buyerId: string): Promise<ComparisonDto[]> {
    return this.comparisons.listForBuyer(buyerId);
  }

  @Post("comparisons/:id/whatsapp")
  @RequireCapability("offers.send")
  @HttpCode(200)
  whatsapp(@Param("id", IdParam) id: string): Promise<{ waUrl: string; message: string }> {
    return this.comparisons.prepareWhatsApp(id);
  }

  @Public()
  @Get("public/compare/:token")
  publicView(@Param("token", TokenParam) token: string): Promise<PublicComparisonView> {
    return this.comparisons.publicView(token);
  }

  @Public()
  @Get("public/compare/:token/media/:p/:i")
  async publicImage(
    @Req() req: Request,
    @Res() res: Response,
    @Param("token", TokenParam) token: string,
    @Param("p", ParseIntPipe) propertyIndex: number,
    @Param("i", ParseIntPipe) mediaIndex: number,
  ): Promise<void> {
    const object = await this.comparisons.publicImage(token, propertyIndex, mediaIndex);
    objectResponse(req, res, object, "public");
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("public/compare/:token/interest")
  @HttpCode(200)
  async interest(
    @Param("token", TokenParam) token: string,
    @Body(new ZodValidationPipe(ComparisonInterestSchema)) body: { propertyId: string },
  ): Promise<{ ok: true }> {
    await this.comparisons.publicInterest(token, body.propertyId);
    return { ok: true };
  }
}
