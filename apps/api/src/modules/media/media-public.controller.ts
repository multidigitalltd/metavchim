import { Controller, Get, Param, Req, Res, type StreamableFile } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z } from "zod";
import { Public } from "../../common/auth.decorators";
import { objectResponse } from "../../common/object-response";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MediaCreativesService } from "./media-creatives.service";

/**
 * קובץ המודעה לנציג המדיה — בלי חשבון, לפי האסימון שבמייל.
 *
 * ‏בקר נפרד ולא נתיב ב-`MediaController`: שם יושב `MediaPreviewGuard`
 * ‏שקורא את הקשר הדייר, ולנציג אין כזה. האסימון (32 בייט אקראיים,
 * ‏base64url, 43 תווים) הוא ההרשאה — אותו דגם כמו דף ההשוואה לקונה —
 * ‏והוא מתחלף בכל העלאה, כך שקישור ישן מפסיק לעבוד כשהקובץ הוחלף.
 */
const TokenParam = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{43}$/u));

@Controller("public/media")
export class MediaPublicController {
  constructor(private readonly creatives: MediaCreativesService) {}

  /** מה הקובץ ולמי — הכותרת של דף הקובץ, בלי פרטי המשרד. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("creatives/:token")
  describe(@Param("token", TokenParam) token: string): Promise<{
    outletName: string;
    productName: string;
    quantity: number;
    creativeName: string;
    creativeMime: string;
    uploadedAt: Date;
    brief: string;
  }> {
    return this.creatives.describeByToken(token);
  }

  /** הקובץ עצמו — להצגה או להורדה. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("creatives/:token/file")
  async file(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("token", TokenParam) token: string,
  ): Promise<StreamableFile | undefined> {
    const object = await this.creatives.getByToken(token);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(object.name)}`);
    // ‏private: הקישור אישי לנציג; מטמון משותף לא אמור להחזיק מודעה של משרד
    return objectResponse(req, res, object, "private");
  }
}
