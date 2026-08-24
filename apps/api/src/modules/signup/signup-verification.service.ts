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
import { EmailRejectedError, EmailService } from "../../core/email.service";

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
 * **החכירה מוכרחה לכסות את השליחה עצמה.** הערך היה 20 שניות בעוד
 * ‎`chargeAndDeliver` יכולה לרוץ יותר מזה: החכירה פגה באמצע, בקשה
 * שנייה תפסה מנעול חדש ושלחה קוד מחליף, ורק אחד מהשניים נכתב —
 * כלומר שני אימיילים ואחד מהם מת (ביקורת Codex). ‎`EmailService`
 * חוסמת את הקריאה לספק ב-`AbortSignal.timeout(10_000)` ואינה מנסה
 * שוב, ולכן 45 שניות הן מעל הגבול העליון של השליחה בהפרש ניכר.
 */
const RESEND_LOCK_SECONDS = 45;

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
  /**
   * מזהה הגרסה — **המפתח שמונה הניסיונות נספר תחתיו.**
   *
   * מונה אחד לטוקן היה נמנה על „ההרשמה” ולא על הקוד, וכל שליחה
   * חוזרת נאלצה לאפס אותו בדיוק ברגע שבו היא מתקינה קוד חדש.
   * אישור שקרא את הקוד הישן והספיק להגדיל את המונה אחרי האיפוס
   * זקף ניסיון לחובת הקוד **החדש**: כמה כאלה במקביל מוצים את
   * חמשת הניסיונות שלו לפני שהמשתמש בכלל הקליד אותו, וההקלדה
   * הראשונה שלו מוחקת אותו (ביקורת Codex).
   *
   * גרסה משלה לכל קוד פירושה שאין מה לאפס ואין מה לתאם: מונה של
   * קוד שהוחלף פשוט פג מעצמו, ולעולם אינו נוגע ביורש.
   */
  version: string;
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
    const stored: StoredPending = {
      pending,
      codeHmac: this.hmac(code),
      version: SignupVerificationService.freshVersion(),
    };
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
    /*
     * למנעול יש **בעלים**, ולא רק קיום.
     *
     * ‎`DEL` עיוור מוחק את מה שיושב בכתובת ולא את מה שתפסנו: חכירה
     * שפגה תוך כדי שליחה, ובקשה שנייה שתפסה מנעול חדש בעקבותיה,
     * הפכו את שחרור-הכישלון שלנו למחיקת המנעול **שלה** (ביקורת
     * Codex). החותם נבדק לפני המחיקה, ולכן אין דרך לשחרר מנעול של
     * מישהו אחר.
     */
    const holder = randomBytes(12).toString("base64url");
    const claimed = await this.redis.set(lock, holder, "EX", RESEND_LOCK_SECONDS, "NX");
    if (claimed === null) {
      throw new BadRequestException("קוד חדש נשלח זה עתה — בדקו את תיבת הדואר");
    }
    const release = async (): Promise<void> => {
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        lock,
        holder,
      );
    };

    const code = SignupVerificationService.freshCode();
    /*
     * ה-TTL נשמר ואינו מתחדש: הארכה בכל „שלחו שוב” הייתה הופכת את
     * חלון התפוגה לבלתי-מוגבל בלחיצות.
     */
    const ttl = await this.redis.ttl(this.key(token));
    if (ttl <= 0) {
      await release();
      throw new BadRequestException("ההרשמה פגה — מלאו את הפרטים שוב");
    }
    /*
     * **מועד, ולא יתרה** — מאותו נימוק בדיוק כמו ב-`withVerified`.
     *
     * ‎`ttl` נמדד כאן, וההתקנה קורית אחרי השליחה: כתיבה של `ttl`
     * כמו-שהוא מוסיפה לתפוגה את כל משך השליחה. „שלחו שוב” בעשר
     * שניות של שליחה, עשר פעמים, מותחת חלון של עשרים דקות ללא
     * גבול — וזה בדיוק מה שההערה מעל טוענת שאינו קורה (ביקורת
     * Codex). את התיקון הזה עשיתי בסבב הקודם בצד אחד בלבד.
     */
    const deadline = Date.now() + ttl * 1000;

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
      await release();
      throw error;
    }

    /* מה שנותר מהמועד המקורי — אחרי השליחה, ולא לפניה. */
    const left = Math.floor((deadline - Date.now()) / 1000);
    if (left <= 0) {
      await release();
      throw new BadRequestException(
        "ההרשמה פגה — הקוד שנשלח זה עתה אינו בתוקף, מלאו את הפרטים שוב",
      );
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
     * **בלי איפוס מונה כאן, כי אין מה לאפס.**
     *
     * הקוד החדש נושא גרסה חדשה, והמונה נספר תחת הגרסה (ראו
     * ‎`StoredPending.version`). המונה של הקוד המוחלף אינו נוגע בו
     * ופג מעצמו, ולכן אין עוד שתי פעולות שצריך לתאם ביניהן — וגם
     * לא רגע שבו אחת מהן כבר קרתה והשנייה טרם.
     */
    const replaced = await this.redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then
         redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
         return 1
       end
       return 0`,
      1,
      this.key(token),
      raw,
      JSON.stringify({
        ...stored,
        codeHmac: this.hmac(code),
        version: SignupVerificationService.freshVersion(),
      } satisfies StoredPending),
      String(left),
    );
    if (replaced !== 1) {
      /*
       * האימייל כבר יצא, ולכן נאמר במפורש שהקוד שבו אינו בתוקף —
       * „נשלח קוד” בלי המשך היה משאיר את המשתמש ממתין לו לחינם.
       */
      await release();
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
     * הרשומה נקראת **לפני** ספירת הניסיון, והספירה נזקפת לגרסה
     * שנקראה — לא ל„הרשמה” באופן כללי.
     *
     * הסדר הזה הוא מה שמונע ניסיון שנזקף לקוד הלא-נכון בשני
     * הכיוונים: מחיקת מיצוי שמסירה קוד שהוחלף (וזה הקוד שנשלח זה
     * עתה למשתמש), וספירה של אישור שהתיישן שנזקפת לקוד החדש —
     * כמה כאלה במקביל מוצים אותו לפני שהוקלד ולו פעם אחת (ביקורת
     * Codex). הצילום קודם, ומפתח המונה נגזר ממנו.
     */
    const raw = await this.redis.get(this.key(token));
    if (raw === null) throw new UnauthorizedException("ההרשמה פגה — מלאו את הפרטים שוב");
    const stored = JSON.parse(raw) as StoredPending;
    const attempts = this.attemptsKey(token, stored.version);

    /*
     * הגדלה ותפוגה בפעולה אחת: ‎`EXPIRE` נפרד שלא הספיק לרוץ משאיר
     * מונה נצחי, ומאותו רגע ההרשמה חסומה עד שמישהו ינקה ידנית.
     */
    const counted = await this.redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return n`,
      1,
      attempts,
      String(PENDING_TTL_SECONDS),
    );
    /*
     * ‎`eval` מוחזר כ-`unknown`, ומונה שאי אפשר לקרוא **עוצר את
     * הניסיון** ולא מכשיר אותו: תנאי מהצורה „אם זה מספר וגם גדול
     * מהתקרה” נכשל לכיוון הפתוח, כלומר הופך תקלה בספירה לביטול
     * מגבלת הניחושים. הרשומה אינה נמחקת כאן — לא הוכח שהניסיונות
     * מוצו, אלא שאיננו יודעים.
     */
    if (typeof counted !== "number") {
      throw new ServiceUnavailableException("האימות אינו זמין כרגע — נסו שוב בעוד רגע");
    }
    if (counted > MAX_ATTEMPTS) {
      /*
       * המחיקה מותנית בגרסה שנקראה. אם בינתיים הותקן קוד אחר —
       * ההתאמה נכשלת, הוא שורד, והמונה שלו הוא ממילא מונה אחר.
       */
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        this.key(token),
        raw,
      );
      await this.redis.del(attempts);
      throw new UnauthorizedException("יותר מדי ניסיונות — מלאו את הפרטים שוב");
    }

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
    /*
     * **מועד התפוגה, ולא כמה נותר.**
     *
     * נשמר כאן `remaining` שנמדד לפני `create`, וההחזרה נעשתה
     * ב-`EX remaining` — כלומר פתיחה שנתקעה שתי דקות ונפלה הייתה
     * מאריכה את חיי הקוד בשתי דקות מעבר לעשרים המקוריות, בניגוד
     * למה שנכתב באימייל ולמה שההערה כאן טענה (ביקורת Codex).
     * מועד מוחלט אינו נסחף: מה שנותר ממנו מחושב בזמן ההחזרה.
     */
    const remaining = await this.redis.ttl(this.key(token));
    const deadline = remaining > 0 ? Date.now() + remaining * 1000 : 0;

    const claimed = await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1,
      this.key(token),
      raw,
    );
    if (claimed !== 1) throw new UnauthorizedException("הקוד כבר אינו תקף — בקשו קוד חדש");
    await this.redis.del(attempts);

    try {
      return await create(stored.pending as VerifiedSignup);
    } catch (error) {
      /*
       * הפתיחה נכשלה — אותו קוד בדיוק חוזר לתוקף, עד למועד התפוגה
       * המקורי, אבל **תחת גרסה חדשה**.
       *
       * החזרה של אותה גרסה נראית תמימה והיא אינה: בזמן שהפתיחה
       * רצה, אישורים מקבילים שקראו את אותו `raw` ממשיכים להגדיל את
       * מונה הגרסה הזו — מונה שכבר נמחק כאן ונוצר מחדש על ידם.
       * חמישה כאלה, והרשומה המוחזרת חוזרת לחיים עם מונה שכבר עומד
       * על חמש: ההקלדה הבאה של המשתמש היא השישית, והקוד שלו נמחק
       * (ביקורת Codex). ‎`codeHmac` נשמר, ולכן הקוד שבתיבת הדואר
       * ממשיך לעבוד — רק המונה מתחיל נקי.
       *
       * ‎`NX` ולא כתיבה גסה: אם משהו כבר יושב שם הוא חדש מזה, ואין
       * להחליף אותו במה שזה עתה נצרך.
       */
      const left = Math.floor((deadline - Date.now()) / 1000);
      if (left > 0) {
        await this.redis.set(
          this.key(token),
          JSON.stringify({
            ...stored,
            version: SignupVerificationService.freshVersion(),
          } satisfies StoredPending),
          "EX",
          left,
          "NX",
        );
      }
      throw error;
    }
  }

  private key(token: string): string {
    return `signup-pending:${token}`;
  }

  /** מזהה קצר וייחודי לגרסת קוד — משמש רק כשם מפתח, לא כסוד. */
  private static freshVersion(): string {
    return randomBytes(9).toString("base64url");
  }

  private attemptsKey(token: string, version: string): string {
    return `signup-pending:attempts:${token}:${version}`;
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
      /*
       * **מוחזר רק מה שידוע שלא נשלח.**
       *
       * ההחזר היה על כל כישלון, וזו טעות: פסק זמן או נפילת רשת
       * אינם „לא נשלח” אלא „איננו יודעים” — ייתכן ש-Postmark קיבל
       * את ההודעה ושלח אותה, ורק התשובה אבדה. מי שמסוגל לגרום
       * לתוצאה העמומה הזו שוב ושוב מקבל מכסה שחוזרת לאפס בכל פעם,
       * כלומר שליחה בלי גבול אל תיבה של אדם אחר — בדיוק ההצפה
       * שהתקרה נועדה למנוע, וההערה מעל `chargeEmailQuota` טענה
       * שהיא עדיין מגינה מפניה (ביקורת Codex).
       *
       * ‎`EmailRejectedError` הוא המקרה היחיד שבו הספק **ענה ודחה**,
       * ולכן היחיד שבו הוודאות קיימת. בהיעדרה נשמרת הגבייה: תקלה
       * אצל הספק עולה למשתמש עיכוב של שעה על כתובתו שלו, וזה מחיר
       * נמוך מהאפשרות להשתמש בנו כדי להטריד.
       */
      if (error instanceof EmailRejectedError) {
        await this.refundEmailQuota(pending.email);
      }
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
