import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import IORedis from "ioredis";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";
import { PrismaService } from "../../core/prisma.service";
import { AuthService } from "./auth.service";

/**
 * "שכחתי סיסמה" — קישור איפוס חד-פעמי במייל (docs/04).
 *
 * הטוקן נשלח במייל ונשמר ב-Redis כ-SHA-256 בלבד (דליפת Redis לא
 * מאפשרת איפוס). תוקף 30 דקות, שימוש יחיד (DEL אטומי לפני האיפוס),
 * וכל ה-sessions הקיימים של המשתמש מבוטלים אחרי איפוס מוצלח.
 *
 * מניעת הצפה: בקשה חדשה לאותו אימייל בתוך דקה מדולגת בשקט — התשובה
 * ללקוח זהה תמיד ("אם הכתובת קיימת, נשלח מייל"), בלי אימות קיום חשבון.
 */

const TOKEN_TTL_SECONDS = 30 * 60;
const REQUEST_COOLDOWN_SECONDS = 60;

@Injectable()
export class PasswordResetService implements OnModuleDestroy {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly redis: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {
    this.redis = new IORedis(loadEnv().REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    this.redis.on("error", () => {
      /* נרשם באזהרות — אין קריסה על ניתוק Redis */
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private static hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * בקשת איפוס. לעולם לא מגלה אם הכתובת קיימת — הקורא מחזיר תמיד 200.
   */
  async request(emailAddress: string): Promise<void> {
    const normalized = emailAddress.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, isActive: true, name: true },
    });
    if (!user || !user.isActive) return;

    // דילוג שקט על בקשות רצופות — הגנה מהצפת תיבת המייל
    const cooldownKey = `pwreset:cooldown:${PasswordResetService.hash(normalized)}`;
    const fresh = await this.redis.set(cooldownKey, "1", "EX", REQUEST_COOLDOWN_SECONDS, "NX");
    if (fresh === null) return;

    const token = randomBytes(32).toString("base64url");
    await this.redis.set(
      `pwreset:${PasswordResetService.hash(token)}`,
      user.id,
      "EX",
      TOKEN_TTL_SECONDS,
    );

    const url = `${loadEnv().WEB_ORIGIN}/reset-password?token=${token}`;
    await this.email.send(
      normalized,
      "איפוס סיסמה — מתווכים",
      `שלום ${user.name},\n\nלאיפוס הסיסמה שלך במערכת מתווכים, היכנס לקישור:\n${url}\n\n` +
        `הקישור תקף ל-30 דקות וניתן לשימוש פעם אחת.\nאם לא ביקשת לאפס סיסמה — התעלם מהודעה זו.`,
    );
    this.logger.log("נשלח קישור איפוס סיסמה");
  }

  /** איפוס בפועל — טוקן חד-פעמי; מבטל את כל ה-sessions של המשתמש. */
  async reset(token: string, newPassword: string): Promise<void> {
    const key = `pwreset:${PasswordResetService.hash(token)}`;
    // GETDEL — שימוש יחיד אטומי: שתי בקשות מקבילות, רק אחת מקבלת ערך
    const userId = await this.redis.getdel(key);
    if (!userId) throw new UnauthorizedException("הקישור פג או שכבר נוצל — בקשו קישור חדש");

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await AuthService.hashPassword(newPassword),
        mustChangePassword: false,
      },
    });
    // כל ה-sessions מבוטלים — אם התוקף היה מחובר, הוא מנותק
    await this.prisma.session.deleteMany({ where: { userId } });
  }
}
