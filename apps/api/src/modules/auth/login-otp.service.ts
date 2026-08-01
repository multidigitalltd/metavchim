import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import IORedis from "ioredis";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";

/**
 * אימות דו-שלבי בקוד אימייל (docs/04) — פעיל רק כש-LOGIN_OTP_ENABLED=true
 * (כבוי כברירת מחדל עד שיחובר ספק אימייל אמיתי).
 *
 * זרימה: סיסמה תקינה ⟵ קוד בן 6 ספרות נשלח לאימייל + otpToken אקראי
 * ללקוח ⟵ אימות עם (otpToken, code). הקוד לבדו לא מספיק — צריך גם את
 * ה-otpToken שהונפק רק אחרי סיסמה נכונה; 5 ניסיונות, תוקף 10 דקות,
 * והקוד נשמר כ-HMAC בלבד (לא בגלוי) ב-Redis.
 */

const OTP_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

interface OtpRecord {
  userId: string;
  codeHmac: string;
}

@Injectable()
export class LoginOtpService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginOtpService.name);
  private readonly redis: IORedis;
  private readonly hmacKey: string;

  constructor(private readonly email: EmailService) {
    const env = loadEnv();
    this.redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
    this.hmacKey = env.PHONE_HASH_KEY;
    this.redis.on("error", () => {
      /* נרשם באזהרות — אין קריסה על ניתוק Redis */
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private hmac(code: string): string {
    return createHmac("sha256", this.hmacKey).update(code).digest("hex");
  }

  /**
   * הגנת נעילה: האימות פעיל רק כשהדגל דלוק *וגם* ספק אימייל מחובר —
   * דגל דלוק בלי ספק היה שולח קודים לשום-מקום ונועל את כולם בחוץ.
   */
  get active(): boolean {
    if (!loadEnv().LOGIN_OTP_ENABLED) return false;
    if (!this.email.providerConfigured) {
      this.logger.warn("LOGIN_OTP_ENABLED=true אבל אין ספק אימייל — האימות מדולג");
      return false;
    }
    return true;
  }

  /** הנפקת קוד למשתמש שסיסמתו אומתה — מחזיר otpToken להמשך הזרימה. */
  async issue(userId: string, emailAddress: string): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const record: OtpRecord = { userId, codeHmac: this.hmac(code) };
    await this.redis.set(`login-otp:${token}`, JSON.stringify(record), "EX", OTP_TTL_SECONDS);
    await this.email.send(
      emailAddress,
      "קוד הכניסה שלך למערכת מתווכים",
      `קוד הכניסה: ${code}\nהקוד תקף ל-10 דקות. אם לא ניסית להתחבר — החלף סיסמה מיד.`,
    );
    return token;
  }

  /** אימות (otpToken, code) — מחזיר את מזהה המשתמש או זורק 401. */
  async verify(token: string, code: string): Promise<string> {
    const key = `login-otp:${token}`;
    const attemptsKey = `login-otp:attempts:${token}`;

    // הזמנה אטומית לפני ההשוואה: INCR מונה כל ניסיון בדיוק פעם אחת —
    // גם בקשות מקבילות לא עוקפות את התקרה (ביקורת Codex, אותו דפוס
    // כמו LoginThrottleService)
    const attemptNo = await this.redis.incr(attemptsKey);
    if (attemptNo === 1) {
      await this.redis.expire(attemptsKey, OTP_TTL_SECONDS);
    }
    if (attemptNo > MAX_ATTEMPTS) {
      await this.redis.del(key, attemptsKey);
      throw new UnauthorizedException("יותר מדי ניסיונות — התחברו מחדש");
    }

    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException("הקוד פג או שגוי — התחברו מחדש");
    const record = JSON.parse(raw) as OtpRecord;

    const expected = Buffer.from(record.codeHmac, "hex");
    const actual = Buffer.from(this.hmac(code), "hex");
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!ok) {
      throw new UnauthorizedException("קוד שגוי");
    }

    await this.redis.del(key, attemptsKey);
    return record.userId;
  }
}
