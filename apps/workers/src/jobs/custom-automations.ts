import { type Job } from "bullmq";
import { ulid } from "ulid";
import { z } from "zod";
import {
  AutomationActionSchema,
  AutomationConditionSchema,
  automationTrigger,
  conditionsMatch,
} from "@metavchim/shared";
import { withTenant } from "../runtime.js";
import { tenantHasFeature } from "../tenant-settings.js";

const CustomAutomationJobSchema = z.object({
  tenantId: z.string(),
  /** מזהה האירוע ב-outbox — מפתח האי-כפילות. */
  eventId: z.string(),
  event: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.union([z.string(), z.date()]).optional(),
});

/**
 * הרצת האוטומציות שהמשרד בנה בעצמו.
 *
 * המפיץ שולח Job אחד לכל אירוע שיש לו טריגר בקטלוג, **בלי לקרוא את
 * הכללים** — הטבלה תחת FORCE RLS והמפיץ רץ בלי הקשר דייר, כך
 * ששאילתה משם הייתה מחזירה אפס שורות בשקט. כאן יש הקשר, ולכן כאן
 * הכללים נטענים, מסוננים ומבוצעים.
 *
 * **כלל שנכשל אינו מפיל את השאר.** משרד עם חמישה כללים שאחד מהם
 * מפנה לסוכן שהושבת אינו אמור לאבד את ארבעת האחרים, ובוודאי לא
 * שהאירוע כולו יסומן ככישלון וינסה שוב בלולאה.
 */
export async function processCustomAutomations(job: Job): Promise<void> {
  const data = CustomAutomationJobSchema.parse(job.data);
  const trigger = automationTrigger(data.event);
  if (!trigger) return;

  /*
   * זכאות המסלול נבדקת **בהרצה** ולא רק בשמירה.
   *
   * משרד שירד מסלול נשאר עם הכללים שהגדיר, ובלי הבדיקה הזו הוא היה
   * ממשיך לקבל את התכונה בחינם לנצח. הכללים עצמם נשארים גלויים
   * וניתנים לכיבוי ומחיקה — רק ההרצה נעצרת (ביקורת Codex).
   */
  if (!(await tenantHasFeature(data.tenantId, "automations"))) return;

  // שלב הקריאה — טרנזקציה אחת קצרה, בלי כתיבה
  const { rules, activeUsers } = await withTenant(data.tenantId, async (tx) => {
    const [ruleRows, userRows] = await Promise.all([
      tx.automationRule.findMany({
        where: { tenantId: data.tenantId, trigger: data.event, enabled: true },
        select: { id: true, name: true, conditions: true, action: true },
      }),
      /*
       * הנמענים נבדקים **בזמן הריצה** ולא רק בשמירה.
       *
       * כלל חי חודשים, וסוכן שהושבת בינתיים ימשיך לקבל משימות שאיש
       * אינו רואה: ה-Session שלו בוטל, והתראה אישית גלויה רק לו.
       * הבדיקה בשמירה אינה יכולה להגן על כלל ארוך-חיים (ביקורת Codex).
       */
      tx.user.findMany({
        where: { tenantId: data.tenantId, isActive: true },
        select: { id: true },
      }),
    ]);
    return { rules: ruleRows, activeUsers: new Set(userRows.map((u) => u.id)) };
  });
  if (rules.length === 0) return;

  /*
   * **מועד היעד נמדד מרגע האירוע ולא מרגע העיבוד.**
   *
   * המפיץ שולח `occurredAt` בדיוק לשם כך: תור שהצטבר, תקלה או
   * ניסיון חוזר היו דוחים משימה של "מחר" לשעות מאוחרות יותר, בלי
   * שאיש ביקש זאת.
   */
  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date();

  for (const rule of rules) {
    const conditions = z.array(AutomationConditionSchema).safeParse(rule.conditions);
    if (!conditions.success) continue;
    if (!conditionsMatch(trigger, conditions.data, data.payload)) continue;

    const action = AutomationActionSchema.safeParse(rule.action);
    if (!action.success) continue;

    const recipient =
      action.data.kind === "task" ? action.data.assignedToUserId : action.data.userId;
    if (!activeUsers.has(recipient)) {
      console.warn(`[custom-automations] כלל ${rule.id} מדולג — הנמען אינו פעיל`);
      continue;
    }

    /*
     * **טרנזקציה לכל כלל, ולא אחת לכולם.**
     *
     * try/catch בתוך טרנזקציה משותפת אינו מבודד: שגיאה אחת מעבירה
     * את הטרנזקציה ב-Postgres למצב aborted, וכל מה שאחריה נכשל
     * ממילא. כאן כלל שנכשל מתגלגל לבדו, והשאר ממשיכים — וגם ה"תפיסה"
     * והפעולה נכתבות יחד או בכלל לא.
     */
    try {
      await withTenant(data.tenantId, async (tx) => {
        /*
         * ספר הריצות **לפני** הפעולה ובאותה טרנזקציה.
         *
         * `jobId` מונע הכנסה כפולה לתור אך לא עיבוד כפול: Job שנתקע
         * נמסר שוב, והכלל היה רץ פעם שנייה ופותח משימה זהה. שורה
         * שנדחתה על המפתח הראשי פירושה "כבר רץ", והריצה מדולגת.
         */
        const claimed = await tx.automationRun.createMany({
          data: { ruleId: rule.id, eventId: data.eventId, tenantId: data.tenantId },
          skipDuplicates: true,
        });
        if (claimed.count === 0) return;

        /*
         * מזהה הישות שהאירוע נוגע בה — כדי שהמשימה וההתראה יובילו
         * לכרטיס ולא ל"איפשהו". אם אין מזהה מובהק, הפעולה עדיין
         * מתבצעת — פשוט בלי קישור.
         */
        const link = entityFromPayload(data.payload);

        if (action.data.kind === "task") {
          const dueAt = new Date(occurredAt);
          dueAt.setUTCDate(dueAt.getUTCDate() + action.data.dueInDays);
          const taskId = ulid();
          await tx.task.create({
            data: {
              id: taskId,
              tenantId: data.tenantId,
              assignedToUserId: action.data.assignedToUserId,
              title: action.data.title,
              notes: `נוצר אוטומטית על ידי "${rule.name}".`,
              dueAt,
              ...(link ?? {}),
            },
          });
          /*
           * `task.created` נכתב גם כאן ולא רק ב-TasksService.
           *
           * תזכורת מועד היעד מתוזמנת **מהאירוע הזה בלבד**, ולכן
           * משימה שנוצרה ישירות הייתה מופיעה ברשימה ולעולם לא
           * מזכירה על עצמה — כלומר ההבטחה שהמשימה אמורה לקיים
           * נשברת בשקט (ביקורת Codex).
           */
          await tx.outboxEvent.create({
            data: {
              id: ulid(),
              tenantId: data.tenantId,
              name: "task.created",
              payload: {
                taskId,
                tenantId: data.tenantId,
                assignedToUserId: action.data.assignedToUserId,
                title: action.data.title,
                dueAt: dueAt.toISOString(),
              },
            },
          });
        } else {
          await tx.notification.create({
            data: {
              id: ulid(),
              tenantId: data.tenantId,
              userId: action.data.userId,
              type: "custom_automation",
              title: action.data.title,
              body: action.data.body,
              ...(link ?? {}),
            },
          });
        }
      });
    } catch (error) {
      console.warn(`[custom-automations] כלל ${rule.id} נכשל: ${String(error)}`);
    }
  }
}

/** הישות שהאירוע נוגע בה, אם אפשר לזהות אותה חד-משמעית. */
function entityFromPayload(
  payload: Record<string, unknown>,
): { entityType: string; entityId: string } | null {
  const map: [string, string][] = [
    ["leadId", "lead"],
    ["propertyId", "property"],
    ["buyerId", "buyer"],
    ["offerId", "offer"],
    ["appointmentId", "appointment"],
  ];
  for (const [key, entityType] of map) {
    const value = payload[key];
    if (typeof value === "string" && value !== "") return { entityType, entityId: value };
  }
  return null;
}
