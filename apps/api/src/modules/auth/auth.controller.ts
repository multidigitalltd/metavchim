import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Public } from "../../common/auth.decorators";
import { AuthService, type AuthenticatedUser } from "./auth.service";
import { LoginOtpService } from "./login-otp.service";
import { LoginThrottleService } from "./login-throttle.service";
import { PasswordResetService } from "./password-reset.service";

export const SESSION_COOKIE = "mv_session";

const LoginSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(200),
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
  ) {}

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
    if (this.otp.active) {
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
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(VerifyOtpSchema)) body: z.infer<typeof VerifyOtpSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthenticatedUser }> {
    if (!this.otp.active) {
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
  @HttpCode(200)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) body: z.infer<typeof ForgotPasswordSchema>,
  ): Promise<{ ok: true }> {
    await this.passwordReset.request(body.email);
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) body: z.infer<typeof ResetPasswordSchema>,
  ): Promise<{ ok: true }> {
    await this.passwordReset.reset(body.token, body.newPassword);
    return { ok: true };
  }

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

  @Get("me")
  me(@Req() req: Request): { user: AuthenticatedUser } {
    const user = (req as Request & { authUser?: AuthenticatedUser }).authUser;
    if (!user) {
      throw new UnauthorizedException();
    }
    return { user };
  }

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
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  }
}
