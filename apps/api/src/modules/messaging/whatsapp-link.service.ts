import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
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
    const body = Array.from({ length: WHATSAPP_LINK_CODE_LENGTH }, () =>
      WHATSAPP_LINK_CODE_ALPHABET.charAt(randomInt(0, WHATSAPP_LINK_CODE_ALPHABET.length)),
    ).join("");
    /*
     * המפתח הוא **הקוד**, לא המשתמש: ההודעה בוואטסאפ מגיעה בלי שום
     * הקשר מלבד הקוד עצמו, ולכן זה הצד שצריך להיות ניתן לחיפוש.
     * מפתח שני לפי משתמש קיים רק כדי למחוק קוד קודם.
     */
    const previous = await this.redis.getdel(`wa-link:user:${userId}`);
    if (previous !== null) await this.redis.del(`wa-link:code:${previous}`);
    const codeHmac = this.hmac(body);
    await this.redis.set(
      `wa-link:code:${codeHmac}`,
      JSON.stringify({ tenantId, userId }),
      "EX",
      WHATSAPP_LINK_CODE_TTL_SECONDS,
    );
    await this.redis.set(`wa-link:user:${userId}`, codeHmac, "EX", WHATSAPP_LINK_CODE_TTL_SECONDS);
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

    const claim = JSON.parse(raw) as { tenantId: string; userId: string };
    // קוד לשימוש אחד — נמחק לפני שהקישור נכתב, כדי ששני מכשירים
    // שישלחו אותו יחד לא ייצרו שני קישורים
    const consumed = await this.redis.del(`wa-link:code:${codeHmac}`);
    if (consumed === 0) return null;
    await this.redis.del(`wa-link:user:${claim.userId}`, attemptsKey);

    await this.bind(digits, claim.tenantId, claim.userId, SOURCE_CODE);
    return { userId: claim.userId, tenantId: claim.tenantId };
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
  private async bind(digits: string, tenantId: string, userId: string, source: string): Promise<void> {
    const waIdHash = this.crypto.phoneHash(digits);
    await this.prisma.$transaction(async (tx) => {
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
    });
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
     * כל שורה שנמצאת כאן היא מצבה: `resolve` כבר החזיר `null`, ולכן
     * אין למספר הזה קישור פעיל. גם „הועבר לחשבון אחר” נכלל — מספר
     * שהועבר במפורש אינו חוזר לבעליו הקודם בהשוואת ספרות.
     */
    const previous = await this.prisma.whatsAppLink.findFirst({
      where: { waIdHash: this.crypto.phoneHash(digits) },
      select: { id: true },
    });
    if (previous !== null) return false;
    await this.bind(digits, tenantId, userId, SOURCE_PHONE);
    return true;
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
    const db = tx ?? this.prisma;
    const { count } = await db.whatsAppLink.updateMany({
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
