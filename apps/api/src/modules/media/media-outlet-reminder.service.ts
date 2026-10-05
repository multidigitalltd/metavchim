import { Injectable, Logger } from "@nestjs/common";
import { MEDIA_OUTLET_CONFIRM_REMINDER_HOURS, mediaOutletReminderDue } from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";
import { Sweep } from "../../core/sweeps";
import { MediaMailService } from "./media-mail.service";

/**
 * תזכורת לנציג המדיה — „ההזמנה ממתינה לאישור קבלה”.
 *
 * ## למה
 *
 * ההזמנה נמסרה לנציג במייל, ויש לו עמוד שבו לוחצים „קיבלנו”. נציג
 * שלא לחץ יומיים — המייל כנראה נקבר. תזכורת אחת, עם אותו קישור, סוגרת
 * את רוב המקרים; מי שלא ענה לשתי הודעות מקבל טלפון מבעל הפלטפורמה,
 * לא מייל שלישי — ולכן **פעם אחת להזמנה** (`outlet_reminder_at`).
 *
 * ## מתי לא
 *
 * הזמנה שסומנה „פורסם” (מי שפרסם — קיבל), הזמנה שהנציג אישר, והזמנה
 * שלא נמסרה (`notified_at` ריק — אין למי להזכיר; מסך הפלטפורמה כבר
 * אומר „לא נשלח”). הכלל ב-`mediaOutletReminderDue` ב-shared.
 *
 * ‎`media_orders` מחוץ ל-RLS ונקראת כאן על פני כל המשרדים; אין כאן
 * כתיבה לטבלאות תחת RLS — התזכורת היא מייל לנציג והודעה למנהלים.
 */

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 3 * 60 * 1000;
const MAX_ORDERS_PER_SWEEP = 200;

@Injectable()
export class MediaOutletReminderService {
  private readonly logger = new Logger(MediaOutletReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MediaMailService,
  ) {}

  @Sweep({
    name: "media-outlet-reminder",
    everyMs: SWEEP_INTERVAL_MS,
    firstDelayMs: FIRST_SWEEP_DELAY_MS,
  })
  private async tick(): Promise<void> {
    try {
      await this.sweep(new Date());
    } catch (error) {
      this.logger.error(`סבב תזכורות לנציגי מדיה נכשל: ${String(error)}`);
    }
  }

  /** ציבורי ועם `now` — כדי שבדיקה תריץ אותו בלי לחכות שעה. */
  async sweep(now: Date): Promise<{ reminded: number }> {
    const cutoff = new Date(now.getTime() - MEDIA_OUTLET_CONFIRM_REMINDER_HOURS * 60 * 60 * 1000);
    const orders = await this.prisma.mediaOrder.findMany({
      where: {
        status: { in: ["paid", "referred"] },
        notifiedAt: { lte: cutoff },
        outletConfirmedAt: null,
        publishedAt: null,
        outletReminderAt: null,
      },
      orderBy: { notifiedAt: "asc" },
      take: MAX_ORDERS_PER_SWEEP,
    });
    let reminded = 0;
    for (const order of orders) {
      // ‏הכלל המשותף — גם אם השאילתה תשתנה, התנאי נשאר אחד
      if (!mediaOutletReminderDue({ ...order, now })) continue;
      /*
       * ‏תפיסה מותנית **לפני** השליחה: הרשימה נקראה פעם אחת, ובסבב של עד
       * ‏200 הזמנות הנציג יכול לאשר קבלה או לסמן „פורסם” בין הקריאה לתורו.
       * ‏מי שאושר, פורסם או הוזכר בינתיים — העדכון לא תופס, ואין מייל
       * ‏(ביקורת Codex).
       */
      const claimed = await this.prisma.mediaOrder.updateMany({
        where: { id: order.id, tenantId: order.tenantId, outletConfirmedAt: null, publishedAt: null, outletReminderAt: null },
        data: { outletReminderAt: now },
      });
      if (claimed.count === 0) continue;
      try {
        const outlet = await this.prisma.mediaOutlet.findUnique({
          where: { id: order.outletId },
          select: { name: true, contactName: true, contactEmail: true, contactPhone: true, closingText: true, nextClosingAt: true },
        });
        const { outletDelivered } = await this.mail.outletReminder(order, outlet);
        /*
         * ‏הסימון נשאר כשהמייל יצא, וגם כשאין לנציג כתובת (אין למי לשלוח;
         * ‏מנהלי הפלטפורמה קיבלו הודעה והם מי שמתקשר). כתובת שיש ושליחה
         * ‏שנכשלה — ספק דואר שנפל — אינה „נשלח”: הסימון משוחרר והסבב הבא
         * ‏מנסה שוב (ביקורת Codex).
         */
        if (!outletDelivered && outlet !== null && outlet.contactEmail !== "") {
          await this.release(order.id, order.tenantId, now);
          continue;
        }
        reminded += 1;
      } catch (error) {
        // כישלון בהזמנה אחת אינו עוצר את השאר — הסימון משוחרר ונחזור אליה בסבב הבא
        this.logger.warn(`תזכורת לנציג על הזמנה ${order.id} נכשלה: ${String(error)}`);
        await this.release(order.id, order.tenantId, now);
      }
    }
    return { reminded };
  }

  /** שחרור התפיסה — רק אם היא עדיין שלנו (אותו `now`). */
  private async release(orderId: string, tenantId: string, now: Date): Promise<void> {
    try {
      await this.prisma.mediaOrder.updateMany({
        where: { id: orderId, tenantId, outletReminderAt: now },
        data: { outletReminderAt: null },
      });
    } catch (error) {
      this.logger.error(`שחרור סימון התזכורת על הזמנה ${orderId} נכשל: ${String(error)}`);
    }
  }
}
