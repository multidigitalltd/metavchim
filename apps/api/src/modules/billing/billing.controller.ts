import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import type { PlanDefinition } from "@metavchim/shared";
import { AnyAuthenticated, BillingAllowed, RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CardcomService } from "../../core/cardcom.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { BillingService } from "./billing.service";

const CheckoutSchema = z
  .object({
    plan: z.string().min(1).max(20),
    cycle: z.enum(["monthly", "yearly"]),
  })
  .strict();

/**
 * מסך החיוב של המשרד.
 *
 * ההפרדה בין היכולות מכוונת: **לראות** את מצב המנוי מותר לכל מי
 * שמחובר — הבאנר "נשארו 3 ימים" צריך להופיע לסוכן, אחרת הוא נתקל
 * בנעילה בלי שראה אזהרה. **לשלם ולבטל** דורש `billing.manage`,
 * שיושבת אצל בעל המשרד בלבד (docs/04 §3).
 */
/*
 * כל הבקר פתוח גם למשרד שתקופתו נגמרה. זה בדיוק המסך שהוא צריך
 * להגיע אליו כדי לצאת מהמצב — ראו BillingAllowed.
 */
@BillingAllowed()
@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly plans: PlanCatalogService,
    private readonly cardcom: CardcomService,
  ) {}

  @Get()
  @AnyAuthenticated()
  async overview(): Promise<{
    subscription: Awaited<ReturnType<BillingService["current"]>>;
    plans: PlanDefinition[];
    /** false ⇒ המסך מציג "הסליקה טרם הופעלה" במקום כפתור שנופל. */
    checkoutAvailable: boolean;
  }> {
    const { tenantId } = TenantContext.current();
    return {
      subscription: await this.billing.current(tenantId),
      plans: await this.plans.publicPlans(),
      checkoutAvailable: await this.cardcom.isConfigured(),
    };
  }

  @Get("payments")
  @RequireCapability("billing.manage")
  async history(): Promise<Awaited<ReturnType<BillingService["history"]>>> {
    return this.billing.history(TenantContext.current().tenantId);
  }

  /** פתיחת דף תשלום. מחזיר כתובת שאליה הדפדפן מופנה. */
  @Post("checkout")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async checkout(
    @Body(new ZodValidationPipe(CheckoutSchema)) body: z.infer<typeof CheckoutSchema>,
  ): Promise<{ url: string; paymentId: string }> {
    const { tenantId, userId } = TenantContext.current();
    return this.billing.startCheckout({
      tenantId,
      userId,
      planCode: body.plan,
      cycle: body.cycle,
    });
  }

  /**
   * מצב תשלום — דף החזרה שואל עליו.
   *
   * הקריאה הזו גם **מאמתת מול קארדקום** אם הוובהוק טרם הגיע, כך
   * שמשרד ששילם רואה מנוי פעיל מיד ולא ממתין לוובהוק.
   */
  @Get("payments/:id")
  @RequireCapability("billing.manage")
  async paymentStatus(
    @Param("id") id: string,
  ): Promise<{ status: string; failureReason: string | null }> {
    return this.billing.paymentStatus(TenantContext.current().tenantId, id);
  }

  @Post("cancel")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async cancel(): Promise<{ ok: true }> {
    await this.billing.cancel(TenantContext.current().tenantId);
    return { ok: true };
  }
}
