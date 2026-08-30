import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { WhatsappSeatService, type SeatRow } from "./whatsapp-seat.service";

/**
 * מקומות נוספים לסוכן הוואטסאפ — הצד של המשרד.
 *
 * לצפות מספיק `settings.manage` (זה חלק ממסך ניהול הצוות);
 * ‎**לשלם ולבטל** דורש `billing.manage` — הוצאה כספית חוזרת של
 * המשרד, ואותה רמת הרשאה כמו רכישת מנוי, קרדיטים ומספרים.
 *
 * ‎**בלי שער `RequireFeature`.** מסלול שאינו כולל את הסוכן חוסם
 * בשירות עם נוסח שמסביר למה — שער פיצ'ר היה מחזיר 403 יבש על
 * המסך שאמור להסביר את המצב, כלומר בדיוק הקיר שהמסך נועד לפרק.
 */
@Controller("billing/whatsapp-seats")
export class WhatsappSeatController {
  constructor(private readonly seats: WhatsappSeatService) {}

  @Get()
  @RequireCapability("settings.manage")
  async offering(): Promise<{
    seats: number;
    used: number;
    offer: unknown;
    checkoutAvailable: boolean;
    rows: SeatRow[];
  }> {
    return this.seats.offering(TenantContext.current().tenantId);
  }

  /** פתיחת דף תשלום — חודש ראשון מראש. מחזיר כתובת להפניית הדפדפן. */
  @Post("checkout")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async checkout(): Promise<{ url: string; paymentId: string }> {
    const { tenantId, userId } = TenantContext.current();
    return this.seats.startCheckout({ tenantId, userId });
  }

  /** ביטול חידוש — המקום נשאר עד סוף התקופה ששולמה, בלי החזר יחסי. */
  @Post(":id/cancel")
  @HttpCode(200)
  @RequireCapability("billing.manage")
  async cancel(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{ ok: true }> {
    await this.seats.cancel(TenantContext.current().tenantId, id);
    return { ok: true };
  }
}
