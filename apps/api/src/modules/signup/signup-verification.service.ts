import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import IORedis from "ioredis";
import { normalizeSignupCode, SIGNUP_CODE_LENGTH } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";

/**
 * אימות כתובת האימייל **לפני** שהמשרד נפתח.
 *
 * ## הבעיה
 *
 * ההרשמה העצמית היא הנתיב הציבורי היחיד שיוצר דייר. סקריפט שרץ דקה
 * היה ממלא את המסד במשרדי רפאים עם כתובות שאיש אינו קורא — וכל אחד
 * מהם תופס שם משרד, תופס כתובת אימייל, ומופיע בכל דוח.
 *
 * ## ההכרעה: הדייר נוצר רק אחרי הקוד
 *
 * הפרטים שהמשתמש מילא **אינם נכתבים למסד** בשלב הראשון. הם ממתינים
 * ב-Redis עם תפוגה, והכתיבה הראשונה למסד קורית רק כשהקוד שנשלח
 * לכתובת חוזר. כתובת שאיש אינו קורא אינה משאירה שום עקבה.
 *
 * החלופה — לפתוח את המשרד ולסמן אותו „לא מאומת” — הייתה משאירה את
 * הזבל בדיוק במקום שממנו רצינו למנוע אותו, ומוסיפה עבודת ניקיון
 * שאיש לא היה עושה.
 *
 * ## מה נשמר ומה לא
 *
 * הסיסמה נשמרת **מוצפנת בלבד** (אותו hash שהיה נכתב למסד), ולעולם
 * לא בגלוי. הקוד עצמו נשמר כ-HMAC ולא בגלוי, ואינו מוחזר ללקוח
 * ואינו נרשם ביומן — קוד שמופיע ביומן הוא קוד שאפשר לפתוח בו חשבון
 * על כתובת של מישהו אחר.
 */

/** התפוגה של הרשמה ממתינה. מספיק זמן לפתוח מייל, לא מספיק לשכוח. */
const PENDING_TTL_SECONDS = 20 * 60;

/** ניסיונות הקלדה לקוד. אחרי זה ההרשמה הממתינה נמחקת. */
const MAX_ATTEMPTS = 5;

/**
 * כמה קודים מותר לשלוח לאותה כתובת בשעה.
 *
 * ההגבלה בבקר היא לפי מקור הבקשה, וזו לפי היעד. בלעדיה, מי שמחליף
 * כתובות IP יכול להפוך את טופס ההרשמה שלנו למכונת הצפה של תיבת דואר
 * של אדם אחר — כלומר להשתמש בנו כדי להטריד.
 */
const MAX_CODES_PER_EMAIL = 3;
const EMAIL_WINDOW_SECONDS = 60 * 60;

/** הפרטים שממתינים לאימות. סיסמה — מוצפנת בלבד. */
export interface PendingSignup {
  agencyName: string;
  ownerName: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  plan: string;
  coupon: string | null;
}

declare const verified: unique symbol;

/**
 * הרשמה ממתינה **שהכתובת שלה אומתה.**
 *
 * הסימון אינו שדה אלא סוג: הדרך היחידה לקבל ערך כזה היא `consume`,
 * ולכן `SignupService.create` אינו יכול להיקרא — גם לא בטעות בעתיד —
 * על פרטים שלא עברו קוד. הכלל „דייר נוצר רק אחרי אימות” מוודא כאן
 * בזמן הידור, ולא בבדיקה שמישהו צריך לזכור לכתוב.
 */
export type VerifiedSignup = PendingSignup & { readonly [verified]: true };

interface StoredPending {
  pending: PendingSignup;
  codeHmac: string;
}

@Injectable()
export class SignupVerificationService implements OnModuleDestroy {
  private readonly logger = new Logger(SignupVerificationService.name);
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

  private static fingerprint(emailAddress: string): string {
    return createHash("sha256").update(emailAddress).digest("hex");
  }

  /**
   * הנפקת קוד ושמירת הפרטים — מחזיר טוקן להמשך הזרימה.
   *
   * **בלי ספק אימייל מחובר ההרשמה נעצרת, ולא „ממשיכה בלי אימות”.**
   * דילוג שקט על השער היה מחזיר בדיוק את המצב שהשער בא למנוע, ביום
   * שבו איש אינו מסתכל — וזה הרגע היחיד שבו הוא באמת נחוץ.
   */
  async issue(pending: PendingSignup): Promise<string> {
    if (!(await this.email.isConfigured())) {
      this.logger.error("הרשמה עצמית נחסמה — אין ספק אימייל מחובר, ואי אפשר לאמת כתובת");
      throw new ServiceUnavailableException(
        "ההרשמה העצמית אינה זמינה כרגע — נסו שוב מאוחר יותר או פנו אלינו",
      );
    }
    await this.chargeEmailQuota(pending.email);

    const token = randomBytes(24).toString("base64url");
    const code = SignupVerificationService.freshCode();
    const stored: StoredPending = { pending, codeHmac: this.hmac(code) };
    await this.redis.set(this.key(token), JSON.stringify(stored), "EX", PENDING_TTL_SECONDS);
    await this.deliver(pending, code);
    // בלי הקוד, בלי הטוקן ובלי הכתובת — שורת יומן היא ספירה, לא ראיה
    this.logger.log("נשלח קוד אימות לפתיחת משרד");
    return token;
  }

  /**
   * שליחה חוזרת של קוד לאותה הרשמה ממתינה.
   *
   * הקוד הקודם נפסל באותו רגע: משתמש שביקש קוד חדש כי הראשון לא
   * הגיע אינו מצפה ששניהם יעבדו, ושני קודים חיים בו-זמנית פירושם
   * הכפלה של מרחב הניחוש בלי שום תועלת.
   */
  async reissue(token: string): Promise<void> {
    const raw = await this.redis.get(this.key(token));
    if (raw === null) throw new BadRequestException("ההרשמה פגה — מלאו את הפרטים שוב");
    const stored = JSON.parse(raw) as StoredPending;

    if (!(await this.email.isConfigured())) {
      throw new ServiceUnavailableException("ההרשמה העצמית אינה זמינה כרגע — נסו שוב מאוחר יותר");
    }
    await this.chargeEmailQuota(stored.pending.email);

    const code = SignupVerificationService.freshCode();
    /*
     * ה-TTL נשמר ואינו מתחדש: הארכה בכל „שלחו שוב” הייתה הופכת את
     * חלון התפוגה לבלתי-מוגבל בלחיצות.
     */
    const ttl = await this.redis.ttl(this.key(token));
    if (ttl <= 0) throw new BadRequestException("ההרשמה פגה — מלאו את הפרטים שוב");

    /*
     * **השליחה קודמת לכתיבה** — וכאן דווקא הפוך מ-`issue`.
     *
     * הסדר ההפוך פסל את הקוד הישן ברגע שהחדש נכתב, ואם ספק
     * האימייל נפל אחר-כך המשתמש נשאר בלי כלום: הקוד שכבר בתיבה
     * שלו הפסיק לעבוד, והמחליף מעולם לא נשלח (ביקורת Codex).
     *
     * ב-`issue` הסדר הפוך ונכון: שם אין קוד קודם להגן עליו, ומה
     * שיש להימנע ממנו הוא ההפך — קוד שנשלח ואין לו רשומה.
     */
    await this.deliver(stored.pending, code);
    await this.redis.set(
      this.key(token),
      JSON.stringify({ ...stored, codeHmac: this.hmac(code) } satisfies StoredPending),
      "EX",
      ttl,
    );
    await this.redis.del(this.attemptsKey(token));
    this.logger.log("נשלח קוד אימות חוזר לפתיחת משרד");
  }

  /**
   * אימות (טוקן, קוד) — מחזיר את הפרטים המאומתים.
   *
   * המחיקה נעשית ב-`GETDEL` אטומי: שתי בקשות מקבילות עם אותו קוד
   * מקבלות ערך רק אחת, ולכן אין דרך לפתוח שני משרדים מקוד אחד.
   */
  async consume(token: string, code: string): Promise<VerifiedSignup> {
    const normalized = normalizeSignupCode(code);
    /*
     * קוד שאינו בצורה של קוד אינו נספר כניסיון: הוא אינו ניחוש, והוא
     * מגיע כמעט תמיד מהדבקה שנדבק לה תו בלתי-נראה. ספירה שלו הייתה
     * שורפת למשתמש ניסיונות על שגיאה שהוא אינו רואה.
     */
    if (normalized === null) throw new UnauthorizedException("הקוד אינו בצורה הנכונה");

    const attemptNo = await this.redis.incr(this.attemptsKey(token));
    if (attemptNo === 1) await this.redis.expire(this.attemptsKey(token), PENDING_TTL_SECONDS);
    if (attemptNo > MAX_ATTEMPTS) {
      await this.redis.del(this.key(token), this.attemptsKey(token));
      throw new UnauthorizedException("יותר מדי ניסיונות — מלאו את הפרטים שוב");
    }

    const raw = await this.redis.get(this.key(token));
    if (raw === null) throw new UnauthorizedException("ההרשמה פגה — מלאו את הפרטים שוב");
    const stored = JSON.parse(raw) as StoredPending;

    const expected = Buffer.from(stored.codeHmac, "hex");
    const actual = Buffer.from(this.hmac(normalized), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException("קוד שגוי");
    }

    // שימוש יחיד — המחיקה קודמת להחזרה, לא אחריה
    const claimed = await this.redis.getdel(this.key(token));
    if (claimed === null) throw new UnauthorizedException("הקוד כבר נוצל");
    await this.redis.del(this.attemptsKey(token));
    return stored.pending as VerifiedSignup;
  }

  private key(token: string): string {
    return `signup-pending:${token}`;
  }

  private attemptsKey(token: string): string {
    return `signup-pending:attempts:${token}`;
  }

  private static freshCode(): string {
    return String(randomInt(0, 10 ** SIGNUP_CODE_LENGTH)).padStart(SIGNUP_CODE_LENGTH, "0");
  }

  private async chargeEmailQuota(emailAddress: string): Promise<void> {
    const key = `signup-pending:sent:${SignupVerificationService.fingerprint(emailAddress)}`;
    const sent = await this.redis.incr(key);
    if (sent === 1) await this.redis.expire(key, EMAIL_WINDOW_SECONDS);
    if (sent > MAX_CODES_PER_EMAIL) {
      throw new BadRequestException(
        "נשלחו כבר כמה קודים לכתובת הזו — נסו שוב בעוד שעה או פנו אלינו",
      );
    }
  }

  private async deliver(pending: PendingSignup, code: string): Promise<void> {
    await this.email.send(pending.email, "קוד לפתיחת המשרד שלכם במתווכים", {
      heading: "אימות כתובת האימייל",
      greeting: `שלום ${pending.ownerName},`,
      paragraphs: [
        `קיבלנו בקשה לפתוח את המשרד "${pending.agencyName}" עם הכתובת הזו. הזינו את הקוד במסך ההרשמה כדי להשלים את הפתיחה.`,
      ],
      code,
      footnote:
        "הקוד תקף לעשרים דקות וניתן לשימוש פעם אחת. אם לא ביקשתם לפתוח משרד — אפשר להתעלם מהודעה זו, ולא ייפתח שום חשבון.",
    });
  }
}
