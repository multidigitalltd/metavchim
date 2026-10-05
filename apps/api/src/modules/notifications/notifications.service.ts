import { Injectable } from "@nestjs/common";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";
import {
  notificationVisibility,
  redactUnauthorizedNotifications,
} from "./notification-visibility";

/**
 * ‎**התראות — והכלל היחיד שקובע מי רואה מה.**
 *
 * המודול הזה חי עד כה בתוך הבקר בלבד, ולכן `אין` היה מי שיקרא לו
 * מחוץ ל-HTTP: הסוכן לא יכול היה לענות „מה חדש”, שהיא אחת השאלות
 * הראשונות שנשאלות בבוקר.
 *
 * ‎**וההוצאה לשירות אינה רק נוחות.** תנאי הראות —
 * ‎`userId IS NULL OR userId = הנוכחי` — היה כתוב **שלוש פעמים**
 * באותו קובץ: ברשימה, בסימון קריאה, ובסימון הכול. שלושה עותקים של
 * אותו תנאי הרשאה כבר נפרדו זה מזה במערכת הזו פעם אחת, והתיקון עדכן
 * שניים והשאיר את השלישי (ביקורת Codex, ב-`ownership.ts`). ערוץ
 * רביעי היה עותק רביעי.
 *
 * כאן הוא נכתב פעם אחת, וכל קורא מרכיב אותו לשאילתה שלו.
 */

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  readAt?: Date;
  createdAt: Date;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(limit: number): Promise<{ items: NotificationDto[]; unreadCount: number }> {
    return this.prisma.withTenant(async (tx) => {
      const visible = notificationVisibility();
      const [found, unreadCount] = await Promise.all([
        tx.notification.findMany({ where: visible, orderBy: { createdAt: "desc" }, take: limit }),
        tx.notification.count({ where: { ...visible, readAt: null } }),
      ]);
      /*
       * ‎**והצנזורה בקריאה, ולא רק בכתיבה** (ביקורת Codex, P1):
       * ‏שורה משרדית ישנה נכתבה כשהלקוח היה גלוי לכל המשרד.
       */
      const rows = await redactUnauthorizedNotifications(
        tx,
        TenantContext.current().tenantId,
        found,
      );
      return {
        items: rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body ?? undefined,
          entityType: n.entityType ?? undefined,
          entityId: n.entityId ?? undefined,
          readAt: n.readAt ?? undefined,
          createdAt: n.createdAt,
        })),
        unreadCount,
      };
    });
  }

  /**
   * ‎**רק מה שטרם נקרא** — וזו השאלה שהסוכן נשאל.
   *
   * „מה חדש” אינו „הראה לי את שלושים האחרונות”. רשימה שכוללת התראות
   * שכבר טופלו קוראת כמו ערימת עבודה שאינה מתקצרת, וזו בדיוק הסיבה
   * שמסך ההתראות נפתח פחות ופחות.
   */
  async unread(limit: number): Promise<{ items: NotificationDto[]; unreadCount: number }> {
    return this.prisma.withTenant(async (tx) => {
      const where = { ...notificationVisibility(), readAt: null };
      const [found, unreadCount] = await Promise.all([
        tx.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
        tx.notification.count({ where }),
      ]);
      const rows = await redactUnauthorizedNotifications(
        tx,
        TenantContext.current().tenantId,
        found,
      );
      return {
        items: rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body ?? undefined,
          entityType: n.entityType ?? undefined,
          entityId: n.entityId ?? undefined,
          createdAt: n.createdAt,
        })),
        unreadCount,
      };
    });
  }

  /** סימון אחת כנקראה. שקט כשאינה נגישה — אותה תשובה כמו „כבר נקראה”. */
  async markRead(id: string): Promise<void> {
    await this.prisma.withTenant((tx) =>
      tx.notification.updateMany({
        where: { ...notificationVisibility(), id, readAt: null },
        data: { readAt: new Date() },
      }),
    );
  }

  async markAllRead(): Promise<number> {
    const result = await this.prisma.withTenant((tx) =>
      tx.notification.updateMany({
        where: { ...notificationVisibility(), readAt: null },
        data: { readAt: new Date() },
      }),
    );
    return result.count;
  }
}
