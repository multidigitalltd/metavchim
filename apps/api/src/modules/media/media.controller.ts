import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  type StreamableFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  IdSchema,
  MEDIA_CREATIVE_MAX_BYTES,
  MEDIA_SLUG_PATTERN,
  MediaOrderCreateSchema,
  type MediaOrderCreate,
  type MediaOrderStatus,
} from "@metavchim/shared";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { objectResponse } from "../../common/object-response";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MediaCreativesService } from "./media-creatives.service";
import { MediaImagesService } from "./media-images.service";
import { MediaPreviewGuard } from "./media-preview.guard";
import {
  MediaService,
  orderContext,
  type MediaOrderDetail,
  type MediaOrderRow,
  type MediaOutletCard,
  type MediaOutletDetail,
} from "./media.service";

/**
 * רכש מדיה — נתיבי המשרד.
 *
 * ## מי רשאי למה
 *
 * - **הארכיון וההזמנות** — כל משתמש מחובר. אין כאן נתוני לקוחות;
 *   יש קטלוג של הפלטפורמה ורשימת ההזמנות של המשרד עצמו.
 * - **הפניה לנציג** — כל משתמש מחובר: היא אינה מחייבת את המשרד
 *   בכסף, והסוכן שמפרסם נכס הוא בדיוק מי שפונה.
 * - **הזמנה בתשלום** — `billing.manage`, כמו כל רכישה בכרטיס
 *   המשרד: קרדיטים, מקומות, מספרים. הסוכן רואה את המחיר; בעל
 *   המשרד משלם.
 *
 * ‏**בינתיים — תצוגה מקדימה.** `MediaPreviewGuard` על המחלקה פותח את
 * כל הנתיבים האלה למנהל הפלטפורמה בלבד, עד שהתיקונים יסתיימו; שאר
 * המשתמשים רואים „בקרוב”. ההצהרות למטה הן מה שיהיה בהשקה.
 */
const SlugSchema = z.string().trim().min(2).max(60).regex(MEDIA_SLUG_PATTERN);
const SlugParam = new ZodValidationPipe(SlugSchema);
const IdParam = new ZodValidationPipe(IdSchema);
const OrderBody = new ZodValidationPipe(MediaOrderCreateSchema);

@Controller("media")
@UseGuards(MediaPreviewGuard)
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly images: MediaImagesService,
    private readonly creatives: MediaCreativesService,
  ) {}

  @Get()
  @AnyAuthenticated()
  async catalog(): Promise<{ outlets: MediaOutletCard[] }> {
    return { outlets: await this.media.catalog() };
  }

  /*
   * ‏`orders` לפני `:slug` — Nest מתאים נתיבים לפי סדר ההצהרה, ו-slug
   * ‏בשם הזה היה בולע את הרשימה.
   */
  @Get("orders")
  @AnyAuthenticated()
  async orders(): Promise<{ orders: MediaOrderRow[] }> {
    return { orders: await this.media.orders(TenantContext.current().tenantId) };
  }

  /** עמוד ההזמנה — ציר הזמן, הקובץ, ומה אפשר לעשות. */
  @Get("orders/:id")
  @AnyAuthenticated()
  order(@Param("id", IdParam) id: string): Promise<MediaOrderDetail> {
    return this.media.order(TenantContext.current().tenantId, id);
  }

  /**
   * קובץ המודעה — העלאה או החלפה. כל משתמש במשרד: מי שמנהל את המודעה
   * אינו בהכרח מי שמשלם, והקובץ אינו מחייב כסף.
   */
  @Post("orders/:id/creative")
  @AnyAuthenticated()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MEDIA_CREATIVE_MAX_BYTES, files: 1 } }))
  uploadCreative(
    @Param("id", IdParam) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ creativeName: string; creativeMime: string; uploadedAt: Date }> {
    if (file === undefined) throw new BadRequestException("לא נבחר קובץ");
    return this.creatives.upload(orderContext(), id, { buffer: file.buffer, originalname: file.originalname });
  }

  /** קובץ המודעה של ההזמנה — למשרד שהעלה אותו. */
  @Get("orders/:id/creative")
  @AnyAuthenticated()
  async creative(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id", IdParam) id: string,
  ): Promise<StreamableFile | undefined> {
    const object = await this.creatives.getForTenant(TenantContext.current().tenantId, id);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(object.name)}`);
    return objectResponse(req, res, object, "private");
  }

  @Get(":slug")
  @AnyAuthenticated()
  outlet(@Param("slug", SlugParam) slug: string): Promise<MediaOutletDetail> {
    return this.media.outlet(slug);
  }

  /**
   * תמונה של מדיה — שער או דוגמת מודעה. מוזרמת דרך ה-API כמו תמונות
   * הנכסים (אין כתובות חתומות); `private` כי היא למחוברים בלבד.
   */
  @Get(":slug/images/:imageId")
  @AnyAuthenticated()
  async image(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("slug", SlugParam) slug: string,
    @Param("imageId", IdParam) imageId: string,
  ): Promise<StreamableFile | undefined> {
    return objectResponse(req, res, await this.images.getRaw(slug, imageId), "private");
  }

  /** הפניה — בלי תשלום. */
  @Post("orders/referral")
  @AnyAuthenticated()
  referral(@Body(OrderBody) body: MediaOrderCreate): Promise<{ orderId: string; status: MediaOrderStatus }> {
    return this.media.createReferral(orderContext(), body);
  }

  /** הזמנה בתשלום — פתיחת דף תשלום אצל קארדקום. */
  @Post("orders/checkout")
  @RequireCapability("billing.manage")
  checkout(
    @Body(OrderBody) body: MediaOrderCreate,
  ): Promise<{ orderId: string; paymentId: string; url: string }> {
    return this.media.startCheckout(orderContext(), body);
  }

  /** המשך לתשלום — דף תשלום חדש להזמנה שממתינה או שנכשלה. */
  @Post("orders/:id/checkout")
  @RequireCapability("billing.manage")
  resume(@Param("id", IdParam) id: string): Promise<{ orderId: string; paymentId: string; url: string }> {
    return this.media.resumeCheckout(orderContext(), id);
  }

  /** ביטול הזמנה שממתינה לתשלום. */
  @Post("orders/:id/cancel")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async cancel(@Param("id", IdParam) id: string): Promise<{ ok: true }> {
    await this.media.cancel(orderContext(), id);
    return { ok: true };
  }
}
