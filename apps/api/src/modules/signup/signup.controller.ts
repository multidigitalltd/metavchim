import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  couponRejectionMessage,
  formatPlanPrice,
  planPriceLabel,
  PRICE_TERMS_NOTE,
  yearlySavingPercent,
  type PlanFeature,
} from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { loadEnv } from "../../config/env";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuthService } from "../auth/auth.service";
import { SESSION_COOKIE } from "../auth/auth.controller";
import { SignupService } from "./signup.service";
import { CouponService } from "./coupon.service";
import { SignupVerificationService } from "./signup-verification.service";

/**
 * הרשמה עצמית — הנתיב הציבורי היחיד שיוצר דייר חדש.
 *
 * ההגבלה כאן הדוקה יותר מזו של ההתחברות. התחברות כושלת לא משאירה
 * דבר במסד; הרשמה יוצרת משרד, משתמש, ותפוסה על כתובת אימייל. סקריפט
 * שרץ דקה היה ממלא את המסד במשרדי רפאים.
 *
 * לכן ההרשמה מפוצלת לשניים: `POST /signup` בודק, שולח קוד לכתובת
 * ו**אינו כותב דבר**, ו-`POST /signup/confirm` פותח את המשרד רק אחרי
 * שהקוד חזר. מי שמילא כתובת שאינה שלו אינו מגיע לשלב השני.
 */

const SignupSchema = z
  .object({
    agencyName: z.string().trim().min(2).max(120),
    ownerName: z.string().trim().min(2).max(120),
    email: z.string().email().max(254),
    phone: z.union([z.string().regex(/^[\d\-+ ]{9,20}$/u), z.literal("")]).optional(),
    /*
     * אותו מינימום של החלפת סיסמה (10) ולא זה של ההתחברות (8).
     * הסיסמה הראשונה של בעל משרד היא המפתח לכל נתוני הלקוחות שלו,
     * ואין סיבה שדרישת הסף בפתיחת חשבון תהיה נמוכה מזו של החלפה.
     */
    password: z.string().min(10).max(200),
    plan: z.string().min(2).max(20),
    /** קוד קופון — לא חובה. הנרמול והבדיקה בשרת. */
    coupon: z.string().max(40).optional(),
    /** אישור מפורש לתנאים — נדרש לפני יצירת החשבון. */
    acceptTerms: z.literal(true),
  })
  .strict();

const CouponCheckSchema = z
  .object({ code: z.string().min(1).max(40), plan: z.string().min(2).max(20) })
  .strict();

/**
 * הטוקן של ההרשמה הממתינה. אורך קבוע — `randomBytes(24)` ב-base64url.
 * גבול עליון על מחרוזת שמגיעה מהדפדפן הוא לא נימוס אלא הגנה: בלעדיו
 * אפשר לשלוח מגה-בייט ולגרום לנו לחשב עליו.
 */
const PendingToken = z.string().min(20).max(64);

const ConfirmSchema = z
  .object({ token: PendingToken, code: z.string().min(1).max(40) })
  .strict();

const ResendSchema = z.object({ token: PendingToken }).strict();

/** מה שדף התמחור צריך — בלי חלקים פנימיים של הגדרת המסלול. */
export interface OfferedPlan {
  code: string;
  name: string;
  description: string;
  monthlyPrice: string;
  /**
   * true = `monthlyPrice` הוא „בהתאמה” ולא סכום.
   *
   * דגל ולא השוואת מחרוזת במסך: מסך שבודק `monthlyPrice === "בהתאמה"`
   * נשבר בשקט ביום שהנוסח משתנה, ומציג „בהתאמה / חודש”.
   */
  priceOnRequest: boolean;
  yearlyPrice: string | null;
  yearlySavingPercent: number | null;
  maxUsers: number | null;
  maxProperties: number | null;
  /** מכסות הפרסום ברשת — `null` = ללא הגבלה. */
  maxNetworkListings: number | null;
  maxNetworkDemands: number | null;
  features: PlanFeature[];
  trialDays: number;
}

@Controller("signup")
export class SignupController {
  constructor(
    private readonly signup: SignupService,
    private readonly auth: AuthService,
    private readonly coupons: CouponService,
    private readonly verification: SignupVerificationService,
  ) {}

  /** המסלולים שאפשר להירשם אליהם — לדף התמחור הציבורי. */
  @Public()
  @Get("plans")
  async plans(): Promise<{ plans: OfferedPlan[]; priceNote: string }> {
    const plans = await this.signup.offeredPlans();
    return {
      /*
       * הסייג נשלח עם המחירון ולא נכתב במסך.
       *
       * הוא הבטחה מסחרית — „למצטרפים חדשים ולשנה הראשונה” — ולכן
       * מקורו אחד עם המחירים עצמם. נוסח שיושב במסך מתיישן ביום
       * שהתנאים משתנים, וממשיך להיקרא כאילו הוא בתוקף.
       */
      priceNote: PRICE_TERMS_NOTE,
      plans: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        // „חינם”, „בהתאמה” או סכום — ראו `planPriceLabel`
        monthlyPrice: planPriceLabel(plan),
        priceOnRequest: plan.priceOnRequest,
        yearlyPrice:
          plan.yearlyPriceAgorot === null ? null : formatPlanPrice(plan.yearlyPriceAgorot),
        yearlySavingPercent: yearlySavingPercent(plan),
        maxUsers: plan.maxUsers,
        maxProperties: plan.maxProperties,
        maxNetworkListings: plan.maxNetworkListings,
        maxNetworkDemands: plan.maxNetworkDemands,
        features: plan.features,
        trialDays: plan.trialDays,
      })),
    };
  }

  /**
   * "האם הקוד תקף" — לפני שליחת הטופס.
   *
   * **מוגבל בקצב חזק יותר מהרשמה עצמה.** נתיב שאומר "קיים / לא קיים"
   * על מחרוזת קצרה הוא כלי ניחוש קודים, וקוד שנוחש שווה כסף. עשר
   * בדיקות בשעה מספיקות בהחלט למי שמקליד קוד שקיבל, ולא מספיקות
   * לסריקה.
   *
   * התשובה מחזירה **תיאור** ולא תנאים: החישוב נשאר בשרת.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post("coupon")
  @HttpCode(200)
  async coupon(
    @Body(new ZodValidationPipe(CouponCheckSchema)) body: z.infer<typeof CouponCheckSchema>,
  ): Promise<{ valid: boolean; description?: string; message?: string }> {
    const result = await this.coupons.check(body.code, body.plan);
    if (result.valid) return { valid: true, description: result.description! };
    return { valid: false, message: couponRejectionMessage(result.rejection!) };
  }

  /**
   * שלב ראשון — בדיקת הפרטים ושליחת קוד לכתובת. **בלי כתיבה למסד.**
   *
   * מחזיר 200 ולא 201 בכוונה: שום דבר לא נוצר. `email` מוחזר כדי
   * שהמסך יוכל לומר לאן נשלח הקוד — זו הכתובת שהמשתמש עצמו הרגע
   * הקליד, ולכן אין כאן חשיפה של דבר.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post()
  @HttpCode(200)
  async register(
    @Body(new ZodValidationPipe(SignupSchema)) body: z.infer<typeof SignupSchema>,
  ): Promise<{ token: string; email: string }> {
    return this.signup.prepare(body);
  }

  /**
   * שליחה חוזרת של הקוד לאותה הרשמה ממתינה.
   *
   * הגבלה נפרדת והדוקה: כל בקשה כאן היא מייל אמיתי לתיבה של מישהו,
   * וללא תקרה טופס ההרשמה שלנו הופך לכלי הצפה. יש גם תקרה שנייה
   * לפי כתובת היעד בשירות עצמו — זו לפי מקור הבקשה בלבד.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post("resend")
  @HttpCode(200)
  async resend(
    @Body(new ZodValidationPipe(ResendSchema)) body: z.infer<typeof ResendSchema>,
  ): Promise<{ sent: true }> {
    await this.verification.reissue(body.token);
    return { sent: true };
  }

  /**
   * שלב שני — הקוד חזר, המשרד נפתח, והמשתמש נכנס.
   *
   * ה-Session מונפק כאן ולא במסך התחברות נפרד: משרד שסיים להירשם
   * ונשלח למסך כניסה כדי להקליד שוב את מה שהרגע בחר הוא חיכוך מיותר
   * בדיוק בנקודה שבה הוא הכי קרוב לנטוש.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post("confirm")
  @HttpCode(201)
  async confirm(
    @Body(new ZodValidationPipe(ConfirmSchema)) body: z.infer<typeof ConfirmSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ trialEndsAt: string | null; couponApplied?: string }> {
    /*
     * האימות והפתיחה כיחידה אחת — פתיחה שנכשלת מחזירה את הקוד
     * לתוקף במקום להשאיר את המשתמש עם רשומה שנצרכה (ביקורת Codex).
     */
    const { user, trialEndsAt, couponApplied } = await this.verification.withVerified(
      body.token,
      body.code,
      (verified) => this.signup.create(verified),
    );
    const { token, expiresAt } = await this.auth.issueSession(user, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: loadEnv().COOKIE_SECURE,
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });
    return {
      // null = מסלול חינמי, בלי תפוגה
      trialEndsAt: trialEndsAt?.toISOString() ?? null,
      ...(couponApplied ? { couponApplied } : {}),
    };
  }
}
