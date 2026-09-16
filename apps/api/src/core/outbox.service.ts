import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import type { DomainEventName, DomainEventPayload } from "@metavchim/shared";
import { DomainEvents } from "@metavchim/shared";
import { TenantContext } from "../common/tenant-context";
import type { TenantTx } from "./prisma.service";

/**
 * דפוס Outbox (docs/02 §5): האירוע נכתב באותה טרנזקציה עם השינוי העסקי.
 * Worker ייעודי מפיץ את השורות הלא-מפורסמות לתורים — כך אין אירועים
 * אבודים ואין חצאי-מצב.
 */
@Injectable()
export class OutboxService {
  async emit<E extends DomainEventName>(
    tx: TenantTx,
    name: E,
    payload: DomainEventPayload<E>,
  ): Promise<void> {
    await this.emitFor(tx, TenantContext.current().tenantId, name, payload);
  }

  /**
   * ‏אותה פליטה כשהמשרד ידוע מהנתונים ולא מההתחברות — נתיבים ציבוריים
   * ‏(הרשמה לבית פתוח מדף הנחיתה), שבהם אין `TenantContext` ובכל זאת
   * ‏הסיור שנוצר צריך תזכורת ופולו-אפ כמו כל סיור.
   */
  async emitFor<E extends DomainEventName>(
    tx: TenantTx,
    tenantId: string,
    name: E,
    payload: DomainEventPayload<E>,
  ): Promise<void> {
    // ולידציה מול החוזה — אירוע לא-תקני נתפס בכתיבה, לא אצל הצרכן.
    const validated = DomainEvents[name].parse(payload);
    await tx.outboxEvent.create({
      data: {
        id: ulid(),
        tenantId,
        name,
        payload: validated as object,
      },
    });
  }
}
