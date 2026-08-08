import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AnyAuthenticated, Public } from "../../common/auth.decorators";
import { AuthService, type AuthenticatedUser, type ProfileDto } from "./auth.service";
import { GoogleAuthService } from "./google-auth.service";
import { LoginOtpService } from "./login-otp.service";
import { LoginThrottleService } from "./login-throttle.service";
import { PasswordResetService } from "./password-reset.service";

export const SESSION_COOKIE = "mv_session";
/** state+nonce של סבב ה-OAuth — קצר-חיים, נמחק מיד בסיום. */
const OAUTH_COOKIE = "mv_oauth";
const OAUTH_TTL_MS = 10 * 60 * 1000;

const LoginSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(200),
  })
  .strict();

/**
 * עריכת הפרופיל.
 *
 * שינוי אימייל דורש סיסמה נוכחית: הכתובת היא זהות ההתחברות, ומי
 * שהשתלט על מסך פתוח לרגע יכול היה בלעדיה להעביר את החשבון אליו.
 */
const UpdateProfileSchema = z
  .object({
    // trim לפני הבדיקה: בלעדיו שם של רווחים בלבד עובר min(2) ואז
    // נשמר כמחרוזת ריקה, ושובר את כותרת הפרופיל (ביקורת Codex)
    name: z.string().trim().min(2).max(120).optional(),
    /** ספרות, רווחים ומקפים; "" מנקה את השדה */
    phone: z.union([z.string().regex(/^[\d\-+ ]{9,20}$/u), z.literal("")]).optional(),
    email: z.string().email().max(254).optional(),
    currentPassword: z.string().min(1).max(200).optional(),
    preferences: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(10).max(200),
  })
  .strict();

const VerifyOtpSchema = z
  .object({
    otpToken: z.string().regex(/^[A-Za-z0-9_-]{32}$/u),
    code: z.string().regex(/^\d{6}$/u),
  })
  .strict();

const ForgotPasswordSchema = z.object({ email: z.string().email().max(254) }).strict();

const ResetPasswordSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    newPassword: z.string().min(10).max(200),
  })
  .strict();

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly throttle: LoginThrottleService,
    private readonly otp: LoginOtpService,
    private readonly passwordReset: PasswordResetService,
    private readonly google: GoogleAuthService,
  ) {}

  /** אילו אמצעי התחברות פעילים — מסך הכניסה מציג לפי זה. */
  @Public()
  @Get("providers")
  async providers(): Promise<{ google: boolean }> {
    return { google: await this.google.isConfigured() };
  }

  /**
   * שלב 1 — הפניה ל-Google. ה-state וה-nonce נשמרים בעוגייה
   * httpOnly קצרת-חיים: state מגן מ-CSRF (תשובה שלא נולדה מבקשה
   * שלנו), ו-nonce מונע שידור חוזר של id_token ישן.
   */
  @Public()
  @Get("google/start")
  async googleStart(@Res() res: Response): Promise<void> {
    const { state, nonce } = GoogleAuthService.newHandshake();
    res.cookie(OAUTH_COOKIE, `${state}.${nonce}`, {
      httpOnly: true,
      secure: loadEnv().COOKIE_SECURE,
      // lax ולא strict: העוגייה חייבת להישלח בחזרה מהניווט של Google
      sameSite: "lax",
      maxAge: OAUTH_TTL_MS,
      path: "/",
    });
    res.redirect(await this.google.authorizationUrl(state, nonce));
  }

  /**
   * שלב 2 — חזרה מ-Google. בסיום מפנים תמיד למסך של האפליקציה
   * (הצלחה או שגיאה), כי זה ניווט של הדפדפן ולא קריאת API.
   */
  @Public()
  @Get("google/callback")
  async googleCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const webOrigin = loadEnv().WEB_ORIGIN;
    const query = req.query as Record<string, string | undefined>;
    const handshake = (req.cookies as Record<string, string> | undefined)?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: "/" }); // חד-פעמי בכל מקרה

    const [expectedState, expectedNonce] = (handshake ?? "").split(".");
    const code = query["code"];

    if (query["error"] !== undefined || !code || !expectedState || !expectedNonce) {
      res.redirect(`${webOrigin}/login?googleError=failed`);
      return;
    }
    // השוואת state לפני כל פנייה החוצה
    if (query["state"] !== expectedState) {
      res.redirect(`${webOrigin}/login?googleError=failed`);
      return;
    }

    try {
      const identity = await this.google.exchangeCode(code, expectedNonce);
      // כתובת שלא אומתה אצל Google אינה הוכחת בעלות
      if (!identity.emailVerified) {
        res.redirect(`${webOrigin}/login?googleError=unverified`);
        return;
      }
      const user = await this.auth.loginWithVerifiedEmail(identity.email);
      const { token, expiresAt } = await this.auth.issueSession(user, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      this.setSessionCookie(res, token, expiresAt);
      res.redirect(`${webOrigin}/`);
    } catch (error) {
      // אימייל שאינו רשום במשרד — הודעה נפרדת, כי זו לא תקלה אלא
      // חוסר הרשאה, והמתווך צריך לדעת לפנות למנהל
      const unknown = error instanceof UnauthorizedException && /לא קיים/u.test(error.message);
      res.redirect(`${webOrigin}/login?googleError=${unknown ? "unknown" : "failed"}`);
    }
  }

  private setSessionCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: loadEnv().COOKIE_SECURE,
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(
    @Body() body: z.infer<typeof LoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthenticatedUser } | { otpRequired: true; otpToken: string }> {
    // הזמנה אטומית לפני כל עבודת סיסמה — גם בקשות מקבילות לא עוקפות
    // את הסף (docs/04 §6; ביקורת Codex, PR #15).
    await this.throttle.reserveAttempt(body.email, req.ip);

    let validated: Awaited<ReturnType<AuthService["validateCredentials"]>>;
    try {
      validated = await this.auth.validateCredentials(body.email, body.password);
    } catch (error) {
      // רק דחיית אימות נספרת ככשל; תקלת תשתית משחררת את ההזמנה —
      // נפילת DB זמנית לא נועלת חשבונות ל-15 דקות.
      if (!(error instanceof UnauthorizedException)) {
        await this.throttle.releaseOnInfraError(body.email, req.ip);
      }
      throw error;
    }
    await this.throttle.releaseOnSuccess(body.email, req.ip);

    // אימות דו-שלבי בקוד אימייל — רק כשמופעל בסביבה וספק אימייל מחובר
    // (הגנת נעילה; ראו login-otp.service.ts)
    if (await this.otp.isActive()) {
      const otpToken = await this.otp.issue(validated.id, validated.email);
      return { otpRequired: true, otpToken };
    }

    const { token, expiresAt, user } = await this.auth.issueSession(validated, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    this.setSessionCookie(res, token, expiresAt);
    return { user };
  }

  /** שלב 2 של התחברות עם קוד אימייל — פעיל רק כש-LOGIN_OTP_ENABLED. */
  @Public()
  @Post("login/verify")
  // חמישה ניסיונות פר otpToken כבר נאכפים ב-LoginOtpService; זו התקרה
  // המשלימה על ה-IP, כדי שהנפקה חוזרת של טוקנים לא תיצור ניחוש רחב
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(VerifyOtpSchema)) body: z.infer<typeof VerifyOtpSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthenticatedUser }> {
    if (!(await this.otp.isActive())) {
      throw new UnauthorizedException();
    }
    const userId = await this.otp.verify(body.otpToken, body.code);
    const user = await this.auth.getUserForSession(userId);
    const { token, expiresAt } = await this.auth.issueSession(user, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    this.setSessionCookie(res, token, expiresAt);
    return { user };
  }

  /**
   * "שכחתי סיסמה" — תמיד 200 עם אותה תשובה, בלי לגלות אם הכתובת
   * רשומה במערכת (מניעת מיפוי משתמשים).
   */
  @Public()
  @Post("forgot-password")
  // הצינון ב-PasswordResetService הוא פר כתובת; זו התקרה פר IP, שמונעת
  // הצפת תיבות של רשימת כתובות שלמה מאותו מקור (ועלות שליחה מיותרת)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(200)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) body: z.infer<typeof ForgotPasswordSchema>,
  ): Promise<{ ok: true }> {
    this.passwordReset.request(body.email);
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) body: z.infer<typeof ResetPasswordSchema>,
  ): Promise<{ ok: true }> {
    await this.passwordReset.reset(body.token, body.newPassword);
    return { ok: true };
  }

  @AnyAuthenticated()
  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) {
      await this.auth.logout(token);
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @AnyAuthenticated()
  @Get("me")
  me(@Req() req: Request): { user: AuthenticatedUser & { isPlatformAdmin: boolean } } {
    const user = (req as Request & { authUser?: AuthenticatedUser }).authUser;
    if (!user) {
      throw new UnauthorizedException();
    }
    // מנהל פלטפורמה — קובע אם קישור "פלטפורמה" מוצג בניווט (האכיפה
    // עצמה בשרת; זה רק לתצוגה)
    const isPlatformAdmin = loadEnv().PLATFORM_ADMIN_EMAILS.includes(user.email.toLowerCase());
    return { user: { ...user, isPlatformAdmin } };
  }

  /**
   * הפרופיל של המשתמש עצמו — לקריאה ולעריכה.
   *
   * מופרד מ-/settings/users: שם מנהל עורך *אחרים* ונדרשת
   * users.manage, וכאן כל משתמש עורך את עצמו בלבד. המזהה נלקח
   * מה-Session ולא מהבקשה, ולכן אין כאן נתיב לעריכת פרופיל של אחר.
   */
  @AnyAuthenticated()
  @Get("profile")
  async profile(@Req() req: Request): Promise<ProfileDto> {
    const user = (req as Request & { authUser?: AuthenticatedUser }).authUser;
    if (!user) throw new UnauthorizedException();
    return this.auth.getProfile(user.id);
  }

  @AnyAuthenticated()
  @Patch("profile")
  @UsePipes(new ZodValidationPipe(UpdateProfileSchema))
  async updateProfile(
    @Body() body: z.infer<typeof UpdateProfileSchema>,
    @Req() req: Request,
  ): Promise<ProfileDto> {
    const user = (req as Request & { authUser?: AuthenticatedUser }).authUser;
    if (!user) throw new UnauthorizedException();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    return this.auth.updateProfile(user.id, body, token);
  }

  @AnyAuthenticated()
  @Post("change-password")
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(ChangePasswordSchema))
  async changePassword(
    @Body() body: z.infer<typeof ChangePasswordSchema>,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const user = (req as Request & { authUser?: AuthenticatedUser }).authUser;
    if (!user) {
      throw new UnauthorizedException();
    }
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword, token);
    return { ok: true };
  }
}
