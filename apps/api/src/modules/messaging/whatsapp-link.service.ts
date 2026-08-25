import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import IORedis from "ioredis";
import { ulid } from "ulid";
import {
  WHATSAPP_LINK_CODE_ALPHABET,
  WHATSAPP_LINK_CODE_LENGTH,
  WHATSAPP_LINK_CODE_MAX_ATTEMPTS,
  WHATSAPP_LINK_CODE_TTL_SECONDS,
  formatWhatsappLinkCode,
  linkNeedsReverification,
  normalizeWhatsappLinkCode,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import { waPhoneVariants } from "./assistant-lang";
import { phoneDigitsCondition } from "./phone-match";

/**
 * הקישור בין מספר וואטסאפ לחשבון — **מי מדבר איתנו, ומי אמר את זה.**
 *
 * ## מה השתנה
 *
 * הזהות בערוץ נגזרה מהשוואת ספרות מול שדה `phone`. זו הנחה, לא
 * הצהרה, ויש לה שלוש תוצאות שאי אפשר להתעלם מהן:
 *
 * - מספר שהוחזר לשוק וניתן למישהו אחר (נפוץ בישראל) פותח לבעליו
 *   החדש את כל מאגר המשרד, כל עוד השדה לא עודכן.
 * - אותו מספר אצל שני משתמשים הוכרע לפי „מי התחבר לאחרונה” — ניחוש
 *   שקט ברשומות של מישהו אחר.
 * - למתווך לא הייתה דרך לראות איזה מכשיר מחובר, ולא דרך לנתק.
 *
 * מכאן הזהות היא **הקישור**: שורה שנכתבה פעם אחת, שאפשר לראות
 * ולנתק, ושפגה כשהיא מתיישנת.
 *
 * ## למה הקוד ב-Redis והקישור במסד
 *
 * לשניים תוחלת חיים הפוכה. הקוד חי רבע שעה ואינו מעניין איש אחרי
 * שהשתמשו בו — בדיוק כמו קוד הכניסה, ובאותו דפוס: HMAC בלבד, מונה
 * ניסיונות אטומי, ותפוגה שהמסד לא צריך לנקות. הקישור הוא ההפך:
 * הוא הזהות עצמה, הוא נקרא בכל הודעה נכנסת, והוא חייב לשרוד אתחול.
 */

/** קישור שנוצר מהשוואת מספר, ולא מקוד שהמתווך שלח. */
const SOURCE_PHONE = "phone";
const SOURCE_CODE = "code";

/**
 * כל כמה זמן נאמר למספר שנותק „אינך מחובר” — יממה.
 *
 * ההודעה נשלחת למספר שאינו מזוהה, ולכן היא חייבת תקרה: מי שמחזיק
 * עכשיו במספר שהוחלף אינו אמור לקבל את אותה שורה בכל הודעה, וגם
 * דירוג האיכות של המספר אצל Meta נפגע מחזרתיות.
 */
const UNLINKED_HINT_COOLDOWN_SECONDS = 24 * 60 * 60;

/**
 * כמה זמן זוכרים שהודעת קוד כבר טופלה.
 *
 * Meta שולחת שוב הודעה שהתשובה עליה התמהמהה, ומסלול הקוד עוקף את
 * התפיסה שבמסד — היא דורשת משתמש מזוהה, וכאן עוד אין אחד. יממה
 * מכסה בהרבה את חלון השליחה החוזרת, והמפתח זעיר.
 */
const INBOUND_CLAIM_SECONDS = 24 * 60 * 60;

/**
 * כמה זמן נשמר מונה הדורות של חשבון.
 *
 * ארוך בהרבה מחיי הקוד ומתחדש בכל ניתוק: מונה שפג בין ההפקה לניצול
 * ייקרא כדור 0 ויפסול קוד תקין. שלושים יום הם סדר גודל אחר לגמרי
 * מרבע שעה, ולכן זה אינו מצב שאפשר להיקלע אליו בפועל.
 */
const GENERATION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** למה הקישור נותק — נשמר כדי שהמסך יאמר משהו אמיתי. */
export type LinkRevokeReason = "user" | "phone_changed" | "expired" | "relinked";

export interface ResolvedLink {
  userId: string;
  tenantId: string;
}

/** מה שמסך ההגדרות מציג — בלי המספר עצמו. */
export interface LinkStatus {
  linked: boolean;
  /** ארבע ספרות אחרונות בלבד: „מחובר למספר שמסתיים ב-4567”. */
  tail?: string;
  linkedAt?: Date;
  verifiedAt?: Date;
  lastSeenAt?: Date;
  /** נוצר בהשוואת מספר ולא בקוד — המסך מציע לאמת במפורש */
  implicit?: boolean;
  needsReverification?: boolean;
}

@Injectable()
export class WhatsAppLinkService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppLinkService.name);
  private readonly redis: IORedis;
  private readonly hmacKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {
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

  private hmac(value: string): string {
    return createHmac("sha256", this.hmacKey).update(value).digest("hex");
  }

  /**
   * הצורה הקנונית של מספר השולח — **המפתח, ולכן חייבת להיות אחת.**
   *
   * `waPhoneVariants` מחזירה את שתי צורות ההקלדה הנפוצות; הראשונה
   * היא הצורה הבינלאומית, וזו שנשמרת. שמירה לפי מה שהגיע הייתה
   * מייצרת שני קישורים לאותו מכשיר.
   */
  private canonical(waId: string): string | null {
    const variants = waPhoneVariants(waId);
    const first = variants[0];
    return first === undefined || first === "" ? null : first;
  }

  /* ------------------------------------------------------------------ */
  /*  הנפקה ואימות                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * קוד חדש למשתמש — הקודם נמחק.
   *
   * קוד אחד בכל רגע: שניים פעילים במקביל פירושם שקוד שהמתווך כבר
   * שכח ממנו נשאר תקף על המסך הקודם.
   */
  async issueCode(tenantId: string, userId: string): Promise<{ code: string; expiresInSeconds: number }> {
    /*
     * **ההנפקה נכנסת לאותו תור כמו הקישור והניתוק.**
     *
     * עסקה שכל תוכנה הוא נעילה נראית מוזר — הכתיבות עצמן ב-Redis —
     * אבל הנעילה חיה בתוך עסקה, וזה מה שקונים כאן: בלעדיה הנפקה
     * שרצה במקביל לניתוק יכלה לכתוב קוד **אחרי** שהחותמת נכתבה
     * ולהתקין את המצביע **אחרי** שהניתוק חיפש אותו. התוצאה הייתה
     * קוד ששרד ניתוק שהצליח, ותקף בעיני הבדיקה כי הוא חדש מהחותמת
     * (ביקורת Codex). בתור, „הופק לפני הניתוק” ו„הופק אחריו” הם שני
     * מצבים מובחנים — והשני, שהוא בקשה מפורשת לקשר מכשיר, אכן תקף.
     */
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, userId);
      return this.writeCode(tenantId, userId);
    });
  }

  private async writeCode(
    tenantId: string,
    userId: string,
  ): Promise<{ code: string; expiresInSeconds: number }> {
    /*
     * המפתח הוא **הקוד**, לא המשתמש: ההודעה בוואטסאפ מגיעה בלי שום
     * הקשר מלבד הקוד עצמו, ולכן זה הצד שצריך להיות ניתן לחיפוש.
     * מפתח שני לפי משתמש קיים רק כדי למחוק קוד קודם.
     *
     * **הכתיבה מותנית (`NX`), ולכן התנגשות אינה השתלטות.**
     *
     * שני משתמשים יכולים להגריל את אותן שש אותיות בזמן שהקוד הראשון
     * עדיין חי. כתיבה גורפת הייתה מחליפה את הבעלות על הקוד — והמתווך
     * הראשון, שהמסך שלו עדיין מציג אותו, היה שולח אותו ומקשר את
     * המכשיר שלו לחשבון של השני (ביקורת Codex). התנגשות מגרילה מחדש.
     */
    /*
     * **דור ולא שעה.**
     *
     * הקוד נושא את מספר הדור של החשבון ברגע ההפקה, וכל ניתוק מקדם
     * אותו. ההשוואה בין השניים היא בדיוק הסדר שהנעילה כבר קבעה —
     * בלי להישען על שעון, שאינו סדר: שתי פעולות באותה מילישנייה
     * נראות כמו „בו-זמנית”, והפרשי שעונים בין תהליכים יכולים אפילו
     * להפוך את היחס (ביקורת Codex).
     */
    const generation = await this.generation(userId);
    let body = "";
    let codeHmac = "";
    for (let attempt = 0; ; attempt += 1) {
      body = Array.from({ length: WHATSAPP_LINK_CODE_LENGTH }, () =>
        WHATSAPP_LINK_CODE_ALPHABET.charAt(randomInt(0, WHATSAPP_LINK_CODE_ALPHABET.length)),
      ).join("");
      codeHmac = this.hmac(body);
      const claimed = await this.redis.set(
        `wa-link:code:${codeHmac}`,
        // הדור הוא מה שמאפשר לזהות אחר כך שהקוד קדם לניתוק
        JSON.stringify({ tenantId, userId, generation }),
        "EX",
        WHATSAPP_LINK_CODE_TTL_SECONDS,
        "NX",
      );
      if (claimed === "OK") break;
      /*
       * מרחב הקודים הוא 31⁶, וחיי הקוד רבע שעה — חמש התנגשויות
       * ברצף אינן מקריות אלא סימן לתקלה. עדיף להיכשל בגלוי מאשר
       * להנפיק קוד שאיננו יודעים של מי הוא.
       */
      if (attempt >= 4) {
        throw new ServiceUnavailableException("לא הצלחנו להפיק קוד חיבור — נסו שוב בעוד רגע");
      }
    }
    /*
     * **הסדר הוא מה שהופך „קוד אחד” לנכון גם במקביל.**
     *
     * הקוד נכתב תחילה, ורק אחריו מתחלף המצביע — ב-`GETSET`, שהוא
     * אטומי. שתי הנפקות מקבילות נחתכות שם: מי שהחליף אחרון רואה את
     * ה-HMAC של השנייה ומוחק אותה, ולכן בדיוק אחד שורד. הצורה
     * הקודמת (`GETDEL` ואז שתי כתיבות) יכלה להשאיר שניים תקפים —
     * שתיהן קראו „אין קודם” לפני שאיזו מהן כתבה (ביקורת Codex).
     */
    const previous = await this.redis.getset(`wa-link:user:${userId}`, codeHmac);
    // GETSET מאפס את התפוגה, ולכן היא נקבעת מחדש
    await this.redis.expire(`wa-link:user:${userId}`, WHATSAPP_LINK_CODE_TTL_SECONDS);
    if (previous !== null && previous !== codeHmac) {
      await this.redis.del(`wa-link:code:${previous}`);
    }
    return { code: formatWhatsappLinkCode(body), expiresInSeconds: WHATSAPP_LINK_CODE_TTL_SECONDS };
  }

  /**
   * ניסיון קישור מהודעה נכנסת.
   *
   * `null` = הקוד אינו תקף (פג, כבר נוצל, או שגוי). מונה הניסיונות
   * הוא **לפי מספר השולח** ולא לפי הקוד: תוקף שמנחש קודים היה מקבל
   * מונה חדש בכל ניחוש, כלומר תקרה שאינה תקרה.
   */
  async redeemCode(waId: string, text: string): Promise<ResolvedLink | null> {
    const body = normalizeWhatsappLinkCode(text);
    const digits = this.canonical(waId);
    if (body === null || digits === null) return null;

    const attemptsKey = `wa-link:attempts:${this.hmac(digits)}`;
    const attemptNo = await this.redis.incr(attemptsKey);
    if (attemptNo === 1) await this.redis.expire(attemptsKey, WHATSAPP_LINK_CODE_TTL_SECONDS);
    if (attemptNo > WHATSAPP_LINK_CODE_MAX_ATTEMPTS) return null;

    const codeHmac = this.hmac(body);
    const raw = await this.redis.get(`wa-link:code:${codeHmac}`);
    if (raw === null) return null;
    /*
     * השוואה בזמן קבוע גם כאן, למרות שהמפתח עצמו הוא ה-HMAC: אם
     * יום אחד המפתח ישתנה לצורה אחרת, ההשוואה כבר תהיה הנכונה.
     */
    if (!timingSafeEqual(Buffer.from(codeHmac), Buffer.from(this.hmac(body)))) return null;

    const claim = JSON.parse(raw) as { tenantId: string; userId: string; generation?: number };
    // קוד לשימוש אחד — נמחק לפני שהקישור נכתב, כדי ששני מכשירים
    // שישלחו אותו יחד לא ייצרו שני קישורים
    const consumed = await this.redis.del(`wa-link:code:${codeHmac}`);
    if (consumed === 0) return null;
    /*
     * **המצביע נמחק רק אם הוא עדיין מצביע על הקוד הזה.**
     *
     * מחיקה גורפת פתחה מחדש בדיוק את החלון ש-`GETSET` סגר: אם בין
     * מחיקת הקוד לכאן הונפק קוד חדש, המחיקה הייתה מוחקת את **המצביע
     * שלו**, וההנפקה הבאה הייתה רואה „אין קודם” — כלומר שני קודים
     * תקפים במקביל (ביקורת Codex). ההשוואה והמחיקה קורות יחד בצד
     * Redis, ולכן אין ביניהן רגע שבו מישהו יכול להיכנס.
     */
    await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1,
      `wa-link:user:${claim.userId}`,
      codeHmac,
    );
    await this.redis.del(attemptsKey);

    /*
     * הקוד נוצל — אבל ייתכן שבינתיים נותק החשבון. `bind` מכריע את
     * זה **בתוך הנעילה**, ולכן „נותק אחרי שהקוד הופק” מסתיים בסירוב
     * ולא בקישור חדש שנולד רגע אחרי „המכשיר נותק”.
     */
    const bound = await this.bind(
      digits,
      claim.tenantId,
      claim.userId,
      SOURCE_CODE,
      claim.generation,
    );
    if (!bound) return null;
    return { userId: claim.userId, tenantId: claim.tenantId };
  }

  /**
   * „כבר טיפלנו בהודעה הזו” — תפיסה לפי מזהה ההודעה של Meta.
   *
   * מסלול הקוד רץ **לפני** הזיהוי, ולכן התפיסה שבמסד (שדורשת משתמש
   * ומשרד) אינה זמינה לו. בלי תפיסה, שליחה חוזרת של Meta הייתה
   * מקבלת „הקוד אינו תקף” על קוד שהמשלוח הראשון בדיוק ניצל — שתי
   * תשובות סותרות לאותה הודעה (ביקורת Codex).
   */
  async claimInbound(externalId: string): Promise<boolean> {
    const claimed = await this.redis.set(
      `wa-link:msg:${this.hmac(externalId)}`,
      "1",
      "EX",
      INBOUND_CLAIM_SECONDS,
      "NX",
    );
    return claimed === "OK";
  }

  /* ------------------------------------------------------------------ */
  /*  הקישור עצמו                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * כתיבת הקישור — **מספר אחד, מכשיר אחד, חשבון אחד.**
   *
   * הניתוק שלפני הכתיבה הוא **דו-כיווני**, וזו הנקודה:
   *
   * - קישור קודם לאותו מספר — כדי שמספר אחד לא יפתח שני חשבונות.
   * - קישור קודם של אותו משתמש — כדי שמכשיר קודם לא יישאר תקף אחרי
   *   שהמתווך קישר מכשיר חדש. המסך מבטיח „המכשיר שמחובר”, ביחיד;
   *   בלי הצד הזה המכשיר הישן היה ממשיך לפתוח את המאגר בשקט
   *   (ביקורת Codex).
   *
   * הקישורים מנותקים ולא נדרסים: „הועבר לחשבון אחר” הוא מידע
   * שהמתווך הקודם צריך לראות במסך שלו.
   */
  private async bind(
    digits: string,
    tenantId: string,
    userId: string,
    source: string,
    generation?: number,
  ): Promise<boolean> {
    const waIdHash = this.crypto.phoneHash(digits);
    const write = async (): Promise<boolean> =>
      this.prisma.$transaction(async (tx) => {
        /*
         * **הנעילה היא מה שמסדר קישור מול ניתוק.**
         *
         * בלעדיה השניים יכולים לחצות זה את זה: הניתוק כותב את
         * הביטול ולא רואה קוד ממתין, והקישור — שכבר ניצל את הקוד —
         * מוסיף שורה חדשה רגע אחריו. התוצאה היא „המכשיר נותק” על
         * המסך ומכשיר מחובר במסד (ביקורת Codex). מרגע שהשניים
         * נכנסים בתור, אחד מהם רואה תמיד את מה שהשני עשה.
         */
        await this.lock(tx, userId);
        /*
         * וזה מה שהתור נותן: קוד שהופק **לפני** הניתוק כבר אינו
         * תקף, גם אם הניצול שלו התחיל קודם.
         */
        if (generation !== undefined && (await this.generation(userId)) !== generation) return false;
        /*
         * **וגם המצבה נבדקת כאן — בתוך הנעילה.**
         *
         * בדיקה מחוץ לה יכולה להתיישן בדיוק כשזה קובע: ההודעה
         * הראשונה מהמספר הישן קוראת „אין קישור קודם”, הניתוק מסתיים,
         * והצירוף — שכבר עבר את הבדיקה — כותב קישור פעיל למכשיר
         * שזה עתה נותק (ביקורת Codex). בתוך התור הקריאה תמיד רואה
         * את מה שהניתוק כתב.
         */
        if (source === SOURCE_PHONE) {
          /*
           * **והמספר עדיין שלו.**
           *
           * המצבה לבדה אינה מספיקה: חשבון שלא היה מקושר מעולם אינו
           * מותיר שורה כשמנתקים אותו, ולכן החלפת מספר על חשבון כזה
           * עוברת בלי להשאיר עקבות. הודעה ראשונה מהמספר הישן, שעברה
           * את הזיהוי רגע לפני ההחלפה, הייתה נקשרת אחריה (ביקורת
           * Codex). הקריאה כאן היא מהמסד ובתוך הנעילה — כלומר אחרי
           * ההחלפה, לא לפניה.
           */
          const phoneMatches = phoneDigitsCondition(digits);
          if (phoneMatches === null) return false;
          const [current] = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM users
             WHERE id = ${userId}
               AND is_active = TRUE
               AND phone IS NOT NULL
               AND ${phoneMatches}
             LIMIT 1`;
          if (current === undefined) return false;
          const previous = await tx.whatsAppLink.findFirst({
            where: { waIdHash },
            select: { id: true },
          });
          if (previous !== null) return false;
        }
        await tx.whatsAppLink.updateMany({
          where: { revokedAt: null, OR: [{ waIdHash }, { userId }] },
          data: { revokedAt: new Date(), revokedReason: "relinked" },
        });
        await tx.whatsAppLink.create({
          data: {
            id: ulid(),
            waIdHash,
            waIdEncrypted: this.crypto.encrypt(digits),
            tenantId,
            userId,
            source,
          },
        });
        return true;
      });
    try {
      return await write();
    } catch (error: unknown) {
      /*
       * **מה שהנעילה אינה מכסה — האינדקס מכסה.**
       *
       * הנעילה היא לפי חשבון, ולכן שני **משתמשים שונים** שקושרים את
       * אותו מספר בו-זמנית אינם נכנסים לאותו תור: שניהם מנתקים אפס
       * שורות ושניהם מוסיפים, והאינדקס החלקי על המספר הוא מה
       * שמכריע — אחד עובר, השני מקבל P2002. הניסיון השני כבר רואה
       * את השורה שנכתבה, מנתק אותה ומוסיף: „האחרון קובע”, שזו
       * התוצאה הנכונה גם ברצף (ביקורת Codex).
       *
       * ניסיון אחד בלבד: שני כשלים ברצף אינם מרוץ אלא תקלה אמיתית,
       * ולולאה כאן הייתה מסתירה אותה.
       */
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      return write();
    }
  }

  /** נעילה לפי חשבון — קישור וניתוק נכנסים בתור ולא חוצים זה את זה. */
  private async lock(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wa-link:${userId}`}))`;
  }

  /**
   * הדור הנוכחי של החשבון — **מונה, לא שעון.**
   *
   * כל ניתוק מקדם אותו, וקוד נושא את הדור שבו הופק. השוואה ביניהם
   * אומרת „האם נותק משהו מאז ההפקה” בלי להישען על שעה: שתי פעולות
   * שנעולות זו אחרי זו מקבלות ערכים שונים גם כשהן באותה מילישנייה,
   * ושעונים שאינם מסונכרנים בין תהליכים אינם יכולים להפוך את היחס.
   *
   * ב-Redis ולא במסד: ניתוק על חשבון שלא היה מקושר כלל אינו משאיר
   * שורה, ובדיוק המקרה הזה — „הפקתי קוד, התחרטתי וניתקתי” — הוא מה
   * שצריך להיחסם. מפתח חסר נקרא כדור 0, וזה נכון: לפני הניתוק
   * הראשון אין מה לחסום.
   */
  private async generation(userId: string): Promise<number> {
    const value = await this.redis.get(`wa-link:gen:${userId}`);
    return value === null ? 0 : Number(value);
  }

  /**
   * מי המספר הזה — או `null` כשאין קישור פעיל.
   *
   * זו השאילתה שרצה בכל הודעה נכנסת, ולכן היא אחת: חיפוש לפי HMAC
   * על אינדקס ייחודי. שני האימותים שאחריה נעשים על אותה שורה, בלי
   * לחזור למסד.
   */
  async resolve(waId: string): Promise<ResolvedLink | null> {
    const digits = this.canonical(waId);
    if (digits === null) return null;
    const link = await this.prisma.whatsAppLink.findFirst({
      where: { waIdHash: this.crypto.phoneHash(digits), revokedAt: null },
      select: { id: true, userId: true, tenantId: true, verifiedAt: true },
    });
    if (link === null) return null;

    /*
     * **הקישור פג מעצמו.** מכשיר אבוד או מספר שהוחלף אינם מודיעים
     * לנו, ושימוש שוטף אינו ראיה — הוא בדיוק מה שגם הגנב עושה.
     */
    if (linkNeedsReverification(link.verifiedAt, new Date())) {
      await this.revokeById(link.id, "expired");
      return null;
    }
    // חותמת שימוש, ולא אימות: היא נועדה למסך („נראה לאחרונה”) בלבד
    await this.prisma.whatsAppLink.update({
      where: { id: link.id },
      data: { lastSeenAt: new Date() },
    });
    return { userId: link.userId, tenantId: link.tenantId };
  }

  /**
   * קישור מהשוואת מספר — **רק פעם ראשונה, ורק כשהתשובה חד-משמעית.**
   *
   * זו הדרך שבה משתמש קיים ממשיך לעבוד בלי לעצור: המספר שלו כבר
   * רשום במערכת, ההודעה הראשונה שלו יוצרת את הקישור, ומכאן היא
   * הזהות. מה שהשתנה הוא שריבוי אינו מוכרע יותר: שני משתמשים עם
   * אותו מספר מקבלים בקשה לקוד, ולא ניחוש שקט.
   *
   * **מצבה עוצרת את ההשוואה.** ניתוק, תפוגה והחלפת מספר כולם מותירים
   * שורה מנותקת על אותו hash. בלי הבדיקה הזאת ההודעה הבאה הייתה
   * משווה שוב מול שדה `phone` — שלא השתנה — ובונה את הקישור מחדש,
   * כלומר מבטלת בשקט גם את הניתוק וגם את חובת האימות מחדש (ביקורת
   * Codex). מרגע שהיה כאן קישור, החזרה אליו היא בקוד בלבד.
   *
   * מחזירה `false` כשהצירוף נדחה — הקורא צריך לדעת שהמספר מוכר אך
   * אינו מקושר, כדי לומר זאת ולא לענות מענה שיווקי.
   */
  async bindByPhone(waId: string, tenantId: string, userId: string): Promise<boolean> {
    const digits = this.canonical(waId);
    if (digits === null) return false;
    /*
     * המצבה נבדקת בתוך `bind`, תחת הנעילה: כל שורה שנמצאת שם היא
     * מצבה (`resolve` כבר החזיר `null`, ולכן אין קישור פעיל), וגם
     * „הועבר לחשבון אחר” נכלל — מספר שהועבר במפורש אינו חוזר
     * לבעליו הקודם בהשוואת ספרות.
     */
    return this.bind(digits, tenantId, userId, SOURCE_PHONE);
  }

  /**
   * „כבר אמרנו לו היום” — תקרה על הודעת „המכשיר אינו מחובר”.
   *
   * מחזירה `true` פעם אחת ביממה לכל מספר. ההודעה יוצאת למספר שאינו
   * מזוהה, ולכן חזרה עליה בכל הודעה הייתה ספאם — ובדרך גם פגיעה
   * בדירוג האיכות של המספר אצל Meta.
   */
  async claimUnlinkedHint(waId: string): Promise<boolean> {
    const digits = this.canonical(waId);
    if (digits === null) return false;
    const claimed = await this.redis.set(
      `wa-link:hint:${this.hmac(digits)}`,
      "1",
      "EX",
      UNLINKED_HINT_COOLDOWN_SECONDS,
      "NX",
    );
    return claimed === "OK";
  }

  /* ------------------------------------------------------------------ */
  /*  המסך                                                               */
  /* ------------------------------------------------------------------ */

  /** מה שמסך ההגדרות מציג. המספר עצמו אינו חוזר — רק זנב. */
  async status(userId: string): Promise<LinkStatus> {
    const link = await this.prisma.whatsAppLink.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { linkedAt: "desc" },
      select: {
        waIdEncrypted: true,
        source: true,
        linkedAt: true,
        verifiedAt: true,
        lastSeenAt: true,
      },
    });
    if (link === null) return { linked: false };
    const digits = this.crypto.decrypt(link.waIdEncrypted);
    return {
      linked: true,
      tail: digits.slice(-4),
      linkedAt: link.linkedAt,
      verifiedAt: link.verifiedAt,
      ...(link.lastSeenAt === null ? {} : { lastSeenAt: link.lastSeenAt }),
      ...(link.source === SOURCE_PHONE ? { implicit: true } : {}),
      ...(linkNeedsReverification(link.verifiedAt, new Date())
        ? { needsReverification: true }
        : {}),
    };
  }

  /**
   * ניתוק יזום מהמסך.
   *
   * `tx` קיים כדי שהניתוק יוכל להיות **חלק מהעסקה שגרמה לו**: החלפת
   * מספר טלפון מנתקת את הקישור, ואם רק אחד מהשניים נכתב נוצר בדיוק
   * המצב שהניתוק נועד למנוע — מספר חדש בפרופיל וקישור פעיל למספר
   * הישן, שניסיון חוזר כבר לא יזהה כשינוי (ביקורת Codex).
   */
  async revoke(
    userId: string,
    reason: LinkRevokeReason = "user",
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    /*
     * בלי `tx` נפתחת עסקה משלנו — לא לשם הכתיבה היחידה שיש כאן,
     * אלא בשביל הנעילה: `pg_advisory_xact_lock` חי בתוך עסקה, וזה
     * מה שמכניס את הניתוק ואת הקישור לאותו תור.
     */
    if (tx === undefined) {
      await this.prisma.$transaction((t) => this.revokeWithin(t, userId, reason));
      return;
    }
    await this.revokeWithin(tx, userId, reason);
  }

  private async revokeWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: LinkRevokeReason,
  ): Promise<void> {
    await this.lock(tx, userId);
    /*
     * **הדור מקודם בתוך הנעילה, לפני הכתיבה במסד.**
     *
     * זה מה שאומר לניצול קוד שהתחיל קודם: „הקוד הזה קדם לניתוק”.
     * בלעדיו הניצול היה יכול לכתוב קישור חדש מיד אחרי שהניתוק
     * הסתיים — כלומר „המכשיר נותק” על המסך ומכשיר מחובר במסד
     * (ביקורת Codex).
     *
     * תפוגה ארוכה בהרבה מחיי הקוד, ומתחדשת בכל ניתוק: מונה שפג בין
     * ההפקה לניצול היה נקרא כדור 0 ופוסל קוד תקין.
     */
    await this.redis.incr(`wa-link:gen:${userId}`);
    await this.redis.expire(`wa-link:gen:${userId}`, GENERATION_TTL_SECONDS);
    /*
     * **וגם הקוד שממתין נשרף.**
     *
     * מי שהפיק קוד ואז לחץ „נתק” השאיר מאחוריו מפתח חי לרבע שעה: כל
     * מי שהקוד הגיע לידיו יכול היה לשלוח אותו ולהחזיר את הקישור,
     * בעוד המסך כבר אומר „המכשיר נותק” (ביקורת Codex). אותו הדבר
     * בהחלפת מספר — הקוד הופק מול הזהות הקודמת.
     */
    const pending = await this.redis.getdel(`wa-link:user:${userId}`);
    if (pending !== null) await this.redis.del(`wa-link:code:${pending}`);
    const { count } = await tx.whatsAppLink.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (count > 0) this.logger.log(`קישור וואטסאפ נותק (${reason}) למשתמש ${userId}`);
  }

  private async revokeById(id: string, reason: LinkRevokeReason): Promise<void> {
    await this.prisma.whatsAppLink.update({
      where: { id },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
