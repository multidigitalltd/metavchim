import { BadRequestException, Injectable } from "@nestjs/common";
import { automationQuotaRejection } from "@metavchim/shared";
import { TenantContext } from "../common/tenant-context";
import { PlanCatalogService } from "./plan-catalog.service";
import { PrismaService } from "./prisma.service";

/**
 * מכסת האוטומציות של המשרד — **מונה אחד לשני הסוגים**.
 *
 * כללים שהמשרד בנה ומשימות אוטומטיות קבועות נספרים יחד. מבחינת
 * הלקוח שתיהן אותו דבר — „המערכת עושה משהו בשבילי מעצמה” — ושתי
 * מכסות נפרדות היו מייצרות בדיוק את השאלה שאין עליה תשובה טובה:
 * למה נגמרה לי אחת בזמן שהשנייה פנויה.
 *
 * השירות יושב ב-`core` ולא באחד המודולים כי שניהם צריכים אותו,
 * ומודול שמייבא מודול אחר רק בשביל ספירה הוא תלות מיותרת.
 */
@Injectable()
export class AutomationQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
  ) {}

  /** כמה אוטומציות מוגדרות כרגע, משני הסוגים. */
  async used(tenantId: string): Promise<number> {
    const [rules, recurrences] = await this.prisma.withTenant((tx) =>
      Promise.all([
        tx.automationRule.count({ where: { tenantId } }),
        tx.taskRecurrence.count({ where: { tenantId } }),
      ]),
    );
    return rules + recurrences;
  }

  /** המכסה של המסלול. `null` = ללא הגבלה. */
  async limit(tenantId: string): Promise<number | null> {
    const plan = await this.plans.forTenant(tenantId);
    return plan?.maxAutomations ?? null;
  }

  async status(tenantId: string): Promise<{ used: number; limit: number | null }> {
    const [used, limit] = await Promise.all([this.used(tenantId), this.limit(tenantId)]);
    return { used, limit };
  }

  /**
   * נזרק לפני **יצירה** בלבד.
   *
   * עריכה וכיבוי נשארים פתוחים גם מעל המכסה, ובכוונה: משרד שירד
   * מסלול ונשארו לו שש אוטומציות במסלול של חמש צריך להיות מסוגל
   * לכבות ולמחוק — כלומר להתכנס למכסה. חסימה גורפת הייתה נועלת
   * אותו במצב שאי אפשר לצאת ממנו אלא בשדרוג.
   */
  async assertCanAdd(): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const { used, limit } = await this.status(tenantId);
    const reason = automationQuotaRejection(used, limit);
    if (reason !== null) throw new BadRequestException(reason);
  }
}
