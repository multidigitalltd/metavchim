import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { PrismaService } from "../../core/prisma.service";
import { WhatsAppConnectionService, type ExpiredLine } from "./whatsapp-connection.service";
import { Sweep } from "../../core/sweeps";

/**
 * כל שש שעות. הטוקן חי 60 יום והרענון מתחיל שבועיים לפני הסוף,
 * כלומר תדירות גבוהה יותר לא הייתה קונה דבר — ונמוכה יותר הייתה
 * מצמצמת את מספר הניסיונות החוזרים שיש לתקלה זמנית.
 */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** דקה וחצי אחרי העלייה — אחרי המיגרציות, כמו שאר הסורקים. */
const FIRST_SWEEP_DELAY_MS = 90 * 1000;

/**
 * ‎**הארכת הטוקנים העסקיים של קווי המתווכים.**
 *
 * ## הכשל שהסורק הזה קיים בשבילו
 *
 * תצורת ה-Embedded Signup שמטא מאפשרת ליצור היום מנפיקה טוקן קצוב
 * (60 יום). טוקן שפג אינו מודיע על עצמו בשום ערוץ: Meta אינה
 * שולחת `account_update`, הוובהוק אינו נכשל בקול, והשורה בבסיס
 * הנתונים ממשיכה לומר `connected`. מה שהמתווך רואה הוא ✓ ירוק
 * ומסך שקט — ומה שקורה בפועל הוא שלידים מפסיקים להיכנס. הוא יגלה
 * את זה מלקוח שמתלונן שלא חזרו אליו, שבועות אחרי.
 *
 * ## למה סורק ולא רענון בזמן שימוש
 *
 * "נרענן כשהשליחה תיכשל" מטפל רק בקווים ש**שולחים**. עיקר הערך
 * של החיבור הוא נכנס — ליד שכותב למתווך — ובנתיב הזה הטוקן שלנו
 * אינו בשימוש כלל, כך שכשל הטוקן לא היה מתגלה עד השליחה הבאה, אם
 * תהיה. הסורק אינו תלוי בתעבורה.
 *
 * ## למה ב-API ולא ב-Workers
 *
 * אותו נימוק כמו `EmailDomainRecheckService`: הטוקן מוצפן ב-DB
 * ונקרא דרך `CryptoService`, ופתיחת מסלול פענוח שני בתהליך אחר
 * יקרה מהרווח. הסבב זול — קריאת Graph אחת לכל קו שמתקרב לתפוגה,
 * ורוב הסבבים אינם מוצאים אף אחד.
 */
@Injectable()
export class WhatsAppTokenRefreshService {
  private readonly logger = new Logger(WhatsAppTokenRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: WhatsAppConnectionService,
  ) {}

  @Sweep({
    name: "whatsapp-token-refresh",
    everyMs: SWEEP_INTERVAL_MS,
    firstDelayMs: FIRST_SWEEP_DELAY_MS,
  })
  private async tick(): Promise<void> {
    try {
      await this.sweep();
    } catch (error: unknown) {
      this.logger.error(`סבב רענון טוקני וואטסאפ נכשל: ${String(error)}`);
    }
  }

  /** סבב אחד. ציבורי כדי שבדיקה תוכל להריץ אותו בלי לחכות שש שעות. */
  async sweep(): Promise<{ refreshed: number; expired: number }> {
    const { refreshed, expired } = await this.connections.sweepExpiringTokens();
    for (const line of expired) await this.notify(line);
    if (refreshed > 0 || expired.length > 0) {
      this.logger.log(`רענון טוקני וואטסאפ: ${refreshed} הוארכו, ${expired.length} פגו`);
    }
    return { refreshed, expired: expired.length };
  }

  /**
   * ההתראה נשלחת ל**סוכן שהקו שלו** — הוא היחיד שיכול לעבור שוב
   * את Embedded Signup עם המספר שלו. בלי `entityType`: הלחיצה
   * נוחתת במסך ההתראות, שבו גוף ההתראה מוצג במלואו, ולא בנתיב
   * שהסוכן אינו בהכרח רשאי לראות.
   *
   * כישלון ההתראה אינו מבטל את הסימון: הקו כבר מסומן `error`,
   * והמסך יראה זאת גם בלי הפעמון.
   */
  private async notify(line: ExpiredLine): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${line.tenantId}, true)`;
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: line.tenantId,
            userId: line.userId,
            type: "whatsapp_token_expired",
            title: "החיבור של הוואטסאפ שלך פג",
            body:
              `ההרשאה שנתת ל-metavchim על המספר ${line.displayPhone} פגה, ומרגע זה לידים ` +
              "מהוואטסאפ אינם נכנסים למערכת. בהגדרות ← וואטסאפ ביזנס אפשר לחבר מחדש " +
              "בלחיצה אחת. השיחות עצמן ממשיכות לעבוד בטלפון כרגיל.",
          },
        });
      });
    } catch (error: unknown) {
      this.logger.warn(`התראת תפוגת טוקן לקו ${line.displayPhone} נכשלה: ${String(error)}`);
    }
  }
}
