import { BadRequestException } from "@nestjs/common";
import { limitState, type PlanDefinition } from "@metavchim/shared";
import type { TenantTx } from "../../core/prisma.service";

/**
 * מכסת הפרסום ברשת — **המקום שבו המסלול החינמי מקבל את גבולותיו.**
 *
 * ## למה המכסה כאן ולא על השמירה במאגר
 *
 * `maxProperties` מגביל כמה נכסים המשרד שומר אצלו. זה המאגר שלו,
 * ומסלול חינם שמגביל אותו הוא מסלול שאי אפשר לבחון בו את המערכת.
 * המכסה שכאן יושבת על מה שהמשרד **לוקח מהרשת**: חשיפה מול כל שאר
 * המשרדים. משרד יכול לנהל אלף נכסים ולפרסם שלושה.
 *
 * ## מה נספר
 *
 * רק פרסומים פעילים. מודעה שהוסרה מפנה מקום מיד — אחרת המשרד היה
 * מגלה שהוא חסום לצמיתות אחרי שלוש הסרות, וזו בדיוק אותה מלכודת
 * שכבר תוקנה במכסת הנכסים (שם ספירה שכללה ארכיון חסמה משרד ריק).
 *
 * ## למה נעילה
 *
 * ספירה ואז יצירה אינן אטומיות: שתי לשוניות שלוחצות "פרסם" באותו
 * רגע קוראות שתיהן 2 מתוך 3 ושתיהן יוצרות. `pg_advisory_xact_lock`
 * על מפתח שנגזר מהדייר ומהסוג מסדר את השתיים בטור בלי לנעול טבלה —
 * אותה תבנית כמו מכסת הנכסים, ומאותה סיבה.
 */

export type NetworkQuotaKind = "listing" | "demand";

interface QuotaSpec {
  limitOf: (plan: PlanDefinition) => number | null;
  count: (tx: TenantTx, tenantId: string) => Promise<number>;
  /** "3 נכסים" — מה שמופיע בהודעת החסימה. */
  noun: (limit: number) => string;
}

const SPECS: Record<NetworkQuotaKind, QuotaSpec> = {
  listing: {
    limitOf: (plan) => plan.maxNetworkListings,
    count: (tx, tenantId) =>
      tx.sharedListing.count({ where: { tenantId, status: "active" } }),
    noun: (limit) => `${limit} נכסים`,
  },
  demand: {
    limitOf: (plan) => plan.maxNetworkDemands,
    count: (tx, tenantId) =>
      tx.sharedDemand.count({ where: { tenantId, status: "active" } }),
    noun: (limit) => `${limit} קונים`,
  },
};

/**
 * חוסם פרסום נוסף כשהמסלול מיצה את המכסה.
 *
 * `plan === undefined` נחסם ואינו נפתח: משרד עם קוד מסלול שאינו
 * מוכר הוא מצב תקלה, ומכסה אינסופית היא בדיוק התשובה הלא נכונה לו
 * (אותו כיוון בטוח כמו במכסת הנכסים).
 */
export async function assertNetworkQuota(
  tx: TenantTx,
  tenantId: string,
  plan: PlanDefinition | undefined,
  kind: NetworkQuotaKind,
): Promise<void> {
  if (plan === undefined) {
    throw new BadRequestException("המסלול של המשרד אינו מוגדר — פנו לתמיכה");
  }
  const spec = SPECS[kind];
  const limit = spec.limitOf(plan);
  if (limit === null) return;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`network-quota:${kind}:${tenantId}`}))`;
  const used = await spec.count(tx, tenantId);
  if (limitState(used, limit).blocked) {
    throw new BadRequestException(
      `מסלול "${plan.name}" מאפשר לפרסם ברשת עד ${spec.noun(limit)}. ` +
        `אפשר להסיר פרסום קיים כדי לפנות מקום, או לשדרג מסלול.`,
    );
  }
}
