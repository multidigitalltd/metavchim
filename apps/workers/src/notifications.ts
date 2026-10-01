import { type Job } from "bullmq";
import { ulid } from "ulid";
import { NotificationJobSchema } from "@metavchim/shared";
import { prisma } from "./runtime.js";

/** כתיבת התראה תחת הקשר הדייר — פוליסות ה-RLS חלות גם על ה-Worker. */
export async function processNotification(job: Job): Promise<void> {
  const data = NotificationJobSchema.parse(job.data);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${data.tenantId}, true)`;

    // תזכורת מושהית נבדקת בזמן הריצה: פגישה שבוטלה/הסתיימה בינתיים —
    // אין תזכורת מטעה (ביקורת Codex, PR #2).
    if (data.type === "appointment_reminder" && data.entityId) {
      const appointment = await tx.appointment.findFirst({
        where: { id: data.entityId, tenantId: data.tenantId },
        select: { status: true },
      });
      if (!appointment || appointment.status !== "scheduled") {
        return;
      }
    }

    // תזכורת משימה: יורה רק אם המשימה עדיין פתוחה ומועד היעד הנוכחי הוא
    // בדיוק המועד שה-Job תוזמן אליו — דחייה/הסרת מועד מבטלות את ה-Job
    // הישן, ו-Worker שהתעכב עדיין מוסר תזכורת תקפה (ביקורת Codex, PR #13).
    if (data.type === "task_reminder" && data.entityId) {
      const task = await tx.task.findFirst({
        where: { id: data.entityId, tenantId: data.tenantId },
        select: { status: true, dueAt: true, assignedToUserId: true },
      });
      if (!task || task.status !== "open") return;
      const scheduledFor = data.scheduledFor
        ? new Date(data.scheduledFor).getTime()
        : null;
      if (scheduledFor === null || task.dueAt === null) return;
      if (task.dueAt.getTime() !== scheduledFor) return;
      /*
       * גם **מי אחראי** נבדק, לא רק הסטטוס והמועד.
       *
       * מאז שאפשר להעביר משימה לסוכן אחר, העברה בלי שינוי מועד
       * משאירה את ה-Job הישן תקף לגמרי לפי שתי הבדיקות שמעליו —
       * ואז שני אנשים מקבלים תזכורת, כולל מי שכבר אינו אחראי, עם
       * הכותרת המעודכנת של המשימה (ביקורת Codex).
       *
       * הבדיקה כאן ולא בשליחה: `task.created` נשלח גם ביצירה וגם
       * בהעברה, וה-Job הישן כבר יושב בתור ואי אפשר לבטלו.
       */
      if (
        data.recipientUserId &&
        task.assignedToUserId !== data.recipientUserId
      )
        return;
    }

    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId: data.tenantId,
        userId: data.recipientUserId ?? null, // NULL = התראה משרדית
        type: data.type,
        title: data.title,
        body: data.body ?? null,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
      },
    });
  });
}
