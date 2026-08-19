import { Controller, Get, Header } from "@nestjs/common";
import {
  formatPlanPrice,
  planPriceLabel,
  PRICE_TERMS_NOTE,
  yearlySavingPercent,
  type PlanFeature,
} from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { PlanCatalogService } from "../../core/plan-catalog.service";

/**
 * מסלולי המנוי — **הזנה לאתר התדמית.**
 *
 * ## למה נתיב נפרד מ-`signup/plans`
 *
 * `signup/plans` עונה על שאלה אחרת: „מה אפשר לקנות עכשיו בכרטיס
 * אשראי”. הוא מסנן למסלולים ציבוריים עם תקופת ניסיון, ולכן מסלול
 * הרשת — שנסגר בשיחה ולא בטופס — אינו מופיע בו כלל.
 *
 * אתר התדמית צריך בדיוק את ההפך: להציג את **כל** המסלולים, כולל זה
 * שמחירו „בהתאמה”, ולתת לכל אחד את הקריאה לפעולה המתאימה לו. לכן
 * כל שורה נושאת `selfServe` — האתר מציג „התחילו” למי שאפשר לקנות
 * לבד, ו„דברו איתנו” למי שלא, בלי לנחש מהמחיר.
 *
 * ## למה CORS פתוח דווקא כאן
 *
 * ה-CORS הגלובלי נעול ל-`WEB_ORIGIN` היחיד, וזה נכון לכל נתיב
 * שנוגע בנתוני משרד. הנתיב הזה אינו: הוא מחזיר את המחירון שממילא
 * מודפס בכל מצגת מכירה, אינו מקבל פרמטרים, אינו כותב דבר, ואינו
 * נוגע בעוגייה או בטוקן.
 *
 * לכן `Access-Control-Allow-Origin: *` **בלי** `Allow-Credentials`:
 * הדפדפן לא ישלח לכאן הזדהות, ולכן אין כאן מה לגנוב. החלופה —
 * לרשום את דומיין האתר במשתנה סביבה — הייתה מחייבת פריסה מחדש בכל
 * פעם שנוסף עמוד נחיתה או סביבת תצוגה מקדימה.
 */
@Controller("public/plans")
export class PublicPlansController {
  constructor(private readonly plans: PlanCatalogService) {}

  @Public()
  @Get()
  @Header("access-control-allow-origin", "*")
  /*
   * שעה במטמון. המחירון משתנה פעמים בודדות בשנה, ואתר תדמית שנטען
   * אלף פעם ביום אינו צריך לשאול את המסד בכל טעינה.
   */
  @Header("cache-control", "public, max-age=3600")
  async list(): Promise<{ plans: MarketingPlan[]; priceNote: string }> {
    const all = await this.plans.all();
    return {
      /*
       * הסייג נשלח עם המחירון ולא נכתב באתר בנפרד. אתר שמנסח
       * אותו לבד מתיישן ביום שהתנאים משתנים, וזה בדיוק הנוסח
       * שאסור שיהיה לא מדויק.
       */
      priceNote: PRICE_TERMS_NOTE,
      /*
       * **כל** המסלולים, ולא רק הציבוריים. אין בקטלוג מסלול פנימי
       * או מסלול בדיקה — כל שורה בו היא מסלול שנמכר, ולכן החשיפה
       * כאן היא חשיפת מחירון ולא דליפה. אילו היה נוצר מסלול שאינו
       * למכירה, הוא היה דורש שדה מפורש; הסקה מ-`isPublic` הייתה
       * מסתירה דווקא את מסלול הרשת, שכל תפקידו כאן.
       */
      plans: [...all]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((plan) => ({
          code: plan.code,
          name: plan.name,
          description: plan.description,
          monthlyPrice: planPriceLabel(plan),
          yearlyPrice:
            plan.yearlyPriceAgorot === null
              ? null
              : formatPlanPrice(plan.yearlyPriceAgorot),
          yearlySavingPercent: yearlySavingPercent(plan),
          /*
           * האם אפשר לקנות אותו לבד. זה **לא** נגזר מהמחיר: מסלול
           * יכול להיות מתומחר ועדיין להיסגר בשיחה, ובדיוק ההסקה
           * הזו היא שגרמה למסלול הרשת להופיע פעם כ„חינם”.
           */
          selfServe: plan.isPublic,
          /* true = „בהתאמה”. שונה מ-`monthlyPrice: "חינם"` */
          priceOnRequest: plan.priceOnRequest,
          trialDays: plan.trialDays,
          maxUsers: plan.maxUsers,
          maxProperties: plan.maxProperties,
          features: plan.features,
        })),
    };
  }
}

/** שורת מסלול כפי שאתר התדמית מקבל אותה. */
export interface MarketingPlan {
  code: string;
  name: string;
  description: string;
  /** מוכן לתצוגה — „299 ₪” או „בהתאמה”. */
  monthlyPrice: string;
  yearlyPrice: string | null;
  yearlySavingPercent: number | null;
  /** true = אפשר לרכוש מקוון; false = נסגר בשיחה. */
  selfServe: boolean;
  /** true = המחיר נסגר בשיחה, ו-`monthlyPrice` הוא „בהתאמה”. */
  priceOnRequest: boolean;
  trialDays: number;
  /** `null` = ללא הגבלה. */
  maxUsers: number | null;
  maxProperties: number | null;
  features: PlanFeature[];
}
