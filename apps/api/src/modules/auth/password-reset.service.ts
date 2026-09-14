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
   * בקשת איפוס. חוזרת מיד ומריצה את העבודה ברקע — כך זמן התגובה זהה
   * לכתובת רשומה ולכתובת שאינה רשומה, וגם כשל של Redis/Postmark לא
   * מסגיר אילו כתובות קיימות (ביקורת Codex: Timing Oracle + דליפת שגיאה).
   */
  request(emailAddress: string): void {
    void this.deliver(emailAddress.toLowerCase()).catch((error: unknown) => {
      this.logger.error(`שליחת קישור איפוס נכשלה: ${String(error)}`);
    });
  }

  private async deliver(normalized: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, isActive: true, name: true },
    });
    if (!user || !user.isActive) return;

    // דילוג שקט על בקשות רצופות — הגנה מהצפת תיבת המייל
    const cooldownKey = `pwreset:cooldown:${PasswordResetService.hash(normalized)}`;
    const fresh = await this.redis.set(cooldownKey, "1", "EX", REQUEST_COOLDOWN_SECONDS, "NX");
    if (fresh === null) return;

    const url = await this.issueLink(user.id);
    await this.email.send(
      normalized,
      "איפוס סיסמה — מתווכים",
      {
        heading: "איפוס סיסמה",
        greeting: `שלום ${user.name},`,
        paragraphs: ["התקבלה בקשה לאיפוס הסיסמה שלכם במערכת מתווכים."],
        button: { label: "לאיפוס הסיסמה", url },
        footnote:
          "הקישור תקף לשלושים דקות וניתן לשימוש פעם אחת. אם לא ביקשתם לאפס סיסמה — אפשר להתעלם מהודעה זו, ולא יבוצע שום שינוי.",
      },
      /*
       * הקישור **הוא** הפעולה. בלי `required` היעדר ספק היה חוזר
       * בשקט, השורה למטה הייתה מדווחת „נשלח”, והמשתמש היה נחסם
       * בצינון עשר דקות על מייל שלא יצא (ביקורת Codex).
       */
      // ‏בקשת איפוס חוזרת היא קישור חדש, ולכן שליחה חדשה
      { idempotency: null, required: true },
    );
    this.logger.log("נשלח קישור איפוס סיסמה");
  }

  /**
   * ‏הנפקת קישור חד-פעמי — **מסלול אחד לשני הנוסחים.**
   *
   * ‏„שכחתי סיסמה” ו„נפתח לך חשבון” הם אותה מכניקה בדיוק: טוקן
   * ‏שנשמר כ-SHA-256, תוקף, ומצביע „הטוקן הפעיל” שפוסל קישור
   * ‏קודם. שני עותקים היו נפרדים ביום שבו אחד מהם מתוקן, ואז
   * ‏קישור אחד מהשניים מפסיק להיפסל כשמונפק חדש.
   */
  private async issueLink(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = PasswordResetService.hash(token);
    // מצביע "הטוקן הפעיל" פר משתמש: בקשה חדשה דורסת אותו, ולכן קישור
    // ישן — גם אם טרם פג — לא יעבור את בדיקת ההתאמה ב-reset (Codex)
    await this.redis
      .multi()
      .set(`pwreset:${tokenHash}`, userId, "EX", TOKEN_TTL_SECONDS)
      .set(`pwreset:user:${userId}`, tokenHash, "EX", TOKEN_TTL_SECONDS)
      .exec();
    return `${loadEnv().WEB_ORIGIN}/reset-password?token=${token}`;
  }

  /**
   * ‎**„נפתח לך חשבון” — ולא „התקבלה בקשה לאיפוס”.**
   *
   * ## ‏למה נוסח נפרד ולא `request`
   *
   * ‏סוכן חדש שמעולם לא הייתה לו סיסמה מקבל מייל שאומר „התקבלה
   * ‏בקשה לאיפוס הסיסמה שלכם”. הוא לא ביקש, לא הייתה לו סיסמה,
   * ‏והמייל נקרא כניסיון פריצה — בדיוק ההפך ממה שהוא צריך ברגע
   * ‏שמצרפים אותו למשרד.
   *
   * ## ‏ולמה זו לא „שליחה ברקע”
   *
   * ‎`request` היא `void` בכוונה: היא עונה לכל אחד באותו זמן, כדי
   * ‏שלא יהיה אפשר ללמוד ממנה אילו כתובות רשומות. כאן אין מה
   * ‏להסתיר — המנהל **זה עתה יצר** את החשבון — ולכן התוצאה מוחזרת:
   * ‏„נוסף, ונשלח קישור” על מייל שלא יצא הוא סוכן שממתין למשהו
   * ‏שלא יגיע.
   */
  async welcome(emailAddress: string, officeName: string): Promise<boolean> {
    const normalized = emailAddress.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, name: true, isActive: true },
    });
    if (user === null || !user.isActive) return false;
    try {
      const url = await this.issueLink(user.id);
      await this.email.send(
        normalized,
        `הצטרפת ל${officeName} — מתווכים`,
        {
          heading: "ברוכים הבאים",
          greeting: `שלום ${user.name},`,
          paragraphs: [
            `נפתח עבורכם חשבון במערכת מתווכים, במשרד ${officeName}.`,
            "כדי להיכנס בפעם הראשונה יש לקבוע סיסמה:",
          ],
          button: { label: "לקביעת הסיסמה", url },
          footnote:
            "הקישור תקף לשלושים דקות וניתן לשימוש פעם אחת. אם פג תוקפו — אפשר לבקש חדש ממסך הכניסה, ב„שכחתי סיסמה”.",
        },
        /* ‏הקישור **הוא** הפעולה: בלי ספק אין הצטרפות, ולכן `required` */
        { idempotency: null, required: true },
      );
      this.logger.log("נשלח קישור קביעת סיסמה לסוכן חדש");
      return true;
    } catch (error) {
      this.logger.error(`שליחת קישור קביעת סיסמה נכשלה: ${String(error)}`);
      return false;
    }
  }

  /** איפוס בפועל — טוקן חד-פעמי; מבטל את כל ה-sessions של המשתמש. */
  async reset(token: string, newPassword: string): Promise<void> {
    const tokenHash = PasswordResetService.hash(token);
    // GETDEL — שימוש יחיד אטומי: שתי בקשות מקבילות, רק אחת מקבלת ערך
    const userId = await this.redis.getdel(`pwreset:${tokenHash}`);
    if (!userId) throw new UnauthorizedException("הקישור פג או שכבר נוצל — בקשו קישור חדש");

    // רק הקישור האחרון שנשלח תקף — בקשה חדשה דורסת את המצביע, וקישור
    // ישן שנותר בתיבה נפסל כאן (ביקורת Codex)
    const activeHash = await this.redis.get(`pwreset:user:${userId}`);
    if (activeHash !== tokenHash) {
      throw new UnauthorizedException("הקישור אינו בתוקף — בקשו קישור חדש");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await AuthService.hashPassword(newPassword),
        mustChangePassword: false,
        // קידום עידן הסיסמה — פוסל גם Session שנוצר במרוץ מול האיפוס
        passwordChangedAt: new Date(),
      },
    });
    // כל ה-sessions מבוטלים — אם התוקף היה מחובר, הוא מנותק
    await this.prisma.session.deleteMany({ where: { userId } });
    // כל קישורי האיפוס האחרים של המשתמש נפסלים (ביקורת Codex):
    // המצביע לטוקן הפעיל נמחק, וכל טוקן אחר לא יעבור את בדיקת ההתאמה
    await this.redis.del(`pwreset:user:${userId}`);
  }
}
