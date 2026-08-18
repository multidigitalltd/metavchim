import { BadRequestException, Injectable } from "@nestjs/common";
import { automationQuotaRejection } from "@metavchim/shared";
import { TenantContext } from "../common/tenant-context";
import { PlanCatalogService } from "./plan-catalog.service";
import { PrismaService, type TenantTx } from "./prisma.service";

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
   * נזרק לפני **יצירה** בלבד, ו**בתוך הטרנזקציה שיוצרת**.
   *
   * ## למה בתוך הטרנזקציה
   *
   * ספירה שרצה בטרנזקציה נפרדת רואה את המצב שלפני ההוספה, וגם
   * הבקשה המקבילה רואה אותו: במכסה של 5 עם 4 קיימות, שתי בקשות
   * שמגיעות יחד עוברות שתיהן ומשאירות 6. הנעילה, הספירה וההכנסה
   * חייבות להיות אטומיות (ביקורת Codex).
   *
   * ## למה נעילה משותפת
   *
   * המפתח נגזר מהמשרד בלבד ולא מסוג האוטומציה, ולכן כלל שנבנה
   * ומשימה קבועה שנוצרים בו-זמנית מסתדרים בתור — כפי שמתחייב
   * ממונה אחד לשניהם. מפתח לכל סוג היה מאפשר לשניהם לעבור.
   *
   * ## למה רק ביצירה
   *
   * עריכה, כיבוי ומחיקה נשארים פתוחים גם מעל המכסה: משרד שירד
   * מסלול ונשארו לו שש במסלול של חמש חייב להיות מסוגל להתכנס.
   * חסימה גורפת הייתה נועלת אותו במצב שאי אפשר לצאת ממנו אלא
   * בשדרוג.
   */
  async assertCanAddWithin(tx: TenantTx, tenantId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automations:${tenantId}`}, 0))`;
    const [rules, recurrences] = await Promise.all([
      tx.automationRule.count({ where: { tenantId } }),
      tx.taskRecurrence.count({ where: { tenantId } }),
    ]);
    const plan = await this.plans.forTenant(tenantId, tx);
    const reason = automationQuotaRejection(rules + recurrences, plan?.maxAutomations ?? null);
    if (reason !== null) throw new BadRequestException(reason);
  }

  /** גרסת נוחות למי שכבר בהקשר הדייר ואין לו טרנזקציה פתוחה. */
  async assertCanAdd(): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant((tx) => this.assertCanAddWithin(tx, tenantId));
  }
}
