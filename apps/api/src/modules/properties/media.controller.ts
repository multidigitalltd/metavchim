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
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
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
