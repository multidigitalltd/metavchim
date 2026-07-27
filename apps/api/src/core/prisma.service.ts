import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { TenantContext } from "../common/tenant-context";

export type TenantTx = Prisma.TransactionClient;

/**
 * שער הגישה היחיד לבסיס הנתונים.
 *
 * `withTenant` הוא הדרך המחייבת לגשת לטבלאות עסקיות: הוא פותח טרנזקציה,
 * מזריק את מזהה הדייר מ-TenantContext ל-`app.tenant_id`, ופוליסות ה-RLS
 * ב-PostgreSQL אוכפות שאף שורה של דייר אחר לא תיקרא או תיכתב — גם אם
 * הקוד העסקי שגה (docs/04 §2, ADR-003).
 *
 * גישה ישירה (this.user וכו') שמורה לשכבת האימות בלבד (users/sessions,
 * שאינן תחת RLS בכוונה).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async withTenant<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    const { tenantId } = TenantContext.current();
    return this.$transaction(async (tx) => {
      // set_config עם is_local=true — התקף פג בסוף הטרנזקציה, אין זליגה בין בקשות.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }
}
