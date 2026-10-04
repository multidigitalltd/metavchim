import { type Job } from "bullmq";
import { ulid } from "ulid";
import { z } from "zod";
import { NOT_RELEVANT_MATURITY } from "@metavchim/shared";
import { withTenant } from "../runtime.js";
import { automationOn } from "../tenant-settings.js";

const FollowupJobSchema = z.object({
  tenantId: z.string(),
  offerId: z.string(),
});
const FOLLOWUP_TITLE = "פולו-אפ: הקונה פתח את ההצעה ולא הגיב";

/**
 * פולו-אפ הצעה (docs/01 — "כלום לא נשכח"): ה-Job תוזמן בפתיחה הראשונה
 * ויורה אחרי N שעות. אם הקונה עדיין לא הגיב — משימה לסוכן בעל הקונה
 * + התראה. אידמפוטנטי: משימת פולו-אפ פתוחה קיימת לאותו קונה — לא
 * נוצרת שנייה (ניסיון חוזר אחרי כשל חלקי בטוח).
 */
/*
 * הבדיקה גם בזמן הירייה ולא רק בתזמון.
 *
 * ה-Job מתוזמן עם השהיה של שעות; משרד שכיבה את האוטומציה בינתיים לא
 * ביקש לקבל את המשימה שנקבעה לפני יומיים, וביטול Job שכבר יושב בתור
 * אינו אפשרי. אותו דפוס בדיוק כמו תזכורת משימה שנבדקת מחדש בירייה.
 */
export async function processOfferFollowup(job: Job): Promise<void> {
  const { tenantId, offerId } = FollowupJobSchema.parse(job.data);
  if (!(await automationOn(tenantId, "offer_followup"))) return;
  await withTenant(tenantId, async (tx) => {
    const offer = await tx.offer.findFirst({
      where: { id: offerId, tenantId },
    });
    if (!offer) return;
    // הקונה כבר הגיב (מעוניין/לא רלוונטי) — אין מה לרדוף
    if (offer.status === "interested" || offer.status === "declined") return;

    const match = await tx.match.findFirst({
      where: { id: offer.matchId, tenantId },
      select: { buyerId: true },
    });
    if (!match) return;
    const buyer = await tx.buyer.findFirst({
      /* ‏„לא רלוונטי” — אין למי לחזור על ההצעה */
      where: { id: match.buyerId, tenantId, deletedAt: null, maturity: { not: NOT_RELEVANT_MATURITY } },
      select: { id: true, ownerUserId: true },
    });
    if (!buyer?.ownerUserId) return;

    // נעילת שורת הקונה: שני פולו-אפים על הצעות שונות של אותו קונה
    // מסתדרים בתור — בדיקת הכפילות אטומית (ביקורת Codex)
    await tx.$executeRaw`SELECT id FROM buyers WHERE id = ${buyer.id} AND tenant_id = ${tenantId} FOR UPDATE`;
    const existing = await tx.task.findFirst({
      where: {
        tenantId,
        entityType: "buyer",
        entityId: buyer.id,
        title: FOLLOWUP_TITLE,
        status: "open",
      },
      select: { id: true },
    });
    if (existing) return;

    const presentation = offer.presentation as { title?: string } | null;
    const offerTitle = presentation?.title ?? "ההצעה";
    await tx.task.create({
      data: {
        id: ulid(),
        tenantId,
        assignedToUserId: buyer.ownerUserId,
        title: FOLLOWUP_TITLE,
        notes: `"${offerTitle}" נפתחה ולא נענתה — שווה שיחה קצרה לפני שהעניין מתקרר.`,
        dueAt: new Date(),
        entityType: "buyer",
        entityId: buyer.id,
      },
    });
    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId,
        userId: buyer.ownerUserId,
        type: "offer_followup",
        title: "⏰ הצעה ממתינה לפולו-אפ",
        body: `"${offerTitle}" נפתחה ולא נענתה — נוצרה משימה לחזור לקונה.`,
        entityType: "buyer",
        entityId: buyer.id,
      },
    });
  });
}
