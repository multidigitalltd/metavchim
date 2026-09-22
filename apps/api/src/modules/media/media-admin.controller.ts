import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  IdSchema,
  MediaOutletPatchSchema,
  MediaOutletUpsertSchema,
  MediaProductPatchSchema,
  MediaProductUpsertSchema,
  type MediaOutletPatch,
  type MediaOutletUpsert,
  type MediaProductPatch,
  type MediaProductUpsert,
} from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  MediaAdminService,
  type AdminMediaOrder,
  type AdminMediaOutlet,
} from "./media-admin.service";

/**
 * ניהול הארכיון במסך הפלטפורמה — מדיות, מוצרים, אנשי קשר, עמלה,
 * וההזמנות של כל המשרדים.
 *
 * קונטרולר משלו ולא עוד נתיב ב-`PlatformController`, מאותה סיבה
 * כמו שולחן החיבורים: גבול שאפשר להצביע עליו כקובץ שלם.
 */
const IdParam = new ZodValidationPipe(IdSchema);

@Controller("platform/media")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class MediaAdminController {
  constructor(private readonly admin: MediaAdminService) {}

  @Get()
  async outlets(): Promise<{ outlets: AdminMediaOutlet[] }> {
    return { outlets: await this.admin.outlets() };
  }

  @Get("orders")
  async orders(): Promise<{ orders: AdminMediaOrder[] }> {
    return { orders: await this.admin.orders() };
  }

  @Post("outlets")
  createOutlet(
    @Body(new ZodValidationPipe(MediaOutletUpsertSchema)) body: MediaOutletUpsert,
  ): Promise<{ id: string }> {
    return this.admin.createOutlet(body, TenantContext.current().userId);
  }

  @Patch("outlets/:id")
  async updateOutlet(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(MediaOutletPatchSchema)) body: MediaOutletPatch,
  ): Promise<{ ok: true }> {
    await this.admin.updateOutlet(id, body, TenantContext.current().userId);
    return { ok: true };
  }

  @Post("outlets/:id/products")
  createProduct(
    @Param("id", IdParam) outletId: string,
    @Body(new ZodValidationPipe(MediaProductUpsertSchema)) body: MediaProductUpsert,
  ): Promise<{ id: string }> {
    return this.admin.createProduct(outletId, body);
  }

  @Patch("products/:id")
  async updateProduct(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(MediaProductPatchSchema)) body: MediaProductPatch,
  ): Promise<{ ok: true }> {
    await this.admin.updateProduct(id, body);
    return { ok: true };
  }

  @Delete("products/:id")
  @HttpCode(200)
  async deleteProduct(@Param("id", IdParam) id: string): Promise<{ ok: true }> {
    await this.admin.deleteProduct(id);
    return { ok: true };
  }
}
