import { Injectable } from "@nestjs/common";
import {
  DEFAULT_PLANS,
  sanitizeFeatures,
  type PlanDefinition,
  type PlanFeature,
} from "@metavchim/shared";
import { PrismaService, type TenantTx } from "./prisma.service";

/**
 * קטלוג המסלולים — מקור האמת היחיד לשאלה "מה כלול במסלול".
 *
 * שתי שכבות במכוון: מה שבעל הפלטפורמה שמר בטבלה, ומעליו ברירות
 * המחדל שבקוד. מערכת שעלתה זה עתה, או קוד מסלול שנשאר על משרד אחרי
 * שהשורה נמחקה, עדיין מקבלים תשובה שפויה במקום מסך ריק.
 *
 * מסלול שאינו בטבלה ואינו בברירות המחדל מחזיר `undefined` — וכל
 * הצרכנים מתייחסים לזה כ"לא מזכה בכלום". זה הכיוון הבטוח: משרד עם
 * קוד מסלול שגוי יראה מסך חסום, לא גישה מלאה.
 */
@Injectable()
export class PlanCatalogService {
  /**
   * מטמון קצר.
   *
   * הקטלוג נקרא כמעט בכל בקשה (כל שער פיצ'ר), משתנה נדיר, וקטן —
   * שאילתה לכל בקשה הייתה מס מיותר. ה-TTL קצר מספיק שבעל הפלטפורמה
   * יראה שינוי כמעט מיד, וכתיבה מאפסת אותו במפורש כדי שהמסך שלו
   * יראה את מה ששמר עכשיו.
   */
  private cache: { plans: PlanDefinition[]; until: number } | null = null;
  private static readonly TTL_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  invalidate(): void {
    this.cache = null;
  }

  async all(): Promise<PlanDefinition[]> {
    const now = Date.now();
    if (this.cache && this.cache.until > now) return this.cache.plans;

    const rows = await this.prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
    const stored = new Map(rows.map((row) => [row.code, this.fromRow(row)]));

    /*
     * מיזוג ולא החלפה: ברירת מחדל שלא נערכה נשארת זמינה, ושורה
     * שנשמרה גוברת עליה. בלי זה, שמירה של מסלול אחד הייתה מעלימה את
     * השלושה האחרים מהמסך.
     */
    const merged = [...DEFAULT_PLANS.map((p) => stored.get(p.code) ?? p)];
    for (const [code, plan] of stored) {
      if (!merged.some((p) => p.code === code)) merged.push(plan);
    }
    merged.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

    this.cache = { plans: merged, until: now + PlanCatalogService.TTL_MS };
    return merged;
  }

  async byCode(code: string): Promise<PlanDefinition | undefined> {
    return (await this.all()).find((plan) => plan.code === code);
  }

  /** המסלולים שמוצגים בדף ההרשמה הציבורי. */
  async publicPlans(): Promise<PlanDefinition[]> {
    return (await this.all()).filter((plan) => plan.isPublic);
  }

  /**
   * המסלול של משרד — לפי הקוד ששמור עליו.
   *
   * `tx` אופציונלי, וחובה כשהקריאה מגיעה **מתוך** טרנזקציה פתוחה.
   * בלעדיו השאילתה מושכת חיבור שני מה-pool בזמן שהחיצונית מחזיקה
   * אחד — ותחת עומס, כשכל החיבורים תפוסים בטרנזקציות חיצוניות, כולן
   * ממתינות לפנימיות שלעולם לא יקבלו חיבור. דפי הנחיתה הציבוריים
   * היו נופלים בתעבורת תמונות סבירה (ביקורת Codex).
   */
  async forTenant(tenantId: string, tx?: TenantTx): Promise<PlanDefinition | undefined> {
    const client = tx ?? this.prisma;
    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    return tenant ? this.byCode(tenant.plan) : undefined;
  }

  async tenantHasFeature(
    tenantId: string,
    feature: PlanFeature,
    tx?: TenantTx,
  ): Promise<boolean> {
    const plan = await this.forTenant(tenantId, tx);
    return plan?.features.includes(feature) ?? false;
  }

  /**
   * שמירת הגדרת מסלול.
   *
   * הפיצ'רים עוברים `sanitizeFeatures` ולא נשמרים כמות שהם: קוד שאינו
   * בקטלוג הוא טעות הקלדה, ושמירה שלו הייתה יוצרת מסלול שמבטיח משהו
   * שאף שורת קוד לא אוכפת.
   */
  async upsert(plan: PlanDefinition, updatedBy: string): Promise<void> {
    const features = sanitizeFeatures(plan.features);
    const data = {
      name: plan.name,
      description: plan.description,
      monthlyPriceAgorot: plan.monthlyPriceAgorot,
      yearlyPriceAgorot: plan.yearlyPriceAgorot,
      maxUsers: plan.maxUsers,
      maxProperties: plan.maxProperties,
      features,
      trialDays: plan.trialDays,
      isPublic: plan.isPublic,
      sortOrder: plan.sortOrder,
      updatedBy,
    };
    await this.prisma.plan.upsert({
      where: { code: plan.code },
      create: { code: plan.code, ...data },
      update: data,
    });
    this.invalidate();
  }

  private fromRow(row: {
    code: string;
    name: string;
    description: string;
    monthlyPriceAgorot: number;
    yearlyPriceAgorot: number | null;
    maxUsers: number | null;
    maxProperties: number | null;
    features: string[];
    trialDays: number;
    isPublic: boolean;
    sortOrder: number;
  }): PlanDefinition {
    return {
      code: row.code,
      name: row.name,
      description: row.description,
      monthlyPriceAgorot: row.monthlyPriceAgorot,
      yearlyPriceAgorot: row.yearlyPriceAgorot,
      maxUsers: row.maxUsers,
      maxProperties: row.maxProperties,
      // ניקוי גם בקריאה: שורה שנשמרה לפני שקוד פיצ'ר הוסר מהקטלוג
      // לא אמורה להמשיך להזכות בו
      features: sanitizeFeatures(row.features),
      trialDays: row.trialDays,
      isPublic: row.isPublic,
      sortOrder: row.sortOrder,
    };
  }
}
