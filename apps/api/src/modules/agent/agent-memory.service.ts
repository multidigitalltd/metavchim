import { Injectable } from "@nestjs/common";
import { assistantMemoryTurn, type AgentHistoryTurn } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import {
  notificationVisibility,
  redactUnauthorizedNotifications,
} from "../notifications/notification-visibility";
import { PrismaService } from "../../core/prisma.service";

/**
 * מה שהסוכן **הראה** למתווך לאחרונה — ההקשר של „אליו”.
 *
 * ## למה זה קיים גם במסך ולא רק בוואטסאפ
 *
 * הסוכן הוא אותו סוכן בשני הערוצים, וכל שדרוג צריך להגיע לשניהם
 * (בקשת בעל הפלטפורמה). בוואטסאפ הזיכרון נכתב בסבב ההתראות: מה
 * שנשלח בפועל נרשם כתור בשיחה. במסך אין שיחה מתמשכת שנשמרת בשרת —
 * ההיסטוריה חיה בפאנל של הדפדפן — ולכן הזיכרון נגזר כאן מחדש בכל
 * בקשה, מתוך אותן שורות התראה שהמתווך רואה בפעמון.
 *
 * שתי הדרכים נפגשות באותה פונקציה בחבילה המשותפת
 * (`assistantMemoryTurn`), ולכן גם הניסוח, גם ההשמטה של הטלפון וגם
 * צורת ההפניה זהים. שני מנגנוני איסוף — תוצר אחד.
 *
 * ## החלון
 *
 * שעתיים ושש התראות. „תזכיר לי להתקשר אליו” הוא משפט שנאמר בסמוך
 * לעדכון; חלון רחב יותר היה גורם לסוכן לתלות כינוי גוף בהתראה
 * מאתמול, וזה גרוע מלשאול „למי?”.
 */
const WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_ITEMS = 6;

@Injectable()
export class AgentMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** תור אחד שמסכם את מה שהוצג לאחרונה, או `null` כשאין מה לזכור. */
  async recentTurn(): Promise<AgentHistoryTurn | null> {
    const ctx = TenantContext.current();
    const rows = await this.prisma.withTenant(async (tx) => {
      /*
       * ‎**אותו שער בדיוק כמו הפעמון — הפונקציה, ולא עותק שלה.**
       *
       * ‏ההערה שעמדה כאן טענה „אותו תנאי בדיוק כמו מסך ההתראות”,
       * ‏והייתה כתובה מחדש בפנים: העותק הרביעי שהקובץ ההוא מזהיר
       * ‏מפניו במפורש. וזה לא נשאר תיאורטי — הצנזורה בקריאה נוספה
       * ‏שם, והסוכן היה ממשיך לקרוא מצביעים של לקוחות שאינם בהיקפו
       * ‏(ביקורת Codex, P1).
       *
       * ‏הכותרת והגוף נשלפים אף שהזיכרון אינו משתמש בהם: לשער יש
       * ‏**צורה אחת**, ולא שתי דרכים לקרוא התראה.
       */
      const found = await tx.notification.findMany({
        where: {
          ...notificationVisibility(),
          createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
        take: MAX_ITEMS,
        select: {
          userId: true,
          type: true,
          title: true,
          body: true,
          entityType: true,
          entityId: true,
        },
      });
      return redactUnauthorizedNotifications(tx, ctx.tenantId, found);
    });
    // מהישן לחדש: `assistantMemoryTurn` בונה את המשפט לפי הסדר הזה
    return assistantMemoryTurn(rows.reverse());
  }
}
