import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { CollaborationService } from "./collaboration.service";

/**
 * ‎**הסבב שהופך „עקוב אחרי הביקוש” להתראה.**
 *
 * ## למה ב-API ולא ב-Workers
 *
 * ‏אותו נימוק בדיוק כמו ב-`MatchRefreshService`, ואפילו חד יותר:
 * הסבב מריץ את `matchOwnProperties` **עצמה** — הפונקציה שמציירת את
 * הכרטיס בפיד. ‏`apps/workers` אינה יכולה לייבא מ-`apps/api`, ולכן
 * סבב שם היה מחייב עותק שני של „מה נחשב התאמה”: אותו סף, אותו
 * סינון, אותו מיפוי שדות.
 *
 * ‎**זה בדיוק הכשל שכבר קרה במנטור**, ושדרש שער מבני שלם כדי לשמור
 * עליו — שני מקורות אמת שנפרדים בשקט, ומתווך שרואה בכרטיס „92%
 * התאמה” לצד התראה שלא הגיעה. כאן אין מה שיסטה, ולכן גם אין שער
 * שצריך לשמור.
 *
 * ## הקצב
 *
 * ‏שעה, ולא דקה ולא יום. נכס נכנס למאגר בשעות העבודה, והתראה שמגיעה
 * תוך שעה עדיין רלוונטית לאותו יום עבודה. דקה הייתה סריקה של כל
 * המשרדים שישים פעם בשעה על שינוי אחד, ויממה הייתה אומרת למתווך על
 * הזדמנות שכבר עברה.
 *
 * ‏הסבב **אינו** רץ מיד עם עליית התהליך: פריסה חדשה אינה סיבה
 * לסריקה מלאה, והשהיה קצרה מוציאה אותו מדרכן של הבקשות הראשונות.
 */

/** ‏פעם בשעה. ראו ההסבר על הקצב למעלה. */
const TICK_MS = 60 * 60 * 1000;
/** ‏השהיית ההרצה הראשונה — לא לחנוק את העלייה. */
const FIRST_TICK_DELAY_MS = 5 * 60 * 1000;

@Injectable()
export class DemandFollowSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemandFollowSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  /** ‏סבב שרץ עכשיו. שני סבבים במקביל אינם מזיקים, אבל אינם מועילים. */
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly collaboration: CollaborationService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_MS);
    }, FIRST_TICK_DELAY_MS);
    // אחרת התהליך אינו יוצא בבדיקות ובסקריפטים קצרים
    this.kickoff.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.sweepAll();
    } catch (error: unknown) {
      this.logger.error(`demand follow sweep failed: ${String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * ‏סבב על כל המשרדים.
   *
   * ‏ציבורי כדי שאפשר יהיה להריץ אותו בבדיקה מול מסד אמיתי במקום
   * לחכות שעה ולקוות — אותה סיבה בדיוק כמו ב-`MatchRefreshService`.
   *
   * ‎**כישלון במשרד אחד אינו עוצר את השאר.** משרד עם נתון פגום היה
   * מבטל את הסבב לכולם, וזה הכשל השקט הגרוע ביותר כאן: איש לא
   * מקבל התראה, ואין שגיאה שמישהו רואה.
   */
  async sweepAll(): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let sent = 0;
    for (const tenant of tenants) {
      try {
        sent += await this.collaboration.sweepFollowsForTenant(tenant.id);
      } catch (error: unknown) {
        this.logger.error(
          `demand follow sweep failed for ${tenant.id}: ${String(error)}`,
        );
      }
    }
    if (sent > 0) this.logger.log(`demand follow sweep sent ${sent} notifications`);
    return sent;
  }
}
