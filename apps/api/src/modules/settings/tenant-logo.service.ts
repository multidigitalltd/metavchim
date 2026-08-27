import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { TenantContext } from "../../common/tenant-context";

/**
 * הלוגו של המשרד.
 *
 * ## למה הוא לא עוד שדה טקסט
 *
 * כל שאר פרטי המשרד הם מחרוזות ב-`tenant.settings`, ולכן הפיתוי היה
 * לבקש **כתובת URL** ללוגו ולסיים. זו הייתה טעות בשלוש דרכים: היא
 * מפילה את הלוגו ביום שהאתר שהוא יושב בו משתנה, היא מפנה את הדפדפן
 * של כל משתמש לשרת זר בכל טעינת מסך, וכתובת חיצונית בתוך `img` היא
 * ערוץ שמדליף לצד שלישי מי צופה ומתי.
 *
 * ## למה בכל זאת ב-settings ולא בעמודה
 *
 * מה שנשמר הוא **מפתח באחסון**, לא הקובץ. שתי מחרוזות קצרות לצד
 * שאר פרטי המשרד אינן מצדיקות מיגרציה, והן נמחקות יחד עם המשרד
 * באותו מסלול מחיקה שכבר קיים.
 *
 * ## למה 2MB ולא 10 כמו תמונת נכס
 *
 * לוגו מוצג בגודל 40 פיקסלים בסרגל הצד. קובץ של 10MB שם אינו איכות
 * אלא זמן טעינה, בכל מסך, לכל משתמש במשרד.
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** מפתחות ההגדרות — במקום אחד, כי שלושה מקומות קוראים אותם. */
const LOGO_KEY = "logoKey";
const LOGO_MIME = "logoMime";

/**
 * זיהוי לפי Magic Bytes ולא לפי ה-Content-Type של הלקוח.
 *
 * SVG **אינו** ברשימה במכוון, למרות שהוא הפורמט הטבעי ללוגו: SVG
 * הוא מסמך XML שיכול להכיל `<script>`, והגשה שלו מאותו מקור היא
 * XSS מלא. אין דרך לחטא אותו בבטחה בלי ספרייה שלמה, ולוגו PNG
 * שקוף נראה זהה.
 */
function sniff(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
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
export class TenantLogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(file: Buffer): Promise<{ ok: true }> {
    if (file.length === 0) throw new BadRequestException("לא נבחר קובץ");
    if (file.length > MAX_LOGO_BYTES) {
      throw new BadRequestException("הקובץ גדול מדי — עד 2MB");
    }
    const kind = sniff(file);
    if (kind === null) {
      throw new BadRequestException("פורמט לא נתמך — רק PNG, JPEG או WebP");
    }

    const tenantId = TenantContext.current().tenantId;
    /*
     * מפתח קבוע ולא ULID חדש בכל העלאה: הלוגו הוא יחיד, וגרסה חדשה
     * דורסת את הקודמת. מפתח מתחלף היה מותיר קבצים יתומים באחסון
     * בכל החלפה, ואין מי שינקה אותם.
     */
    const key = `tenants/${tenantId}/logo.${kind.ext}`;
    await this.storage.put(key, file, kind.mime, tenantId);

    await this.prisma.withTenant(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
      await tx.tenant.update({
        where: { id: tenantId },
        data: { settings: { ...settings, [LOGO_KEY]: key, [LOGO_MIME]: kind.mime } },
      });
    });
    return { ok: true };
  }

  async remove(): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      const settings = { ...((tenant?.settings ?? {}) as Record<string, unknown>) };
      const key = settings[LOGO_KEY];
      delete settings[LOGO_KEY];
      delete settings[LOGO_MIME];
      await tx.tenant.update({
        where: { id: tenantId },
        data: { settings: settings as Prisma.InputJsonValue },
      });
      /*
       * המחיקה מהאחסון אחרי העדכון ובלי להפיל: מפתח שנשאר מוגדר
       * כשהקובץ כבר איננו מייצר תמונה שבורה בכל מסך, וזה גרוע
       * מקובץ יתום אחד.
       */
      if (typeof key === "string") await this.storage.delete(key).catch(() => undefined);
    });
    return { ok: true };
  }

  /** האם למשרד יש לוגו — לפרופיל, כדי שהמסך ידע אם לבקש אותו. */
  async has(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    return typeof settings[LOGO_KEY] === "string";
  }

  /**
   * הקובץ עצמו, מוזרם דרך ה-API.
   *
   * הדפדפן אינו ניגש לאחסון הפנימי ישירות — אותה החלטה בדיוק כמו
   * בתמונות נכס. כתובת חתומה שדולפת נשארת פתוחה עד שתפוג; נתיב
   * שעובר כאן נבדק מול ה-Session בכל בקשה.
   */
  async raw(): Promise<{ body: NodeJS.ReadableStream; contentType: string; contentLength?: number }> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const key = settings[LOGO_KEY];
    if (typeof key !== "string") throw new NotFoundException("למשרד אין לוגו");
    const obj = await this.storage.getObject(key);
    return {
      body: obj.body,
      contentType: typeof settings[LOGO_MIME] === "string" ? settings[LOGO_MIME] : "image/png",
      ...(obj.contentLength !== undefined ? { contentLength: obj.contentLength } : {}),
    };
  }
}
