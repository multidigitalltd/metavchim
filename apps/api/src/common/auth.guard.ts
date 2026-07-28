import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Capability } from "@metavchim/shared";
import { CAPABILITY_KEY, IS_PUBLIC_KEY } from "./auth.decorators";
import { TenantContext } from "./tenant-context";

/**
 * שער ברירת המחדל: כל Endpoint דורש Session מאומת אלא אם סומן @Public
 * במפורש — שכחה מייצרת 401, לא דלת פתוחה (Secure by Default).
 * אם הוצהרה @RequireCapability — נבדקת גם היכולת (docs/04 §3).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const ctx = TenantContext.maybeCurrent();
    if (!ctx) {
      throw new UnauthorizedException("נדרשת התחברות");
    }

    const capability = this.reflector.getAllAndOverride<Capability | undefined>(CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (capability && !ctx.capabilities.has(capability)) {
      throw new ForbiddenException("אין לך הרשאה לפעולה זו");
    }
    return true;
  }
}
