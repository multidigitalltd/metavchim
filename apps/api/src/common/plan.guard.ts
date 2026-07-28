import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SetMetadata } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { TenantContext } from "./tenant-context";

export const PLAN_KEY = "requiredPlans";
/** מגביל Endpoint למסלולים מסוימים — אכיפת Entitlement בשרת, לא ב-UI. */
export const RequirePlan = (...plans: string[]) => SetMetadata(PLAN_KEY, plans);

/**
 * אוכף שהדייר במסלול המתאים (docs/01 §8). נדרש כי יכולות ה-RBAC אינן
 * תלויות-מסלול — משתמש Basic יכול להחזיק matches.view, אבל דוחות הם
 * פיצ'ר Agency (ביקורת Codex, PR #6).
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const plans = this.reflector.getAllAndOverride<string[] | undefined>(PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!plans || plans.length === 0) return true;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: TenantContext.current().tenantId },
      select: { plan: true },
    });
    if (!tenant || !plans.includes(tenant.plan)) {
      throw new ForbiddenException("הפיצ'ר זמין במסלול Agency ומעלה");
    }
    return true;
  }
}
