import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { featureLabel, type PlanFeature } from "@metavchim/shared";
import { PlanCatalogService } from "../core/plan-catalog.service";
import { IS_PUBLIC_KEY } from "./auth.decorators";
import { TenantContext } from "./tenant-context";

export const FEATURE_KEY = "requiredFeature";

/**
 * מגביל Endpoint לפיצ'ר של מסלול — Entitlement שנאכף בשרת.
 *
 * החליף את `@RequirePlan("agency", "enterprise")`. ההבדל אינו סגנוני:
 * רשימת מסלולים בקוד פירושה שכל שינוי באריזה המסחרית — פתיחת דוחות
 * למסלול מקצועי, הוספת מסלול ביניים — דורש שינוי קוד ועליית גרסה.
 * שאלה על פיצ'ר נענית מהקטלוג, שבעל הפלטפורמה עורך ממסך.
 *
 * זו אותה הפרדה שכבר קיימת ב-RBAC: הקוד שואל יכולת ולא תפקיד
 * (docs/04 §3), וכאן הוא שואל פיצ'ר ולא מסלול.
 */
export const RequireFeature = (feature: PlanFeature): MethodDecorator & ClassDecorator =>
  SetMetadata(FEATURE_KEY, feature);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly plans: PlanCatalogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    /*
     * נתיב ציבורי אינו נבדק כאן — אין לו הקשר דייר, ו-`current()`
     * היה זורק. זו לא פרצה אלא חלוקת אחריות: נתיב ציבורי (Webhook של
     * מרכזייה, דף הצעה) מזהה את המשרד מתוך המפתח שהוצג, ולכן בדיקת
     * הזכאות שלו שייכת לשירות שכבר יודע איזה משרד זה. שער שרץ כאן
     * היה נכשל על *כל* נתיב ציבורי, גם כזה שלא ביקש פיצ'ר.
     */
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowed = await this.plans.tenantHasFeature(
      TenantContext.current().tenantId,
      feature,
    );
    if (!allowed) {
      /*
       * ההודעה מציינת את שם הפיצ'ר ולא את שם המסלול הנדרש.
       * המסלול שמכיל אותו משתנה עם האריזה המסחרית, והודעה שמבטיחה
       * "זמין במסלול Agency" הופכת לשקר ברגע שהוא נפתח במקצועי.
       */
      throw new ForbiddenException(`"${featureLabel(feature)}" אינו כלול במסלול של המשרד`);
    }
    return true;
  }
}
