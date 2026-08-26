import { BadRequestException, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  describeOfferRejection,
  isBillingCycle,
  isOfferKind,
  offerAmountAgorot,
  offerCreationRejection,
  offerRejection,
  sanitizeFeatures,
  sanitizeOfferLineItems,
  type OfferLineItem,
  type PlanDefinition,
  type SubscriptionOfferDefinition,
  type TenantPriceOverride,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * הצעות מנוי בלינק — יצירה בפלטפורמה, צפייה ומימוש אצל המשרד.
 *
 * הטבלה ברמת הפלטפורמה (מחוץ ל-RLS), כמו plans ו-payments; הסינון
 * לפי דייר נעשה כאן מפורשות: הצעה אישית נקראת רק על ידי המשרד
 * שהיא נתפרה לו, והבדיקה הזו יושבת בלוגיקה המשותפת
 * (`offerRejection`) ולא מפוזרת בין הבקרים.
 *
 * שני דברים שהשירות הזה **אינו** עושה בכוונה: הוא לא פותח דפי
 * תשלום (זה של `BillingService`, ששם כבר יושבים קארדקום
 * והאידמפוטנטיות), והוא לא מוחק הצעות — רק מבטל. תשלום שמימש הצעה
 * מפנה אליה לתמיד, ומחיקה הייתה מוחקת את התשובה ל"מה הובטח לו".
 */

/** שורת הצעה למסך הפלטפורמה — כולל הלינק המוכן לשליחה. */
export interface PlatformOfferRow {
  id: string;
  url: string;
  kind: string;
  tenantId: string | null;
  tenantName: string | null;
  planCode: string;
  planName: string;
  billingCycle: string;
  priceAgorot: number | null;
  /** הסכום שייגבה בפועל למחיר תצוגה; null כשהמסלול נעלם מהקטלוג. */
  amountAgorot: number | null;
  lineItems: OfferLineItem[];
  featureGrants: string[];
  note: string;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** מה שדף ההצעה של הלקוח מקבל — או הסבר למה אין מה להציג. */
export type OfferView =
  | { valid: false; message: string }
  | {
      valid: true;
      offer: {
        kind: string;
        planCode: string;
        planName: string;
        planDescription: string;
        billingCycle: string;
        amountAgorot: number;
        lineItems: OfferLineItem[];
        note: string;
        /** התכונות שבמסלול, והתכונות שההצעה מוסיפה מעליו. */
        planFeatures: string[];
        extraFeatures: string[];
        expiresAt: Date | null;
      };
    };

type OfferRecord = {
  id: string;
  token: string;
  kind: string;
  tenantId: string | null;
  planCode: string;
  billingCycle: string;
  priceAgorot: number | null;
  lineItems: unknown;
  featureGrants: string[];
  note: string;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

@Injectable()
export class SubscriptionOfferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
  ) {}

  /**
   * השורה כפי שהלוגיקה המשותפת מדברת בה.
   *
   * הניקוי גם בקריאה, כמו בקטלוג המסלולים: מחזור לא מוכר נופל
   * לחודשי (הכיוון הזול ללקוח), ושורות תוספת שבורות נזרקות במקום
   * להישלח למסך.
   */
  private toDefinition(row: OfferRecord): SubscriptionOfferDefinition {
    return {
      id: row.id,
      token: row.token,
      kind: isOfferKind(row.kind) ? row.kind : "custom",
      tenantId: row.tenantId,
      planCode: row.planCode,
      billingCycle: isBillingCycle(row.billingCycle) ? row.billingCycle : "monthly",
      priceAgorot: row.priceAgorot,
      lineItems: sanitizeOfferLineItems(row.lineItems),
      featureGrants: sanitizeFeatures(row.featureGrants),
      note: row.note,
      maxRedemptions: row.maxRedemptions,
      redemptions: row.redemptions,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  private offerUrl(token: string): string {
    return `${loadEnv().WEB_ORIGIN}/subscribe/${token}`;
  }

  /**
   * יצירת הצעה — הסוג נגזר מהיעד, לא נבחר בנפרד.
   *
   * משרד יעד ⇒ הצעה אישית, חד-פעמית כברירת מחדל: לינק שנתפר ללקוח
   * אחד ומומש פעם אחת אינו אמור להישאר פתוח בטעות. בלי יעד ⇒ לינק
   * מכירה, פתוח לכולם ורב-פעמי אלא אם הוגבל.
   */
  async create(
    input: {
      tenantId: string | null;
      planCode: string;
      billingCycle: string;
      priceAgorot: number | null;
      lineItems: OfferLineItem[];
      featureGrants: string[];
      note: string;
      maxRedemptions: number | null;
      expiresAt: Date | null;
    },
    createdBy: string,
  ): Promise<PlatformOfferRow> {
    const kind = input.tenantId !== null ? "custom" : "plan_link";
    const plan = await this.plans.byCode(input.planCode);
    const lineItems = sanitizeOfferLineItems(input.lineItems);
    const rejection = offerCreationRejection(
      {
        kind,
        tenantId: input.tenantId,
        planCode: input.planCode,
        billingCycle: input.billingCycle,
        priceAgorot: input.priceAgorot,
        lineItems,
        maxRedemptions: input.maxRedemptions,
      },
      plan,
    );
    if (rejection !== null) throw new BadRequestException(rejection);

    let tenantName: string | null = null;
    let override: TenantPriceOverride | undefined;
    if (input.tenantId !== null) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: input.tenantId },
        select: { name: true, priceOverrideMonthlyAgorot: true, priceOverrideYearlyAgorot: true },
      });
      if (!tenant) throw new BadRequestException("משרד היעד לא נמצא");
      tenantName = tenant.name;
      override = {
        monthlyAgorot: tenant.priceOverrideMonthlyAgorot,
        yearlyAgorot: tenant.priceOverrideYearlyAgorot,
      };
    }

    /*
     * 24 בייטים אקראיים — 32 תווי base64url. הטוקן הוא ההרשאה לראות
     * את ההצעה, ולכן הוא באורך של Session token ולא של קוד קופון:
     * קופון מקלידים, את הלינק לוחצים.
     */
    const token = randomBytes(24).toString("base64url");
    const row = await this.prisma.subscriptionOffer.create({
      data: {
        id: ulid(),
        token,
        kind,
        tenantId: input.tenantId,
        planCode: input.planCode,
        billingCycle: input.billingCycle,
        priceAgorot: input.priceAgorot,
        lineItems: lineItems as unknown as object,
        featureGrants: sanitizeFeatures(input.featureGrants),
        note: input.note,
        // הצעה אישית נסגרת אחרי מימוש אחד אלא אם נאמר אחרת
        maxRedemptions: input.maxRedemptions ?? (kind === "custom" ? 1 : null),
        expiresAt: input.expiresAt,
        createdBy,
      },
    });
    return this.toRow(this.toDefinition(row), plan, tenantName, row.createdAt, override);
  }

  /** ההצעות למסך הפלטפורמה, החדשות קודם. */
  async list(): Promise<PlatformOfferRow[]> {
    const rows = await this.prisma.subscriptionOffer.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((id) => id !== null))];
    const tenants =
      tenantIds.length > 0
        ? await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            /*
             * המחיר המוסכם נשלף באותה שאילתה שמביאה את השם, ולא
             * בקריאה לכל שורה: הרשימה מחזירה עד 200 הצעות, ושאילתה
             * לכל אחת מהן היא N+1 על מסך שנפתח בכל כניסה לפלטפורמה.
             */
            select: {
              id: true,
              name: true,
              priceOverrideMonthlyAgorot: true,
              priceOverrideYearlyAgorot: true,
            },
          })
        : [];
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));
    const overrideById = new Map<string, TenantPriceOverride>(
      tenants.map((t) => [
        t.id,
        { monthlyAgorot: t.priceOverrideMonthlyAgorot, yearlyAgorot: t.priceOverrideYearlyAgorot },
      ]),
    );
    const plans = await this.plans.all();
    return rows.map((row) => {
      const definition = this.toDefinition(row);
      return this.toRow(
        definition,
        plans.find((p) => p.code === definition.planCode),
        row.tenantId === null ? null : (nameById.get(row.tenantId) ?? null),
        row.createdAt,
        row.tenantId === null ? undefined : overrideById.get(row.tenantId),
      );
    });
  }

  /**
   * שורה למסך הפלטפורמה.
   *
   * `override` הוא המחיר המוסכם של **משרד היעד**, ונמסר רק להצעה
   * אישית — בלינק מכירה אין משרד ידוע מראש, ולכן גם אין מחיר מוסכם
   * להחיל.
   */
  private toRow(
    offer: SubscriptionOfferDefinition,
    plan: PlanDefinition | undefined,
    tenantName: string | null,
    createdAt: Date,
    override?: TenantPriceOverride,
  ): PlatformOfferRow {
    return {
      id: offer.id,
      url: this.offerUrl(offer.token),
      kind: offer.kind,
      tenantId: offer.tenantId,
      tenantName,
      planCode: offer.planCode,
      planName: plan?.name ?? offer.planCode,
      billingCycle: offer.billingCycle,
      priceAgorot: offer.priceAgorot,
      /*
       * **אותו חישוב שהלקוח יראה בדף ההצעה, כולל המחיר המוסכם.**
       *
       * `resolve` מחיל את המחיר המוסכם של המשרד; שורה שחישבה בלי
       * אותו נתון הראתה למפעיל סכום אחד בעוד שהמקבל רואה — ומשלם —
       * אחר. „מחיר תצוגה” אינו קטגוריה נפרדת: זה הסכום שהמפעיל מצטט
       * כשהוא שולח את הלינק, ולכן הוא חייב להיות אותו מספר.
       */
      amountAgorot: offerAmountAgorot(offer, plan, override),
      lineItems: offer.lineItems,
      featureGrants: offer.featureGrants,
      note: offer.note,
      maxRedemptions: offer.maxRedemptions,
      redemptions: offer.redemptions,
      expiresAt: offer.expiresAt,
      revokedAt: offer.revokedAt,
      createdAt,
    };
  }

  /**
   * ביטול — הלינק מפסיק להתקבל, השורה נשארת.
   *
   * אידמפוטנטי בכוונה: שתי לחיצות על "בטל" אינן שגיאה, והשנייה
   * אינה מזיזה את חותמת הביטול הראשונה.
   */
  async revoke(id: string): Promise<void> {
    const updated = await this.prisma.subscriptionOffer.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) {
      const exists = await this.prisma.subscriptionOffer.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) throw new BadRequestException("ההצעה לא נמצאה");
    }
  }

  /** ההצעה שתשלום מפנה אליה — למימוש בוובהוק; null כשאינה קיימת. */
  async definitionById(id: string): Promise<SubscriptionOfferDefinition | null> {
    const row = await this.prisma.subscriptionOffer.findUnique({ where: { id } });
    return row === null ? null : this.toDefinition(row);
  }

  /**
   * מה דף ההצעה מציג למשרד המחובר.
   *
   * דחייה חוזרת כתשובה תקינה עם הסבר, לא כשגיאת HTTP: "תוקף ההצעה
   * פג" הוא מצב שהדף מציג יפה, לא תקלה. הסכום מחושב **כאן, בשרת**,
   * מאותה פונקציה שפתיחת התשלום תשתמש בה — מספר שמחושב בדפדפן הוא
   * מספר שאפשר לשקר בו.
   */
  async view(token: string, tenantId: string): Promise<OfferView> {
    const resolved = await this.resolve(token, tenantId, new Date());
    if ("rejection" in resolved) {
      return { valid: false, message: describeOfferRejection(resolved.rejection) };
    }
    const { offer, plan, amountAgorot } = resolved;
    return {
      valid: true,
      offer: {
        kind: offer.kind,
        planCode: offer.planCode,
        planName: plan.name,
        planDescription: plan.description,
        billingCycle: offer.billingCycle,
        amountAgorot,
        lineItems: offer.lineItems,
        note: offer.note,
        planFeatures: plan.features,
        // רק מה שבאמת מעבר למסלול — תכונה שההצעה "מעניקה" והמסלול
        // ממילא כולל אינה תוספת, והצגתה ככזו הייתה שקר שיווקי
        extraFeatures: offer.featureGrants.filter(
          (code) => !(plan.features as readonly string[]).includes(code),
        ),
        expiresAt: offer.expiresAt,
      },
    };
  }

  /**
   * ההצעה, המסלול והסכום — או הסיבה שאין. הגרסה הזורקת משמשת את
   * פתיחת התשלום; `view` עוטפת אותה לדף.
   */
  async resolve(
    token: string,
    tenantId: string,
    now: Date,
  ): Promise<
    | {
        offer: SubscriptionOfferDefinition;
        plan: PlanDefinition;
        amountAgorot: number;
      }
    | { rejection: NonNullable<ReturnType<typeof offerRejection>> }
    | { rejection: "not_found" }
  > {
    const row = await this.prisma.subscriptionOffer.findUnique({ where: { token } });
    const offer = row === null ? null : this.toDefinition(row);
    const rejection = offerRejection(offer, { tenantId, now });
    if (rejection !== null) return { rejection };

    const plan = await this.plans.byCode(offer!.planCode);
    /*
     * המחיר המוסכם של המשרד נכנס לחישוב כשההצעה לא קבעה מחיר —
     * אותו סדר עדיפויות כמו בחידוש האוטומטי, כי הסכום שנגבה בלינק
     * הוא ההבטחה למה שייגבה בכל מחזור שאחריו.
     */
    const override = await this.plans.tenantPriceOverride(tenantId);
    const amountAgorot = offerAmountAgorot(offer!, plan, override);
    if (plan === undefined || amountAgorot === null || amountAgorot < 1) {
      // המסלול השתנה מאז שההצעה נוצרה — ללקוח זו הצעה שאינה תקפה
      return { rejection: "not_found" };
    }
    return { offer: offer!, plan, amountAgorot };
  }

  /** כמו `resolve`, אבל זורק — לנתיב פתיחת התשלום. */
  async resolveForCheckout(
    token: string,
    tenantId: string,
    now: Date,
  ): Promise<{
    offer: SubscriptionOfferDefinition;
    plan: PlanDefinition;
    amountAgorot: number;
  }> {
    const resolved = await this.resolve(token, tenantId, now);
    if ("rejection" in resolved) {
      throw new BadRequestException(describeOfferRejection(resolved.rejection));
    }
    return resolved;
  }
}
