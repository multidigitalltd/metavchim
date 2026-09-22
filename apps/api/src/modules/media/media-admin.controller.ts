import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import {
  IdSchema,
  MEDIA_IMAGE_KINDS,
  MediaImagePatchSchema,
  MediaOutletPatchSchema,
  MediaOutletUpsertSchema,
  MediaProductPatchSchema,
  MediaProductUpsertSchema,
  MediaSettlementCreateSchema,
  type MediaImagePatch,
  type MediaOutletPatch,
  type MediaOutletUpsert,
  type MediaProductPatch,
  type MediaProductUpsert,
  type MediaSettlementCreate,
} from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  MediaAdminService,
  type AdminMediaOrder,
  type AdminMediaOutlet,
  type AdminMediaSettlement,
} from "./media-admin.service";
import { MAX_MEDIA_IMAGE_BYTES, MediaImagesService } from "./media-images.service";

/** שדות הטקסט שלצד הקובץ ב-multipart — סגורים, כמו בתמונות הנכסים. */
const UploadFieldsSchema = z
  .object({
    kind: z.enum(MEDIA_IMAGE_KINDS).default("sample"),
    caption: z.string().trim().max(200).default(""),
  })
  .strict();

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
  constructor(
    private readonly admin: MediaAdminService,
    private readonly images: MediaImagesService,
  ) {}

  @Get()
  async outlets(): Promise<{ outlets: AdminMediaOutlet[] }> {
    return { outlets: await this.admin.outlets() };
  }

  @Get("orders")
  async orders(): Promise<{ orders: AdminMediaOrder[] }> {
    return { orders: await this.admin.orders() };
  }

  @Get("settlements")
  async settlements(): Promise<{ settlements: AdminMediaSettlement[] }> {
    return { settlements: await this.admin.settlements() };
  }

  /** רישום העברה למדיה — כל מה ששולם וטרם הועבר, עם אסמכתה. */
  @Post("outlets/:id/settlements")
  settle(
    @Param("id", IdParam) outletId: string,
    @Body(new ZodValidationPipe(MediaSettlementCreateSchema)) body: MediaSettlementCreate,
  ): Promise<{ id: string; amountAgorot: number; orderCount: number }> {
    return this.admin.settle(outletId, body, TenantContext.current().userId);
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

  /** שער או דוגמת מודעה — קובץ אחד לבקשה, עד 10MB, JPEG/PNG/WebP. */
  @Post("outlets/:id/images")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_IMAGE_BYTES, files: 1 } }))
  uploadImage(
    @Param("id", IdParam) outletId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(UploadFieldsSchema)) body: z.infer<typeof UploadFieldsSchema>,
  ): Promise<{ id: string }> {
    return this.images.upload(outletId, file?.buffer ?? Buffer.alloc(0), body);
  }

  @Patch("images/:id")
  async updateImage(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(MediaImagePatchSchema)) body: MediaImagePatch,
  ): Promise<{ ok: true }> {
    await this.images.patch(id, body);
    return { ok: true };
  }

  @Delete("images/:id")
  @HttpCode(200)
  async deleteImage(@Param("id", IdParam) id: string): Promise<{ ok: true }> {
    await this.images.remove(id);
    return { ok: true };
  }
}
