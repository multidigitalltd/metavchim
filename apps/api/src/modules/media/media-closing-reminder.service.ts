import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  MEDIA_CLOSING_REMINDER_HOURS,
  formatJerusalemDate,
  formatJerusalemTime,
  mediaClosingReminderDue,
} from "@metavchim/shared";
import { notifyOnce } from "../../common/notify-once";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * תזכורת „הגיליון נסגר מחר” — למשרד שיש לו הזמנה שממתינה לתשלום.
 *
 * ## למה דווקא להזמנה ממתינה
 *
 * משרד שפתח דף תשלום ולא סיים הוא בדיוק מי שיפספס את הגיליון בלי
 * לשים לב; משרד שלא התחיל אינו צריך דחיפה מהמערכת. התזכורת הולכת
 * למי שהתחיל את ההזמנה (הוא זה שמנהל את החיוב) — בפעמון, ובמייל
 * לאיש הקשר שנרשם על ההזמנה.
 *
 * ## פעם אחת לגיליון
 *
 * הסורק רץ כל שעה, ולא „פעם ביום”: שרת שהיה למטה ברגע המתוזמן היה
 * מדלג על הגיליון כולו. מה שמונע כפילות הוא הזיכרון — `closing_reminder_at`
 * על ההזמנה, `reminded_for_closing_at` על המדיה, ומפתח האידמפוטנטיות
 * במייל — ולא השעה. כשבעל הפלטפורמה מעדכן את המועד לגיליון הבא,
 * ההזמנות שעדיין ממתינות מקבלות תזכורת חדשה.
 *
 * ‎`media_orders` מחוץ ל-RLS ונקראת כאן על פני כל המשרדים; ההתראה
 * נכתבת לטבלה תחת RLS, ולכן בתוך `withExplicitTenant` של אותו משרד.
 */

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** שתי דקות אחרי העלייה — אחרי המיגרציות, לפני שמישהו מחכה. */
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
const MAX_ORDERS_PER_SWEEP = 200;

@Injectable()
export class MediaClosingReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaClosingReminderService.name);
  private kickoff: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
      this.timer.unref();
    }, FIRST_SWEEP_DELAY_MS);
    this.kickoff.unref();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } catch (error) {
      this.logger.error(`סבב תזכורות סגירת גיליון נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** ציבורי ועם `now` — כדי שבדיקה תריץ אותו בלי לחכות שעה. */
  async sweep(now: Date): Promise<{ reminded: number }> {
    const outlets = await this.prisma.mediaOutlet.findMany({
      where: { active: true, nextClosingAt: { not: null } },
      select: { id: true, name: true, nextClosingAt: true, remindedForClosingAt: true },
    });
    let reminded = 0;
    for (const outlet of outlets) {
      if (!mediaClosingReminderDue({ nextClosingAt: outlet.nextClosingAt, remindedForClosingAt: outlet.remindedForClosingAt, now })) {
        continue;
      }
      const closingAt = outlet.nextClosingAt as Date;
      const orders = await this.prisma.mediaOrder.findMany({
        where: {
          outletId: outlet.id,
          status: "pending_payment",
          OR: [{ closingReminderAt: null }, { closingReminderAt: { lt: closingAt } }],
        },
        orderBy: { createdAt: "asc" },
        take: MAX_ORDERS_PER_SWEEP,
      });
      for (const order of orders) {
        try {
          await this.remind(order, { name: outlet.name, closingAt });
          reminded += 1;
        } catch (error) {
          // כישלון בהזמנה אחת אינו עוצר את השאר — הוא נרשם ונחזור אליו בסבב הבא
          this.logger.warn(`תזכורת סגירה להזמנה ${order.id} נכשלה: ${String(error)}`);
        }
      }
      /*
       * המדיה מסומנת רק כשכל ההזמנות שלה טופלו (או שאין כאלה): סימון
       * מוקדם היה משתיק את הסבב הבא על הזמנה שנכשלה בשליחה.
       */
      if (orders.length < MAX_ORDERS_PER_SWEEP) {
        await this.prisma.mediaOutlet.update({
          where: { id: outlet.id },
          data: { remindedForClosingAt: closingAt },
        });
      }
    }
    return { reminded };
  }

  private async remind(
    order: {
      id: string;
      tenantId: string;
      createdBy: string | null;
      productName: string;
      contactName: string;
      contactEmail: string;
    },
    outlet: { name: string; closingAt: Date },
  ): Promise<void> {
    const when = `${formatJerusalemDate(outlet.closingAt)} בשעה ${formatJerusalemTime(outlet.closingAt)}`;
    const title = `${outlet.name} נסגר מחר — ההזמנה ממתינה לתשלום`;
    const body = `${order.productName}: הגיליון נסגר ב-${when}. השלימו את התשלום כדי שהמודעה תיכנס.`;
    const origin = loadEnv().WEB_ORIGIN;

    await this.prisma.withExplicitTenant(order.tenantId, async (tx) => {
      await notifyOnce(tx, {
        tenantId: order.tenantId,
        dedupeKey: `media_closing:${order.id}:${outlet.closingAt.getTime()}`,
        // מי שהתחיל את ההזמנה; בלי מזהה — כל המשרד
        userId: order.createdBy,
        type: "media_closing",
        title,
        body,
        entityType: "media_order",
        entityId: order.id,
      });
    });

    if (order.contactEmail !== "") {
      await this.email.send(
        order.contactEmail,
        title,
        {
          heading: "הגיליון נסגר מחר",
          greeting: `שלום ${order.contactName},`,
          paragraphs: [
            `ההזמנה שלכם — ${order.productName} ב${outlet.name} — עדיין ממתינה לתשלום, והגיליון נסגר ב-${when}.`,
            "כדי שהמודעה תיכנס לגיליון הזה, השלימו את התשלום מהארכיון. הזמנה שלא שולמה עד הסגירה נכנסת לגיליון הבא.",
          ],
          button: { label: "להשלמת ההזמנה", url: `${origin}/media/orders` },
          footnote: "הודעה אוטומטית ממערכת מתווכים. אם כבר שילמתם, אין צורך לעשות דבר.",
        },
        {
          idempotency: { key: `media-closing:${order.id}:${outlet.closingAt.getTime()}`, purpose: "media" },
          autoGenerated: true,
        },
      );
    }

    await this.prisma.mediaOrder.updateMany({
      where: { id: order.id, tenantId: order.tenantId },
      data: { closingReminderAt: outlet.closingAt },
    });
  }
}

/** ‏חלון התזכורת, לתיעוד ולבדיקות — מקורו ב-shared. */
export const CLOSING_REMINDER_HOURS = MEDIA_CLOSING_REMINDER_HOURS;
