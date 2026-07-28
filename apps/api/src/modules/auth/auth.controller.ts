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

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(
    @Body() body: z.infer<typeof LoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthenticatedUser }> {
    const { token, expiresAt, user } = await this.auth.login(body.email, body.password, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    const env = loadEnv();
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });
    return { user };
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
