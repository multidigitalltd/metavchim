import { BadRequestException, Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import { couponRejectionMessage, describeCoupon, type PlanDefinition } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { EmailService } from "../../core/email.service";
import { AuthService, type ValidatedUser } from "../auth/auth.service";
import { CouponService } from "./coupon.service";

/**
 * הרשמה עצמית של משרד תיווך.
 *
 * עד כה משרד הוקם רק ידנית ממסך הפלטפורמה — כלומר כל לקוח חדש דרש
 * נוכחות של בעל הפלטפורמה. כאן המשרד נרשם בעצמו, מקבל תקופת ניסיון,
 * ומתחיל לעבוד מיד.
 *
 * ההרשמה יוצרת **דייר חדש**, וזו הפעולה הרגישה ביותר שנתיב ציבורי
 * יכול לעשות במערכת רב-דיירית. ההגנות:
 * - הגבלת קצב על הנתיב (Throttle בבקר)
 * - האימייל חייב להיות ייחודי בכל המערכת, כמו בכל התחברות
 * - רק מסלול ש**מסומן ציבורי** ניתן לבחירה — מסלול "רשת" נסגר בשיחה
 * - הדייר נפתח בסטטוס `trial` עם תאריך תפוגה, לא כלקוח משלם
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
    private readonly email: EmailService,
    private readonly coupons: CouponService,
  ) {}

  /**
   * המסלולים שמוצגים בדף ההרשמה.
   *
   * **מסלול בלי ימי ניסיון אינו נמכר בהרשמה עצמית.** ההרשמה פותחת
   * משרד בסטטוס `trial`, והתפוגה היא מה שמגביל אותו; מסלול עם אפס
   * ימים היה נפתח בלי תאריך תפוגה כלל — כלומר גישה מלאה, לתמיד,
   * בלי תשלום (ביקורת Codex).
   *
   * זה נשאר נכון גם אחרי שנוספה סליקה: ההרשמה עצמה אינה גובה תשלום,
   * והתשלום נעשה ממסך המנוי אחרי הכניסה. מסלול כזה עדיין ניתן לרכישה
   * שם — הוא פשוט אינו נקודת הכניסה למשרד חדש.
   */
  async offeredPlans(): Promise<PlanDefinition[]> {
    return (await this.plans.publicPlans()).filter((plan) => plan.trialDays > 0);
  }

  async register(input: {
    agencyName: string;
    ownerName: string;
    email: string;
    phone?: string;
    password: string;
    plan: string;
    coupon?: string;
  }): Promise<{ user: ValidatedUser; trialEndsAt: Date; couponApplied?: string }> {
    const email = input.email.toLowerCase().trim();

    const plan = await this.plans.byCode(input.plan);
    /*
     * מסלול שאינו ציבורי נדחה גם אם הוא קיים.
     * הבחירה מגיעה מהדפדפן, ולכן "לא מוצג במסך" אינו אכיפה — בלי
     * הבדיקה הזו כל אחד היה יכול להירשם למסלול הרשת בשליחת הקוד שלו.
     */
    if (!plan || !plan.isPublic || plan.trialDays <= 0) {
      throw new BadRequestException("המסלול שנבחר אינו זמין להרשמה");
    }

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      /*
       * הודעה מפורשת ולא "משתמש קיים" סתמי.
       *
       * זו אינה דליפת מידע חדשה: מסך ההתחברות ממילא מבדיל בין
       * "אימייל או סיסמה שגויים" לבין חשבון שקיים, ומי שמנסה להירשם
       * עם כתובת שכבר רשומה צריך לדעת שהפתרון הוא התחברות ולא
       * הרשמה נוספת.
       */
      throw new BadRequestException("הכתובת כבר רשומה במערכת — התחברו או אפסו סיסמה");
    }

    /*
     * הקופון נתפס **אחרי** בדיקת האימייל ולפני יצירת הדייר.
     *
     * מוקדם מדי — כל ניסיון הרשמה עם כתובת תפוסה היה שורף שימוש
     * בקופון מוגבל. מאוחר מדי — הדייר כבר קיים כשמתברר שהקוד נגמר.
     * מה שנשאר בין לבין הוא כישלון כתיבה, ולכן יש `release`.
     */
    let redeemed: {
      code: string;
      percentOff: number | null;
      freeDays: number | null;
      planCode: string | null;
    } | null = null;
    if (input.coupon !== undefined && input.coupon.trim() !== "") {
      const result = await this.coupons.redeem(input.coupon, plan.code);
      if (!result.ok) throw new BadRequestException(couponRejectionMessage(result.rejection));
      redeemed = {
        code: result.coupon.code,
        percentOff: result.coupon.kind === "percent" ? result.coupon.percentOff : null,
        freeDays: result.coupon.kind === "free_days" ? result.coupon.freeDays : null,
        planCode: result.coupon.planCode,
      };
    }

    const tenantId = ulid();
    const userId = ulid();
    const passwordHash = await AuthService.hashPassword(input.password);
    /*
     * תמיד תאריך תפוגה, לעולם לא null.
     *
     * `null` פירושו "בלי תפוגה", וזה המצב של משרד משלם. הרשמה עצמית
     * לא מייצרת אחד כזה: `offeredPlans` כבר סינן מסלולים בלי ימי
     * ניסיון, והבדיקה למעלה חוסמת קוד שנשלח ידנית.
     *
     * קופון של ימים מאריך את הניסיון כאן ומיד — אין בהרשמה תשלום
     * שאפשר להנחות, ולכן "חינם לתקופה" פירושו ניסיון ארוך יותר.
     */
    const trialDays = plan.trialDays + (redeemed?.freeDays ?? 0);
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    /*
     * דייר ומשתמש בטרנזקציה אחת.
     *
     * דייר בלי בעלים הוא רשומה יתומה שאיש לא יכול להיכנס אליה, והיא
     * גם תופסת את שם המשרד. כשל בהצפנת הסיסמה או בכתיבת המשתמש חייב
     * לגרור את הדייר איתו.
     */
    const agencyName = input.agencyName.trim();
    const created = await this.prisma
      .$transaction(async (tx) => {
        await tx.tenant.create({
          data: {
            id: tenantId,
            name: agencyName,
            plan: plan.code,
            // ניסיון ולא פעיל: התשלום עוד לא נגבה
            status: "trial",
            trialEndsAt,
            signupSource: "self",
            ...(redeemed
              ? {
                  couponCode: redeemed.code,
                  /*
                   * ההנחה נשמרת כאן ולא נקראת מהקופון בזמן התשלום:
                   * התשלום הראשון קורה ימים אחרי ההרשמה, וקופון
                   * שנערך או כובה בינתיים אינו אמור לשנות למפרע את
                   * מה שכבר הובטח.
                   */
                  couponPercentOff: redeemed.percentOff,
                  // ההגבלה למסלול מועתקת גם היא — הרכישה אוכפת אותה
                  couponPlanCode: redeemed.planCode,
                }
              : {}),
          },
        });
        return tx.user.create({
          data: {
            id: userId,
            tenantId,
            name: input.ownerName.trim(),
            email,
            phone: input.phone?.trim() || null,
            passwordHash,
            role: "owner",
            // הסיסמה נבחרה על ידי המשתמש עצמו — אין מה להחליף
            mustChangePassword: false,
          },
          select: { id: true, name: true, email: true, role: true, passwordChangedAt: true },
        });
      })
      .catch(async (error: unknown) => {
        /*
         * ההרשמה נפלה אחרי שהמקום בקופון כבר נתפס — מחזירים אותו.
         * בלי זה, כישלון כתיבה שורף שימוש בקופון מוגבל, והלקוח הבא
         * מקבל "הקוד אינו תקף" על קוד שאיש לא ניצל.
         */
        if (redeemed) await this.coupons.release(redeemed.code);
        throw error;
      });

    // מייל פתיחה — best-effort. משרד שנרשם בהצלחה לא אמור לראות
    // שגיאה כי ספק האימייל לא מוגדר בסביבה הזו.
    void this.sendWelcome(email, input.ownerName, plan, trialEndsAt);

    return {
      user: {
        id: created.id,
        tenantId,
        name: created.name,
        email: created.email,
        role: created.role,
        mustChangePassword: false,
        tenantName: agencyName,
        // החותמת מה-DB ולא מהשעון המקומי: היא זו שה-Session נחתם
        // מולה, ופער בין השניים היה פוסל את ה-Session מיד
        passwordChangedAt: created.passwordChangedAt,
      },
      trialEndsAt,
      ...(redeemed
        ? {
            couponApplied: describeCoupon({
              code: redeemed.code,
              description: "",
              kind: redeemed.freeDays === null ? "percent" : "free_days",
              percentOff: redeemed.percentOff,
              freeDays: redeemed.freeDays,
              planCode: null,
              maxRedemptions: null,
              redemptions: 0,
              expiresAt: null,
              isActive: true,
            }),
          }
        : {}),
    };
  }

  private async sendWelcome(
    email: string,
    name: string,
    plan: PlanDefinition,
    trialEndsAt: Date,
  ): Promise<void> {
    try {
      if (!(await this.email.isConfigured())) return;
      await this.email.send(email, "ברוכים הבאים למתווכים", {
        heading: "המשרד שלכם מוכן",
        greeting: `שלום ${name},`,
        paragraphs: [
          `המשרד נפתח במסלול "${plan.name}", ותקופת הניסיון פתוחה עד ${trialEndsAt.toLocaleDateString("he-IL")}.`,
          "אפשר להתחיל להזין נכסים וקונים כבר עכשיו — המערכת תתאים ביניהם בעצמה.",
        ],
        button: { label: "כניסה למערכת", url: loadEnv().WEB_ORIGIN },
      });
    } catch {
      // שליחת מייל אינה חלק מהצלחת ההרשמה
    }
  }
}
