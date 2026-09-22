import { Body, Controller, Get, Param, Post, Req, Res, type StreamableFile } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  IdSchema,
  MEDIA_SLUG_PATTERN,
  MediaOrderCreateSchema,
  type MediaOrderCreate,
  type MediaOrderStatus,
} from "@metavchim/shared";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { objectResponse } from "../../common/object-response";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MediaImagesService } from "./media-images.service";
import {
  MediaService,
  orderContext,
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
 */
const SlugSchema = z.string().trim().min(2).max(60).regex(MEDIA_SLUG_PATTERN);
const SlugParam = new ZodValidationPipe(SlugSchema);
const IdParam = new ZodValidationPipe(IdSchema);
const OrderBody = new ZodValidationPipe(MediaOrderCreateSchema);

@Controller("media")
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly images: MediaImagesService,
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
}
