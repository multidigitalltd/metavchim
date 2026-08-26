import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { NumberRentalService, type RentalRow } from "./number-rental.service";

/**
 * השכרת מספרים וירטואליים — הצד של המשרד.
 *
 * מאחורי הפיצ'ר `telephony`, כמו מסך המספרים הווירטואליים: מספר
 * שכור בלי מרכזייה שקולטת את שיחותיו הוא הבטחה ריקה.
 *
 * לצפות בהיצע מספיק `settings.manage` (זה חלק ממסך ההגדרות);
 * **לשלם ולבטל** דורש `billing.manage` — זו הוצאה כספית חוזרת של
 * המשרד, ואותה רמת הרשאה כמו רכישת מנוי וקרדיטים.
 */

const CheckoutSchema = z
  .object({
    /*
     * המספר בלבד — ספרות כפי ש-015 מחזיר אותן ברשימת הפנויים.
     * המחיר לעולם אינו מגיע מהדפדפן; הוא נקבע בהגדרת הפלטפורמה.
     */
    number: z.string().trim().regex(/^\d{4,20}$/u, "מספר לא תקין"),
  })
  .strict();

@RequireFeature("telephony")
@Controller("billing/number-rental")
export class NumberRentalController {
  constructor(private readonly rentals: NumberRentalService) {}

  @Get()
  @RequireCapability("settings.manage")
  async offering(): Promise<{
    configured: boolean;
    checkoutAvailable: boolean;
    monthlyAgorot: number | null;
    available: string[];
    rentals: RentalRow[];
  }> {
    return this.rentals.offering(TenantContext.current().tenantId);
  }

  /** פתיחת דף תשלום — חודש ראשון מראש. מחזיר כתובת להפניית הדפדפן. */
  @Post("checkout")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async checkout(
    @Body(new ZodValidationPipe(CheckoutSchema)) body: z.infer<typeof CheckoutSchema>,
  ): Promise<{ url: string; paymentId: string }> {
    const { tenantId, userId } = TenantContext.current();
    return this.rentals.startCheckout({ tenantId, userId, number: body.number });
  }

  /** ביטול חידוש — המספר נשאר עד סוף התקופה ששולמה, בלי החזר יחסי. */
  @Post(":id/cancel")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async cancel(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.rentals.cancel(TenantContext.current().tenantId, id);
    return { ok: true };
  }
}
