import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import {
  MEDIA_SLUG_PATTERN,
  MediaOrderCreateSchema,
  type MediaOrderCreate,
  type MediaOrderStatus,
} from "@metavchim/shared";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
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
const OrderBody = new ZodValidationPipe(MediaOrderCreateSchema);

@Controller("media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

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
  outlet(@Param("slug", new ZodValidationPipe(SlugSchema)) slug: string): Promise<MediaOutletDetail> {
    return this.media.outlet(slug);
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
