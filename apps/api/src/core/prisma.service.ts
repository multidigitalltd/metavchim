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

  /**
   * קריאת רשת שיתופי הפעולה: ביקושים אנונימיים גלויים לכל הסוכנויות
   * (docs/04 §7). פוליסת ה-RLS של shared_demands מתירה SELECT כשמוגדר
   * app.network_read — אין בטבלה PII, והקישור לקונה לא נחשף בשכבת ה-DTO.
   */
  async withNetworkRead<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.network_read', 'on', true)`;
      return fn(tx);
    });
  }

  /**
   * גישה ציבורית לפי טוקן הצעה (דף ההצעה ללקוח קצה): פוליסת RLS ייעודית
   * חושפת אך ורק את שורת ההצעה שהטוקן שלה הוצג — בלי הקשר דייר,
   * בלי גישה לשום טבלה אחרת.
   */
  async withPublicOffer<T>(token: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.offer_token', ${token}, true)`;
      return fn(tx);
    });
  }

  /** גישת הלקוח החותם — הטוקן שבקישור הוא המפתח, בלי הקשר דייר. */
  async withPublicAgreement<T>(token: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.agreement_token', ${token}, true)`;
      return fn(tx);
    });
  }

  /**
   * גישה ציבורית לפי טוקן דף נחיתה של נכס — אותו דפוס: הפוליסה חושפת
   * את שורת הנכס של הטוקן ואת התמונות שלו בלבד.
   */
  async withPublicLanding<T>(token: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.landing_token', ${token}, true)`;
      return fn(tx);
    });
  }
}
