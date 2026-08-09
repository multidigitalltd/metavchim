import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Capability } from "@metavchim/shared";
import { BILLING_ALLOWED_KEY, CAPABILITY_KEY, IS_PUBLIC_KEY } from "./auth.decorators";
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

    /*
     * משרד שתקופתו נגמרה — ניסיון שפג או מנוי שהסתיים — מחובר אבל
     * מוגבל למסך המנוי.
     *
     * הנעילה הקודמת הייתה בהתחברות עצמה, וזו הייתה טעות מסחרית:
     * המשרד לא הצליח להיכנס, ולכן לא הגיע למסך היחיד שיכול לפתור את
     * הבעיה. כל ניסיון שפג הפך ללקוח אבוד.
     *
     * 402 ולא 403: ל-web יש קוד חד-משמעי להפנות לפיו, ואין בלבול עם
     * חוסר הרשאה של המשתמש.
     */
    if (ctx.billingOnly) {
      const allowed = this.reflector.getAllAndOverride<boolean>(BILLING_ALLOWED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new HttpException(
          { message: "התקופה הסתיימה — יש לחדש את המנוי כדי להמשיך", code: "billing_required" },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
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
