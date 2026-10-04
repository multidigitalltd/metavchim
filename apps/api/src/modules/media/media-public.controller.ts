import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, type StreamableFile } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { MediaPublishSchema, type MediaPublish } from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { objectResponse } from "../../common/object-response";
import { PublicTokenParam, ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MediaCreativesService } from "./media-creatives.service";
import { MediaService, type MediaOutletOrderView } from "./media.service";

/**
 * הצד של נציג המדיה — בלי חשבון, לפי האסימון שבמייל.
 *
 * ‏בקר נפרד ולא נתיב ב-`MediaController`: שם יושב `MediaPreviewGuard`
 * ‏שקורא את הקשר הדייר, ולנציג אין כזה. האסימון (32 בייט אקראיים,
 * ‏base64url, 43 תווים) הוא ההרשאה — אותו דגם כמו דף ההשוואה לקונה.
 *
 * ‏שני אסימונים, שני תפקידים:
 * ‏- **אסימון הקובץ** (`/ad/<token>`) מתחלף בכל העלאה, כך שקישור ישן
 * ‏  מפסיק לעבוד כשהקובץ הוחלף — שהמגזין לא ידפיס טיוטה.
 * ‏- **אסימון ההזמנה** (`/outlet/<token>`) קבוע: עמוד ההזמנה של הנציג,
 * ‏  שם הוא מאשר קבלה, מוריד את הקובץ העדכני ומסמן שהמודעה פורסמה.
 */
const PublishBody = new ZodValidationPipe(MediaPublishSchema);

@Controller("public/media")
export class MediaPublicController {
  constructor(
    private readonly creatives: MediaCreativesService,
    private readonly media: MediaService,
  ) {}

  /** מה הקובץ ולמי — הכותרת של דף הקובץ, בלי פרטי המשרד. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("creatives/:token")
  describe(@Param("token", PublicTokenParam) token: string): Promise<{
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
    @Param("token", PublicTokenParam) token: string,
  ): Promise<StreamableFile | undefined> {
    const object = await this.creatives.getByToken(token);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(object.name)}`);
    // ‏private: הקישור אישי לנציג; מטמון משותף לא אמור להחזיק מודעה של משרד
    return objectResponse(req, res, object, "private");
  }

  /* ==================== עמוד ההזמנה של הנציג ==================== */

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("orders/:token")
  order(@Param("token", PublicTokenParam) token: string): Promise<MediaOutletOrderView> {
    return this.media.outletView(token);
  }

  /** קובץ המודעה העדכני של ההזמנה — מהעמוד הקבוע, לא מהקישור שבמייל הישן. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("orders/:token/creative")
  async orderCreative(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("token", PublicTokenParam) token: string,
  ): Promise<StreamableFile | undefined> {
    const object = await this.creatives.getByOutletToken(token);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(object.name)}`);
    return objectResponse(req, res, object, "private");
  }

  /** „קיבלנו את ההזמנה” — פעם אחת; לחיצה חוזרת מחזירה את המועד הקיים. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("orders/:token/confirm")
  @HttpCode(200)
  confirm(@Param("token", PublicTokenParam) token: string): Promise<{ confirmedAt: Date }> {
    return this.media.confirmByOutlet(token);
  }

  /** „המודעה פורסמה” — עם הערה (גיליון, עמוד); אותו מסלול כמו מסך הפלטפורמה. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("orders/:token/publish")
  @HttpCode(200)
  publish(@Param("token", PublicTokenParam) token: string, @Body(PublishBody) body: MediaPublish): Promise<{ publishedAt: Date }> {
    return this.media.publishByOutlet(token, body.note);
  }
}
