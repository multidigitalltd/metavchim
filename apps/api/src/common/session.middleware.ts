import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService, type AuthenticatedUser } from "../modules/auth/auth.service";
import { SESSION_COOKIE } from "../modules/auth/auth.controller";
import { TenantContext } from "./tenant-context";

/**
 * מזהה את ה-Session מהעוגייה ועוטף את המשך הבקשה ב-TenantContext.run —
 * מכאן והלאה, כל שכבת נתונים יודעת לאיזה דייר היא שייכת בלי להעביר
 * פרמטרים ידנית, ובלי שום אמון בקלט מהלקוח (docs/04 §2).
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) {
      next();
      return;
    }
    const resolved = await this.auth.resolveSession(token);
    if (!resolved) {
      next();
      return;
    }
    (req as Request & { authUser?: AuthenticatedUser }).authUser = resolved.user;
    TenantContext.run(resolved.context, () => next());
  }
}
