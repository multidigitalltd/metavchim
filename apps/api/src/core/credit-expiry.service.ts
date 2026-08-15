import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ulid } from "ulid";
import { Prisma } from "@prisma/client";
import {
  EXPIRY_KIND,
  expiryWarningText,
  planCreditExpiry,
  type CreditLedgerEntry,
} from "@metavchim/shared";
import { CreditEconomyService } from "./credit-economy.service";
import { PrismaService, type TenantTx } from "./prisma.service";

/** כל שעה. התפוגה נמדדת בחודשים — דיוק של שעה הוא יותר מדי, לא פחות. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * דקה אחרי העלייה. לא מיד: בעליית השרת רצות מיגרציות ונטענות
 * הגדרות, ואין סיבה שסריקה כספית תתחרה בהן על החיבורים.
 */
const FIRST_SWEEP_DELAY_MS = 60 * 1000;

/**
 * אכיפת תפוגת הקרדיטים.
 *
 * **למה ב-API ולא ב-Workers**, שם יושבות שאר הסריקות: התפוגה נגזרת
 * מ`creditExpiryMonths` שב-`platform_settings`, והערכים שם מוצפנים
 * ונקראים דרך `PlatformSettingsService`. פתיחת מסלול פענוח שני
 * בתהליך שמעולם לא נזקק למפתח ההצפנה היא מחיר גבוה מהרווח של גבול
 * תהליך. הסריקה עצמה זולה: שאילתה אחת למשרד, פעם בשעה.
 *
 * **ריצה במקביל בטוחה.** ההפקעה נכתבת עם `ref_id` של המנה, ואינדקס
 * ייחודי חלקי במסד מונע שתי הפקעות לאותה מנה. שני עותקי API שירוצו
 * יחד — אחד ייכשל על ייחודיות והשני יכתוב. זו ההגנה, ולא התזמון.
 */
@Injectable()
export class CreditExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CreditExpiryService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly economy: CreditEconomyService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    }, FIRST_SWEEP_DELAY_MS);
    // אחרת התהליך לא יוצא בבדיקות ובסקריפטים קצרים
    this.kickoff.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } catch (error: unknown) {
      this.logger.error(`credit expiry sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * סבב אחד על כל המשרדים.
   *
   * ציבורי כדי שאפשר יהיה להריץ אותו בבדיקה מול מסד אמיתי במקום
   * לחכות שעה ולקוות.
   */
  async sweep(now: Date): Promise<{ expired: number; warned: number }> {
    const { expiryMonths } = await this.economy.current();
    /*
     * כיבוי ההגדרה חייב להיות מיידי ומלא — כולל אי-שליחת אזהרות על
     * תפוגה שלא תקרה. יציאה מוקדמת ולא סינון בהמשך.
     */
    if (expiryMonths <= 0) return { expired: 0, warned: 0 };

    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let expired = 0;
    let warned = 0;
    for (const tenant of tenants) {
      try {
        const result = await this.sweepTenant(tenant.id, expiryMonths, now);
        expired += result.expired;
        warned += result.warned;
      } catch (error: unknown) {
        // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
        this.logger.warn(`credit expiry failed for tenant ${tenant.id}: ${String(error)}`);
      }
    }
    if (expired > 0 || warned > 0) {
      this.logger.log(`תפוגת קרדיטים: ${expired} מנות הופקעו, ${warned} התראות נשלחו`);
    }
    return { expired, warned };
  }

  private async sweepTenant(
    tenantId: string,
    expiryMonths: number,
    now: Date,
  ): Promise<{ expired: number; warned: number }> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const rows = await tx.creditLedger.findMany({
        where: { tenantId },
        select: { id: true, kind: true, amount: true, refId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      if (rows.length === 0) return { expired: 0, warned: 0 };

      const plan = planCreditExpiry(rows as CreditLedgerEntry[], expiryMonths, now);

      let expired = 0;
      for (const action of plan.expire) {
        try {
          await tx.creditLedger.create({
            data: {
              id: ulid(),
              tenantId,
              kind: EXPIRY_KIND,
              amount: -action.amount,
              refId: action.batchId,
            },
          });
          expired += 1;
        } catch (error: unknown) {
          /*
           * P2002 = עותק אחר הספיק להפקיע את אותה מנה. זו התוצאה
           * הרצויה ולא תקלה — ההפקעה קרתה בדיוק פעם אחת.
           */
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            continue;
          }
          throw error;
        }
      }

      const warned = await this.warn(tx, tenantId, plan.expiringSoon, now);
      return { expired, warned };
    });
  }

  /**
   * התראה על מנה שנכנסה לחלון האזהרה.
   *
   * **התראה אחת לכל מנה, אי פעם.** ההתראה מעוגנת במזהה המנה
   * (`entityId`), וקיומה של שורה קודמת חוסם שנייה — אחרת המשרד היה
   * מקבל את אותה הודעה בכל שעה במשך שלושים יום, וזו הדרך הבטוחה
   * ביותר להרגיל אותו להתעלם מהתראות.
   */
  private async warn(
    tx: TenantTx,
    tenantId: string,
    soon: { batchId: string; amount: number; expiresAt: Date }[],
    now: Date,
  ): Promise<number> {
    if (soon.length === 0) return 0;
    const owners = await tx.user.findMany({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (owners.length === 0) return 0;

    let sent = 0;
    for (const action of soon) {
      const already = await tx.notification.findFirst({
        where: { tenantId, type: "credits_expiring", entityType: "credit_batch", entityId: action.batchId },
        select: { id: true },
      });
      if (already) continue;
      const text = expiryWarningText([action], now);
      for (const owner of owners) {
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId,
            userId: owner.id,
            type: "credits_expiring",
            title: text.title,
            body: text.body,
            entityType: "credit_batch",
            entityId: action.batchId,
          },
        });
      }
      sent += 1;
    }
    return sent;
  }
}
