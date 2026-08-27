import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { IdSchema, type PlanDefinition } from "@metavchim/shared";
import { AnyAuthenticated, BillingAllowed, RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CardcomService } from "../../core/cardcom.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { BillingService } from "./billing.service";
import { InvoiceService } from "./invoice.service";
import { SubscriptionOfferService, type OfferView } from "./subscription-offer.service";

const CheckoutSchema = z
  .object({
    plan: z.string().min(1).max(20),
    cycle: z.enum(["monthly", "yearly"]),
  })
  .strict();

/**
 * רכישת קרדיטים. התקרה היא הגנת שפיות מפני טעות הקלדה — רכישה
 * גדולה מזה נעשית מול הפלטפורמה ולא בלחיצה.
 */
const BuyCreditsSchema = z.object({ credits: z.number().int().min(1).max(100_000) }).strict();

/** מעבר למסלול חינמי — הקוד בלבד; השרת מוודא שהוא באמת חינמי. */
const SwitchFreeSchema = z.object({ plan: z.string().min(1).max(20) }).strict();

/**
 * טוקן של הצעה בלינק — base64url בלבד. הצורה נבדקת כאן כדי שקלט
 * שבור ייעצר לפני שאילתה; הקיום נבדק מול הטבלה, ששם זה רלוונטי.
 */
const OfferTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/u, "לינק לא תקין");

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
    private readonly offers: SubscriptionOfferService,
    private readonly invoices: InvoiceService,
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

  /**
   * הורדת חשבונית מס קבלה — **הפניה לקישור טרי מלינט.**
   *
   * הקישור אינו נצחי, ולכן הוא נמשך בכל הורדה במקום להישמר במסך.
   * המסמך עצמו יושב אצל ספק הפקת המסמכים; אנחנו מחזיקים את המזהה
   * ואת מי שרשאי לראות אותו — כלומר מי שמנהל את החיוב של אותו משרד.
   */
  @Get("invoices/:id/download")
  @RequireCapability("billing.manage")
  async invoiceDownload(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ url: string }> {
    return { url: await this.invoices.downloadUrl(id, TenantContext.current().tenantId) };
  }

  /**
   * רכישת קרדיטים לרשת השיתופים.
   *
   * `billing.manage` כמו כל תשלום אחר: זו הוצאה כספית של המשרד,
   * ולא כל מי שמשתמש ברשת מוסמך לחייב את הכרטיס.
   *
   * הכמות בלבד מגיעה מהלקוח — **המחיר נקבע בשרת** מהכלכלה שהוגדרה
   * בפלטפורמה.
   */
  @Post("credits/checkout")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async buyCredits(
    @Body(new ZodValidationPipe(BuyCreditsSchema)) body: z.infer<typeof BuyCreditsSchema>,
  ): Promise<{ url: string; paymentId: string }> {
    const { tenantId, userId } = TenantContext.current();
    return this.billing.startCreditCheckout({ tenantId, userId, credits: body.credits });
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

  /**
   * מעבר למסלול חינמי — בלי דף תשלום ובלי נציג. השרת מאמת שהמסלול
   * באמת חינמי וציבורי; ראו BillingService.switchToFreePlan.
   */
  @Post("switch-free")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async switchFree(
    @Body(new ZodValidationPipe(SwitchFreeSchema)) body: z.infer<typeof SwitchFreeSchema>,
  ): Promise<{ ok: true }> {
    await this.billing.switchToFreePlan(TenantContext.current().tenantId, body.plan);
    return { ok: true };
  }

  @Post("cancel")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async cancel(): Promise<{ ok: true }> {
    await this.billing.cancel(TenantContext.current().tenantId);
    return { ok: true };
  }

  /**
   * דף ההצעה בלינק — מה מקבלים וכמה זה עולה.
   *
   * **לצפייה מספיקה התחברות**, כמו מסך המנוי: מי שקיבל את הלינק
   * צריך לראות את ההצעה גם אם רק בעל המשרד ישלם עליה. דחייה (פג
   * תוקף, בוטל) חוזרת כתשובה תקינה עם הסבר — זה מצב שהדף מציג,
   * לא תקלה.
   */
  @Get("offers/:token")
  @AnyAuthenticated()
  async offerView(
    @Param("token", new ZodValidationPipe(OfferTokenSchema)) token: string,
  ): Promise<OfferView & { checkoutAvailable: boolean; mayManage: boolean }> {
    const ctx = TenantContext.current();
    return {
      ...(await this.offers.view(token, ctx.tenantId)),
      checkoutAvailable: await this.cardcom.isConfigured(),
      // הדף מציג "רכישה נעשית ע"י בעל/ת המשרד" במקום כפתור שייכשל
      mayManage: ctx.capabilities.has("billing.manage"),
    };
  }

  /** פתיחת תשלום על הצעה. הסכום נקבע בשרת מההצעה — לא מהדפדפן. */
  @Post("offers/:token/checkout")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async offerCheckout(
    @Param("token", new ZodValidationPipe(OfferTokenSchema)) token: string,
  ): Promise<{ url: string; paymentId: string }> {
    const { tenantId, userId } = TenantContext.current();
    return this.billing.startOfferCheckout({ tenantId, userId, token });
  }
}
