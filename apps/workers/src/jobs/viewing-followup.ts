import { type Job } from "bullmq";
import { ulid } from "ulid";
import { z } from "zod";
import { withTenant } from "../runtime.js";
import { automationOn } from "../tenant-settings.js";

const ViewingFollowupJobSchema = z.object({
  tenantId: z.string(),
  appointmentId: z.string(),
});
const VIEWING_FOLLOWUP_TITLE = "פולו-אפ אחרי סיור — איך היה?";

/**
 * פולו-אפ אחרי סיור (docs/09 שלב 2): שעה אחרי סיום הסיור, אם הסוכן
 * עוד לא רשם תוצאה — נוצרת משימת "איך היה?" + התראה. עדכון הסטטוס
 * לקונה מיד אחרי סיור הוא ההבדל בין עסקה מתקדמת לליד שמתקרר.
 * אידמפוטנטי: sourceKey לפי הפגישה, ונעילת שורת הישות כמו בשאר.
 */
/* גם כאן — הכיבוי חייב לתפוס Job שכבר ממתין בתור */
export async function processViewingFollowup(job: Job): Promise<void> {
  const { tenantId, appointmentId } = ViewingFollowupJobSchema.parse(job.data);
  if (!(await automationOn(tenantId, "viewing_followup"))) return;
  await withTenant(tenantId, async (tx) => {
    // נעילת שורת הפגישה: PATCH של סיכום/ביטול שרץ במקביל מסתדר בתור —
    // או שה-Worker רואה את המצב החדש ומדלג, או שסגירת המשימות של ה-PATCH
    // רצה אחרי שהמשימה כבר קיימת וסוגרת אותה (ביקורת Codex)
    await tx.$executeRaw`SELECT id FROM appointments WHERE id = ${appointmentId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const appt = await tx.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });
    if (!appt || appt.kind !== "viewing") return;
    // בוטל / לא הגיע — אין סיכום סיור; תוצאה כבר נרשמה — אין מה לדחוף
    if (appt.status === "cancelled" || appt.status === "no_show") return;
    if (appt.outcome !== null) return;
    if (!appt.createdBy) return;

    // גם סיור בלי קונה/ליד מקבל פולו-אפ — זה מסלול היצירה הנפוץ מהיומן;
    // מקשרים למה שיש: קונה → ליד → נכס → בלי קישור (ביקורת Codex, P1)
    const entity =
      appt.buyerId !== null
        ? { type: "buyer", id: appt.buyerId }
        : appt.leadId !== null
          ? { type: "lead", id: appt.leadId }
          : appt.propertyId !== null
            ? { type: "property", id: appt.propertyId }
            : null;

    const sourceKey = `viewing:${appointmentId}`;
    // הדדופ לפי sourceKey בלבד — ייחודי פר פגישה גם בלי ישות מקושרת
    const existing = await tx.task.findFirst({
      where: { tenantId, sourceKey, status: "open" },
      select: { id: true },
    });
    if (existing) return;

    const what = appt.title ?? "הסיור";
    await tx.task.create({
      data: {
        id: ulid(),
        tenantId,
        assignedToUserId: appt.createdBy,
        title: VIEWING_FOLLOWUP_TITLE,
        notes: `"${what}" הסתיים — התקשרו ללקוח ("איך היה?") ורשמו תוצאה בפגישה: אהב / לא מתאים / במשא-ומתן / צריך נכס אחר.`,
        dueAt: new Date(),
        entityType: entity?.type ?? null,
        entityId: entity?.id ?? null,
        sourceKey,
      },
    });
    /*
     * ‎**ההתראה מצביעה על הסיור עצמו**, לא על הקונה: הכפתורים
     * ‏בוואטסאפ („המחיר גבוה / הוגן / נמוך”) נושאים את מזהה הסיור,
     * ‏והמשוב נרשם עליו (docs/03 — appointments). המשימה נשארת על
     * ‏הקונה/הליד/הנכס — היא „לחזור ללקוח”, וזה כרטיס הלקוח.
     */
    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId,
        userId: appt.createdBy,
        type: "viewing_followup",
        title: "🚶 סיור הסתיים — איך היה?",
        body: `"${what}" הסתיים ועדיין אין סיכום — נוצרה משימה לחזור ללקוח ולרשום תוצאה. מה אמר הקונה על המחיר?`,
        entityType: "appointment",
        entityId: appointmentId,
      },
    });
  });
}
