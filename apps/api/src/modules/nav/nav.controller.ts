import { Controller, Get } from "@nestjs/common";
import { isTaskUrgent } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ownershipFilter } from "../../common/ownership";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { AnyAuthenticated } from "../../common/auth.decorators";

/**
 * מוני סרגל הצד — לפי קובץ העיצוב: מספר ליד כל פריט ניווט (נכסים,
 * קונים, התאמות), תג כתום ללידים חדשים ויתרת קרדיטים על שת"פ.
 *
 * העיקרון: המונה חייב להתאים למה שהמסך עצמו יציג. סוכן עם view_own
 * שרואה תג "5 לידים" ונוחת על רשימה עם 2 יחשוב שהמערכת שבורה — ולכן
 * אותם מסנני בעלות של הרשימות מוחלים גם כאן.
 */

export interface NavSummary {
  /** נכסים בשיווק פעיל (טיוטה/פעיל/בהמתנה) — נמכר וארכיון לא נספרים. */
  properties: number;
  buyers: number;
  /** לידים בסטטוס "חדש" — התג הכתום; אפס = בלי תג. */
  newLeads: number;
  /** התאמות שממתינות להחלטה. */
  matches: number;
  /** יתרת הקרדיטים לשת"פ; null כשאין עדיין תנועות (אין מענק בצפייה). */
  credits: number | null;
  /**
   * משימות **שלי** שבאיחור או להיום. גם למנהל: הבאדג' אומר "מה עלי
   * לעשות", ומספר שכולל את כל המשרד הופך אותו למד עומס שאי אפשר
   * לאפס.
   */
  urgentTasks: number;
  /**
   * הפיצ'רים שכלולים במסלול המשרד.
   *
   * הניווט מסתיר לפיהם פריטים שיוליכו לקיר: הכניסה למסך תיחסם
   * בשרת בכל מקרה, וקישור שמוביל ל-403 גרוע מקישור שלא קיים. זו
   * תצוגה בלבד — האכיפה היא ב-FeatureGuard.
   */
  features: string[];
}

@Controller("nav")
export class NavController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
  ) {}

  @AnyAuthenticated()
  @Get("summary")
  async summary(): Promise<NavSummary> {
    const { tenantId } = TenantContext.current();
    const plan = await this.plans.forTenant(tenantId);
    return this.prisma.withTenant(async (tx) => {
      const now = new Date();
      const [properties, buyers, newLeads, matches, ledger, taskRows] = await Promise.all([
        // deletedAt מפורש בשני אלה: אלה המונים שליד שמות המסכים,
        // והמסכים עצמם מסננים מחוקים. בלי הסינון כאן הבאדג' מראה
        // מספר אחד והרשימה מספר אחר — וזה נקרא כתקלה, בצדק.
        tx.property.count({
          where: { tenantId, deletedAt: null, status: { in: ["draft", "active", "on_hold"] } },
        }),
        tx.buyer.count({
          where: {
            tenantId,
            deletedAt: null,
            ...ownershipFilter("buyers.view_all", "ownerUserId"),
          },
        }),
        tx.lead.count({
          where: {
            tenantId,
            status: "new",
            ...ownershipFilter("leads.view_all", "assignedToUserId"),
          },
        }),
        /*
         * `suggested` בלבד — הבאדג' סופר הצעות חדשות שממתינות, לא את
         * כל מה שמופיע במסך ההתאמות (שמציג גם `offered`). זו כוונה,
         * לא אי-התאמה.
         *
         * מה שכן חייב להתקיים: התאמה לצד שנמחק אינה נספרת כאן. היא
         * אינה נספרת כי **מחיקה רכה מסמנת את כל ההתאמות של הנכס
         * כ-`dismissed`** (properties.service.ts, softDelete) — ולכן
         * אין צורך בבדיקה נוספת כאן. אם ייווצר נתיב מחיקה לקונה, הוא
         * חייב לעשות את אותו הדבר, אחרת המונה הזה יתפח בשקט.
         */
        tx.match.count({ where: { tenantId, status: "suggested" } }),
        // צפייה בלבד — המענק ההתחלתי נרשם רק במסך השת"פ עצמו, כדי
        // שסרגל הצד לא ייצור תנועות כספיות כתופעת לוואי של רינדור
        tx.creditLedger.aggregate({
          where: { tenantId },
          _sum: { amount: true },
          _count: true,
        }),
        /*
         * המסננים הצרים כאן (יומיים קדימה, מועד לא ריק) הם קיצור
         * דרך של השאילתה בלבד; ההכרעה עצמה היא `isTaskUrgent` —
         * אותה פונקציה שהמסך מחלק לפיה לדליים. שני חישובים שאמורים
         * להסכים הם שני חישובים שיפסיקו להסכים.
         */
        tx.task.findMany({
          where: {
            tenantId,
            assignedToUserId: TenantContext.current().userId,
            status: "open",
            dueAt: { not: null, lt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000) },
          },
          select: { status: true, dueAt: true },
          take: 500,
        }),
      ]);
      return {
        properties,
        buyers,
        newLeads,
        matches,
        credits: ledger._count === 0 ? null : (ledger._sum.amount ?? 0),
        urgentTasks: taskRows.filter((row) => isTaskUrgent(row, now)).length,
        features: plan?.features ?? [],
      };
    });
  }
}
