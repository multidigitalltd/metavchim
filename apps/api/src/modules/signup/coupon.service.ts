import { Injectable, Logger } from "@nestjs/common";
import {
  couponRejection,
  describeCoupon,
  normalizeCouponCode,
  type CouponDefinition,
  type CouponRejection,
} from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";

/**
 * קודי קופון — בדיקה, מימוש וניהול.
 *
 * הקופון שייך לפלטפורמה ולא למשרד, ולכן הטבלה מחוץ ל-RLS והגישה
 * אליה היא דרך ה-client הרגיל. אין בה מידע על לקוחות קצה.
 */
@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async byCode(code: string): Promise<CouponDefinition | null> {
    const normalized = normalizeCouponCode(code);
    if (normalized === "") return null;
    const row = await this.prisma.coupon.findUnique({ where: { code: normalized } });
    return row === null ? null : (row as CouponDefinition);
  }

  /**
   * "האם הקוד תקף" — למסך ההרשמה, לפני השליחה.
   *
   * מחזיר את **התיאור** ולא את התנאים הגולמיים: המסך צריך לומר
   * "20% הנחה על התשלום הראשון", ולא לחשב בעצמו. חישוב בדפדפן הוא
   * חישוב שאפשר לשקר בו.
   */
  async check(
    code: string,
    planCode: string,
  ): Promise<{ valid: boolean; description?: string; rejection?: CouponRejection }> {
    const coupon = await this.byCode(code);
    const rejection = couponRejection(coupon, { planCode, now: new Date() });
    if (rejection !== null) return { valid: false, rejection };
    return { valid: true, description: describeCoupon(coupon!) };
  }

  /**
   * מימוש — **תפיסה אטומית של מקום ברשימת השימושים**.
   *
   * שני משרדים שנרשמים באותה שנייה עם הקוד האחרון חייבים לקבל
   * תשובות שונות. בדיקה ואז עדכון היא בדיוק המרוץ הזה: שניהם קוראים
   * `redemptions = 9` מול מגבלה של 10, ושניהם כותבים 10.
   *
   * ‎`updateMany` שמותנה ב**ערך שנקרא** הוא compare-and-swap: מי
   * שהפסיד מקבל 0 שורות מעודכנות ומנסה שוב עם הערך החדש. שלוש
   * הזדמנויות מספיקות בהחלט — התנגשות אמיתית כאן נדירה, ולולאה בלי
   * גבול על נתיב ציבורי היא דבר אחר לגמרי.
   */
  async redeem(
    code: string,
    planCode: string,
  ): Promise<{ ok: false; rejection: CouponRejection } | { ok: true; coupon: CouponDefinition }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const coupon = await this.byCode(code);
      const rejection = couponRejection(coupon, { planCode, now: new Date() });
      if (rejection !== null) return { ok: false, rejection };

      const claimed = await this.prisma.coupon.updateMany({
        where: { code: coupon!.code, redemptions: coupon!.redemptions },
        data: { redemptions: coupon!.redemptions + 1 },
      });
      if (claimed.count === 1) return { ok: true, coupon: coupon! };
      this.logger.warn(`התנגשות במימוש קופון ${coupon!.code} — ניסיון ${attempt + 1}`);
    }
    /*
     * שלושה כישלונות רצופים אינם "נגמר" אלא עומס. ההודעה הגנרית
     * זהה לזו של קוד שנוצל, כי למשתמש אין מה לעשות עם ההבדל.
     */
    return { ok: false, rejection: "exhausted" };
  }

  /**
   * ביטול מימוש — כשההרשמה עצמה נכשלה אחרי שהמקום כבר נתפס.
   *
   * בלי זה, כל ניסיון הרשמה שנפל על אימייל תפוס או על שגיאת מסד היה
   * שורף שימוש בקופון מוגבל. הפחתה מותנית באי-שליליות: תיקון שהופך
   * מונה לשלילי גרוע מהבעיה שהוא בא לתקן.
   */
  async release(code: string): Promise<void> {
    const normalized = normalizeCouponCode(code);
    if (normalized === "") return;
    await this.prisma.coupon
      .updateMany({
        where: { code: normalized, redemptions: { gt: 0 } },
        data: { redemptions: { decrement: 1 } },
      })
      .catch(() => undefined);
  }
}
