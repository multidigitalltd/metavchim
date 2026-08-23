import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../common/tenant-context";
import type { TenantTx } from "./prisma.service";

/**
 * לוג ביקורת Append-Only (docs/04 §7) — נכתב באותה טרנזקציה עם השינוי,
 * כך שאין פעולה בלי תיעוד ואין תיעוד בלי פעולה.
 */
@Injectable()
export class AuditService {
  async record(
    tx: TenantTx,
    entry: {
      action: string;
      entityType: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const ctx = TenantContext.current();
    await tx.auditLog.create({
      data: {
        id: ulid(),
        tenantId: ctx.tenantId,
        /*
         * הקשר בלי משתמש הוא מצב אמיתי: רענון התאמות מתוזמן, וטופס
         * שהלקוח עצמו מילא. `userId` הוא `char(26)`, ומחרוזת ריקה
         * הייתה נשמרת בו כ-26 רווחים — ערך שנראה כמו מזהה, מופיע
         * בסינון „לפי משתמש”, ואינו שייך לאיש. `null` אומר את מה
         * שקרה: לפעולה הזו לא היה משתמש.
         */
        userId: ctx.userId === "" ? null : ctx.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        /*
         * פעולה שבוצעה ע"י התמיכה מסומנת ככזו — תמיד, אוטומטית.
         * בלי הסימון, כל מה שהתמיכה עשתה היה מיוחס למשתמש שבשמו
         * היא פעלה, וההבטחה "רואים מי עשה מה" הייתה שקר מנומס
         * (ביקורת Codex).
         */
        metadata: {
          ...(entry.metadata ?? {}),
          ...(ctx.supportAdminEmail ? { supportAdmin: ctx.supportAdminEmail } : {}),
        } as object,
      },
    });
  }
}
