import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { IdSchema, PhoneSchema, normalizePhone } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { LandingService, type LandingView } from "./landing.service";

/**
 * דף הנחיתה של נכס: יצירה/ביטול למתווך המחובר, וצפייה + טופס פנייה
 * ציבוריים לפי טוקן. אותו נוהג כמו דף ההצעה — הטוקן הוא ההרשאה.
 */

const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

// גולש מקליד "050-1234567" — מנרמלים ל-E.164 (normalizePhone המשותפת) לפני הוולידציה.
const LandingLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(25).transform(normalizePhone).pipe(PhoneSchema),
    message: z.string().trim().max(2000).optional(),
    website: z.string().max(200).optional(), // honeypot — אמור להישאר ריק
  })
  .strict();

@Controller()
export class LandingController {
  constructor(private readonly landing: LandingService) {}

  /** יצירת קישור דף הנחיתה (או החזרתו אם קיים). */
  @Post("properties/:id/landing")
  @RequireCapability("properties.edit")
  @RequireFeature("landing_pages")
  ensure(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{ url: string }> {
    return this.landing.ensure(id);
  }

  /** ביטול הקישור — הדף מפסיק לעבוד מיידית. */
  @Delete("properties/:id/landing")
  @RequireCapability("properties.edit")
  @HttpCode(204)
  async revoke(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.landing.revoke(id);
  }

  @Public()
  @Get("public/landing/:token")
  view(@Param("token", new ZodValidationPipe(TokenSchema)) token: string): Promise<LandingView> {
    return this.landing.publicView(token);
  }

  @Public()
  @Get("public/landing/:token/media/:mediaId")
  @Header("Cache-Control", "public, max-age=3600")
  async image(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
    @Param("mediaId", new ZodValidationPipe(IdSchema)) mediaId: string,
  ): Promise<StreamableFile> {
    const obj = await this.landing.publicImage(token, mediaId);
    return new StreamableFile(obj.body as never, {
      type: obj.contentType ?? "application/octet-stream",
      ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
    });
  }

  /**
   * פנייה מהטופס בדף — נכנסת ללידים של המשרד עם הקשר הנכס.
   * מגבלה הדוקה כמו בטופס האתר: נתיב ציבורי שכותב שורות.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("public/landing/:token/lead")
  @HttpCode(200)
  async lead(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
    @Body(new ZodValidationPipe(LandingLeadSchema)) body: z.infer<typeof LandingLeadSchema>,
  ): Promise<{ ok: true }> {
    if (body.website?.trim()) return { ok: true }; // בוט — נבלע בשקט
    await this.landing.publicLead(token, {
      name: body.name,
      phone: body.phone,
      message: body.message,
    });
    return { ok: true };
  }
}
