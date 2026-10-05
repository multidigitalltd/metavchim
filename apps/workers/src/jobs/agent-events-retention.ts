import { prisma, withTenant } from "../runtime.js";

/*
 * הערך נבדק, לא רק נקרא: משתנה ריק או שלילי היה הופך את קו החיתוך
 * ל"עכשיו" — והסריקה הבאה הייתה מוחקת את היומן כולו במקום לשמור
 * חצי שנה (ביקורת Codex). ערך לא-תקין נופל לברירת המחדל.
 */
const AGENT_EVENTS_RETENTION_DAYS = (() => {
  const parsed = Number(process.env["AGENT_EVENTS_RETENTION_DAYS"]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 180;
})();

export async function processAgentEventsRetention(): Promise<void> {
  const cutoff = new Date(
    Date.now() - AGENT_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let removed = 0;
  for (const tenant of tenants) {
    try {
      const result = await withTenant(tenant.id, async (tx) => {
        return tx.agentEvent.deleteMany({
          where: { tenantId: tenant.id, createdAt: { lt: cutoff } },
        });
      });
      removed += result.count;
    } catch (error: unknown) {
      // דייר אחד שנכשל לא עוצר את הניקוי אצל השאר
      console.error(`[agent-events-retention] ${tenant.id}: ${String(error)}`);
    }
  }
  if (removed > 0) {
    console.warn(
      `[agent-events-retention] נמחקו ${removed} אירועי סוכן ישנים מ-${AGENT_EVENTS_RETENTION_DAYS} ימים`,
    );
  }
}
