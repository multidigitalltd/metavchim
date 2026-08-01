import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";

/**
 * תמונות נכס (docs/03 — property_media): העלאה דרך ה-API בלבד עם ולידציית
 * Magic Bytes בצד השרת (Content-Type מהדפדפן אינו גבול אמון), אחסון
 * ב-S3-תואם, צפייה ב-URL חתום קצר-מועד. RLS חל על הרשומות כרגיל.
 */

export interface MediaDto {
  id: string;
  kind: string;
  altText?: string;
  sortOrder: number;
  url: string;
}

const MAX_IMAGES_PER_PROPERTY = 20;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/** נתיב הזרמת התמונה יחסית לבסיס ה-API — הלקוח מרכיב את ה-URL המלא */
export function mediaRawPath(propertyId: string, mediaId: string): string {
  return `/properties/${propertyId}/media/${mediaId}/raw`;
}

/** זיהוי סוג תמונה לפי Magic Bytes — לא סומכים על ה-Content-Type של הלקוח. */
function sniffImageType(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }
  if (
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * מחיקת אובייקט עם רשת ביטחון: כשל זמני לא נבלע — נרשם אירוע Outbox
   * שמנותב לתור low ומנוסה שוב עד הצלחה (ביקורת Codex, PR #12).
   */
  private async deleteObjectDurably(s3Key: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    try {
      await this.storage.delete(s3Key);
    } catch {
      await this.prisma.withTenant(async (tx) => {
        await this.outbox.emit(tx, "storage.cleanup_object", { tenantId, s3Key });
      });
    }
  }

  async upload(propertyId: string, file: Buffer, altText?: string): Promise<MediaDto> {
    const tenantId = TenantContext.current().tenantId;
    if (file.length === 0) throw new BadRequestException("קובץ ריק");
    if (file.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException("תמונה גדולה מדי — עד 10MB");
    }
    const sniffed = sniffImageType(file);
    if (!sniffed) {
      throw new BadRequestException("פורמט לא נתמך — רק JPEG, PNG או WebP");
    }

    const id = ulid();
    const s3Key = `tenants/${tenantId}/properties/${propertyId}/${id}.${sniffed.ext}`;

    // בדיקה מוקדמת (קיום + מכסה) — כישלון זול לפני כתיבה ל-S3.
    await this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");
      const count = await tx.propertyMedia.count({ where: { tenantId, propertyId } });
      if (count >= MAX_IMAGES_PER_PROPERTY) {
        throw new BadRequestException(`עד ${MAX_IMAGES_PER_PROPERTY} תמונות לנכס`);
      }
    });

    // ההעלאה ל-S3 לפני הרשומה — כשל S3 ⇒ אין רשומה שמצביעה לכלום.
    await this.storage.put(s3Key, file, sniffed.mime);

    let assignedOrder = 0;
    try {
      await this.prisma.withTenant(async (tx) => {
        // נעילת שורת הנכס מסדרת העלאות מקבילות: המכסה וה-sortOrder
        // מוקצים אטומית תחת אותה נעילה (ביקורת Codex, PR #12).
        await tx.$queryRaw`SELECT id FROM properties WHERE id = ${propertyId} FOR UPDATE`;
        const count = await tx.propertyMedia.count({ where: { tenantId, propertyId } });
        if (count >= MAX_IMAGES_PER_PROPERTY) {
          throw new BadRequestException(`עד ${MAX_IMAGES_PER_PROPERTY} תמונות לנכס`);
        }
        const last = await tx.propertyMedia.findFirst({
          where: { tenantId, propertyId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        assignedOrder = (last?.sortOrder ?? -1) + 1;
        await tx.propertyMedia.create({
          data: {
            id,
            tenantId,
            propertyId,
            kind: "image",
            s3Key,
            altText: altText ?? null,
            sortOrder: assignedOrder,
          },
        });
        await this.audit.record(tx, {
          action: "property.media_upload",
          entityType: "property",
          entityId: propertyId,
        });
      });
    } catch (error) {
      // הרשומה לא נוצרה — האובייקט שהועלה מנוקה (מיידית או דרך התור)
      await this.deleteObjectDurably(s3Key);
      throw error;
    }

    return {
      id,
      kind: "image",
      altText,
      sortOrder: assignedOrder,
      url: mediaRawPath(propertyId, id),
    };
  }

  /**
   * הזרמת התמונה עצמה דרך ה-API — הדפדפן לא מדבר עם שרת האחסון ישירות
   * (בפרודקשן MinIO חי על רשת פנימית של compose, בלי כתובת ציבורית;
   * URL חתום שנוצר מולו לא נגיש מהדפדפן — ביקורת Codex).
   */
  async getRaw(
    propertyId: string,
    mediaId: string,
  ): Promise<{ body: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.propertyMedia.findFirst({
        where: { id: mediaId, tenantId, propertyId },
        select: { s3Key: true },
      }),
    );
    if (!row) throw new NotFoundException("תמונה לא נמצאה");
    try {
      return await this.storage.getObject(row.s3Key);
    } catch (error) {
      // רק "האובייקט לא קיים" ממופה ל-404; כשל תשתית זמני נשאר 500
      // כדי לא להתקבע בקאש כתמונה חסרה (ביקורת Codex)
      if (StorageService.isMissingObjectError(error)) {
        throw new NotFoundException("התמונה לא נמצאה באחסון");
      }
      throw error;
    }
  }

  async list(propertyId: string): Promise<MediaDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");
      return tx.propertyMedia.findMany({
        where: { tenantId, propertyId },
        orderBy: { sortOrder: "asc" },
      });
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      altText: r.altText ?? undefined,
      sortOrder: r.sortOrder,
      url: mediaRawPath(propertyId, r.id),
    }));
  }

  async remove(propertyId: string, mediaId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const { s3Key, referencedByOffer } = await this.prisma.withTenant(async (tx) => {
      const row = await tx.propertyMedia.findFirst({
        where: { id: mediaId, tenantId, propertyId },
        select: { s3Key: true },
      });
      if (!row) throw new NotFoundException("תמונה לא נמצאה");
      await tx.propertyMedia.delete({ where: { id: mediaId } });
      await this.audit.record(tx, {
        action: "property.media_delete",
        entityType: "property",
        entityId: propertyId,
      });
      // הצעה חיה מפנה לתמונה ב-snapshot שלה? האובייקט נשאר עד שתפוג —
      // אחרת דף ההצעה אצל הקונה נשבר (ביקורת Codex). הרשומה נמחקת כרגיל.
      const referencing = await tx.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM offers
          WHERE tenant_id = ${tenantId}
            AND token_expires > now()
            AND presentation -> 'media' @> ${JSON.stringify([{ key: row.s3Key }])}::jsonb
        ) AS "exists"`;
      return { s3Key: row.s3Key, referencedByOffer: referencing[0]?.exists ?? false };
    });
    if (referencedByOffer) return;
    // מחיקת האובייקט אחרי הטרנזקציה — כשל זמני מנותב לניסיון חוזר עמיד
    // דרך Outbox → תור low; לעולם לא רשומה שמצביעה לכלום.
    await this.deleteObjectDurably(s3Key);
  }

  /** הופך תמונה לראשית (sortOrder 0) ומזיז את השאר — התמונה בכרטיס הנכס. */
  async makePrimary(propertyId: string, mediaId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const target = await tx.propertyMedia.findFirst({
        where: { id: mediaId, tenantId, propertyId },
        select: { id: true },
      });
      if (!target) throw new NotFoundException("תמונה לא נמצאה");
      const rows = await tx.propertyMedia.findMany({
        where: { tenantId, propertyId },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });
      const reordered = [mediaId, ...rows.map((r) => r.id).filter((rid) => rid !== mediaId)];
      for (const [index, rid] of reordered.entries()) {
        await tx.propertyMedia.update({ where: { id: rid }, data: { sortOrder: index } });
      }
      await this.audit.record(tx, {
        action: "property.media_primary",
        entityType: "property",
        entityId: propertyId,
      });
    });
  }

  async updateAltText(propertyId: string, mediaId: string, altText: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const row = await tx.propertyMedia.findFirst({
        where: { id: mediaId, tenantId, propertyId },
        select: { id: true },
      });
      if (!row) throw new NotFoundException("תמונה לא נמצאה");
      await tx.propertyMedia.update({ where: { id: mediaId }, data: { altText } });
      await this.audit.record(tx, {
        action: "property.media_alt_text",
        entityType: "property",
        entityId: propertyId,
      });
    });
  }
}
