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

/**
 * כמה זמן „שלחו שוב” אחת חוסמת שנייה על אותו טוקן.
 *
 * שתי שליחות חוזרות מקבילות שולחות **שני קודים שונים**, ורק
 * האחרונה שנכתבת עובדת — כלומר המשתמש מקבל שני אימיילים ואינו
 * יודע איזה מהם תקף. זה קורה בלחיצה כפולה, בשתי לשוניות, או
 * בניסיון חוזר של הדפדפן (ביקורת Codex).
 *
 * הערך קצר בכוונה: הוא נועד לסדר בקשות שנשלחו כמעט יחד, ולא
 * להוסיף השהיה למי שבאמת לא קיבל את הקוד וממתין.
 */
const RESEND_LOCK_SECONDS = 20;

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
    const token = randomBytes(24).toString("base64url");
    const code = SignupVerificationService.freshCode();
    const stored: StoredPending = { pending, codeHmac: this.hmac(code) };
    await this.redis.set(this.key(token), JSON.stringify(stored), "EX", PENDING_TTL_SECONDS);
    await this.chargeAndDeliver(pending, code);
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
    /*
     * תפיסת הטוקן לפני השליחה — ראו `RESEND_LOCK_SECONDS`.
     *
     * ‎`NX` הוא מה שהופך את זה לתפיסה ולא לבדיקה: מי שהגיע שני אינו
     * מקבל את המנעול, ולכן אינו שולח קוד שני שיבטל את הראשון.
     */
    const lock = this.resendKey(token);
    const claimed = await this.redis.set(lock, "1", "EX", RESEND_LOCK_SECONDS, "NX");
    if (claimed === null) {
      throw new BadRequestException("קוד חדש נשלח זה עתה — בדקו את תיבת הדואר");
    }

    const code = SignupVerificationService.freshCode();
    /*
     * ה-TTL נשמר ואינו מתחדש: הארכה בכל „שלחו שוב” הייתה הופכת את
     * חלון התפוגה לבלתי-מוגבל בלחיצות.
     */
    const ttl = await this.redis.ttl(this.key(token));
    if (ttl <= 0) {
      await this.redis.del(lock);
      throw new BadRequestException("ההרשמה פגה — מלאו את הפרטים שוב");
    }

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
    /*
     * כישלון משחרר את המנעול: מי שלא קיבל דבר אינו אמור להמתין
     * בגללו. הצלחה משאירה אותו לפוג מעצמו — זו כל מטרתו.
     */
    try {
      await this.chargeAndDeliver(stored.pending, code);
    } catch (error) {
      await this.redis.del(lock);
      throw error;
    }
    /*
     * הכתיבה מותנית ב**ערך שנקרא בכניסה**, ולא עיוורת.
     *
     * ‎`consume` יכולה לרוץ בזמן שהשליחה הזו באוויר, ולהצליח: היא
     * מוחקת את הרשומה בהתאמה-ומחיקה, המשרד נפתח, וזהו. כתיבה
     * בלתי-מותנית אחריה **מחייה רשומה שכבר נוצלה** — והקוד שזה עתה
     * נשלח באימייל הופך לקוד תקף להרשמה שכבר הושלמה. אישור שני היה
     * נכנס למסלול פתיחת המשרד ונופל רק בהמשך, על אילוצי ייחודיות
     * (ביקורת Codex).
     *
     * זו אותה התאמה-ואז-פעולה של `consume`, מהצד השני: שם „מחק אם
     * זה עדיין מה שאימתתי”, כאן „כתוב אם זה עדיין מה שקראתי”.
     */
    /*
     * ההתקנה **ואיפוס המונה** הם פעולה אחת.
     *
     * קודם הם היו שתיים, ובין לבין נשאר מונה ניסיונות שאינו שייך
     * לקוד שיושב בכתובת: אישור מקביל שקורא את הקוד החדש, מגלה
     * שהמונה של הקודם מוצה, ומוחק בהתאמה-ומחיקה דווקא אותו. השליחה
     * החוזרת מדווחת הצלחה על קוד שנמחק (ביקורת Codex). הקדמת
     * הצילום ב-`consume` צמצמה את החלון ולא סגרה אותו — מה שסוגר
     * אותו הוא שהמונה לעולם אינו שורד את הקוד שהוא נספר עליו.
     *
     * Lua רץ אטומית ב-Redis, ולכן אין רגע שבו הקוד החדש כבר בפנים
     * והמונה הישן עדיין קיים.
     */
    const replaced = await this.redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then
         redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
         redis.call('DEL', KEYS[2])
         return 1
       end
       return 0`,
      2,
      this.key(token),
      this.attemptsKey(token),
      raw,
      JSON.stringify({ ...stored, codeHmac: this.hmac(code) } satisfies StoredPending),
      String(ttl),
    );
    if (replaced !== 1) {
      /*
       * האימייל כבר יצא, ולכן נאמר במפורש שהקוד שבו אינו בתוקף —
       * „נשלח קוד” בלי המשך היה משאיר את המשתמש ממתין לו לחינם.
       */
      await this.redis.del(lock);
      throw new BadRequestException(
        "ההרשמה כבר הושלמה או פגה — הקוד שנשלח זה עתה אינו בתוקף",
      );
    }
    this.logger.log("נשלח קוד אימות חוזר לפתיחת משרד");
  }

  /**
   * אימות (טוקן, קוד) → פתיחת המשרד, כיחידה אחת.
   *
   * המחיקה נעשית בהתאמה-ומחיקה אטומית: שתי בקשות מקבילות עם אותו
   * קוד מקבלות ערך רק אחת, ולכן אין דרך לפתוח שני משרדים מקוד אחד.
   *
   * **הפתיחה נמסרת פנימה ואינה קורית אחרי החזרה**, כדי שכישלון
   * שלה יחזיר את מה שנצרך. קודם `consume` הייתה מחזירה את הפרטים
   * והמשרד נפתח אצל הקורא: קופון שנגמר בינתיים, כתובת שנתפסה
   * במקביל או נפילה זמנית של המסד השאירו את המשתמש במסך הקוד עם
   * רשומה שכבר נמחקה — גם „נסו שוב” וגם „שלחו קוד חדש” ענו
   * „פג תוקף”, והדרך היחידה קדימה הייתה למלא את הטופס מחדש ולשרוף
   * עוד מכסת אימייל על כלום (ביקורת Codex).
   *
   * ‎`issueSession` נשאר **מחוץ** לחלון הזה במכוון: מרגע שהמשרד
   * נוצר אין לשחזר את הקוד: אישור שני היה מנסה ליצור אותו שוב.
   */
  async withVerified<T>(
    token: string,
    code: string,
    create: (verified: VerifiedSignup) => Promise<T>,
  ): Promise<T> {
    const normalized = normalizeSignupCode(code);
    /*
     * קוד שאינו בצורה של קוד אינו נספר כניסיון: הוא אינו ניחוש, והוא
     * מגיע כמעט תמיד מהדבקה שנדבק לה תו בלתי-נראה. ספירה שלו הייתה
     * שורפת למשתמש ניסיונות על שגיאה שהוא אינו רואה.
     */
    if (normalized === null) throw new UnauthorizedException("הקוד אינו בצורה הנכונה");

    /*
     * הרשומה נקראת **לפני** ספירת הניסיון — זו הגרסה שהניסיון הזה
     * נספר עליה, וזו היחידה שמותר למצוי למחוק.
     *
     * קודם היא נקראה רק אחרי גילוי המיצוי, ואז אין קשר בין הערך
     * שנקרא לבין הניסיונות שנספרו: „שלחו קוד שוב” שהספיק להתקין
     * קוד חדש ועוד לא ניקה את המונה גורם לקריאה הזו להחזיר דווקא
     * את **החדש**, וההתאמה-ומחיקה מסירה בדיוק אותו. השליחה החוזרת
     * מדווחת הצלחה, והקוד שבתיבת הדואר של המשתמש לעולם לא יעבוד
     * (ביקורת Codex). מכאן — צילום לפני ה-INCR.
     */
    const raw = await this.redis.get(this.key(token));

    const attemptNo = await this.redis.incr(this.attemptsKey(token));
    if (attemptNo === 1) await this.redis.expire(this.attemptsKey(token), PENDING_TTL_SECONDS);
    if (attemptNo > MAX_ATTEMPTS) {
      /*
       * גם מחיקת המיצוי מותנית בגרסה — ולא במחיקה עיוורת.
       *
       * „שלחו קוד שוב” שהספיק להתקין קוד חדש, ועוד לא ניקה את מונה
       * הניסיונות, נופל אחרת קורבן לבקשת אישור שמגיעה באותו רגע:
       * המחיקה מסירה את **הרשומה החדשה**, השליחה החוזרת מחזירה
       * הצלחה, והקוד שבאימייל שלה לעולם לא יעבוד (ביקורת Codex).
       *
       * הניסיונות מוצו על הקוד ש**נקרא לפני הספירה**, ולכן רק הוא
       * נמחק. אם בינתיים הותקן אחר — ההתאמה נכשלת, הוא שורד,
       * והמונה שלו מאופס ממילא על ידי השליחה החוזרת.
       */
      if (raw !== null) {
        await this.redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
          1,
          this.key(token),
          raw,
        );
      }
      await this.redis.del(this.attemptsKey(token));
      throw new UnauthorizedException("יותר מדי ניסיונות — מלאו את הפרטים שוב");
    }

    /*
     * אותו צילום מלמעלה. קריאה שנייה כאן הייתה יכולה להחזיר גרסה
     * אחרת מזו שהניסיון נספר עליה, וההתאמה-ומחיקה שבסוף חוסמת
     * ממילא כל צילום שהתיישן בינתיים.
     */
    if (raw === null) throw new UnauthorizedException("ההרשמה פגה — מלאו את הפרטים שוב");
    const stored = JSON.parse(raw) as StoredPending;

    const expected = Buffer.from(stored.codeHmac, "hex");
    const actual = Buffer.from(this.hmac(normalized), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException("קוד שגוי");
    }

    /*
     * שימוש יחיד — והמחיקה היא של **בדיוק הגרסה שאומתה**.
     *
     * ‎`GETDEL` מוחק את מה שיושב שם עכשיו, ולא את מה שנקרא למעלה.
     * „שלחו קוד שוב” שנכנס בין הקריאה למחיקה היה גורם לשליחה עם
     * הקוד **הישן** למחוק את הרשומה החדשה — כלומר הקוד הישן מתקבל,
     * והקוד שזה עתה נשלח למשתמש כבר אינו קיים (ביקורת Codex). זו
     * בדיוק הפרה של מה שכתוב מעל `reissue`: „הקוד הקודם נפסל
     * באותו רגע”.
     *
     * ‎Lua כי אין ל-Redis פקודת „מחק אם הערך שווה”; זו אותה תבנית
     * של שחרור נעילה מבוזרת, ומאותו נימוק בדיוק.
     */
    /* נקרא לפני המחיקה — אחריה כבר אין ממי לשאול כמה נותר. */
    const remaining = await this.redis.ttl(this.key(token));

    const claimed = await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1,
      this.key(token),
      raw,
    );
    if (claimed !== 1) throw new UnauthorizedException("הקוד כבר אינו תקף — בקשו קוד חדש");
    await this.redis.del(this.attemptsKey(token));

    try {
      return await create(stored.pending as VerifiedSignup);
    } catch (error) {
      /*
       * הפתיחה נכשלה — הרשומה חוזרת בדיוק כפי שהייתה, עם מה שנותר
       * מהתפוגה המקורית. ‎`NX` ולא כתיבה גסה: אם משהו כבר יושב שם
       * הוא חדש מזה, ואין להחליף אותו במה שזה עתה נצרך.
       *
       * מונה הניסיונות אינו מוחזר. הקוד הוכח כנכון, ומה שנכשל הוא
       * הצד שלנו — התחלה נקייה היא הדבר הנכון למי שממילא לא טעה.
       */
      if (remaining > 0) {
        await this.redis.set(this.key(token), raw, "EX", remaining, "NX");
      }
      throw error;
    }
  }

  private key(token: string): string {
    return `signup-pending:${token}`;
  }

  private attemptsKey(token: string): string {
    return `signup-pending:attempts:${token}`;
  }

  private resendKey(token: string): string {
    return `signup-pending:resend:${token}`;
  }

  private static freshCode(): string {
    return String(randomInt(0, 10 ** SIGNUP_CODE_LENGTH)).padStart(SIGNUP_CODE_LENGTH, "0");
  }

  private quotaKey(emailAddress: string): string {
    return `signup-pending:sent:${SignupVerificationService.fingerprint(emailAddress)}`;
  }

  /**
   * גבייה **לפני** השליחה, והחזר אם השליחה נכשלה.
   *
   * הסדר הזה מכוון: התקרה מגינה על תיבת הדואר של מישהו מפני הצפה,
   * וגבייה אחרי השליחה הייתה מאפשרת לבקשות מקבילות לחמוק בין
   * הבדיקות. אבל **גבייה בלי החזר שורפת מכסה על אימייל שלא נשלח**:
   * שלוש נפילות של הספק חסמו את המשתמש לשעה על משהו שלא באשמתו,
   * ודווקא אחרי שהוא כבר לא קיבל שום קוד (ביקורת Codex).
   *
   * ההחזר אינו פותח פרצה: אם השליחה נכשלה — לא נשלח אימייל, ולכן
   * אין הצפה להגן מפניה. המקרה היחיד שנותר הוא ספק שקיבל את
   * ההודעה ובכל זאת החזיר שגיאה (פסק זמן), וההגזמה שם חסומה
   * ממילא בתקרה עצמה.
   */
  private async chargeEmailQuota(emailAddress: string): Promise<void> {
    const key = this.quotaKey(emailAddress);
    /*
     * המונה והתפוגה **בפעולה אחת.**
     *
     * ‎`INCR` ואז `EXPIRE` הם שתי פקודות, ובין השתיים אפשר להיכשל.
     * מה שנשאר אז הוא מפתח מונה **בלי תפוגה**: הוא ממשיך לגדול בכל
     * ניסיון, ומרגע שעבר את התקרה הכתובת חסומה **לתמיד** ולא לשעה
     * (ביקורת Codex). זה הכשל הגרוע ביותר האפשרי בהגבלת קצב —
     * הגבלה שאין לה סוף.
     *
     * ‎Lua מריץ את שתיהן כיחידה. התפוגה נקבעת גם אם המפתח קיים
     * ואיבד אותה משום מה — `ttl == -1` — כדי שמפתח כזה שכבר שרד
     * מגרסה קודמת ייפדה מעצמו בפנייה הבאה.
     */
    const sent = Number(
      await this.redis.eval(
        `local n = redis.call('INCR', KEYS[1])
         if n == 1 or redis.call('TTL', KEYS[1]) == -1 then
           redis.call('EXPIRE', KEYS[1], ARGV[1])
         end
         return n`,
        1,
        key,
        String(EMAIL_WINDOW_SECONDS),
      ),
    );
    if (sent > MAX_CODES_PER_EMAIL) {
      throw new BadRequestException(
        "נשלחו כבר כמה קודים לכתובת הזו — נסו שוב בעוד שעה או פנו אלינו",
      );
    }
  }

  /** מה שנגבה ולא נשלח מוחזר. כישלון ההחזר עצמו אינו מפיל את הבקשה. */
  private async refundEmailQuota(emailAddress: string): Promise<void> {
    await this.redis
      .decr(this.quotaKey(emailAddress))
      .catch(() => this.logger.warn("החזר מכסת האימייל נכשל"));
  }

  /**
   * גבייה, שליחה, והחזר אם השליחה נכשלה — **כיחידה אחת.**
   *
   * הגבייה ישבה קודם בראש `issue` ו-`reissue`, וביניה לבין השליחה
   * היו פעולות שיכולות להיכשל בעצמן: כתיבת הרשומה ל-Redis, וקריאת
   * ה-TTL. כישלון שם שרף מכסה בלי שאיש ניסה לשלוח דבר, וההחזר לא
   * רץ כי הוא היה תלוי בניסיון השליחה (ביקורת Codex).
   *
   * צירוף השניים לפונקציה אחת אינו נוחות: הוא הופך את הפער הזה
   * לבלתי-ניתן לכתיבה מחדש. אין מקום שבו אפשר לגבות בלי שההחזר
   * שומר עליו, כי אין קריאה נפרדת לגבייה.
   */
  private async chargeAndDeliver(pending: PendingSignup, code: string): Promise<void> {
    await this.chargeEmailQuota(pending.email);
    try {
      await this.deliver(pending, code);
    } catch (error) {
      await this.refundEmailQuota(pending.email);
      throw error;
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
