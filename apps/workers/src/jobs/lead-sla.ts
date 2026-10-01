import { type Job } from "bullmq";
import { ulid } from "ulid";
import { z } from "zod";
import { automationThresholdMs } from "@metavchim/shared";
import { prisma } from "../runtime.js";
import { automationOn, automationSettings } from "../tenant-settings.js";
import { decryptSetting } from "../whatsapp/config.js";

const LeadSlaJobSchema = z.object({ tenantId: z.string(), leadId: z.string() });
/*
 * בלי המילה SLA: המתווך שקורא את המשימה לא חי את הז'רגון הזה,
 * ו"חלון ה-SLA חלף" נקרא כמו תקלה טכנית (דיווח המשתמש). אומרים
 * את הדבר עצמו — עבר יותר מדי זמן בלי מענה.
 */
const LEAD_SLA_TITLE = "לחזור לליד — מחכה יותר מדי זמן בלי מענה";

/**
 * ‎**כותרת המשימה נושאת את שם הלקוח.**
 *
 * ‏„לחזור לליד — מחכה יותר מדי זמן בלי מענה” היא כותרת שמופיעה
 * ברשימת המשימות, בתקציר הבוקר ובוואטסאפ — ובכל שלושתם היא אומרת
 * בדיוק אפס. מתווך שקיבל אותה פעמיים באותו בוקר אינו יודע אם אלה
 * שני לקוחות או אותו אחד. השם הופך אותה למשימה שאפשר לפעול לפיה
 * בלי לפתוח כלום.
 *
 * ‏`sourceKey` הוא שמונע כפילות, לא הכותרת — שינוי הניסוח אינו
 * מייצר משימות חדשות על לידים שכבר יש להם אחת.
 */
function leadSlaTitle(contactName: string | null): string {
  return contactName === null || contactName === ""
    ? LEAD_SLA_TITLE
    : `לחזור ל${contactName} — מחכה יותר מדי זמן בלי מענה`;
}

/**
 * ‎**גבול לשם לפני שהוא נכנס לכותרת** — ולא חיתוך של הכותרת אחריה.
 *
 * ‏`contacts.name_encrypted` הוא עמודה בלי גבול, ומה שנכנס אליה
 * מסנכרון וואטסאפ (`full_name`) אינו מאומת באורך. שם באורך 300
 * תווים היה מפוצץ את `notifications.title` שהיא `VARCHAR(200)`,
 * ו-`create` שנכשל **מגלגל אחורה את כל הטרנזקציה** — כלומר גם
 * משימת האסקלציה. הליד עם השם הארוך היה היחיד שלא מקבל טיפול,
 * וזה כישלון שקט לגמרי (ביקורת Codex).
 *
 * החיתוך על השם ולא על המשפט, ובכוונה: חיתוך של הכותרת המוגמרת
 * היה משאיר „לחזור לדני — מחכה יותר מדי ז…”, כלומר בולע דווקא את
 * הסיבה. שישים תווים מכסים כל שם אמיתי, ומה שמעבר להם אינו שם.
 */
const CONTACT_NAME_MAX = 60;

function displayName(name: string | null): string | null {
  if (name === null) return null;
  const clean = name.trim();
  if (clean === "") return null;
  return clean.length > CONTACT_NAME_MAX ? `${clean.slice(0, CONTACT_NAME_MAX - 1)}…` : clean;
}

/**
 * SLA לליד (docs/01 — "כל ליד מקבל מענה"): ליד שנשאר "חדש" בלי מענה
 * ראשון אחרי N שעות. משויך לסוכן — המשימה וההתראה אליו; ליד יתום
 * (וואטסאפ נכנס) — המשימה לבעלים הוותיק וההתראה לכל הבעלים הפעילים.
 * נעילת שורת הליד + sourceKey: מרוץ מול טיפול בליד לא מייצר רעש.
 */
async function escalateLeadSla(
  tenantId: string,
  leadId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.$executeRaw`SELECT id FROM leads WHERE id = ${leadId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) return;
    // טופל: הסטטוס זז או שנרשם מענה ראשון — אין אסקלציה
    if (lead.status !== "new" || lead.firstResponseAt !== null) return;

    /*
     * השם מפוענח כאן ולא נשלף מהליד: `contacts.name_encrypted` הוא
     * PII מוצפן, ואותו AES-GCM שמשרת את הגדרות הפלטפורמה משרת גם
     * אותו. כישלון פענוח נופל לניסוח הגנרי ואינו מבטל את האסקלציה.
     */
    const contact = await tx.contact.findFirst({
      where: { id: lead.contactId, tenantId },
      select: { nameEncrypted: true },
    });
    const contactName = displayName(
      contact === null ? null : decryptSetting(contact.nameEncrypted),
    );

    const sourceKey = `lead-sla:${leadId}`;
    const existing = await tx.task.findFirst({
      where: { tenantId, sourceKey, status: "open" },
      select: { id: true },
    });
    if (existing) return;

    // סוכן משויך שהושבת בינתיים לא רואה משימות — נופלים לבעלים (ביקורת Codex)
    const assignedActive = lead.assignedToUserId
      ? (await tx.user.findFirst({
          where: { id: lead.assignedToUserId, tenantId, isActive: true },
          select: { id: true },
        })) !== null
      : false;
    const owners = await tx.user.findMany({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const assignee = assignedActive ? lead.assignedToUserId! : owners[0]?.id;
    if (!assignee) return;
    const notifyUserIds = assignedActive ? [assignee] : owners.map((o) => o.id);

    await tx.task.create({
      data: {
        id: ulid(),
        tenantId,
        assignedToUserId: assignee,
        title: leadSlaTitle(contactName),
        notes:
          'הליד עדיין בסטטוס "חדש" ללא מענה ראשון — לקוח שמחכה עובר למתווך הבא. חזרו אליו עכשיו.',
        dueAt: new Date(),
        entityType: "lead",
        entityId: leadId,
        sourceKey,
      },
    });
    for (const userId of notifyUserIds) {
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          type: "lead_sla",
          title:
            contactName === null ? "⏳ ליד ממתין למענה" : `⏳ ${contactName} ממתין למענה`,
          body: "עבר יותר מדי זמן והליד עדיין ללא טיפול — נוצרה משימה לחזור ללקוח.",
          entityType: "lead",
          entityId: leadId,
        },
      });
    }
    await tx.interaction.create({
      data: {
        id: ulid(),
        tenantId,
        leadId,
        kind: "system",
        content:
          "עבר יותר מדי זמן בלי מענה ראשון — נוצרה משימת תזכורת לחזור ללקוח",
        createdBy: null,
      },
    });
  });
}

export async function processLeadSla(job: Job): Promise<void> {
  const { tenantId, leadId } = LeadSlaJobSchema.parse(job.data);
  /*
   * הכיבוי נבדק גם כאן ולא רק בסוויפ.
   *
   * ההסלמה רצה בשני מסלולים: Job מושהה שנוצר מ-`lead.created`,
   * וסריקת רשת-ביטחון. כיסוי הסוויף בלבד הותיר את המסלול **הראשי**
   * פתוח — משרד שכיבה את האוטומציה היה ממשיך לקבל בדיוק את המשימות
   * שביקש לא לקבל, כי ה-Job כבר ישב בתור (ביקורת Codex).
   */
  if (!(await automationOn(tenantId, "lead_sla"))) return;
  await escalateLeadSla(tenantId, leadId);
}

const LEAD_SLA_HOURS = Number(process.env.LEAD_SLA_HOURS ?? 2);

/**
 * סריקת רשת-ביטחון ל-SLA: ה-Job המושהה נוצר רק מאירוע lead.created
 * חדש — לידים שקדמו לפריסה (או שה-Job שלהם אבד ב-Redis) לא מכוסים
 * (ביקורת Codex). כל רבע שעה: לכל דייר, כל ליד "חדש" בלי מענה ראשון
 * שחלון ה-SLA שלו חלף עובר את אותה אסקלציה — האידמפוטנטיות של
 * escalateLeadSla (sourceKey + נעילה) מונעת כפילויות מול ה-Job המתוזמן.
 */
export async function processLeadSlaSweep(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    /*
     * הסף הוא של המשרד ולא של המערכת.
     *
     * קודם הוא היה משתנה סביבה אחד לכל המשרדים: משרד שמעדיף שעה
     * ומשרד שמעדיף יום קיבלו את אותה התנהגות, ואף אחד מהם לא ידע
     * שיש כאן הגדרה בכלל (`AUTOMATIONS.lead_sla`).
     */
    const settings = await automationSettings(tenant.id);
    if (!settings.lead_sla.enabled) continue;
    const cutoff = new Date(
      Date.now() -
        (automationThresholdMs("lead_sla", settings) ??
          LEAD_SLA_HOURS * 60 * 60 * 1000),
    );
    // עימוד cursor: הטיפול לא משנה את שורת הליד, כך ש-take בודד היה
    // מחזיר את אותם 200 לנצח ומרעיב את השאר (ביקורת Codex)
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        return tx.lead.findMany({
          where: {
            tenantId: tenant.id,
            status: "new",
            firstResponseAt: null,
            createdAt: { lte: cutoff },
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take: 200,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
      });
      for (const lead of batch) await escalateLeadSla(tenant.id, lead.id);
      if (batch.length < 200) break;
      cursor = batch[batch.length - 1]!.id;
    }
  }
}
