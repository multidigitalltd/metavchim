import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { ulid } from "ulid";
import { isExpoPushToken } from "@metavchim/shared";
import { AnyAuthenticated } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { loadEnv } from "../../config/env";
import { PrismaService } from "../../core/prisma.service";

/**
 * ניהול מנויי הפוש של המשתמש הנוכחי.
 *
 * כל הנתיבים כאן אישיים לחלוטין — משתמש רושם ומבטל את הדפדפן שלו
 * ותו לא. אין כאן נתוני משרד, ולכן `@AnyAuthenticated` ולא יכולת:
 * חסימת פוש לפי תפקיד הייתה אומרת שלסוכן זוטר מותר פחות *לדעת*
 * על הלקוחות שלו עצמו.
 */

/**
 * ה-endpoint מגיע מהדפדפן ונכתב למסד. מגבילים אותו ל-https ולאורך
 * סביר: זו מחרוזת שהלקוח שולט בה במלואה, והיא הופכת בהמשך לכתובת
 * שהשרת שלנו פונה אליה. בלי הרסן הזה היה כאן נתיב SSRF.
 */
const SubscribeSchema = z
  .object({
    endpoint: z.string().url().startsWith("https://").max(1000),
    keys: z.object({
      p256dh: z.string().min(20).max(300),
      auth: z.string().min(10).max(200),
    }),
    userAgent: z.string().max(300).optional(),
  })
  .strict();

const UnsubscribeSchema = z.object({ endpoint: z.string().max(1000) }).strict();

/**
 * ‏רישום מכשיר של האפליקציה לנייד. הטוקן הוא מה ש-Expo הנפיק —
 * ‏הצורה נבדקת, כי המחרוזת הזו נשלחת אחר כך לשירות של Expo בשם
 * ‏השרת, ומחרוזת חופשית מהלקוח היא קלט שאסור להעביר הלאה כמות שהוא.
 */
const DeviceSchema = z
  .object({
    token: z.string().max(200).refine(isExpoPushToken, "טוקן פוש לא תקין"),
    platform: z.enum(["ios", "android"]),
    deviceName: z.string().trim().max(120).optional(),
  })
  .strict();

const DeviceRemoveSchema = z.object({ token: z.string().max(200) }).strict();

@Controller("notifications/push")
export class PushController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * המפתח הציבורי שהדפדפן צריך כדי ליצור מנוי. `enabled: false`
   * כשלא הוגדרו מפתחות — המסך מציג "לא מוגדר" במקום להציע כפתור
   * שייצור מנוי שאיש לא יוכל לשלוח אליו.
   */
  @AnyAuthenticated()
  @Get("key")
  key(): { enabled: boolean; publicKey: string | null } {
    const env = loadEnv();
    const enabled =
      env.VAPID_PUBLIC_KEY !== undefined &&
      env.VAPID_PRIVATE_KEY !== undefined &&
      env.VAPID_SUBJECT !== undefined;
    return { enabled, publicKey: enabled ? (env.VAPID_PUBLIC_KEY ?? null) : null };
  }

  /** האם למשתמש הנוכחי יש מנוי פעיל בדפדפן הזה. */
  @AnyAuthenticated()
  @Get("status")
  async status(): Promise<{ subscriptions: number }> {
    const { tenantId, userId } = TenantContext.current();
    const subscriptions = await this.prisma.withTenant((tx) =>
      tx.pushSubscription.count({ where: { tenantId, userId } }),
    );
    return { subscriptions };
  }

  /**
   * רישום מנוי. אידמפוטנטי לפי ה-endpoint, וזה מה שהופך אותו לנכון:
   * הדפדפן מחזיר את אותו endpoint בכל טעינת עמוד, וכל רענון היה
   * מייצר שורה נוספת — כלומר אותה התראה נשלחת חמש פעמים.
   *
   * upsert ולא "צור אם אין": מחשב משותף במשרד שעבר בין שני סוכנים
   * מחזיר את אותו endpoint, וההרשמה החדשה חייבת *להעביר* אותו
   * לבעלים הנוכחי — אחרת הסוכן הקודם ימשיך לקבל את ההתראות שלו
   * על המסך של מי שיושב שם עכשיו.
   */
  @AnyAuthenticated()
  @Post("subscribe")
  @HttpCode(200)
  async subscribe(
    @Body(new ZodValidationPipe(SubscribeSchema)) body: z.infer<typeof SubscribeSchema>,
  ): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      /*
       * המחיקה קודמת ליצירה במקום upsert: ה-endpoint ייחודי גלובלית,
       * אבל פוליסת ה-RLS מגבילה את השורה לדייר שלה — ולכן upsert על
       * endpoint של דייר אחר היה נכשל על ההגבלה הייחודית בלי לראות
       * את השורה. deleteMany רץ ללא הגבלת RLS על תנאי ה-WHERE כי
       * הוא כפוף לאותה פוליסה, ולכן הניקוי הגלובלי נעשה בשאילתה
       * גולמית שמכוונת ל-endpoint בלבד.
       */
      await tx.$executeRaw`DELETE FROM push_subscriptions WHERE endpoint = ${body.endpoint}`;
      await tx.pushSubscription.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent: body.userAgent ?? null,
        },
      });
    });
    return { ok: true };
  }

  /**
   * ‏רישום מכשיר נייד — אותו כלל כמו מנוי הדפדפן: אידמפוטנטי לפי
   * ‏הטוקן, ומכשיר שעבר בין שני חשבונות **עובר** לבעלים הנוכחי
   * ‏(המחיקה הגולמית לפני היצירה, מאותו נימוק בדיוק כמו ב-`subscribe`).
   */
  @AnyAuthenticated()
  @Post("device")
  @HttpCode(200)
  async registerDevice(
    @Body(new ZodValidationPipe(DeviceSchema)) body: z.infer<typeof DeviceSchema>,
  ): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      await tx.$executeRaw`DELETE FROM device_push_tokens WHERE token = ${body.token}`;
      await tx.devicePushToken.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          token: body.token,
          platform: body.platform,
          deviceName: body.deviceName ?? null,
        },
      });
    });
    return { ok: true };
  }

  /** ‏הסרת מכשיר — רק של המשתמש עצמו; נקרא לפני התנתקות באפליקציה. */
  @AnyAuthenticated()
  @Post("device/remove")
  @HttpCode(200)
  async removeDevice(
    @Body(new ZodValidationPipe(DeviceRemoveSchema)) body: z.infer<typeof DeviceRemoveSchema>,
  ): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    await this.prisma.withTenant((tx) =>
      tx.devicePushToken.deleteMany({ where: { tenantId, userId, token: body.token } }),
    );
    return { ok: true };
  }

  /** ביטול מנוי — רק של המשתמש עצמו. */
  @AnyAuthenticated()
  @Post("unsubscribe")
  @HttpCode(200)
  async unsubscribe(
    @Body(new ZodValidationPipe(UnsubscribeSchema)) body: z.infer<typeof UnsubscribeSchema>,
  ): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    await this.prisma.withTenant((tx) =>
      tx.pushSubscription.deleteMany({ where: { tenantId, userId, endpoint: body.endpoint } }),
    );
    return { ok: true };
  }
}
