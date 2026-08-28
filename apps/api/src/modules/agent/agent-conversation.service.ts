import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import type { AgentHistoryTurn } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";
import { lockConversation, mergeTurns, parseTurns, turnsAsJson } from "./conversation";

/**
 * שיחת הסוכן של המשתמש — הצד של המסך.
 *
 * הוואטסאפ כותב את התורות שלו לאותה שורה בסבב ההודעה (`saveChat`);
 * המסך קורא אותה בפתיחה — ולכן שיחה שהתחילה בוואטסאפ נמשכת במסך —
 * וכותב אליה כל תור שבוצע, כדי שהכיוון ההפוך יעבוד באותה מידה.
 *
 * הכתיבה נוגעת ב-`history` בלבד: `pending` (ההצעה שממתינה ל„אשר”)
 * ו-`handledIds` הם מנגנוני הערוץ של הוואטסאפ, ולמסך אין בהם עסק —
 * כרטיס האישור שלו חי בדפדפן, לא בשורה.
 */
@Injectable()
export class AgentConversationService {
  constructor(private readonly prisma: PrismaService) {}

  /** התורות השמורים, מהישן לחדש. */
  async turns(): Promise<AgentHistoryTurn[]> {
    const { tenantId, userId } = TenantContext.current();
    const row = await this.prisma.withTenant((tx) =>
      tx.whatsAppChat.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: { history: true },
      }),
    );
    return parseTurns(row?.history);
  }

  /** הוספת תור שבוצע — תחת אותו מנעול שכל הכותבים לוקחים. */
  async append(turn: AgentHistoryTurn): Promise<void> {
    const { tenantId, userId } = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      await lockConversation(tx, tenantId, userId);
      const row = await tx.whatsAppChat.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: { history: true },
      });
      const history = turnsAsJson(mergeTurns(parseTurns(row?.history), [turn]));
      await tx.whatsAppChat.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { id: ulid(), tenantId, userId, history },
        update: { history },
      });
    });
  }
}
