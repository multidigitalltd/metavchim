import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { MEDIA_IMAGES_MAX, MEDIA_PRODUCT_IMAGES_MAX, type MediaImageKind, type MediaImagePatch } from "@metavchim/shared";
import { PHOTO_EXT, PHOTO_MIME, UnreadablePhotoError, enhancePhoto } from "../../core/photo-enhancer";
import { PrismaService } from "../../core/prisma.service";
import { StorageService, type StoredObject } from "../../core/storage.service";

/**
 * תמונות של מדיה — לוגו/שער אחד ודוגמאות מודעה.
 *
 * אותו מסלול כמו תמונות הנכסים: הסוג נקבע לפי Magic Bytes ולא לפי
 * מה שהדפדפן אמר, התמונה מכווצת ונשמרת כ-WebP בלי EXIF, והקובץ
 * נכתב ל-S3 **לפני** השורה — כישלון ב-S3 אינו משאיר שורה שמצביעה
 * על כלום. המפתח תחת `platform/` ולא תחת `tenants/`: זה קובץ של
 * הפלטפורמה, ו-`put` מקבל `tenantId: null` בהתאם.
 *
 * שער הוא אחד: העלאת שער חדש מחליפה את הקודם (הקובץ נמחק). דוגמאות
 * מוגבלות ל-`MEDIA_IMAGES_MAX` — להראות, לא גלריה.
 *
 * **הדמיה של מוצר** (`kind = product`) — אותה טבלה, אותו מסלול, עם
 * `product_id`: התמונה שייכת למוצר ולא למדיה, מוצגת על כרטיס המוצר,
 * ויורדת איתו. עד `MEDIA_PRODUCT_IMAGES_MAX` למוצר.
 */

export const MAX_MEDIA_IMAGE_BYTES = 10 * 1024 * 1024;

/** זיהוי לפי Magic Bytes — JPEG, PNG או WebP. SVG מחוץ בכוונה (XSS). */
function isSupportedImage(buf: Buffer): boolean {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }
  return (
    buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP"
  );
}

@Injectable()
export class MediaImagesService {
  private readonly logger = new Logger(MediaImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** הדמיה למוצר — המדיה נגזרת מהמוצר, והתמונה נקשרת אליו. */
  async uploadForProduct(productId: string, file: Buffer, caption: string): Promise<{ id: string }> {
    const product = await this.prisma.mediaProduct.findUnique({ where: { id: productId }, select: { outletId: true } });
    if (product === null) throw new NotFoundException("המוצר לא נמצא");
    return this.upload(product.outletId, file, { kind: "product", caption, productId });
  }

  async upload(
    outletId: string,
    file: Buffer,
    input: { kind: MediaImageKind; caption: string; productId?: string },
  ): Promise<{ id: string }> {
    const outlet = await this.prisma.mediaOutlet.findUnique({
      where: { id: outletId },
      select: { id: true },
    });
    if (outlet === null) throw new NotFoundException("המדיה לא נמצאה");
    // ‏הדמיה בלי מוצר, או מוצר בלי הדמיה — אין דבר כזה; הסוג והשיוך הולכים יחד
    if ((input.kind === "product") !== (input.productId !== undefined)) {
      throw new BadRequestException("הדמיה מועלית על מוצר; שער ודוגמאות — על המדיה");
    }
    if (input.productId !== undefined) {
      const count = await this.prisma.mediaOutletImage.count({ where: { productId: input.productId } });
      if (count >= MEDIA_PRODUCT_IMAGES_MAX) {
        throw new BadRequestException(`עד ${MEDIA_PRODUCT_IMAGES_MAX} הדמיות למוצר — מחקו אחת כדי להוסיף`);
      }
    }
    if (file.length === 0) throw new BadRequestException("קובץ ריק");
    if (file.length > MAX_MEDIA_IMAGE_BYTES) throw new BadRequestException("תמונה גדולה מדי — עד 10MB");
    if (!isSupportedImage(file)) throw new BadRequestException("פורמט לא נתמך — רק JPEG, PNG או WebP");
    if (input.kind === "sample") {
      const samples = await this.prisma.mediaOutletImage.count({ where: { outletId, kind: "sample" } });
      if (samples >= MEDIA_IMAGES_MAX) {
        throw new BadRequestException(`עד ${MEDIA_IMAGES_MAX} דוגמאות למדיה — מחקו אחת כדי להוסיף`);
      }
    }

    let enhanced;
    try {
      enhanced = await enhancePhoto(file);
    } catch (error) {
      if (error instanceof UnreadablePhotoError) throw new BadRequestException(error.message);
      throw error;
    }

    const id = ulid();
    const s3Key = `platform/media-outlets/${outletId}/${id}.${PHOTO_EXT}`;
    await this.storage.put(s3Key, enhanced.buffer, PHOTO_MIME, null);
    try {
      const previousCover =
        input.kind === "cover"
          ? await this.prisma.mediaOutletImage.findMany({ where: { outletId, kind: "cover" } })
          : [];
      const last = await this.prisma.mediaOutletImage.aggregate({
        where: input.productId === undefined ? { outletId, kind: input.kind } : { productId: input.productId },
        _max: { sortOrder: true },
      });
      await this.prisma.mediaOutletImage.create({
        data: {
          id,
          outletId,
          productId: input.productId ?? null,
          kind: input.kind,
          s3Key,
          contentType: PHOTO_MIME,
          caption: input.caption,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
      // שער אחד: הקודם יורד אחרי שהחדש כבר במקום, כדי שלא יהיה רגע בלי שער
      for (const old of previousCover) await this.remove(old.id);
    } catch (error) {
      await this.deleteObjectQuietly(s3Key);
      throw error;
    }
    return { id };
  }

  async patch(id: string, input: MediaImagePatch): Promise<void> {
    const existing = await this.prisma.mediaOutletImage.findUnique({ where: { id } });
    if (existing === null) throw new NotFoundException("התמונה לא נמצאה");
    // ‏הדמיה נשארת הדמיה של המוצר שלה; שער ודוגמה אינם הופכים להדמיה בלי מוצר
    if (input.kind !== undefined && input.kind !== existing.kind && (input.kind === "product" || existing.kind === "product")) {
      throw new BadRequestException("אי אפשר להפוך הדמיה של מוצר לתמונת מדיה, או להפך — מעלים מחדש במקום הנכון");
    }
    await this.prisma.mediaOutletImage.update({ where: { id }, data: input });
  }

  /** השורה יורדת ראשונה: תמונה בלי שורה אינה מוצגת, שורה בלי תמונה היא 404 בכרטיס. */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.mediaOutletImage.findUnique({ where: { id } });
    if (existing === null) return;
    await this.prisma.mediaOutletImage.delete({ where: { id } });
    await this.deleteObjectQuietly(existing.s3Key);
  }

  /** הקובץ להגשה — לפי slug המדיה ומזהה התמונה, כדי שכתובת לא תדלוף בין מדיות. */
  async getRaw(slug: string, imageId: string): Promise<StoredObject> {
    const image = await this.prisma.mediaOutletImage.findFirst({
      where: { id: imageId, outlet: { slug, active: true } },
      select: { s3Key: true },
    });
    if (image === null) throw new NotFoundException("התמונה לא נמצאה");
    try {
      return await this.storage.getObject(image.s3Key);
    } catch (error) {
      // רק קובץ חסר הוא 404 — תקלת אחסון נשארת 500 כדי שלא תישמר במטמון
      if (StorageService.isMissingObjectError(error)) throw new NotFoundException("התמונה לא נמצאה");
      throw error;
    }
  }

  private async deleteObjectQuietly(s3Key: string): Promise<void> {
    try {
      await this.storage.delete(s3Key);
    } catch (error) {
      this.logger.error(`מחיקת ${s3Key} מהאחסון נכשלה: ${String(error)}`);
    }
  }
}
