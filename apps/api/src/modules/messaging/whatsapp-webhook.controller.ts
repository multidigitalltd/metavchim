import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { Public } from "../../common/auth.decorators";
import { loadEnv } from "../../config/env";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";

/**
 * Webhook נכנס מ-WhatsApp Cloud API (docs/05 §1):
 * - GET: אימות המנוי (hub.challenge) מול VERIFY_TOKEN.
 * - POST: אימות חתימת HMAC-SHA256 על גוף הבקשה הגולמי (X-Hub-Signature-256),
 *   ואז ניתוב ההודעות ל-Inbound Service. כשל אימות ⇒ 401, בלי פירוט.
 */
@Controller("webhooks/whatsapp")
export class WhatsAppWebhookController {
  constructor(
    private readonly inbound: WhatsAppInboundService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  @Public()
  @Get()
  async verify(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ): Promise<string> {
    // הגדרות הפלטפורמה (מסך /platform) קודמות; משתנה הסביבה כ-Fallback
    const expected =
      (await this.platformSettings.get("whatsappVerifyToken")) ?? loadEnv().WHATSAPP_VERIFY_TOKEN;
    if (!expected || mode !== "subscribe" || token !== expected || !challenge) {
      throw new UnauthorizedException();
    }
    return challenge;
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request): Promise<{ ok: true }> {
    const secret =
      (await this.platformSettings.get("whatsappAppSecret")) ?? loadEnv().WHATSAPP_APP_SECRET;
    if (!secret) {
      // אינטגרציה לא מוגדרת — לא מקבלים כלום (אין מצב "פתוח בטעות").
      throw new UnauthorizedException();
    }

    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.headers["x-hub-signature-256"];
    if (!raw || typeof signature !== "string") {
      throw new UnauthorizedException();
    }
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }

    const body: unknown = req.body;
    if (typeof body !== "object" || body === null) {
      throw new BadRequestException();
    }
    await this.inbound.handle(body as Record<string, unknown>);
    return { ok: true };
  }
}
