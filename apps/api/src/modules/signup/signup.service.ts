import { BadRequestException, Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import { couponRejectionMessage, describeCoupon, formatJerusalemDate, isFreePlan, type PlanDefinition } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { EmailService } from "../../core/email.service";
import { AuthService, type ValidatedUser } from "../auth/auth.service";
import { CouponService } from "./coupon.service";
import { SignupVerificationService, type VerifiedSignup } from "./signup-verification.service";

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
 * - **קוד אימות לכתובת האימייל לפני שנכתבת שורה כלשהי למסד**
 * - האימייל חייב להיות ייחודי בכל המערכת, כמו בכל התחברות
 * - רק מסלול ש**מסומן ציבורי** ניתן לבחירה — מסלול "רשת" נסגר בשיחה
 * - הדייר נפתח בסטטוס `trial` עם תאריך תפוגה, לא כלקוח משלם
 *
 * ## שני שלבים, ושורה במסד רק בשני
 *
 * `prepare` בודק הכול ושולח קוד; `create` פותח את המשרד. בין השניים
 * שום דבר אינו נכתב למסד — לא דייר, לא משתמש ולא תפיסת קופון. מי
 * שמילא כתובת שאינה שלו פשוט אינו מגיע לשלב השני, ולא משאיר אחריו
 * כלום.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
    private readonly email: EmailService,
    private readonly coupons: CouponService,
    private readonly verification: SignupVerificationService,
  ) {}

  /**
   * המסלולים שמוצגים בדף ההרשמה.
   *
   * **מסלול בתשלום בלי ימי ניסיון אינו נמכר בהרשמה עצמית.** ההרשמה
   * פותחת משרד בסטטוס `trial`, והתפוגה היא מה שמגביל אותו; מסלול
   * בתשלום עם אפס ימים היה נפתח בלי תאריך תפוגה כלל — כלומר גישה
   * מלאה, לתמיד, בלי תשלום (ביקורת Codex).
   *
   * **מסלול חינמי הוא היוצא מהכלל המכוון**: "גישה לתמיד בלי תשלום"
   * היא בדיוק ההגדרה שלו, ולכן הוא מוצע גם בלי ימי ניסיון ונפתח
   * פעיל ובלי תפוגה (בקשת המשתמש: מסלול השת"פ נבחר בלי נציג).
   *
   * זה נשאר נכון גם אחרי שנוספה סליקה: ההרשמה עצמה אינה גובה תשלום,
   * והתשלום נעשה ממסך המנוי אחרי הכניסה. מסלול כזה עדיין ניתן לרכישה
   * שם — הוא פשוט אינו נקודת הכניסה למשרד חדש.
   */
  async offeredPlans(): Promise<PlanDefinition[]> {
    return (await this.plans.publicPlans()).filter(
      (plan) => plan.trialDays > 0 || isFreePlan(plan),
    );
  }

  /**
   * שלב ראשון — בדיקה, ואז קוד לכתובת. **בלי כתיבה למסד.**
   *
   * כל מה שאפשר לפסול נפסל כאן, לפני שנשלח מייל: מסלול שאינו זמין,
   * כתובת תפוסה וקוד קופון שאינו תקף. פסילה שמתגלה רק אחרי שהמשתמש
   * הקליד קוד מתיבת הדואר היא בדיוק החיכוך שגורם לנטישה — והוא גם
   * מיותר, כי כל הנתונים כבר בידינו.
   */
  async prepare(input: {
    agencyName: string;
    ownerName: string;
    email: string;
    phone?: string;
    password: string;
    plan: string;
    coupon?: string;
  }): Promise<{ token: string; email: string }> {
    const email = input.email.toLowerCase().trim();
    const coupon = input.coupon?.trim() ?? "";
    const plan = await this.eligiblePlan(input.plan, coupon);

    await this.assertAddressFree(email);

    /*
     * הקופון **נבדק ואינו נתפס** כאן.
     *
     * תפיסה בשלב הזה הייתה שורפת שימוש בקופון מוגבל על כל הרשמה
     * שננטשה במסך הקוד — כלומר על כל ניסיון של בוט. התפיסה קורית
     * ב-`create`, רגע לפני שהמשרד באמת נפתח.
     */
    if (coupon !== "") {
      const check = await this.coupons.check(coupon, plan.code);
      if (!check.valid) throw new BadRequestException(couponRejectionMessage(check.rejection!));
    }

    /*
     * ההצפנה כאן ולא ב-`create`: הסיסמה הגלויה מגיעה רק בשלב הזה,
     * ואין שום סיבה שהיא תמתין עשרים דקות בצורתה הגלויה כדי
     * שנצפין אותה אחר-כך.
     */
    const token = await this.verification.issue({
      agencyName: input.agencyName.trim(),
      ownerName: input.ownerName.trim(),
      email,
      phone: input.phone?.trim() || null,
      passwordHash: await AuthService.hashPassword(input.password),
      plan: plan.code,
      coupon: coupon === "" ? null : coupon,
    });
    return { token, email };
  }

  /**
   * שלב שני — פתיחת המשרד בפועל.
   *
   * הפרמטר הוא `VerifiedSignup` ולא אובייקט רגיל, וזה לא קישוט:
   * הסוג הזה מיוצר **רק** על ידי `SignupVerificationService.consume`,
   * ולכן אין דרך לקרוא לפונקציה הזו — גם לא בטעות בעתיד — על פרטים
   * שהכתובת שלהם לא אומתה.
   */
  async create(
    verified: VerifiedSignup,
  ): Promise<{ user: ValidatedUser; trialEndsAt: Date | null; couponApplied?: string }> {
    const email = verified.email;
    const coupon = verified.coupon ?? "";
    /*
     * המסלול והכתובת נבדקים שוב ולא נסמכים על בדיקת `prepare`.
     *
     * בין שני השלבים עוברות עד עשרים דקות, ובהן אפשר שהמסלול הוסר
     * ממסך הפלטפורמה ואפשר שמישהו אחר תפס בדיוק את אותה כתובת.
     */
    const plan = await this.eligiblePlan(verified.plan, coupon);
    await this.assertAddressFree(email);

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
    if (coupon !== "") {
      const result = await this.coupons.redeem(coupon, plan.code);
      if (!result.ok) throw new BadRequestException(couponRejectionMessage(result.rejection));
      redeemed = {
        code: result.coupon.code,
        percentOff: result.coupon.kind === "percent" ? result.coupon.percentOff : null,
        freeDays: result.coupon.kind === "free_days" ? result.coupon.freeDays : null,
        planCode: result.coupon.planCode,
      };
    }

    const freePlan = isFreePlan(plan);
    const agencyName = verified.agencyName;
    const tenantId = ulid();
    const userId = ulid();
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
    // מסלול חינמי נפתח פעיל ובלי תפוגה — אין מה שיפקע ואין מה לגבות
    const trialEndsAt = freePlan
      ? null
      : new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    /*
     * דייר ומשתמש בטרנזקציה אחת.
     *
     * דייר בלי בעלים הוא רשומה יתומה שאיש לא יכול להיכנס אליה, והיא
     * גם תופסת את שם המשרד. כשל בהצפנת הסיסמה או בכתיבת המשתמש חייב
     * לגרור את הדייר איתו.
     */
    const created = await this.prisma
      .$transaction(async (tx) => {
        await tx.tenant.create({
          data: {
            id: tenantId,
            name: agencyName,
            plan: plan.code,
            // ניסיון ולא פעיל: התשלום עוד לא נגבה. חינמי — פעיל מיד.
            status: freePlan ? "active" : "trial",
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
            name: verified.ownerName,
            email,
            phone: verified.phone,
            passwordHash: verified.passwordHash,
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
    void this.sendWelcome(email, verified.ownerName, plan, trialEndsAt);

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

  /**
   * המסלול שנבחר, אם מותר להירשם אליו — אחרת שגיאה.
   *
   * מסלול שאינו ציבורי נדחה גם אם הוא קיים: הבחירה מגיעה מהדפדפן,
   * ולכן "לא מוצג במסך" אינו אכיפה — בלי הבדיקה הזו כל אחד היה יכול
   * להירשם למסלול הרשת בשליחת הקוד שלו.
   */
  private async eligiblePlan(planCode: string, coupon: string): Promise<PlanDefinition> {
    const plan = await this.plans.byCode(planCode);
    const freePlan = plan !== undefined && plan !== null && isFreePlan(plan);
    if (!plan || !plan.isPublic || (plan.trialDays <= 0 && !freePlan)) {
      throw new BadRequestException("המסלול שנבחר אינו זמין להרשמה");
    }
    /*
     * קופון על מסלול חינמי נדחה במפורש ולא נבלע: אין תשלום להנחות
     * ואין ניסיון להאריך, ושריפת שימוש בקופון מוגבל על כלום היא
     * בדיוק מה שהלקוח היה מגלה אחר-כך בכעס.
     */
    if (freePlan && coupon !== "") {
      throw new BadRequestException("המסלול חינמי — אין צורך בקופון");
    }
    return plan;
  }

  private async assertAddressFree(email: string): Promise<void> {
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
  }

  private async sendWelcome(
    email: string,
    name: string,
    plan: PlanDefinition,
    trialEndsAt: Date | null,
  ): Promise<void> {
    try {
      if (!(await this.email.isConfigured())) return;
      await this.email.send(email, "ברוכים הבאים למתווכים", {
        heading: "המשרד שלכם מוכן",
        greeting: `שלום ${name},`,
        paragraphs: [
          trialEndsAt === null
            ? `המשרד נפתח במסלול "${plan.name}" — מסלול ללא תשלום, בלי הגבלת זמן.`
            : `המשרד נפתח במסלול "${plan.name}", ותקופת הניסיון פתוחה עד ${formatJerusalemDate(trialEndsAt)}.`,
          "אפשר להתחיל להזין נכסים וקונים כבר עכשיו — המערכת תתאים ביניהם בעצמה.",
        ],
        button: { label: "כניסה למערכת", url: loadEnv().WEB_ORIGIN },
      });
    } catch {
      // שליחת מייל אינה חלק מהצלחת ההרשמה
    }
  }
}
