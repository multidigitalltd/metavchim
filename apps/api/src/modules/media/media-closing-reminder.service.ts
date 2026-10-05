import { Injectable, Logger } from "@nestjs/common";
import {
  MEDIA_CLOSING_REMINDER_HOURS,
  formatJerusalemDate,
  formatJerusalemTime,
  mediaClosingWindowOpen,
} from "@metavchim/shared";
import { notifyOnce } from "../../common/notify-once";
import { PrismaService } from "../../core/prisma.service";
import { MediaMailService } from "./media-mail.service";
import { Sweep } from "../../core/sweeps";

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
 * ## פעם אחת לגיליון — על ההזמנה
 *
 * הסורק רץ כל שעה, ולא „פעם ביום”: שרת שהיה למטה ברגע המתוזמן היה
 * מדלג על הגיליון כולו. מה שמונע כפילות הוא הזיכרון **על ההזמנה** —
 * `closing_reminder_at` שווה למועד שהוזכר — ומפתח האידמפוטנטיות במייל,
 * ולא השעה ולא סימון על המדיה: סימון כזה היה משתיק הזמנה שנפתחה אחרי
 * הסבב הראשון בחלון, ומועד מוקדם יותר שהוקצה למוצר אחרי שהזמנתו כבר
 * הוזכרה למועד המדיה (ביקורת Codex). כשבעל הפלטפורמה מעדכן את המועד
 * לגיליון הבא, ההזמנות שעדיין ממתינות מקבלות תזכורת חדשה — המועד שלהן
 * שונה.
 *
 * ‎`media_orders` מחוץ ל-RLS ונקראת כאן על פני כל המשרדים; ההתראה
 * נכתבת לטבלה תחת RLS, ולכן בתוך `withExplicitTenant` של אותו משרד.
 */

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** שתי דקות אחרי העלייה — אחרי המיגרציות, לפני שמישהו מחכה. */
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
const MAX_ORDERS_PER_SWEEP = 200;

@Injectable()
export class MediaClosingReminderService {
  private readonly logger = new Logger(MediaClosingReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MediaMailService,
  ) {}

  @Sweep({
    name: "media-closing-reminder",
    everyMs: SWEEP_INTERVAL_MS,
    firstDelayMs: FIRST_SWEEP_DELAY_MS,
  })
  private async tick(): Promise<void> {
    try {
      await this.sweep(new Date());
    } catch (error) {
      this.logger.error(`סבב תזכורות סגירת גיליון נכשל: ${String(error)}`);
    }
  }

  /**
   * ציבורי ועם `now` — כדי שבדיקה תריץ אותו בלי לחכות שעה.
   *
   * ‏שתי רמות של מועד: **המוצר** יכול לקבוע מועד משלו (שער נסגר לפני
   * ‏העמודים הפנימיים), ואז ההזמנות שלו מקבלות תזכורת לפי המועד שלו;
   * ‏**המדיה** מכסה את שאר המוצרים — אלה בלי מועד משלהם. אותו כלל כמו
   * ‏`mediaProductClosingAt`. בתוך חלון התזכורת כל סבב שעתי שואל שוב
   * ‏מי ממתין וטרם הוזכר **למועד הזה** — ולכן הזמנה שנפתחה באמצע החלון
   * ‏מקבלת את שלה, והזמנה שהוזכרה למועד המדיה מקבלת תזכורת חדשה כשמוצרה
   * ‏קיבל מועד מוקדם יותר.
   */
  async sweep(now: Date): Promise<{ reminded: number }> {
    const outlets = await this.prisma.mediaOutlet.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        nextClosingAt: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        closingText: true,
        products: {
          where: { nextClosingAt: { not: null } },
          select: { id: true, nextClosingAt: true },
        },
      },
    });
    let reminded = 0;
    for (const outlet of outlets) {
      const contact = {
        name: outlet.name,
        contactName: outlet.contactName,
        contactEmail: outlet.contactEmail,
        contactPhone: outlet.contactPhone,
        closingText: outlet.closingText,
      };
      // ‏מוצרים עם מועד משלהם — לפי המועד שלהם
      for (const product of outlet.products) {
        if (!mediaClosingWindowOpen({ nextClosingAt: product.nextClosingAt, now })) continue;
        reminded += await this.remindOrders(
          { outletId: outlet.id, productId: product.id },
          { ...contact, closingAt: product.nextClosingAt as Date },
        );
      }
      // ‏המדיה — שאר המוצרים
      if (!mediaClosingWindowOpen({ nextClosingAt: outlet.nextClosingAt, now })) continue;
      const ownClosing = outlet.products.map((p) => p.id);
      reminded += await this.remindOrders(
        { outletId: outlet.id, ...(ownClosing.length === 0 ? {} : { productId: { notIn: ownClosing } }) },
        { ...contact, closingAt: outlet.nextClosingAt as Date },
      );
    }
    return { reminded };
  }

  /**
   * ההזמנות הממתינות שהמועד הזה חל עליהן וטרם הוזכרו **למועד הזה** —
   * זהות המועד, לא סדר כרונולוגי: הזמנה שהוזכרה למועד מאוחר של המדיה
   * ואז מוצרה קיבל מועד מוקדם יותר — מקבלת את התזכורת המוקדמת.
   */
  private async remindOrders(
    scope: { outletId: string; productId?: string | { notIn: string[] } },
    outlet: {
      name: string;
      contactName: string;
      contactEmail: string;
      contactPhone: string;
      closingText: string;
      closingAt: Date;
    },
  ): Promise<number> {
    const orders = await this.prisma.mediaOrder.findMany({
      where: {
        ...scope,
        status: "pending_payment",
        OR: [{ closingReminderAt: null }, { closingReminderAt: { not: outlet.closingAt } }],
      },
      orderBy: { createdAt: "asc" },
      take: MAX_ORDERS_PER_SWEEP,
    });
    let reminded = 0;
    for (const order of orders) {
      try {
        await this.remind(order, outlet);
        reminded += 1;
      } catch (error) {
        // כישלון בהזמנה אחת אינו עוצר את השאר — הוא נרשם ונחזור אליו בסבב הבא
        this.logger.warn(`תזכורת סגירה להזמנה ${order.id} נכשלה: ${String(error)}`);
      }
    }
    return reminded;
  }

  private async remind(
    order: {
      id: string;
      tenantId: string;
      createdBy: string | null;
      kind: string;
      outletName: string;
      productName: string;
      quantity: number;
      amountAgorot: number;
      commissionAgorot: number;
      leadFeeAgorot: number | null;
      brief: string;
      contactName: string;
      contactPhone: string;
      contactEmail: string;
      officeName: string;
      customerNo: number | null;
      createdAt: Date;
      creativeToken: string | null;
      creativeName: string | null;
      creativeUploadedAt: Date | null;
      publishedAt: Date | null;
      publishedNote: string;
      publishedBy: string;
      outletToken: string | null;
      outletConfirmedAt: Date | null;
    },
    outlet: {
      name: string;
      contactName: string;
      contactEmail: string;
      contactPhone: string;
      closingText: string;
      closingAt: Date;
    },
  ): Promise<void> {
    const when = `${formatJerusalemDate(outlet.closingAt)} בשעה ${formatJerusalemTime(outlet.closingAt)}`;
    const title = `${outlet.name} נסגר מחר — ההזמנה ממתינה לתשלום`;
    const body = `${order.productName}: הגיליון נסגר ב-${when}. השלימו את התשלום כדי שהמודעה תיכנס.`;

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

    // ‏המייל — ללקוח ולמנהלי הפלטפורמה, באותה צורה כמו שאר שלבי ההזמנה
    await this.mail.closingReminder(
      order,
      {
        name: outlet.name,
        contactName: outlet.contactName,
        contactEmail: outlet.contactEmail,
        contactPhone: outlet.contactPhone,
        closingText: outlet.closingText,
        nextClosingAt: outlet.closingAt,
      },
      outlet.closingAt,
    );

    await this.prisma.mediaOrder.updateMany({
      where: { id: order.id, tenantId: order.tenantId },
      data: { closingReminderAt: outlet.closingAt },
    });
  }
}

/** ‏חלון התזכורת, לתיעוד ולבדיקות — מקורו ב-shared. */
export const CLOSING_REMINDER_HOURS = MEDIA_CLOSING_REMINDER_HOURS;
