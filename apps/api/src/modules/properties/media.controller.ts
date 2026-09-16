import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { z } from "zod";
import { IdSchema, PhotoBlurSchema, type PhotoBlurRequest } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { objectResponse } from "../../common/object-response";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MAX_IMAGE_BYTES, MediaService, type MediaDto } from "./media.service";

/**
 * תמונות נכס — העלאה כ-multipart דרך ה-API (ולידציית תוכן בשרת),
 * צפייה ב-URL חתום. עריכה דורשת properties.edit; צפייה properties.view.
 */
const AltTextSchema = z.object({ altText: z.string().max(300) }).strict();
const UploadFieldsSchema = z.object({ altText: z.string().max(300).optional() }).strict();

const IdParam = new ZodValidationPipe(IdSchema);

@Controller("properties/:id/media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  @RequireCapability("properties.view")
  list(@Param("id", IdParam) propertyId: string): Promise<MediaDto[]> {
    return this.media.list(propertyId);
  }

  @Post()
  @RequireCapability("properties.edit")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  upload(
    @Param("id", IdParam) propertyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(UploadFieldsSchema)) body: z.infer<typeof UploadFieldsSchema>,
  ): Promise<MediaDto> {
    return this.media.upload(propertyId, file?.buffer ?? Buffer.alloc(0), body.altText);
  }

  /**
   * הזרמת התמונה עצמה — הדפדפן לא ניגש לשרת האחסון הפנימי ישירות.
   * ‏הקובץ משתכתב במקום (טשטוש, שיפור), ולכן `no-cache` + ETag ולא
   * ‏שעה של מטמון — ראו `objectResponse`.
   */
  @Get(":mediaId/raw")
  @RequireCapability("properties.view")
  async raw(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id", IdParam) propertyId: string,
    @Param("mediaId", IdParam) mediaId: string,
  ): Promise<StreamableFile | undefined> {
    return objectResponse(req, res, await this.media.getRaw(propertyId, mediaId), "private");
  }

  @Delete(":mediaId")
  @RequireCapability("properties.edit")
  @HttpCode(204)
  async remove(
    @Param("id", IdParam) propertyId: string,
    @Param("mediaId", IdParam) mediaId: string,
  ): Promise<void> {
    await this.media.remove(propertyId, mediaId);
  }

  @Post(":mediaId/primary")
  @RequireCapability("properties.edit")
  @HttpCode(204)
  async makePrimary(
    @Param("id", IdParam) propertyId: string,
    @Param("mediaId", IdParam) mediaId: string,
  ): Promise<void> {
    await this.media.makePrimary(propertyId, mediaId);
  }

  /** ‏„לשפר” על תמונה שהועלתה לפני הכלי. אותה יכולת כמו ההעלאה. */
  @Post(":mediaId/enhance")
  @RequireCapability("properties.edit")
  enhance(
    @Param("id", IdParam) propertyId: string,
    @Param("mediaId", IdParam) mediaId: string,
  ): Promise<MediaDto> {
    return this.media.enhance(propertyId, mediaId);
  }

  /** ‏טשטוש מלבנים — בלתי הפיך; המלבנים כשברים של התמונה. */
  @Post(":mediaId/blur")
  @RequireCapability("properties.edit")
  blur(
    @Param("id", IdParam) propertyId: string,
    @Param("mediaId", IdParam) mediaId: string,
    @Body(new ZodValidationPipe(PhotoBlurSchema)) body: PhotoBlurRequest,
  ): Promise<MediaDto> {
    return this.media.blur(propertyId, mediaId, body.rects);
  }

  @Patch(":mediaId")
  @RequireCapability("properties.edit")
  @HttpCode(204)
  async updateAlt(
    @Param("id", IdParam) propertyId: string,
    @Param("mediaId", IdParam) mediaId: string,
    @Body(new ZodValidationPipe(AltTextSchema)) body: z.infer<typeof AltTextSchema>,
  ): Promise<void> {
    await this.media.updateAltText(propertyId, mediaId, body.altText);
  }
}
