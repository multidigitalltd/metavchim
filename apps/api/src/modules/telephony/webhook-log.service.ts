import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { diagnosticFields } from "@metavchim/shared";
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

@Injectable()
export class TelephonyWebhookLogService {
  private readonly logger = new Logger(TelephonyWebhookLogService.name);

  constructor(private readonly prisma: PrismaService) {}

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
  private static readonly KEEP = 200;

  /** כל כמה כתיבות רץ הגיזום — ראו `record`. */
  private static readonly PRUNE_EVERY = 25;

  private writes = 0;

  async record(input: {
    outcome: "accepted" | "unknown_key" | "disabled" | "no_feature";
    tenantId: string | null;
    key: string;
    method: "GET" | "POST";
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.telephonyWebhookHit.create({
        data: {
          id: ulid(),
          outcome: input.outcome,
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
  async recent(limit: number): Promise<
    {
      id: string;
      receivedAt: Date;
      outcome: string;
      tenantId: string | null;
      keyPrefix: string;
      method: string;
      fieldKeys: string | null;
    }[]
  > {
    return this.prisma.telephonyWebhookHit.findMany({
      orderBy: { receivedAt: "desc" },
      take: limit,
    });
  }

  /** מחיקת מה שמעבר ל-KEEP האחרונות. */
  private async prune(): Promise<void> {
    /*
     * מחיקה לפי חותמת זמן ולא לפי `skip`: Prisma אינו תומך ב-skip
     * ב-deleteMany, ושליפת המזהים כדי למחוק לפיהם היא שתי פניות
     * במקום אחת. הסף הוא הזמן של השורה ה-KEEP.
     */
    const cutoff = await this.prisma.telephonyWebhookHit.findMany({
      orderBy: { receivedAt: "desc" },
      skip: TelephonyWebhookLogService.KEEP - 1,
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
