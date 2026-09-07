import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { diagnosticFields, normalizePhone, unmappedFields } from "@metavchim/shared";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * יומן הפניות לנתיב הוובהוק של המרכזייה.
 *
 * ## למה הוא קיים
 *
 * פנייה עם מפתח שאינו מוכר, מפתח מנוטרל או משרד שאין במסלולו
 * מרכזייה מקבלת 404 ו**אינה מותירה שום עקבה**. מסך האבחון של המשרד
 * מציג "לא התקבל אף אירוע" — אותו טקסט בדיוק שמקבלת מרכזייה
 * שמעולם לא פנתה.
 *
 * שני המצבים דורשים פעולה הפוכה לגמרי: כתובת שגויה שצריך לתקן אצל
 * הספק, מול מפתח ישן או מסלול חסר שצריך לתקן אצלנו. בלי ההבחנה אין
 * שום דרך לדעת במה מדובר, וזה בדיוק המצב שבו נתקע מי שמנסה לחבר
 * מרכזייה ורואה מסך ריק.
 *
 * ## הכתיבה לעולם אינה מפילה את הקליטה
 *
 * זה יומן אבחון, לא נתון עסקי. כשל בכתיבה נבלע ונרשם ללוג: אירוע
 * שיחה אמיתי שאבד כי שורת יומן לא נכתבה הוא מחיר שאין שום סיבה
 * לשלם.
 */
/**
 * קידומת המפתח כפי שהיא נשמרת ביומן.
 *
 * שישה תווים בלבד: מספיק כדי להשוות למפתח שבמסך ההגדרות ולראות
 * שהספק מחזיק מפתח ישן — וקצר מכדי לשמש למי שקורא את הטבלה כדי
 * לזייף אירועים. מפתח מלא ביומן הוא סוד שנשמר בטקסט גלוי.
 *
 * הסינון לתווים בטוחים אינו קישוט: מאז שהוולידציה עברה לשירות,
 * לכאן מגיע גם מפתח משובש לגמרי — בדיוק המקרה המעניין — וערך
 * שרירותי מהכתובת אינו מה שרוצים לכתוב לעמודה שנקראת בעיניים.
 */
function keyPrefix(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/gu, "·").slice(0, 6);
  return cleaned === "" ? "‹ריק›" : cleaned;
}

/**
 * מה קרה לפנייה.
 *
 * `failed` הוא התוצאה הרביעית, ולא סוג של „נקלטה”: המפתח היה תקין,
 * האירוע הובן — והעיבוד אצלנו נפל. המרכזייה תשלח שוב, ומי שקורא את
 * היומן צריך לדעת שהתקלה בצד שלנו ולא אצל הספק (ביקורת Codex).
 */
export type TelephonyWebhookOutcome =
  | "accepted"
  | "preliminary"
  | "unparsed"
  | "failed"
  | "unknown_key"
  | "disabled"
  | "no_feature";

@Injectable()
export class TelephonyWebhookLogService {
  private readonly logger = new Logger(TelephonyWebhookLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    /*
     * ‏אותה חתימה שכל זיהוי נכנס כבר עובד מולה. חיפוש ביומן לפי
     * ‏מספר חייב לתת בדיוק את אותה תשובה כמו חיפוש איש קשר, ולכן
     * ‏הוא עובר דרך אותה פונקציה ולא דרך גיבוב משלו.
     */
    private readonly crypto: CryptoService,
  ) {}

  /**
   * כמה שורות נשמרות.
   *
   * **הנתיב ציבורי, ולכן חסם הוא חובה ולא ניקיון.** בלי גיזום כל מי
   * שיודע את הכתובת יכול להזרים לתוך הטבלה עד שהדיסק יימלא — והוא
   * גם נדחה ב-404 וגם משאיר שורה, כלומר דווקא הפנייה חסרת ההרשאה
   * היא שכותבת.
   *
   * מאתיים מספיקות בשפע: היומן משמש לחיבור ראשוני ולאבחון תקלה,
   * ובשני המקרים מסתכלים על מה שקרה בדקות האחרונות.
   */
  /**
   * ‎**חלון זמן, ולא מאתיים שורות.**
   *
   * ‏מאתיים שורות לכל הפלטפורמה הן היסטוריה של דקות על מערכת
   * ‏פעילה: מי שנכנס לברר למה שיחה לא נקלטה מצא שהשורה כבר נגרסה,
   * ‏ובדיוק בשביל הרגע הזה היומן קיים. יומן שאי אפשר לחזור אליו
   * ‏אינו יומן.
   *
   * ‏תשעים יום ולא שבועיים: תלונה על שיחה שלא נקלטה מגיעה שבועות
   * ‏אחרי המקרה — „בחודש שעבר התקשר לקוח ולא חזרנו אליו” — ויומן
   * ‏שנגמר לפני שהשאלה נשאלת אינו עונה עליה. השורה קטנה
   * ‏(שמות שדות וחתימות, בלי מטען), ולכן רבעון אינו יקר.
   */
  private static readonly KEEP_MS = 90 * 24 * 60 * 60 * 1000;

  /**
   * ‎**ותקרה, כרשת ביטחון בלבד.**
   *
   * ‏ספק שנכנס ללולאה יכול לשלוח עשרות אלפי פניות בשעה. החלון
   * ‏לבדו היה נותן להן למלא את הדיסק; התקרה עוצרת את זה בלי לקצר
   * ‏את הזיכרון של יום רגיל.
   *
   * ‏מאתיים אלף: פי עשרה מהמספר הקודם, כדי שהתקרה לא תבטל בשקט את
   * ‏חלון התשעים הימים על פלטפורמה עמוסה. תקרה שנוגסת בחלון היא
   * ‏בדיוק המצב שבו „שומרים תשעים יום” הופך להבטחה לא נכונה.
   */
  private static readonly KEEP_MAX = 200_000;

  /** כל כמה כתיבות רץ הגיזום — ראו `record`. */
  private static readonly PRUNE_EVERY = 25;

  /**
   * ‎**וכל כמה כתיבות נבדקת התקרה — לעיתים רחוקות בהרבה.**
   *
   * ‏בדיקת התקרה מדלגת ‎KEEP_MAX‎ שורות באינדקס כדי למצוא את הסף,
   * ‏ומאז שהתקרה עלתה למאתיים אלף זו סריקה שאין שום סיבה להריץ
   * ‏באמצע נתיב הקליטה כל עשרים וחמש פניות: היא הייתה מוסיפה
   * ‏השהיה לתשובה שהמרכזייה ממתינה לה, בשביל רשת ביטחון שנוגעת
   * ‏למצב חריג בלבד.
   *
   * ‏חמש מאות כתיבות של חריגה מעל תקרה של מאתיים אלף הן רבע
   * ‏אחוז — כלומר התקרה נשמרת באותה מידה בדיוק.
   */
  private static readonly CEILING_EVERY = 500;

  private writes = 0;

  /**
   * התוצאה כפי שהיא נראית ביומן.
   *
   * ## למה `unparsed` הוא ערך בפני עצמו
   *
   * „התקבלה” נרשמה עד כה על **ההגעה** — מפתח תקין, חיבור פעיל,
   * מודול במסלול — ולא על מה שקרה אחר כך. אירוע שנזרק שנייה לאחר
   * מכן מפני שלא היה בו מספר טלפון נראה ביומן זהה לאירוע שהפך
   * לשיחה, וזו בדיוק השאלה שמחפשים ביומן כשלקוח התקשר ואין רישום.
   *
   * מי שקורא את היומן צריך לדעת שני דברים נפרדים: האם הפנייה הגיעה
   * אלינו, והאם הפכה לשיחה. עמודה אחת שעונה רק על הראשון שולחת
   * לחפש את התקלה במקום הלא נכון.
   *
   * ## ולמה `preliminary` הוא ערך שלישי
   *
   * אירוע צלצול נקרא בהצלחה ובכל זאת **אינו** יוצר שורת שיחה —
   * `callAction` קובעת זאת בכוונה, כי השיחה עוד לא קרתה. סימונו
   * כ„נקלטה” היה מציג מרכזייה ששולחת `Calling` ומאבדת את ה-`Hangup`
   * כתקינה, בזמן שאף שיחה אינה נרשמת אצלה (ביקורת Codex).
   */
  async record(input: {
    outcome: TelephonyWebhookOutcome;
    /** מדוע לא נותח — רק כש-`outcome` הוא `unparsed`. */
    issue?: string | null;
    tenantId: string | null;
    key: string;
    method: "GET" | "POST";
    payload: Record<string, unknown>;
    /**
     * ‎**האירוע שנותח — מה שהופך שורה ליומן שאפשר לעקוב אחריו.**
     *
     * ‏בלעדיו „נקלטה” אמר שהאירוע הפך לשיחה ולא **לאיזו**, ו„סוג
     * ‏האירוע” — שהוא כל ההבדל בין „מרכזייה ששולחת Calling
     * ‏ומאבדת את ה-Hangup” לבין מרכזייה תקינה — לא נשמר כלל.
     *
     * ‎`undefined` כשהאירוע לא נותח, וזו בדיוק השורה שבה שלושת
     * ‏השדות ריקים.
     */
    event?:
      | {
          type: string;
          direction: string;
          providerCallId: string;
          /**
           * ‎**מספר המתקשר — נכנס, ואינו נשמר.**
           *
           * ‏הוא מגיע לכאן כדי שייחתם ותישמר סיומת בת ארבע ספרות,
           * ‏ולא כדי להיכתב. ראו `peerHash`: „לקוח התקשר ואין
           * ‏רישום” היא השאלה שבשבילה היומן קיים, והמספר הוא הנתון
           * ‏היחיד שיש למי ששואל אותה.
           */
          peerPhone: string;
        }
      | undefined;
  }): Promise<void> {
    try {
      await this.prisma.telephonyWebhookHit.create({
        data: {
          id: ulid(),
          outcome: input.outcome,
          issue: input.issue ?? null,
          tenantId: input.tenantId,
          /*
           * קידומת בלבד. מפתח מלא ביומן הוא סוד שנשמר בטקסט גלוי,
           * ומי שיקרא את הטבלה יוכל לזייף אירועים בשם המשרד. שש
           * תווים מספיקים כדי להשוות למפתח שבמסך ההגדרות ולראות
           * שהספק מחזיק מפתח ישן — וזו כל השאלה שהיומן עונה עליה.
           */
          keyPrefix: keyPrefix(input.key),
          method: input.method,
          fieldKeys: diagnosticFields(input.payload),
          /*
           * מה שהספק שלח ואיננו צורכים. שמות בלבד — הערך של שדה
           * שלא זיהינו יכול להיות כל דבר, כולל פרט מזהה של לקוח.
           */
          unmapped: unmappedFields(input.payload).join(", ").slice(0, 500) || null,
          /*
           * ‏שלושת השדות של האירוע — לא PII: סוג, כיוון, ומזהה
           * ‏השיחה **אצל הספק**. מספר המתקשר אינו כאן, כמו קודם.
           */
          callId: input.event?.providerCallId.slice(0, 120) ?? null,
          action: input.event?.type ?? null,
          direction: input.event?.direction ?? null,
          /*
           * ‏חתימה וארבע ספרות — ולא המספר. אותה חתימת HMAC שכל
           * ‏זיהוי נכנס עובד מולה, ולכן חיפוש כאן נותן בדיוק את
           * ‏אותה תשובה כמו חיפוש איש קשר, בלי שיומן הפלטפורמה
           * ‏יהפוך למאגר מספרים גלוי של כל המשרדים.
           */
          peerHash:
            input.event === undefined ? null : this.crypto.phoneHash(input.event.peerPhone),
          peerSuffix: input.event === undefined ? null : input.event.peerPhone.slice(-4),
        },
      });
      /*
       * גיזום מדי כמה כתיבות ולא בכל אחת: DELETE בכל פנייה מכפיל
       * את עלות הנתיב בלי להוסיף דבר, והחריגה מהחסם בין גיזום
       * לגיזום היא עשרות שורות.
       */
      this.writes += 1;
      if (this.writes % TelephonyWebhookLogService.PRUNE_EVERY === 0) await this.prune();
    } catch (error) {
      // יומן אבחון לא מפיל קליטת שיחה
      this.logger.warn(`כתיבת יומן וובהוק נכשלה: ${String(error)}`);
    }
  }

  /**
   * השורות האחרונות — לבעל הפלטפורמה.
   *
   * `keyPrefix` מוחזר כפי שנשמר; הוא לא מזהה משרד בעצמו, והוא הדבר
   * היחיד שמאפשר לזהות ספק שמחזיק מפתח ישן.
   */
  async recent(
    limit: number,
    /**
     * ‎**סינון — מה שהופך „עשרים האחרונות” למשהו שאפשר לחקור בו.**
     *
     * ‏בלי זה כל שאלה („מה קרה אצל המשרד הזה”, „הראה לי רק את מה
     * ‏שלא נותח”, „מה היה אתמול”) נענתה בגלילה ידנית של רשימה
     * ‏מעורבת מכל המשרדים. שדה ריק = בלי הגבלה, ולכן ההתנהגות בלי
     * ‏סינון זהה לקודם.
     */
    filter: {
      outcome?: string | undefined;
      tenantId?: string | undefined;
      /** ‏האירועים של שיחה אחת — שלוש שורות, סיפור אחד. */
      callId?: string | undefined;
      /**
       * ‎**„מה קרה כשהמספר הזה התקשר” — החיפוש שאין לו תחליף.**
       *
       * ‏מי שבודק תלונה יודע מספר טלפון, לא מזהה שיחה ולא שעה
       * ‏מדויקת. הערך מנורמל ונחתם כאן באותה חתימה שנשמרה, ולכן
       * ‏הכתיב שהוקלד (‎050-123-4567‎ / ‎+972501234567‎) אינו משנה.
       */
      peerPhone?: string | undefined;
      since?: Date | undefined;
    } = {},
  ): Promise<
    {
      id: string;
      receivedAt: Date;
      outcome: string;
      issue: string | null;
      tenantId: string | null;
      keyPrefix: string;
      method: string;
      fieldKeys: string | null;
      unmapped: string | null;
      callId: string | null;
      action: string | null;
      direction: string | null;
      peerSuffix: string | null;
    }[]
  > {
    return this.prisma.telephonyWebhookHit.findMany({
      where: {
        ...(filter.outcome === undefined ? {} : { outcome: filter.outcome }),
        ...(filter.tenantId === undefined ? {} : { tenantId: filter.tenantId }),
        ...(filter.callId === undefined ? {} : { callId: filter.callId }),
        /*
         * ‏חתימה מול חתימה. אין כאן חיפוש חלקי בכוונה: התאמה
         * ‏חלקית מחייבת לשמור את המספר עצמו, וזה בדיוק מה שהעמודה
         * ‏הזו נמנעת ממנו.
         */
        ...(filter.peerPhone === undefined
          ? {}
          : { peerHash: this.crypto.phoneHash(normalizePhone(filter.peerPhone)) }),
        ...(filter.since === undefined ? {} : { receivedAt: { gte: filter.since } }),
      },
      /*
       * ‏העמודות במפורש ולא כל השורה: `peerHash` הוא חתימה של PII
       * ‏ואין לו שום שימוש במסך. שליפה מלאה הייתה מוציאה אותו
       * ‏לרשת בכל טעינה בלי שאיש ביקש זאת.
       */
      select: {
        id: true,
        receivedAt: true,
        outcome: true,
        issue: true,
        tenantId: true,
        keyPrefix: true,
        method: true,
        fieldKeys: true,
        unmapped: true,
        callId: true,
        action: true,
        direction: true,
        peerSuffix: true,
      },
      orderBy: { receivedAt: "desc" },
      take: limit,
    });
  }

  /**
   * ‎**ריקון יזום — מה שהופך את היומן לכלי עבודה.**
   *
   * ‏הגיזום האוטומטי שומר על החסם, אבל אינו עונה על שני הצרכים
   * ‏שיש למי שיושב מול המסך: „נקה את הרעש לפני שאני עושה שיחת
   * ‏בדיקה”, ו„הישן כבר לא רלוונטי, אני לא רוצה לגלול דרכו”.
   * ‏בלי כפתור, שניהם דרשו גישה למסד.
   *
   * ‎`olderThanMs === 0` מוחק הכול — וזו דווקא הדרישה השכיחה
   * ‏(לרוקן, לחייג, ולראות שורה אחת). האישור על כך יושב במסך;
   * ‏כאן זו פעולה ככל פעולה.
   */
  async purge(olderThanMs: number): Promise<number> {
    const { count } = await this.prisma.telephonyWebhookHit.deleteMany({
      where:
        olderThanMs === 0 ? {} : { receivedAt: { lt: new Date(Date.now() - olderThanMs) } },
    });
    return count;
  }

  /**
   * ‎**כמה הגיעו ומה עלה בגורלן — לפני שמסתכלים בשורות.**
   *
   * ‏„קשה לעקוב” מתחיל בכך שאין תמונה: אלף שורות אינן אומרות אם
   * ‏המצב תקין. שורת סיכום אחת עונה על השאלה הראשונה — האם יש
   * ‏פניות בכלל, וכמה מהן הפכו לשיחות — ורק אם משהו חריג שם יש
   * ‏טעם לרדת לשורות.
   */
  async summary(since: Date): Promise<{ outcome: string; count: number }[]> {
    const rows = await this.prisma.telephonyWebhookHit.groupBy({
      by: ["outcome"],
      where: { receivedAt: { gte: since } },
      _count: { _all: true },
    });
    return rows
      .map((row) => ({ outcome: row.outcome, count: row._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * ‎**המשרדים שיש להם שורות ביומן — לרשימת הסינון.**
   *
   * ‏נגזר מכל מה ששמור ולא מהעמוד שמוצג: הרשימה נבנתה קודם
   * ‏מהשורות שחזרו, ולכן משרד ששיחותיו ישנות מהמאתיים האחרונות
   * ‏כלל לא הופיע בה — ולא הייתה שום דרך אחרת לבחור אותו. כלומר
   * ‏חיפוש התשעים יום היה חסום בדיוק על החיבורים השקטים, שהם
   * ‏הסיבה העיקרית להיכנס ליומן מלכתחילה (ביקורת Codex).
   */
  async offices(): Promise<string[]> {
    const rows = await this.prisma.telephonyWebhookHit.groupBy({
      by: ["tenantId"],
      where: { tenantId: { not: null } },
    });
    return rows.map((row) => row.tenantId).filter((id): id is string => id !== null);
  }

  /** ‏מחיקת מה שמחוץ לחלון, ומה שמעבר לתקרה. */
  private async prune(): Promise<void> {
    await this.prisma.telephonyWebhookHit.deleteMany({
      where: {
        receivedAt: { lt: new Date(Date.now() - TelephonyWebhookLogService.KEEP_MS) },
      },
    });
    /* ‏התקרה אינה חלק מהגיזום הרגיל — ראו `CEILING_EVERY` */
    if (this.writes % TelephonyWebhookLogService.CEILING_EVERY !== 0) return;
    /*
     * מחיקה לפי חותמת זמן ולא לפי `skip`: Prisma אינו תומך ב-skip
     * ב-deleteMany, ושליפת המזהים כדי למחוק לפיהם היא שתי פניות
     * במקום אחת. הסף הוא הזמן של השורה ה-KEEP.
     */
    const cutoff = await this.prisma.telephonyWebhookHit.findMany({
      orderBy: { receivedAt: "desc" },
      skip: TelephonyWebhookLogService.KEEP_MAX - 1,
      take: 1,
      select: { receivedAt: true },
    });
    const oldest = cutoff[0]?.receivedAt;
    if (oldest === undefined) return;
    await this.prisma.telephonyWebhookHit.deleteMany({
      where: { receivedAt: { lt: oldest } },
    });
  }
}
