import { ulid } from "ulid";
import { nextOccurrenceUtc, type RecurrenceRule } from "@metavchim/shared";
import { prisma } from "../runtime.js";
import { tenantHasFeature } from "../tenant-settings.js";

/**
 * משימות אוטומטיות קבועות — יצירת המופע שהגיע זמנו.
 *
 * הכלל שייך למשרד, המשימה שנוצרת ממנו שייכת לסוכן. כלל בלי סוכן
 * מוגדר מייצר משימה **לכל סוכן פעיל** — "לעבור על הקונים החמים" הוא
 * משימה של כל אחד בנפרד, לא משימה אחת שמישהו יסמן בשביל כולם.
 *
 * ## שעון
 *
 * `nextOccurrence` עובד על שדות מקומיים של ה-Date. תהליך ה-Worker רץ
 * ב-UTC, ולכן "09:00" היה נופל ב-12:00 בישראל. הפתרון הוא לעבוד
 * כולו ב"מרחב שעון-קיר": ממירים את נקודת הייחוס לשעת קיר ירושלמית,
 * מריצים את החישוב שם, וממירים את התוצאה בחזרה ל-UTC. אותה תבנית
 * שכבר משרתת את דו"ח הבוקר.
 *
 * ## אידמפוטנטיות
 *
 * `sourceKey` נגזר מהכלל ומהמופע, ו-`lastRunAt` מתעדכן באותה
 * טרנזקציה. ריצה כפולה של הסורק — או שתי מכונות Worker — לא תיצור
 * את אותה משימה פעמיים.
 */
const RECURRING_PAGE = 50;

export async function processRecurringTasks(): Promise<void> {
  const now = new Date();
  /*
   * הכללים נשלפים דייר-דייר ולא בשאילתה אחת.
   *
   * `task_recurrences` תחת FORCE RLS: שאילתה בלי `app.tenant_id`
   * מחזירה אפס שורות **בלי שגיאה**, כלומר הסורק היה רץ כל עשר דקות
   * ולא עושה דבר, בלי לוג ובלי כשל. זו אותה תבנית של שאר הסורקים
   * כאן, ומאותה סיבה בדיוק.
   */
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const rules: {
    id: string;
    tenantId: string;
    title: string;
    notes: string | null;
    frequency: string;
    weekdays: number[];
    dayOfMonth: number | null;
    hour: number;
    minute: number;
    assignedToUserId: string | null;
    lastRunAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }[] = [];
  for (const tenant of tenants) {
    /*
     * זכאות המסלול נבדקת **בסריקה** ולא רק בשמירה. משרד שירד מסלול
     * נשאר עם הכללים שהגדיר, ובלי הבדיקה הזו הוא היה ממשיך לקבל
     * משימות אוטומטיות בחינם לנצח. הכללים נשארים גלויים וניתנים
     * לכיבוי ומחיקה — רק ההרצה נעצרת (ביקורת Codex).
     */
    if (!(await tenantHasFeature(tenant.id, "automations"))) continue;

    /*
     * עימוד cursor ולא take בודד.
     *
     * הכללים לא משנים סדר בין הסריקות, ולכן `take: 50` היה מחזיר
     * לנצח את אותם חמישים הראשונים — וכלל מספר 51 של משרד גדול לא
     * היה נוצר אף פעם, בלי שגיאה ובלי שאיש ישים לב (ביקורת Codex).
     */
    let cursor: string | undefined;
    for (;;) {
      const page = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        return tx.taskRecurrence.findMany({
          where: { tenantId: tenant.id, isActive: true },
          orderBy: { id: "asc" },
          take: RECURRING_PAGE,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
      });
      rules.push(...page);
      if (page.length < RECURRING_PAGE) break;
      cursor = page[page.length - 1]!.id;
    }
  }

  for (const rule of rules) {
    const spec: RecurrenceRule = {
      frequency: rule.frequency as RecurrenceRule["frequency"],
      weekdays: rule.weekdays,
      ...(rule.dayOfMonth !== null ? { dayOfMonth: rule.dayOfMonth } : {}),
      hour: rule.hour,
      minute: rule.minute,
    };
    const since = rule.lastRunAt ?? rule.createdAt;
    // ההמרה לשעון ישראל ובחזרה נעשית ב-shared, באותה פונקציה שהמסך
    // משתמש בה לתצוגת "המופע הבא" — אחרת השתיים היו נפרדות
    const dueAt = nextOccurrenceUtc(spec, since);
    if (dueAt === null || dueAt > now) continue;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${rule.tenantId}, true)`;

        /*
         * העדכון המותנה הוא המנעול.
         * שתי מכונות Worker שסורקות במקביל יגיעו לאותו כלל; רק זו
         * שה-lastRunAt שראתה עדיין תקף תצליח לעדכן, והשנייה תצא
         * בלי ליצור כלום.
         */
        /*
         * התפיסה מותנית גם ב-`updatedAt` וגם ב-`isActive`.
         *
         * הסריקה מחזיקה עותק בזיכרון, וכל שינוי בין הקריאה לתפיסה —
         * השהיה, שעה חדשה, נמען אחר, כותרת אחרת — לא נוגע ב-lastRunAt
         * ולכן לא היה נתפס. התוצאה: משימה שנוצרת לפי לוח שכבר לא
         * קיים, ולפעמים לאדם הלא נכון (ביקורת Codex).
         *
         * כלל שהשתנה פשוט יידחה כאן ויטופל בסריקה הבאה עם הערכים
         * המעודכנים — עשר דקות איחור, ולא משימה שגויה.
         */
        const claimed = await tx.taskRecurrence.updateMany({
          where: {
            id: rule.id,
            lastRunAt: rule.lastRunAt,
            updatedAt: rule.updatedAt,
            isActive: true,
          },
          data: { lastRunAt: dueAt },
        });
        if (claimed.count === 0) return;

        /*
         * גם נמען מפורש חייב להיות פעיל.
         *
         * סוכן שהושבת מאבד את ה-Sessions שלו, ולכן משימות שנוצרות לו
         * אינן נראות לאיש ואי אפשר לסמן אותן — הכלל היה ממשיך להתקדם
         * ולצבור שורות שלא ניתנות להשלמה (ביקורת Codex). אותה שאילתה
         * בדיוק של הענף הקבוצתי, רק מצומצמת לנמען אחד.
         */
        const targets = await tx.user.findMany({
          where: {
            tenantId: rule.tenantId,
            isActive: true,
            ...(rule.assignedToUserId ? { id: rule.assignedToUserId } : {}),
          },
          select: { id: true },
        });
        if (targets.length === 0) return;

        const sourceKey = `recurrence:${rule.id}:${dueAt.toISOString()}`;
        await tx.task.createMany({
          data: targets.map((user) => ({
            id: ulid(),
            tenantId: rule.tenantId,
            assignedToUserId: user.id,
            title: rule.title,
            notes: rule.notes,
            dueAt,
            sourceKey,
          })),
          skipDuplicates: true,
        });

        /*
         * התראה לכל נמען — אחרת המשימה מופיעה בשקט.
         *
         * משימה שנוצרת ידנית רושמת אירוע Outbox שהופך לתזכורת במועד,
         * אבל משימה חוזרת נוצרת **כשהמועד כבר הגיע** — אין למה
         * לתזמן. בלי ההתראה כאן היא פשוט מופיעה ברשימה, והסוכן מגלה
         * אותה רק כשהוא נכנס לבדוק (ביקורת Codex).
         *
         * createMany באותה טרנזקציה של המשימות: אם היצירה נכשלת, גם
         * ההתראה לא נשלחת, ואין תזכורת למשימה שלא קיימת.
         */
        await tx.notification.createMany({
          data: targets.map((user) => ({
            id: ulid(),
            tenantId: rule.tenantId,
            userId: user.id,
            type: "task.due",
            title: rule.title,
            body: rule.notes,
            entityType: "task",
          })),
        });
      });
    } catch (error) {
      // כלל אחד שנכשל לא עוצר את השאר — הוא ינוסה בסריקה הבאה
      console.error(`recurring-task ${rule.id} failed: ${String(error)}`);
    }
  }
}
