import { subscriptionGrantsAccess, type SubscriptionStatus } from "@metavchim/shared";
import { prisma } from "../runtime.js";

/**
 * מנויים שתקופתם הסתיימה ⟵ `past_due`.
 *
 * **הסורק הזה אינו שער האבטחה.** הגישה נחסמת ב-`tenantCanOperate`
 * לפי `tenants.paid_until`, בכל אימות Session, בלי תלות בכך שמשהו
 * ירוץ — סורק שנפל היה אחרת נותן גישה חינם לכל מי ששילם פעם אחת.
 * מה שהסורק עושה הוא ליישר את מצב המנוי לתצוגה: בלעדיו מסך החיוב
 * היה מציג "מנוי פעיל" למשרד שתקופתו נגמרה.
 *
 * מבוטל שתקופתו נגמרה נכנס גם הוא — הוא כבר לא "בוטל, זמין עד",
 * הוא פשוט נגמר.
 */
export async function processSubscriptionExpiry(): Promise<void> {
  const now = new Date();
  const candidates = await prisma.subscription.findMany({
    where: {
      status: { in: ["active", "cancelled"] },
      currentPeriodEnd: { not: null, lte: now },
    },
    select: { tenantId: true, status: true, currentPeriodEnd: true },
    take: 500,
  });

  let expired = 0;
  for (const row of candidates) {
    // אותו כלל שהמסך מציג, ולא העתק שלו
    if (
      subscriptionGrantsAccess(
        row.status as SubscriptionStatus,
        row.currentPeriodEnd,
        now,
      )
    ) {
      continue;
    }
    // מותנה בסטטוס שנקרא: תשלום שנכנס בין הקריאה לכתיבה לא נדרס
    const changed = await prisma.subscription.updateMany({
      where: {
        tenantId: row.tenantId,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd,
      },
      data: { status: "past_due" },
    });
    expired += changed.count;
  }
  if (expired > 0)
    console.warn(`[subscription-expiry] ${expired} מנויים סומנו כהסתיימו`);
}
