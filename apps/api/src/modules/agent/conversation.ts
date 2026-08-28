import { Prisma } from "@prisma/client";
import {
  conversationLockKey,
  mergeStoredTurns,
  parseStoredTurns,
  type AgentHistoryTurn,
} from "@metavchim/shared";
import type { TenantTx } from "../../core/prisma.service";

/**
 * ‎**שיחה אחת, שני ערוצים — הצד של המסד.**
 *
 * הליבה הטהורה — מפתח הנעילה, הפירוק והמיזוג — יושבת ב-shared
 * (`agent/history.ts`), כי גם ה-Worker כותב לאותה עמודה ואינו יכול
 * לייבא מכאן. הקובץ הזה מוסיף רק את מה שדורש טרנזקציה: לקיחת
 * המנעול והמרת התורות לערך העמודה.
 */

export const parseTurns = parseStoredTurns;
export const mergeTurns = mergeStoredTurns;

export async function lockConversation(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${conversationLockKey(tenantId, userId)}, 0))`;
}

/** התורות כערך שנכתב לעמודה. */
export function turnsAsJson(turns: readonly AgentHistoryTurn[]): Prisma.InputJsonValue {
  return turns as unknown as Prisma.InputJsonValue;
}
