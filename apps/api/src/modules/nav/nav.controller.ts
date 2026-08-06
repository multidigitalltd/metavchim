import { Controller, Get } from "@nestjs/common";
import { TenantContext } from "../../common/tenant-context";
import { ownershipFilter } from "../../common/ownership";
import { PrismaService } from "../../core/prisma.service";

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
}

@Controller("nav")
export class NavController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("summary")
  async summary(): Promise<NavSummary> {
    const { tenantId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const [properties, buyers, newLeads, matches, ledger] = await Promise.all([
        tx.property.count({
          where: { tenantId, status: { in: ["draft", "active", "on_hold"] } },
        }),
        tx.buyer.count({
          where: { tenantId, ...ownershipFilter("buyers.view_all", "ownerUserId") },
        }),
        tx.lead.count({
          where: {
            tenantId,
            status: "new",
            ...ownershipFilter("leads.view_all", "assignedToUserId"),
          },
        }),
        tx.match.count({ where: { tenantId, status: "suggested" } }),
        // צפייה בלבד — המענק ההתחלתי נרשם רק במסך השת"פ עצמו, כדי
        // שסרגל הצד לא ייצור תנועות כספיות כתופעת לוואי של רינדור
        tx.creditLedger.aggregate({
          where: { tenantId },
          _sum: { amount: true },
          _count: true,
        }),
      ]);
      return {
        properties,
        buyers,
        newLeads,
        matches,
        credits: ledger._count === 0 ? null : (ledger._sum.amount ?? 0),
      };
    });
  }
}
