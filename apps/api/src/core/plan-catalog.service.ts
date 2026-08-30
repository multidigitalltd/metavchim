import { Injectable } from "@nestjs/common";
import {
  DEFAULT_PLANS,
  effectiveFeatures,
  isFreePlan,
  sanitizeFeatures,
  type PlanDefinition,
  type PlanFeature,
  type TenantPriceOverride,
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
  /**
   * מונה ביטולים — מונע מטעינה ישנה למלא את המטמון בחזרה.
   *
   * טעינה שהתחילה לפני `upsert` יכולה להסתיים אחריו, ואז היא כותבת
   * למטמון בדיוק את ההגדרות שהמנהל הרגע שינה — ולשלושים שניות
   * השערים והמכסות ממשיכים לאשר מה שנסגר. הבדיקה היא מה היה המונה
   * כשהטעינה התחילה מול מה שהוא עכשיו (ביקורת Codex).
   */
  private generation = 0;

  constructor(private readonly prisma: PrismaService) {}

  invalidate(): void {
    this.cache = null;
    this.generation += 1;
  }

  /**
   * `tx` חובה כשהקריאה מגיעה **מתוך** טרנזקציה פתוחה.
   *
   * המטמון חוסך את השאילתה ברוב הקריאות, אבל לא בכולן: מטמון קר או
   * TTL שפג מחזירים אותנו ל-DB. שאילתה דרך הלקוח הראשי בזמן שטרנזקציה
   * חיצונית מחזיקה חיבור מושכת חיבור שני, ותחת עומס כל החיבורים
   * תפוסים בחיצוניות שממתינות לפנימיות — deadlock (ביקורת Codex;
   * התיקון הקודם העביר רק את שאילתת הדייר ולא את זו של הקטלוג).
   */
  async all(tx?: TenantTx): Promise<PlanDefinition[]> {
    return this.load(tx, true);
  }

  /**
   * קריאה טרייה שעוקפת את המטמון ואינה ממלאת אותו.
   *
   * נחוצה בדיוק במקום אחד: אימות מחדש **בתוך** טרנזקציית מחיקת
   * מסלול, אחרי שננעל הקטלוג. אימות שנשען על מטמון הוא אימות של
   * העבר, וזו בדיוק הנקודה שבו הוא צריך להיות של ההווה.
   */
  async freshAll(tx: TenantTx): Promise<PlanDefinition[]> {
    return this.load(tx, false);
  }

  private async load(tx: TenantTx | undefined, useCache: boolean): Promise<PlanDefinition[]> {
    const now = Date.now();
    if (useCache && this.cache && this.cache.until > now) return this.cache.plans;

    const client = tx ?? this.prisma;
    const startedAt = this.generation;
    const rows = await client.plan.findMany({ orderBy: { sortOrder: "asc" } });
    /*
     * שורה פרושה אינה "מסלול מוסתר" אלא מסלול שנמחק — והיא גם מה
     * שמוחק מסלול **מובנה**: בלעדיה המיזוג שלמטה היה מחזיר אותו
     * לחיים בהגדרות המקוריות שלו (ביקורת Codex).
     */
    const retired = new Set(rows.filter((row) => row.retiredAt !== null).map((row) => row.code));
    const stored = new Map(
      rows.filter((row) => row.retiredAt === null).map((row) => [row.code, this.fromRow(row)]),
    );

    /*
     * מיזוג ולא החלפה: ברירת מחדל שלא נערכה נשארת זמינה, ושורה
     * שנשמרה גוברת עליה. בלי זה, שמירה של מסלול אחד הייתה מעלימה את
     * השלושה האחרים מהמסך.
     */
    const merged = DEFAULT_PLANS.filter((p) => !retired.has(p.code)).map(
      (p) => stored.get(p.code) ?? p,
    );
    for (const [code, plan] of stored) {
      if (!merged.some((p) => p.code === code)) merged.push(plan);
    }
    merged.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

    /*
     * התוצאה מוחזרת תמיד, אבל נשמרת רק אם לא הייתה כתיבה בינתיים.
     * קורא שקיבל תמונה בת רגע אחד הוא בסדר; מטמון ששומר אותה
     * לשלושים שניות אחרי שינוי הוא לא.
     */
    if (useCache && this.generation === startedAt) {
      this.cache = { plans: merged, until: now + PlanCatalogService.TTL_MS };
    }
    return merged;
  }

  async byCode(code: string, tx?: TenantTx): Promise<PlanDefinition | undefined> {
    return (await this.all(tx)).find((plan) => plan.code === code);
  }

  /**
   * האם קוד המסלול הזה חינמי — התשובה למי שיש לו קוד ולא הגדרה.
   *
   * מסלול שאינו מוכר מחזיר `false`, כמו `planAllows`: הכיוון הבטוח
   * הוא לא להעניק גישה בלתי-פוקעת על סמך מחרוזת שגויה.
   *
   * הקריאה יורדת דרך `all`, כלומר דרך המטמון — היא נמצאת על שער
   * ההרשאה של כל בקשה, ואסור לה להיות שאילתה.
   */
  async isFreeCode(code: string, tx?: TenantTx): Promise<boolean> {
    const plan = await this.byCode(code, tx);
    return plan !== undefined && isFreePlan(plan);
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
    return tenant ? this.byCode(tenant.plan, tx) : undefined;
  }

  /**
   * התכונות שפתוחות למשרד בפועל — המסלול **בתוספת חריגי הפלטפורמה**.
   *
   * המסלול הוא ברירת מחדל מסחרית ולא גזירה: עסקה מיוחדת, פיילוט על
   * תכונה אחת, או סגירה זמנית בגלל חוב — כולם חיים כאן ולא בקטלוג,
   * שאחרת היה הופך לרשימת לקוחות.
   *
   * **מסלול שאינו נפתר אינו מזכה בכלום, גם אם יש הענקות.** הענקה
   * היא תוספת למסלול ולא תחליף לו; משרד בלי מסלול תקין הוא תקלה
   * שצריכה להיראות, לא חשבון שממשיך לעבוד חלקית.
   */
  async tenantFeatures(tenantId: string, tx?: TenantTx): Promise<PlanFeature[]> {
    const client = tx ?? this.prisma;
    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, featureGrants: true, featureDenials: true },
    });
    if (!tenant) return [];
    const plan = await this.byCode(tenant.plan, tx);
    if (!plan) return [];
    return effectiveFeatures(plan.features, {
      grants: tenant.featureGrants,
      denials: tenant.featureDenials,
    });
  }

  async tenantHasFeature(
    tenantId: string,
    feature: PlanFeature,
    tx?: TenantTx,
  ): Promise<boolean> {
    return (await this.tenantFeatures(tenantId, tx)).includes(feature);
  }

  /**
   * המחיר המוסכם למשרד הזה, אם סוכם כזה.
   *
   * **חייב להיקרא בכל מקום שגובה כסף** — פתיחת תשלום *וגם* חידוש
   * אוטומטי. מחיר מוסכם שחל רק באחד מהם הוא הבטחה שנשברת בחודש
   * השני, וזו תקלת חיוב שמגיעה ללקוח לפני שהיא מגיעה אלינו.
   */
  async tenantPriceOverride(tenantId: string, tx?: TenantTx): Promise<TenantPriceOverride> {
    const client = tx ?? this.prisma;
    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: { priceOverrideMonthlyAgorot: true, priceOverrideYearlyAgorot: true },
    });
    return {
      monthlyAgorot: tenant?.priceOverrideMonthlyAgorot ?? null,
      yearlyAgorot: tenant?.priceOverrideYearlyAgorot ?? null,
    };
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
      maxAutomations: plan.maxAutomations,
      maxNetworkListings: plan.maxNetworkListings,
      maxNetworkDemands: plan.maxNetworkDemands,
      features,
      trialDays: plan.trialDays,
      priceOnRequest: plan.priceOnRequest,
      isPublic: plan.isPublic,
      sortOrder: plan.sortOrder,
      updatedBy,
      /*
       * שמירה מחזירה מסלול פרוש לחיים. זו הדרך היחידה לבטל מחיקה —
       * ובלי האיפוס כאן, יצירה מחדש של אותו קוד הייתה מצליחה בשקט
       * ולא מופיעה בשום מקום.
       */
      retiredAt: null,
    };
    await this.prisma.plan.upsert({
      where: { code: plan.code },
      create: { code: plan.code, ...data },
      update: data,
    });
    this.invalidate();
  }

  /**
   * פרישת מסלול — "מחיקה" מנקודת מבט המשתמש.
   *
   * `upsert` ולא `delete`: מסלול מובנה שמעולם לא נערך אין לו שורה
   * למחוק, ומחיקת שורה של מסלול מובנה שכן נערך הייתה מחזירה אותו
   * לחיים בהגדרות המקוריות (ביקורת Codex). השורה הפרושה היא מה
   * שמסתיר אותו.
   *
   * `tx` חובה: הפרישה חייבת לקרות באותה טרנזקציה שמעבירה את
   * המשרדים והמנויים, אחרת יש רגע שבו הם מצביעים על מסלול שאיננו.
   */
  async retire(tx: TenantTx, plan: PlanDefinition, retiredBy: string): Promise<void> {
    const now = new Date();
    await tx.plan.upsert({
      where: { code: plan.code },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        monthlyPriceAgorot: plan.monthlyPriceAgorot,
        yearlyPriceAgorot: plan.yearlyPriceAgorot,
        maxUsers: plan.maxUsers,
        maxProperties: plan.maxProperties,
        maxAutomations: plan.maxAutomations,
      maxNetworkListings: plan.maxNetworkListings,
        maxNetworkDemands: plan.maxNetworkDemands,
        features: sanitizeFeatures(plan.features),
        trialDays: plan.trialDays,
        priceOnRequest: plan.priceOnRequest,
        isPublic: plan.isPublic,
        sortOrder: plan.sortOrder,
        updatedBy: retiredBy,
        retiredAt: now,
      },
      update: { retiredAt: now, updatedBy: retiredBy },
    });
  }

  private fromRow(row: {
    code: string;
    name: string;
    description: string;
    monthlyPriceAgorot: number;
    yearlyPriceAgorot: number | null;
    maxUsers: number | null;
    maxProperties: number | null;
    maxAutomations: number | null;
    whatsappSeatMonthlyAgorot: number | null;
    maxNetworkListings: number | null;
    maxNetworkDemands: number | null;
    features: string[];
    trialDays: number;
    priceOnRequest: boolean;
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
      maxAutomations: row.maxAutomations,
      whatsappSeatMonthlyAgorot: row.whatsappSeatMonthlyAgorot,
      maxNetworkListings: row.maxNetworkListings,
      maxNetworkDemands: row.maxNetworkDemands,
      // ניקוי גם בקריאה: שורה שנשמרה לפני שקוד פיצ'ר הוסר מהקטלוג
      // לא אמורה להמשיך להזכות בו
      features: sanitizeFeatures(row.features),
      trialDays: row.trialDays,
      priceOnRequest: row.priceOnRequest,
      isPublic: row.isPublic,
      sortOrder: row.sortOrder,
    };
  }
}
