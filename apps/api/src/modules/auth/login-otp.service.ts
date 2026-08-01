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
  attempts: number;
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

  /** הנפקת קוד למשתמש שסיסמתו אומתה — מחזיר otpToken להמשך הזרימה. */
  async issue(userId: string, emailAddress: string): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const record: OtpRecord = { userId, codeHmac: this.hmac(code), attempts: 0 };
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
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException("הקוד פג או שגוי — התחברו מחדש");
    const record = JSON.parse(raw) as OtpRecord;

    if (record.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new UnauthorizedException("יותר מדי ניסיונות — התחברו מחדש");
    }

    const expected = Buffer.from(record.codeHmac, "hex");
    const actual = Buffer.from(this.hmac(code), "hex");
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!ok) {
      record.attempts += 1;
      // שמירת מונה הניסיונות עם ה-TTL שנותר
      const ttl = await this.redis.ttl(key);
      await this.redis.set(key, JSON.stringify(record), "EX", Math.max(ttl, 1));
      throw new UnauthorizedException("קוד שגוי");
    }

    await this.redis.del(key);
    return record.userId;
  }
}
