import { BadRequestException, GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  MEDIA_CREATIVE_EXT,
  MEDIA_CREATIVE_MAX_BYTES,
  mediaCanUploadCreative,
  mediaCreativeMime,
  type MediaOrderStatus,
} from "@metavchim/shared";
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";
import { StorageService, type StoredObject } from "../../core/storage.service";
import { MediaMailService } from "./media-mail.service";

/**
 * קובץ המודעה — מה שהמעצב של המגזין מקבל לדפוס.
 *
 * ## למה קובץ ולא רק תדריך
 *
 * התדריך („מה לפרסם”) הוא טקסט חופשי. מגזין מודפס עובד עם קובץ:
 * מודעה מעוצבת ב-PDF, או תמונה מוכנה. בלי זה, אחרי ההזמנה במערכת
 * חוזרים למייל — בדיוק מה שרכש המדיה בא להחליף.
 *
 * ## כפי שהועלה
 *
 * תמונות הנכסים מכווצות ל-WebP כי הן לתצוגה. כאן ההפך: הקובץ הולך
 * לדפוס, וכל כיווץ פוגע בו. לכן זיהוי לפי Magic Bytes (`mediaCreativeMime`
 * ב-shared), תקרת גודל, ושמירה של הבייטים כפי שהם. שלושה סוגים בלבד —
 * מה שמגזין באמת מקבל.
 *
 * ## הקישור לנציג
 *
 * לנציג המדיה אין חשבון במערכת, ולכן הקובץ מגיע אליו בקישור עם
 * אסימון אקראי (`creative_token`, 32 בייט) — אותו דגם כמו דף ההשוואה
 * לקונה. האסימון מתחלף בכל העלאה: קישור ישן במייל ישן מפסיק לעבוד
 * ברגע שהקובץ הוחלף, כדי שהמגזין לא ידפיס טיוטה.
 *
 * ‎`media_orders` מחוץ ל-RLS: כל שאילתה כאן מסננת לפי המשרד במפורש,
 * חוץ מהחיפוש לפי אסימון — שם האסימון הוא ההרשאה.
 */
@Injectable()
export class MediaCreativesService {
  private readonly logger = new Logger(MediaCreativesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MediaMailService,
  ) {}

  /**
   * העלאה או החלפה. ההזמנה חייבת להיות חיה (לא נכשלה, לא בוטלה,
   * לא פורסמה). כשההזמנה כבר אצל המדיה, הנציג מקבל מייל עם הקישור
   * החדש — אחרת הוא יחכה לקובץ שכבר הועלה.
   *
   * ‏**הבדיקה חוזרת בכתיבה.** בין הקריאה לעדכון ההזמנה יכולה להתבטל,
   * ‏להיכשל או להיות מסומנת „פורסם” — ו-`updateMany` מותנה במצב שנקרא
   * ‏וב-`publishedAt` ריק, כדי שקובץ לא ייכתב על הזמנה שכבר ננעלה ושהמייל
   * ‏לנציג לא יצא על סמך מצב ישן. באותו אופן, המשרד יכול להיכנס למחיקה
   * ‏בזמן ההעלאה: אחרי שהשורה מצביעה על הקובץ נבדק שוב `filesLockedAt`,
   * ‏כי איסוף הקבצים למחיקה קורה אחרי הנעילה — קובץ שנרשם רגע אחריו היה
   * ‏נשאר בלי שורה ובלי איסוף (ביקורת Codex).
   */
  async upload(
    ctx: { tenantId: string; userId: string },
    orderId: string,
    file: { buffer: Buffer; originalname: string },
  ): Promise<{ creativeName: string; creativeMime: string; uploadedAt: Date }> {
    const order = await this.prisma.mediaOrder.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId },
    });
    if (order === null) throw new NotFoundException("ההזמנה לא נמצאה");
    if (!mediaCanUploadCreative(order.status as MediaOrderStatus, order.publishedAt)) {
      throw new BadRequestException(
        order.publishedAt !== null ? "המודעה כבר פורסמה — אין להחליף את הקובץ" : "ההזמנה אינה פעילה",
      );
    }
    if (file.buffer.length === 0) throw new BadRequestException("הקובץ ריק");
    if (file.buffer.length > MEDIA_CREATIVE_MAX_BYTES) {
      throw new BadRequestException(`הקובץ גדול מדי — עד ${MEDIA_CREATIVE_MAX_BYTES / (1024 * 1024)}MB`);
    }
    const mime = mediaCreativeMime(file.buffer);
    if (mime === null) throw new BadRequestException("הקובץ אינו JPEG, PNG או PDF");

    const key = `tenants/${ctx.tenantId}/media-orders/${order.id}/${ulid()}.${MEDIA_CREATIVE_EXT[mime]}`;
    // ‏הקובץ ל-S3 לפני השורה: כסף בלי שורה גרוע משורה בלי כסף, וקובץ בלי שורה נאסף
    await this.storage.put(key, file.buffer, mime, ctx.tenantId);
    const token = randomBytes(32).toString("base64url");
    const uploadedAt = new Date();
    const creativeName = safeName(file.originalname, MEDIA_CREATIVE_EXT[mime]);
    const previousKey = order.creativeKey;

    try {
      await this.prisma.withTenant(async (tx) => {
        const claimed = await tx.mediaOrder.updateMany({
          // ‏מותנה במה שנקרא: הזמנה שבינתיים בוטלה, נכשלה או פורסמה — לא מקבלת קובץ
          where: { tenantId: ctx.tenantId, id: order.id, status: order.status, publishedAt: null },
          data: {
            creativeKey: key,
            creativeMime: mime,
            creativeName,
            creativeToken: token,
            creativeUploadedAt: uploadedAt,
          },
        });
        if (claimed.count === 0) throw new BadRequestException("ההזמנה השתנתה בינתיים — רעננו את המסך ונסו שוב");
        await this.audit.record(tx, {
          action: previousKey === null ? "media.creative_uploaded" : "media.creative_replaced",
          entityType: "media_order",
          entityId: order.id,
          metadata: { creativeName, creativeMime: mime },
        });
      });
    } catch (error) {
      // ‏השורה לא נכתבה — הקובץ שהועלה הוא יתום, ונמחק כאן ולא בסריקה
      await this.discard(key, "העלאה שנדחתה");
      throw error;
    }

    // ‏המשרד נכנס למחיקה בזמן ההעלאה? איסוף הקבצים כבר עבר — הקובץ נמחק כאן
    const tenant = await this.prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { filesLockedAt: true } });
    if (tenant === null || tenant.filesLockedAt !== null) {
      await this.discard(key, "משרד שנמחק");
      throw new GoneException("המשרד נמחק — לא ניתן להעלות אליו קבצים");
    }

    if (previousKey !== null && previousKey !== key) {
      try {
        await this.storage.delete(previousKey);
      } catch (error) {
        // הקובץ הישן ייאסף בסריקת האחסון; השורה כבר מצביעה על החדש
        this.logger.warn(`מחיקת קובץ מודעה קודם נכשלה (${previousKey}): ${(error as Error).message}`);
      }
    }

    // ‏ההזמנה כבר אצל המדיה — הנציג צריך לדעת שיש (או התחלף) קובץ
    if (order.status === "paid" || order.status === "referred") {
      const outlet = await this.prisma.mediaOutlet.findUnique({
        where: { id: order.outletId },
        select: { name: true, contactName: true, contactEmail: true, contactPhone: true, closingText: true, nextClosingAt: true },
      });
      await this.mail.creativeUploaded(
        { ...order, creativeToken: token, creativeName, creativeUploadedAt: uploadedAt },
        outlet,
        previousKey !== null,
      );
    }

    return { creativeName, creativeMime: mime, uploadedAt };
  }

  /** מחיקת קובץ שהועלה ולא נרשם; כשל במחיקה נרשם ואינו מסתיר את הסיבה המקורית. */
  private async discard(key: string, reason: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.error(`מחיקת קובץ מודעה יתום (${reason}, ${key}) נכשלה: ${(error as Error).message}`);
    }
  }

  /** הקובץ למשרד עצמו — אותו משרד בלבד. */
  async getForTenant(tenantId: string, orderId: string): Promise<StoredObject & { name: string }> {
    const order = await this.prisma.mediaOrder.findFirst({
      where: { id: orderId, tenantId },
      select: { creativeKey: true, creativeName: true },
    });
    return this.open(order);
  }

  /** הקובץ למנהל הפלטפורמה — חוצה משרדים בהגדרה; השער בבקר. */
  async getForAdmin(orderId: string): Promise<StoredObject & { name: string }> {
    const order = await this.prisma.mediaOrder.findUnique({
      where: { id: orderId },
      select: { creativeKey: true, creativeName: true },
    });
    return this.open(order);
  }

  /**
   * הקובץ לנציג המדיה — לפי האסימון מהמייל, בלי התחברות. אסימון
   * שהוחלף (קובץ חדש) אינו נמצא, וזו הכוונה.
   */
  async getByToken(token: string): Promise<StoredObject & { name: string }> {
    const order = await this.prisma.mediaOrder.findUnique({
      where: { creativeToken: token },
      select: { creativeKey: true, creativeName: true },
    });
    return this.open(order);
  }

  /** מה שדף הקובץ הציבורי מציג מעל הקובץ — בלי פרטי המשרד. */
  async describeByToken(token: string): Promise<{
    outletName: string;
    productName: string;
    quantity: number;
    creativeName: string;
    creativeMime: string;
    uploadedAt: Date;
    brief: string;
  }> {
    const order = await this.prisma.mediaOrder.findUnique({
      where: { creativeToken: token },
      select: {
        outletName: true,
        productName: true,
        quantity: true,
        creativeName: true,
        creativeMime: true,
        creativeUploadedAt: true,
        brief: true,
      },
    });
    if (order === null || order.creativeName === null || order.creativeMime === null || order.creativeUploadedAt === null) {
      throw new NotFoundException("הקישור אינו בתוקף — ייתכן שהקובץ הוחלף; בדקו את המייל האחרון");
    }
    return {
      outletName: order.outletName,
      productName: order.productName,
      quantity: order.quantity,
      creativeName: order.creativeName,
      creativeMime: order.creativeMime,
      uploadedAt: order.creativeUploadedAt,
      brief: order.brief,
    };
  }

  private async open(
    order: { creativeKey: string | null; creativeName: string | null } | null,
  ): Promise<StoredObject & { name: string }> {
    if (order === null || order.creativeKey === null) throw new NotFoundException("אין קובץ מודעה להזמנה הזו");
    try {
      const object = await this.storage.getObject(order.creativeKey);
      return { ...object, name: order.creativeName ?? "ad" };
    } catch {
      // ‏השורה מצביעה על קובץ שאיננו — מצב שדורש תיקון, לא 500
      throw new NotFoundException("קובץ המודעה אינו זמין");
    }
  }
}

/**
 * שם הקובץ כפי שיוצג ויורד — בלי נתיבים ותווי בקרה, ועם הסיומת
 * שתואמת את התוכן (לא את מה שהדפדפן טען).
 */
export function safeName(original: string, ext: string): string {
  const base = [...(original.split(/[\\/]/u).pop() ?? "").replace(/\.[A-Za-z0-9]{1,5}$/u, "")]
    // ‏תווי בקרה (מתחת לרווח) ותווים שאסורים בשם קובץ — נופלים
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && !'"<>|:*?'.includes(ch))
    .join("")
    .trim()
    .slice(0, 120);
  return `${base === "" ? "ad" : base}.${ext}`;
}
