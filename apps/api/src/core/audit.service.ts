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
        userId: ctx.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? {}) as object,
      },
    });
  }
}
