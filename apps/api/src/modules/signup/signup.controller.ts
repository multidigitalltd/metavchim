import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z } from "zod";
import { formatPlanPrice, yearlySavingPercent, type PlanFeature } from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { loadEnv } from "../../config/env";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuthService } from "../auth/auth.service";
import { SESSION_COOKIE } from "../auth/auth.controller";
import { SignupService } from "./signup.service";

/**
 * הרשמה עצמית — הנתיב הציבורי היחיד שיוצר דייר חדש.
 *
 * ההגבלה כאן הדוקה יותר מזו של ההתחברות. התחברות כושלת לא משאירה
 * דבר במסד; הרשמה יוצרת משרד, משתמש, ותפוסה על כתובת אימייל. סקריפט
 * שרץ דקה היה ממלא את המסד במשרדי רפאים.
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
    /** אישור מפורש לתנאים — נדרש לפני יצירת החשבון. */
    acceptTerms: z.literal(true),
  })
  .strict();

/** מה שדף התמחור צריך — בלי חלקים פנימיים של הגדרת המסלול. */
export interface OfferedPlan {
  code: string;
  name: string;
  description: string;
  monthlyPrice: string;
  yearlyPrice: string | null;
  yearlySavingPercent: number | null;
  maxUsers: number | null;
  maxProperties: number | null;
  features: PlanFeature[];
  trialDays: number;
}

@Controller("signup")
export class SignupController {
  constructor(
    private readonly signup: SignupService,
    private readonly auth: AuthService,
  ) {}

  /** המסלולים שאפשר להירשם אליהם — לדף התמחור הציבורי. */
  @Public()
  @Get("plans")
  async plans(): Promise<{ plans: OfferedPlan[] }> {
    const plans = await this.signup.offeredPlans();
    return {
      plans: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        monthlyPrice: formatPlanPrice(plan.monthlyPriceAgorot),
        yearlyPrice:
          plan.yearlyPriceAgorot === null ? null : formatPlanPrice(plan.yearlyPriceAgorot),
        yearlySavingPercent: yearlySavingPercent(plan),
        maxUsers: plan.maxUsers,
        maxProperties: plan.maxProperties,
        features: plan.features,
        trialDays: plan.trialDays,
      })),
    };
  }

  /**
   * פתיחת משרד חדש והתחברות מיידית.
   *
   * ה-Session מונפק כאן ולא במסך התחברות נפרד: משרד שסיים להירשם
   * ונשלח למסך כניסה כדי להקליד שוב את מה שהרגע בחר הוא חיכוך מיותר
   * בדיוק בנקודה שבה הוא הכי קרוב לנטוש.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post()
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(SignupSchema)) body: z.infer<typeof SignupSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ trialEndsAt: string | null }> {
    const { user, trialEndsAt } = await this.signup.register(body);
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
    return { trialEndsAt: trialEndsAt?.toISOString() ?? null };
  }
}
