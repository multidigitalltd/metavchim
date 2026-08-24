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
 * כמה זמן שליחה נחשבת „בדרך” וחוסמת שליחה חוזרת נוספת — ראו
 * ‎`StoredPending.sendingUntil`. ‎60 שניות הן חלון ההשהיה המקובל
 * ב„שלחו שוב”, והן מכסות בנוחות שליחה שגבולה העליון המעשי הוא
 * פסק הזמן של הספק.
 */
const RESEND_DEBOUNCE_MS = 60_000;

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
  /**
   * עד מתי שליחה נחשבת „בדרך” — **השהיה, ולא ערובה.**
   *
   * ההתקנה המותנית מסדרת שתי בקשות שנכנסות יחד, אבל אינה מסדרת
   * בקשה שנכנסת **אחרי** שהראשונה כבר התקינה ועדיין שולחת: היא
   * רואה את הרשומה החדשה כערך הנוכחי, מצליחה בהתאמה, ושולחת קוד
   * שלישי שהורג את זה שיצא לפני רגע (ביקורת Codex).
   *
   * הסימון חי **בתוך הרשומה**, ולכן הוא נשמר ונקרא באותה התאמה
   * אטומית — בלי מפתח נפרד, בלי חכירה ובלי חידוש. וחשוב מכך:
   * הנכונות אינה תלויה בו. אם השליחה נמשכת מעבר לחלון, מה שקורה
   * הוא שני אימיילים **לאותה תיבה** שהאחרון בהם תקף — לא שחיתות
   * ולא קוד חי שאיש אינו יודע עליו. זו הסיבה שהוא נקרא השהיה.
   */
  sendingUntil: number;
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
      sendingUntil: Date.now() + RESEND_DEBOUNCE_MS,
    };
    const value = JSON.stringify(stored);
    await this.redis.set(this.key(token), value, "EX", PENDING_TTL_SECONDS);
    await this.chargeAndDeliver(pending, code);
    await this.requireStillPending(token, value, "ההרשמה לא הושלמה — מלאו את הפרטים שוב");
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
   *
   * ## ההתקנה קודמת לשליחה, והיא נקודת הסידור
   *
   * חמישה סבבים ניסיתי לסדר את השליחות המקבילות במנעול: תפיסה,
   * חותם בעלים, חכירה מתחדשת, מעקב אחר אובדן בעלות. כל אחד מהם סגר
   * מקרה ופתח שכן, והמסקנה נכונה ומנוסחת היטב בביקורת: **חכירה
   * אינה יכולה לאכוף סידור סביב שליחה חיצונית שאינה טרנזקציה.** כל
   * עוד השליחה קודמת לכתיבה, שני קודים יכולים לצאת ורק אחד להיכתב
   * — ואחד המקבלים מחזיק אימייל מת.
   *
   * ההתקנה המותנית **לפני** השליחה מסלקת את הבעיה במקום לגדר אותה:
   * היא אטומית, ולכן מבין שתי בקשות מקבילות רק אחת מצליחה — והשנייה
   * **אינה שולחת דבר** ואומרת למשתמש שקוד חדש כבר בדרך. אין מנעול,
   * אין חכירה, אין חידוש, ואין בעלות לעקוב אחריה.
   *
   * ומה שדחף אותי במקור לסדר ההפוך — „אם הספק ייפול, המשתמש יישאר
   * בלי כלום” — נפתר בהחזרה ולא בהיפוך הסדר: כישלון שליחה מחזיר את
   * הקוד הקודם בהתאמה-וכתיבה, ולכן מה שכבר בתיבת הדואר ממשיך לעבוד.
   *
   * ‎`KEEPTTL` בשתי הכתיבות: חלון התפוגה נשמר בידי Redis עצמו, ואין
   * חשבון זמן שיכול לסטות — לא בהתקנה ולא בהחזרה.
   */
  async reissue(token: string): Promise<void> {
    const raw = await this.redis.get(this.key(token));
    if (raw === null) throw new BadRequestException("ההרשמה פגה — מלאו את הפרטים שוב");
    const stored = JSON.parse(raw) as StoredPending;

    if (!(await this.email.isConfigured())) {
      throw new ServiceUnavailableException("ההרשמה העצמית אינה זמינה כרגע — נסו שוב מאוחר יותר");
    }

    /*
     * שליחה שעדיין בדרך חוסמת שליחה נוספת — ראו
     * ‎`StoredPending.sendingUntil`. הבדיקה כאן, לפני ההתקנה, כדי
     * שהבקשה השנייה לא תיגע ברשומה כלל.
     */
    if (stored.sendingUntil > Date.now()) {
      throw new BadRequestException("קוד חדש נשלח זה עתה — בדקו את תיבת הדואר");
    }

    const code = SignupVerificationService.freshCode();
    const replacement = JSON.stringify({
      ...stored,
      codeHmac: this.hmac(code),
      /* גרסה חדשה — מונה הניסיונות נספר תחתיה (ראו `StoredPending.version`) */
      version: SignupVerificationService.freshVersion(),
      sendingUntil: Date.now() + RESEND_DEBOUNCE_MS,
    } satisfies StoredPending);

    /*
     * **ההתקנה והגבייה הן פעולה אחת** — ולא שתיים עם פיצוי ביניהן.
     *
     * קודם הן היו נפרדות, וכל כישלון של הגבייה חייב ביטול של
     * ההתקנה. הביטול הזה נכתב ל-Redis — **אותו Redis שכשלונו גרם
     * לו** — ולכן בדיוק כשהוא נחוץ הוא אינו יכול לרוץ: הקוד החדש
     * נשאר מותקן בלי שנשלח, והקוד שכבר בתיבת הדואר מת (ביקורת
     * Codex). פיצוי שמסתמך על התלות שנפלה אינו פיצוי.
     *
     * שתיהן ב-Redis, ולכן הן יכולות להיות סקריפט אחד: או ששתיהן
     * קרו או שאף אחת. אין עוד מצב ביניים לפצות עליו, ואין מסלול
     * שבו התקרה חוסמת אחרי שהקוד כבר הוחלף.
     *
     * הצילום שהתיישן נדחה כאן באותה נשימה: שליחה חוזרת אחרת
     * שהקדימה אותנו, או `consume` שניצלה את הרשומה, מפילות את
     * ההתאמה — לפני שיצא אימייל וגם לפני שנגבתה מכסה.
     */
    const charged = await this.redis.eval(
      `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return { 0, 'stale' } end
       local n = redis.call('INCR', KEYS[2])
       if n == 1 or redis.call('TTL', KEYS[2]) == -1 then
         redis.call('EXPIRE', KEYS[2], ARGV[3])
         redis.call('SET', KEYS[3], ARGV[4], 'EX', ARGV[3])
       end
       if n > tonumber(ARGV[5]) then
         redis.call('DECR', KEYS[2])
         return { 0, 'quota' }
       end
       redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
       return { 1, redis.call('GET', KEYS[3]) }`,
      3,
      this.key(token),
      this.quotaKey(stored.pending.email),
      this.quotaWindowKey(stored.pending.email),
      raw,
      replacement,
      String(EMAIL_WINDOW_SECONDS),
      SignupVerificationService.freshVersion(),
      String(MAX_CODES_PER_EMAIL),
    );
    const [okRaw, detailRaw] = Array.isArray(charged) ? charged : [];
    /* תשובה שאי אפשר לקרוא עוצרת — ולא ממשיכה לשלוח על סמך ניחוש. */
    if (typeof okRaw !== "number") {
      throw new ServiceUnavailableException("שליחת הקוד אינה זמינה כרגע — נסו שוב בעוד רגע");
    }
    if (okRaw !== 1) {
      if (detailRaw === "quota") {
        throw new BadRequestException(
          "נשלחו כבר כמה קודים לכתובת הזו — נסו שוב בעוד שעה או פנו אלינו",
        );
      }
      throw new BadRequestException("קוד חדש נשלח זה עתה — בדקו את תיבת הדואר");
    }
    const window = typeof detailRaw === "string" && detailRaw !== "" ? detailRaw : null;

    /*
     * **הביטול נמסר פנימה ואינו מוכרע כאן.**
     *
     * „האם יצאה הודעה” היא שאלה שרק `deliverOrUndo` יודעת לענות
     * עליה. כל עוד ההכרעה הזו ישבה כאן היא שוכפלה ואז נעשתה
     * שגויה — פעמיים בסבבים רצופים (ביקורות Codex). מכאן: המקום
     * שיודע, מחליט, ושתי ההשלכות תלויות בו יחד.
     *
     * הביטול מותנה בכך שהקוד החדש עדיין שלנו: `consume` שהספיקה
     * לנצל את הרשומה, או שליחה חוזרת שהחליפה אותה, אינן נדרסות.
     */
    await this.deliverOrUndo(stored.pending, code, window, async () => {
      await this.redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then
           redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
           return 1
         end
         return 0`,
        1,
        this.key(token),
        replacement,
        raw,
      );
    });

    await this.requireStillPending(
      token,
      replacement,
      "ההרשמה כבר הושלמה או פגה — הקוד שנשלח זה עתה אינו בתוקף",
    );
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

  /**
   * **„נשלח” נאמר רק אם הרשומה שנשלח עליה עדיין קיימת כפי שנכתבה.**
   *
   * השליחה אינה מיידית, והתפוגה אינה מחכה לה: רשומה יכולה לפוג
   * **בזמן** השליחה, ואז המסך אומר „נשלח קוד” בעוד שבצד השרת אין
   * דבר — המשתמש מקליד את מה שקיבל ומקבל „פג תוקף” בלי להבין למה.
   * ההשוואה היא לערך שנכתב ולא בדיקת קיום, ולכן היא תופסת גם רשומה
   * שנוצלה ב-`consume` או הוחלפה בשליחה חוזרת אחרת.
   *
   * **פונקציה משותפת ולא בדיקה כפולה במכוון.** הוספתי אותה תחילה
   * ב-`reissue` בלבד, ו-`issue` נשארה מאחור עם אותו כשל בדיוק
   * (ביקורת Codex) — זו הפעם השלישית בביקורת הזו שתיקנתי דפוס
   * במופע אחד מתוך שניים. מכאן היא במקום אחד, ואין מופע שני שיכול
   * להתיישן.
   */
  private async requireStillPending(
    token: string,
    expected: string,
    message: string,
  ): Promise<void> {
    if ((await this.redis.get(this.key(token))) !== expected) {
      throw new BadRequestException(message);
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

  private static freshCode(): string {
    return String(randomInt(0, 10 ** SIGNUP_CODE_LENGTH)).padStart(SIGNUP_CODE_LENGTH, "0");
  }

  private quotaKey(emailAddress: string): string {
    return `signup-pending:sent:${SignupVerificationService.fingerprint(emailAddress)}`;
  }

  /** מזהה הדור של חלון המכסה — ראו `refundEmailQuota`. */
  private quotaWindowKey(emailAddress: string): string {
    return `${this.quotaKey(emailAddress)}:window`;
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
  private async chargeEmailQuota(emailAddress: string): Promise<string | null> {
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
    /*
     * **החלון מסומן במזהה, כדי שההחזר יידע למי הוא שייך.**
     *
     * ההחזר היה `DECR` עיוור, ולכן פגע בכל דבר חוץ מהחלון שנגבה:
     * מפתח שפג בינתיים נוצר מחדש בערך ‎-1 **בלי תפוגה**, וחלון חדש
     * שכבר נפתח ספג הפחתה של בקשה שאינה שייכת לו — ומכאן יותר
     * משלוש שליחות בשעה (ביקורת Codex). המזהה נכתב עם הגבייה
     * הראשונה, חי בדיוק כמו המונה, וההחזר מותנה בו.
     */
    /*
     * **בקשה שנדחתה אינה משאירה את ההגדלה שלה.**
     *
     * הבדיקה ישבה מחוץ לסקריפט, ולכן הבקשה הרביעית הגדילה ל-4,
     * נדחתה — והשאירה את ה-4 במונה. אם אחת מקודמותיה קיבלה אחר-כך
     * דחייה ודאית והוחזרה, המונה ירד ל-3 בעוד שרק שתי שליחות
     * בפועל יצאו: הבקשה הלגיטימית הבאה מוצאת תקרה מלאה עד סוף
     * השעה (ביקורת Codex). הביטול קורה באותו סקריפט, ולכן אין רגע
     * שבו הספירה כוללת ניסיון שנדחה.
     */
    const charged = await this.redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 or redis.call('TTL', KEYS[1]) == -1 then
         redis.call('EXPIRE', KEYS[1], ARGV[1])
         redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[1])
       end
       if n > tonumber(ARGV[3]) then
         redis.call('DECR', KEYS[1])
         return { 0, '' }
       end
       return { 1, redis.call('GET', KEYS[2]) }`,
      2,
      key,
      this.quotaWindowKey(emailAddress),
      String(EMAIL_WINDOW_SECONDS),
      SignupVerificationService.freshVersion(),
      String(MAX_CODES_PER_EMAIL),
    );
    const [allowedRaw, windowRaw] = Array.isArray(charged) ? charged : [];
    /*
     * תשובה שאי אפשר לקרוא **עוצרת** את השליחה. „אם זה מספר וגם מעל
     * התקרה” נכשל לכיוון הפתוח, כלומר הופך תקלה בספירה לביטול
     * ההגבלה — אותו לקח כמו במונה הניסיונות.
     */
    if (typeof allowedRaw !== "number") {
      throw new ServiceUnavailableException("שליחת הקוד אינה זמינה כרגע — נסו שוב בעוד רגע");
    }
    if (allowedRaw !== 1) {
      throw new BadRequestException(
        "נשלחו כבר כמה קודים לכתובת הזו — נסו שוב בעוד שעה או פנו אלינו",
      );
    }
    /* בלי מזהה חלון לא יוחזר דבר — עדיף לגבות יתר על לאבד תקרה. */
    return typeof windowRaw === "string" && windowRaw !== "" ? windowRaw : null;
  }

  /**
   * מה שנגבה ולא נשלח מוחזר — **רק לחלון שממנו נגבה.**
   *
   * כישלון ההחזר עצמו אינו מפיל את הבקשה: השליחה כבר נכשלה, ומכסה
   * שנשארה גבויה היא הכיוון הבטוח מבין השניים.
   */
  private async refundEmailQuota(emailAddress: string, window: string): Promise<void> {
    await this.redis
      .eval(
        `if redis.call('GET', KEYS[2]) == ARGV[1] and redis.call('EXISTS', KEYS[1]) == 1 then
           return redis.call('DECR', KEYS[1])
         end
         return 0`,
        2,
        this.quotaKey(emailAddress),
        this.quotaWindowKey(emailAddress),
        window,
      )
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
  /**
   * גבייה ואז שליחה — מסלול ההנפקה הראשונה.
   *
   * ‎`reissue` אינה עוברת כאן: שם הגבייה מאוחדת עם ההתקנה לסקריפט
   * אחד, כדי שלא יהיה מצב ביניים שדורש פיצוי דרך Redis שאולי נפל.
   */
  private async chargeAndDeliver(pending: PendingSignup, code: string): Promise<void> {
    const window = await this.chargeEmailQuota(pending.email);
    await this.deliverOrUndo(pending, code, window);
  }

  /**
   * השליחה, ומה שמתבטל אם **ידוע** שהיא לא יצאה.
   *
   * זהו המקום היחיד שמכריע „לא נשלח”, ושתי ההשלכות תלויות בהכרעה
   * הזו יחד: החזר המכסה, וביטול שהקורא מוסר פנימה (ב-`reissue` —
   * החזרת הקוד הקודם). כל עוד הן ישבו בשני מקומות, כל הזזה של
   * הגבול שכחה אחת מהן — חמש פעמים בביקורת הזו.
   *
   * ‎**`EmailRejectedError` בלבד.** פסק זמן, נפילת רשת או ‎5xx אינם
   * „לא נשלח” אלא „איננו יודעים”: ייתכן שההודעה כן יצאה. החזר מכסה
   * שם היה הופך את התקרה לחסרת משמעות, והחזרת הקוד הקודם הייתה
   * פוסלת דווקא את הקוד החדש שכנראה הגיע — והמשתמש היה מקליד את
   * האחרון שקיבל ונדחה (שתי ביקורות Codex, בשני סבבים).
   */
  private async deliverOrUndo(
    pending: PendingSignup,
    code: string,
    window: string | null,
    undo?: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.deliver(pending, code);
    } catch (error) {
      if (error instanceof EmailRejectedError) {
        /*
         * **כישלון של הפיצוי אינו מסתיר את הסיבה.**
         *
         * הפיצוי כותב ל-Redis, ו-Redis יכול ליפול בדיוק כאן. זריקה
         * שלו הייתה מחליפה את שגיאת השליחה האמיתית בשגיאת Redis,
         * ומשאירה את הקורא בלי לדעת מה קרה. נרשם באזהרה, והשגיאה
         * המקורית ממשיכה למעלה.
         */
        if (window !== null) {
          await this.refundEmailQuota(pending.email, window);
        }
        if (undo !== undefined) {
          await undo().catch(() => this.logger.warn("ביטול הקוד שנשלח נכשל"));
        }
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
