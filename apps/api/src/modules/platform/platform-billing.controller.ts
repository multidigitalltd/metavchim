import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  IdSchema,
  MAX_BURN_CREDITS,
  PLAN_FEATURES,
  PlanCodeSchema,
  couponDefinitionRejection,
  describeCoupon,
  normalizeCouponCode,
  type CouponDefinition,
  type CouponKind,
  leadPriceRejectionReason,
  type LeadSourcePrice,
  MAX_OFFER_ITEM_LABEL,
  MAX_RENTAL_MONTHLY_AGOROT,
  formatRentalNumber,
  MAX_OFFER_LINE_ITEMS,
  MAX_OFFER_NOTE,
  MAX_OFFER_PRICE_AGOROT,
  planRejectionReason,
  sanitizeFeatures,
  type PlanDefinition,
} from "@metavchim/shared";
import { TaxTablesSchema, type TaxTables, type TaxTablesInput } from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { TaxTablesService } from "../../core/tax-tables.service";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe, IdParam } from "../../common/zod-validation.pipe";
import { CardcomService } from "../../core/cardcom.service";
import { PlatformCreditsService, type PlatformCreditRow, type PlatformCreditsReport } from "./platform-credits.service";
import { LeadPricingService } from "../../core/lead-pricing.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { SubscriptionOfferService, type PlatformOfferRow } from "../billing/subscription-offer.service";
import { InvoiceService } from "../billing/invoice.service";
import { NumberRentalService } from "../billing/number-rental.service";

/** חיוב חודשי על מספר של משרד — המחיר באגורות, לפני מע"מ, כמו בהשכרה. */
const CreateNumberChargeSchema = z
  .object({
    tenantId: IdSchema,
    phone: z.string().trim().min(3).max(20),
    monthlyAgorot: z.number().int().min(1).max(MAX_RENTAL_MONTHLY_AGOROT),
  })
  .strict();

/**
 * מחיקת מסלול: חובה לנקוב במסלול היעד.
 *
 * לא אופציונלי בכוונה. מסלול שנמחק בלי יעד משאיר משרדים עם קוד
 * שאינו בקטלוג — ומשרד כזה מאבד את כל הפיצ'רים והמכסות בשקט.
 */
const DeletePlanSchema = z.object({ moveTo: PlanCodeSchema }).strict();

/** `null` במגבלה = ללא הגבלה, ולכן nullable ולא optional. */
const LimitSchema = z.number().int().min(0).max(100_000).nullable();

const UpsertPlanSchema = z
  .object({
    code: PlanCodeSchema,
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(500).default(""),
    monthlyPriceAgorot: z.number().int().min(0).max(100_000_000),
    yearlyPriceAgorot: z.number().int().min(0).max(1_000_000_000).nullable(),
    maxUsers: LimitSchema,
    maxProperties: LimitSchema,
    /*
     * ‎.default(null)‎ ולא חובה: המסך הישן, וכל סקריפט שנכתב מול
     * הגרסה הקודמת, שולחים גוף בלי השדות האלה — ו-‎.strict()‎ היה
     * הופך אותם לשגיאה. `null` הוא גם המשמעות הנכונה של "לא נאמר":
     * ללא הגבלה, כלומר בדיוק ההתנהגות שהייתה לפני התוספת.
     */
    /*
     * מכסת האוטומציות. `default(null)` כמו שאר המגבלות: מסך ישן
     * ששולח גוף בלי השדה מקבל "ללא הגבלה", ולא שגיאה.
     */
    maxAutomations: LimitSchema.default(null),
    /*
     * מחיר לסוכן וואטסאפ נוסף. `null` = לא נמכר במסלול הזה, וזה
     * מצב תקין; `default(null)` כמו שאר השדות, כדי שמסך ישן ששולח
     * גוף בלי השדה לא ייכשל.
     */
    whatsappSeatMonthlyAgorot: z
      .union([z.number().int().min(1).max(10_000_000), z.null()])
      .default(null),
    maxNetworkListings: LimitSchema.default(null),
    maxNetworkDemands: LimitSchema.default(null),
    features: z.array(z.string().max(40)).max(50),
    trialDays: z.number().int().min(0).max(90),
    isPublic: z.boolean(),
    /*
     * ‎.default(false)‎ ולא חובה, מאותה סיבה כמו המגבלות: מסך שנכתב
     * לפני שהדגל קיים שולח גוף בלי השדה, ו-‎.strict()‎ לבדו לא היה
     * מצילו — היעדר ברירת מחדל היה הופך כל שמירה ישנה לשגיאה.
     * `false` הוא גם המשמעות הנכונה של "לא נאמר": מחיר שמוצג כמספר,
     * כפי שהיה לפני התוספת.
     */
    priceOnRequest: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(9999),
  })
  .strict();

/**
 * מחיר ליד לפי מקור.
 *
 * הגבולות מגיעים מהכלל המשותף (`leadPriceRejectionReason`) ולא
 * נכתבים כאן שוב — הסכימה חוסמת קלט שבור, והכלל הוא מה שקובע.
 */
const LeadPriceSchema = z
  .object({
    label: z.string().trim().min(2).max(60),
    creditsCost: z.number().int().min(0).max(1000),
  })
  .strict();

/**
 * זיכוי. הסכום ברשות — חסר פירושו זיכוי מלא.
 *
 * `int` ולא `number`: אגורה היא היחידה, ושבר אגורה בבקשה היה יוצא
 * לקארדקום כשקל מעוגל ומשאיר פער בין מה שנרשם למה שיצא.
 */
const RefundSchema = z
  .object({
    amountAgorot: z.number().int().positive().optional(),
    reason: z.string().max(300).optional(),
  })
  .strict();

export interface PaymentRow {
  id: string;
  tenantId: string;
  tenantName: string;
  /** subscription | credits — מה נקנה בתשלום הזה. */
  purpose: string;
  /** ריקים ברכישת קרדיטים; ערך מדומה היה מציג אותה כמנוי בדוח. */
  planCode: string | null;
  billingCycle: string | null;
  creditsPurchased: number | null;
  amountAgorot: number;
  status: string;
  transactionId: string | null;
  failureReason: string | null;
  paidAt: Date | null;
  refundedAgorot: number | null;
  refundedAt: Date | null;
  refundReason: string | null;
  createdAt: Date;
}

/**
 * מחיקת קרדיטים מחשבון הפלטפורמה.
 *
 * ההערה אינה חובה אבל היא השדה היחיד שיסביר, בעוד שנה, למה נמחקו
 * דווקא אז ודווקא הכמות הזו.
 */
const BurnCreditsSchema = z
  .object({
    credits: z.number().int().min(1).max(MAX_BURN_CREDITS),
    note: z.string().max(200).optional(),
  })
  .strict();

/**
 * יצירת הצעת מנוי בלינק.
 *
 * הסוג אינו נשלח — הוא נגזר מהיעד: משרד יעד ⇒ הצעה אישית (חד-פעמית
 * כברירת מחדל), בלי יעד ⇒ לינק מכירה לחבילה, פתוח לכל משרד מחובר.
 * שליחת סוג בנפרד הייתה מאפשרת "הצעה אישית בלי משרד" — צירוף שאין
 * לו משמעות ושהיה נדחה ממילא.
 */
const CreateOfferSchema = z
  .object({
    tenantId: IdSchema.nullable().optional(),
    planCode: PlanCodeSchema,
    billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
    /** המחיר הסופי באגורות; null/חסר = מחיר המסלול. חיובי בלבד. */
    priceAgorot: z
      .number()
      .int()
      .min(1)
      .max(MAX_OFFER_PRICE_AGOROT)
      .nullable()
      .optional(),
    lineItems: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(MAX_OFFER_ITEM_LABEL),
            // אפס תקין — "כלול במחיר" הוא שורה לגיטימית בהצעה
            amountAgorot: z.number().int().min(0).max(MAX_OFFER_PRICE_AGOROT),
          })
          .strict(),
      )
      .max(MAX_OFFER_LINE_ITEMS)
      .default([]),
    featureGrants: z.array(z.string().min(1).max(40)).max(PLAN_FEATURES.length).default([]),
    note: z.string().trim().max(MAX_OFFER_NOTE).default(""),
    maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
    expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  })
  .strict();

/** הגדרת קופון מהמסך. `redemptions` אינו כאן — הוא מונה ולא שדה. */
const CouponSchema = z
  .object({
    code: z.string().min(1).max(40),
    description: z.string().max(200).optional(),
    kind: z.enum(["percent", "free_days"]),
    percentOff: z.number().int().min(1).max(100).nullable().optional(),
    freeDays: z.number().int().min(1).max(730).nullable().optional(),
    planCode: z.string().max(20).nullable().optional(),
    maxRedemptions: z.number().int().min(1).nullable().optional(),
    expiresAt: z.string().datetime().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/** שורת קופון למסך — כולל התיאור בעברית שהשרת מחשב. */
interface CouponRow {
  code: string;
  kind: CouponKind;
  percentOff: number | null;
  freeDays: number | null;
  planCode: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: Date | null;
  isActive: boolean;
  /** מה הקופון נותן, בעברית. */
  description: string;
  /** ההערה החופשית שנכתבה עליו. */
  note: string;
}

/**
 * ‏כסף בפלטפורמה — מסלולים, טבלאות מס, מחירי לידים, תשלומים והחזרים,
 * ‏חשבוניות, קרדיטים, קופונים, השכרת מספרים והצעות מנוי בלינק.
 *
 * ‏אחד מארבעה בקרים תחת `/platform`, כולם מאחורי `PlatformAdminGuard` —
 * ‏פוצלו מבקר אחד של 3,600 שורות לפי תחום, בלי שינוי בנתיבים או בשערים.
 */
@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class PlatformBillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxTables: TaxTablesService,
    private readonly plans: PlanCatalogService,
    private readonly leadPricing: LeadPricingService,
    private readonly cardcom: CardcomService,
    private readonly platformCredits: PlatformCreditsService,
    private readonly subscriptionOffers: SubscriptionOfferService,
    private readonly numberRentals: NumberRentalService,
    private readonly invoices: InvoiceService,
  ) {}

  /**
   * קטלוג המסלולים לעריכה — כולל קטלוג הפיצ'רים עצמו.
   *
   * הפיצ'רים נשלחים מהשרת ולא נצרבים במסך: הרשימה היא מה שהקוד באמת
   * אוכף, ומסך שמציג רשימה משלו היה מבטיח פיצ'רים שאין להם אכיפה.
   */
  @Get("plans")
  async listPlans(): Promise<{
    plans: PlanDefinition[];
    features: typeof PLAN_FEATURES;
    usage: Record<string, number>;
  }> {
    const [plans, counts] = await Promise.all([
      this.plans.all(),
      this.prisma.tenant.groupBy({ by: ["plan"], _count: { _all: true } }),
    ]);
    const usage: Record<string, number> = {};
    for (const row of counts) usage[row.plan] = row._count._all;
    return { plans, features: PLAN_FEATURES, usage };
  }

  /**
   * שמירת הגדרת מסלול.
   *
   * קודי פיצ'רים לא מוכרים נזרקים ולא נשמרים: פיצ'ר קיים רק אם יש קוד
   * שאוכף אותו, ומסלול שמבטיח משהו שאיש לא אוכף הוא הבטחה שבורה.
   */
  @Patch("plans/:code")
  async upsertPlan(
    @Param("code", new ZodValidationPipe(PlanCodeSchema)) code: string,
    @Body(new ZodValidationPipe(UpsertPlanSchema.omit({ code: true })))
    body: Omit<z.infer<typeof UpsertPlanSchema>, "code">,
  ): Promise<{ ok: true }> {
    const plan: PlanDefinition = {
      ...body,
      code,
      features: sanitizeFeatures(body.features),
    };
    const reason = planRejectionReason(plan);
    if (reason) throw new BadRequestException(reason);

    await this.plans.upsert(plan, TenantContext.current().userId);
    return { ok: true };
  }

  /**
   * מחיקת מסלול — **עם העברת המשרדים שבו למסלול אחר.**
   *
   * ההעברה אינה תוספת נוחות אלא תנאי: קוד מסלול שאינו בקטלוג משאיר
   * את המשרד בלי פיצ'רים ובלי מכסות, בלי שום שגיאה שמישהו יראה.
   * לכן שתי הפעולות באותה טרנזקציה — אין רגע שבו המסלול נעלם
   * והמשרדים עוד מצביעים עליו.
   *
   * גם הקופונים שהוגבלו למסלול הנמחק עוברים איתו: קופון שמצביע על
   * מסלול שאיננו הוא הנחה שלא תמומש לעולם.
   */
  @Delete("plans/:code")
  @HttpCode(200)
  async deletePlan(
    @Param("code", new ZodValidationPipe(PlanCodeSchema)) code: string,
    @Body(new ZodValidationPipe(DeletePlanSchema)) body: z.infer<typeof DeletePlanSchema>,
  ): Promise<{ ok: true; movedTenants: number }> {
    if (body.moveTo === code) throw new BadRequestException("יש לבחור מסלול יעד אחר");
    const actor = TenantContext.current().userId;

    const movedTenants = await this.prisma.$transaction(async (tx) => {
      /*
       * נעילת הקטלוג לכל אורך הטרנזקציה, ואימות **בתוכה**.
       *
       * שני מנהלים שמוחקים בו-זמנית את A ואת B ובוחרים זה את מסלולו
       * של זה כיעד היו עוברים שניהם אימות מול אותה תמונה ישנה,
       * ומשאירים משרדים על שני קודים שאינם קיימים (ביקורת Codex).
       * מחיקת מסלול היא פעולה נדירה של בעל הפלטפורמה — נעילה גלובלית
       * כאן אינה עולה דבר.
       */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('plans:catalog', 0))`;
      const all = await this.plans.freshAll(tx);
      const plan = all.find((p) => p.code === code);
      if (!plan) throw new BadRequestException("המסלול לא נמצא");
      if (!all.some((p) => p.code === body.moveTo)) {
        throw new BadRequestException("מסלול היעד לא מוכר");
      }
      /*
       * המסלול האחרון אינו נמחק. מערכת בלי אף מסלול אינה מצב תקין —
       * הרשמה חדשה נופלת, ואין לאן להעביר את מי שכבר קיים.
       */
      if (all.length <= 1) throw new BadRequestException("זהו המסלול היחיד — אי אפשר למחוק אותו");

      /*
       * ‎**המנוי לפני המשרד, וזה סדר הנעילות ולא סדר קריאה.**
       *
       * ‏`UPDATE` נועל את השורות שהוא נוגע בהן, ולכן שתי השורות כאן
       * ‏הן נעילה על `subscriptions` ואז על `tenants`. הסדר ההפוך —
       * ‏שהיה כאן — סוגר מעגל מול כל מסלול שנועל מנוי ואז דייר:
       * ‏`switchToFreePlan` ב-`BillingService`, ו-`close` של המשפך.
       * ‏מחיקת מסלול שמתנגשת עם סבב המשפך על משרד באותו מסלול הייתה
       * ‏מפילה אחת מהשתיים ב-deadlock (ביקורת Codex, P2).
       *
       * ‏„שורת המשרד אחרונה” הוא הכלל הכתוב ב-`common/locks.ts`,
       * ‏והמסלול הזה היה החריג היחיד לו.
       *
       * ‏המנוי אינו רק מראה של המשרד: `subscriptions.plan_code` הוא
       * ‏מה ש-RenewalService מתמחר לפיו, והוא מדלג על מסלול שאינו
       * ‏מוכר — כלומר לקוח משלם היה מפסיק להתחדש בשקט בזמן שהמשרד
       * ‏שלו נראה תקין לגמרי (ביקורת Codex).
       */
      await tx.subscription.updateMany({
        where: { planCode: code },
        data: { planCode: body.moveTo },
      });
      await tx.coupon.updateMany({ where: { planCode: code }, data: { planCode: body.moveTo } });
      const moved = await tx.tenant.updateMany({
        where: { plan: code },
        data: { plan: body.moveTo },
      });
      /*
       * ההנחה שכבר הובטחה למשרד בהרשמה מוצמדת לקוד המסלול שהיה.
       * בלי העברה היא הייתה מפסיקה לחול — כלומר הבטחה שנשברה בגלל
       * שינוי קטלוג שאין לה שום קשר אליו.
       */
      await tx.tenant.updateMany({
        where: { couponPlanCode: code },
        data: { couponPlanCode: body.moveTo },
      });
      await this.plans.retire(tx, plan, actor);
      return moved.count;
    });
    this.plans.invalidate();
    return { ok: true, movedTenants };
  }

  /**
   * מחירי הלידים לפי מקור.
   *
   * מוחזרים מה-Service ולא מהטבלה ישירות, כדי שהמסך יראה את מה
   * שהמערכת באמת תגבה — כולל ברירות המחדל של מקורות שטרם תומחרו.
   */
  /** ‏מדרגות מס רכישה ותקרת הפטור במס שבח — מתעדכנות מדי ינואר, לכל המשרדים. */
  @Patch("tax-tables")
  async replaceTaxTables(
    @Body(new ZodValidationPipe(TaxTablesSchema)) body: TaxTablesInput,
  ): Promise<TaxTables> {
    return this.taxTables.replace(body, TenantContext.current().userId);
  }

  @Get("lead-prices")
  async leadPrices(): Promise<{ prices: LeadSourcePrice[] }> {
    return { prices: await this.leadPricing.all() };
  }

  @Patch("lead-prices/:source")
  async upsertLeadPrice(
    @Param("source") source: string,
    @Body(new ZodValidationPipe(LeadPriceSchema)) body: z.infer<typeof LeadPriceSchema>,
  ): Promise<{ ok: true }> {
    const price: LeadSourcePrice = { source, ...body };
    const reason = leadPriceRejectionReason(price);
    if (reason) throw new BadRequestException(reason);
    await this.leadPricing.upsert(price, TenantContext.current().userId);
    return { ok: true };
  }

  /**
   * התשלומים — עמוד אחרון, לא הכול.
   *
   * זו טבלה שגדלה לנצח, והמסך שמציג אותה משמש לזיהוי תשלום מסוים
   * ולזיכוי שלו; היסטוריה מלאה היא עבודה של דוח, לא של רשימה.
   */
  @Get("payments")
  async payments(@Query("tenantId") tenantId?: string): Promise<PaymentRow[]> {
    const rows = await this.prisma.payment.findMany({
      where: tenantId !== undefined && tenantId !== "" ? { tenantId } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      tenantName: names.get(row.tenantId) ?? row.tenantId,
      purpose: row.purpose,
      planCode: row.planCode,
      billingCycle: row.billingCycle,
      creditsPurchased: row.creditsPurchased,
      amountAgorot: row.amountAgorot,
      status: row.status,
      transactionId: row.transactionId,
      failureReason: row.failureReason,
      paidAt: row.paidAt,
      refundedAgorot: row.refundedAgorot,
      refundedAt: row.refundedAt,
      refundReason: row.refundReason,
      createdAt: row.createdAt,
    }));
  }

  /**
   * זיכוי תשלום — מלא או חלקי.
   *
   * הבדיקות כאן ולא בקארדקום: הם ישמחו לזכות פעמיים, והתוצאה היא
   * כסף שיצא ולא נרשם. התפיסה נעשית **לפני** הפנייה, בעדכון מותנה
   * על `refunded_at: null` — בדיוק כמו בחידוש — ומוחזרת לאחור אם
   * הזיכוי נדחה.
   */
  @Post("payments/:id/refund")
  @HttpCode(200)
  async refund(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(RefundSchema)) body: z.infer<typeof RefundSchema>,
  ): Promise<{ refundedAgorot: number; message: string }> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new BadRequestException("התשלום לא נמצא");
    if (payment.status !== "paid") throw new BadRequestException("רק תשלום שנגבה ניתן לזיכוי");
    if (payment.refundedAt !== null) throw new ConflictException("התשלום כבר זוכה");
    if (!payment.transactionId) {
      throw new BadRequestException("לתשלום אין מזהה עסקה — לא ניתן לזכות אותו אוטומטית");
    }
    const amount = body.amountAgorot ?? payment.amountAgorot;
    if (amount <= 0 || amount > payment.amountAgorot) {
      throw new BadRequestException("סכום הזיכוי חייב להיות בין אגורה אחת לסכום ששולם");
    }

    const claimed = await this.prisma.payment.updateMany({
      where: { id, refundedAt: null },
      data: { refundedAt: new Date(), refundedAgorot: amount, refundReason: body.reason ?? null },
    });
    if (claimed.count === 0) throw new ConflictException("התשלום כבר זוכה");

    let result: Awaited<ReturnType<CardcomService["refund"]>>;
    try {
      result = await this.cardcom.refund({
        transactionId: payment.transactionId,
        // זיכוי מלא נשלח בלי PartialSum — ראו ההנמקה ב-CardcomService
        ...(amount < payment.amountAgorot ? { partialAgorot: amount } : {}),
      });
    } catch (error) {
      await this.releaseRefund(id);
      throw error;
    }
    if (!result.refunded) {
      await this.releaseRefund(id);
      throw new BadRequestException(result.message || "הזיכוי נדחה בקארדקום");
    }

    await this.prisma.payment.update({
      where: { id },
      data: { refundTransactionId: result.refundTransactionId },
    });
    return { refundedAgorot: amount, message: result.message };
  }

  /** שחרור התפיסה כשהזיכוי לא עבר — אחרת התשלום נראה מזוכה ואינו. */
  private async releaseRefund(id: string): Promise<void> {
    await this.prisma.payment.update({
      where: { id },
      data: { refundedAt: null, refundedAgorot: null, refundReason: null },
    });
  }

  /**
   * ההכנסה מהפניות — **המספר שלא היה לו מסך.**
   *
   * העמלה חושבה ונשמרה על שורת ההפניה, ומעולם לא נזקפה לספר. הדרך
   * היחידה לדעת כמה הפלטפורמה הרוויחה הייתה לחבר ידנית הפרשים בין
   * שני יומנים של משרדים אחרים, ולכן בפועל איש לא ידע.
   */
  @Get("credits")
  async credits(): Promise<{
    report: PlatformCreditsReport;
    entries: PlatformCreditRow[];
  }> {
    return {
      report: await this.platformCredits.report(),
      entries: await this.platformCredits.entries(50),
    };
  }

  /**
   * מחיקת קרדיטים מחשבון הפלטפורמה — **הרגע שבו ההכנסה מוכרת.**
   *
   * הפלטפורמה היא המנפיק היחיד: קרדיט שהיא מוחקת הוא התחייבות שלה
   * שנסגרת בלי שהיא שילמה דבר. אצל משרד מחיקה היא הפסד; כאן היא
   * סגירת מעגל.
   *
   * הפעולה מפורשת ולא אוטומטית כדי שההכרה תיקשר לתאריך ולמחיר —
   * ראו `platform-credits.ts`. שורת הספר עצמה היא רישום הביקורת:
   * `audit_log` הוא טבלה של דייר, ולפעולה הזו אין דייר.
   */
  @Post("credits/burn")
  async burnCredits(
    @Body(new ZodValidationPipe(BurnCreditsSchema)) body: z.infer<typeof BurnCreditsSchema>,
  ): Promise<{ ok: true; recognizedAgorot: number; report: PlatformCreditsReport }> {
    const { recognizedAgorot } = await this.platformCredits.burn(
      body.credits,
      body.note?.trim() ? body.note.trim() : null,
    );
    return { ok: true, recognizedAgorot, report: await this.platformCredits.report() };
  }

  /**
   * חשבוניות שדורשות עין — **ממתינות, נכשלו, ותשלומים בלי מסמך.**
   *
   * המסך הזה עונה על שאלה אחת: האם יש כסף שנכנס ואין עליו מסמך.
   * לכן הוא מציג גם שורות שנכשלו וגם תשלומים שאין להם שורת חשבונית
   * כלל — השנייה היא התקלה השקטה יותר, ובלי המסך הזה אין דרך לראותה.
   */
  @Get("invoices")
  async invoiceProblems(): Promise<{
    pending: {
      id: string;
      tenantId: string;
      tenantName: string;
      status: string;
      grossAgorot: number;
      description: string;
      attempts: number;
      lastError: string | null;
      createdAt: Date;
    }[];
    paymentsWithoutInvoice: { id: string; tenantId: string; amountAgorot: number; paidAt: Date | null }[];
  }> {
    const rows = await this.prisma.invoice.findMany({
      where: { status: { not: "issued" } },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        tenantId: true,
        status: true,
        grossAgorot: true,
        description: true,
        attempts: true,
        lastError: true,
        createdAt: true,
      },
    });
    /*
     * תשלום ששולם ואין לו שורת חשבונית בכלל — הרישום עצמו נכשל.
     * שאילתה נפרדת כי זו תקלה אחרת לגמרי: לא "הספק דחה" אלא "לא
     * ביקשנו". תשלום באפס אינו נספר, כי עליו אין מסמך מלכתחילה.
     */
    const orphans = await this.prisma.payment.findMany({
      where: { status: "paid", amountAgorot: { gt: 0 }, invoice: { is: null } },
      orderBy: { paidAt: "desc" },
      take: 50,
      select: { id: true, tenantId: true, amountAgorot: true, paidAt: true },
    });

    const tenantIds = [...new Set([...rows, ...orphans].map((row) => row.tenantId))];
    const tenants =
      tenantIds.length > 0
        ? await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));

    return {
      pending: rows.map((row) => ({ ...row, tenantName: nameById.get(row.tenantId) ?? row.tenantId })),
      paymentsWithoutInvoice: orphans,
    };
  }

  /** הפקה חוזרת של חשבונית שנכשלה, או רישום מסמך לתשלום שאין לו. */
  @Post("invoices/:id/retry")
  @HttpCode(200)
  async retryInvoice(
    @Param("id", IdParam) id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.invoices.issueOne(id);
  }

  /** רישום חשבונית לתשלום ששולם ואין לו שורה — ואז הפקה בסבב הבא. */
  @Post("payments/:id/invoice")
  @HttpCode(200)
  async invoiceForPayment(
    @Param("id", IdParam) id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    /*
     * ‎**תיקון ידני מדווח מה קרה באמת.** `queueForPayment` בולעת
     * כשלים בכוונה — היא נקראת גם מהוובהוק, ושם הסורק ידווח שוב —
     * אבל כאן זו פעולת תיקון מפורשת, והמסך אמר „נרשם” גם כשלא נרשם
     * דבר והתשלום נשאר בלי מסמך (ביקורת Codex).
     */
    return this.invoices.queueForPayment(id);
  }

  /* ==================== קודי קופון ==================== */

  /**
   * הקופונים, החדשים קודם. מוצג גם כמה פעמים כל אחד מומש — זה המספר
   * היחיד שבעל הפלטפורמה באמת בודק אחרי שהוא מפרסם קוד.
   */
  @Get("coupons")
  async listCoupons(): Promise<{ coupons: CouponRow[] }> {
    const rows = await this.prisma.coupon.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return {
      coupons: rows.map((row) => ({
        ...row,
        kind: row.kind as CouponKind,
        description: describeCoupon(row as CouponDefinition),
        note: row.description,
      })),
    };
  }

  /**
   * יצירה או עדכון של קופון.
   *
   * הקוד מנורמל לפני השמירה, ולכן "welcome 20" ו-"WELCOME20" הם אותה
   * רשומה — אחרת היו נוצרים שני קופונים שנראים זהים במסך ומתנהגים
   * שונה. `redemptions` לעולם אינו נכתב כאן: הוא מונה מימושים, ולא
   * שדה שעורכים.
   */
  @Post("coupons")
  @HttpCode(200)
  async saveCoupon(
    @Body(new ZodValidationPipe(CouponSchema)) body: z.infer<typeof CouponSchema>,
  ): Promise<{ ok: true }> {
    /*
     * ‎`?? null`‎ ולא `body` כמו שהוא: הסכימה מרשה `undefined` (השדה
     * לא נשלח) והבדיקה מדברת ב-`null` (אין ערך). שני מצבים שנראים
     * זהים במסך חייבים להגיע לבדיקה כאחד, אחרת קופון בלי אחוז היה
     * עובר רק משום שהשדה הושמט.
     */
    const rejection = couponDefinitionRejection({
      code: body.code,
      kind: body.kind,
      percentOff: body.percentOff ?? null,
      freeDays: body.freeDays ?? null,
      maxRedemptions: body.maxRedemptions ?? null,
    });
    if (rejection !== null) throw new BadRequestException(rejection);
    const code = normalizeCouponCode(body.code);
    const data = {
      description: body.description ?? "",
      kind: body.kind,
      percentOff: body.kind === "percent" ? body.percentOff : null,
      freeDays: body.kind === "free_days" ? body.freeDays : null,
      planCode: body.planCode ?? null,
      maxRedemptions: body.maxRedemptions ?? null,
      expiresAt: body.expiresAt === undefined ? null : new Date(body.expiresAt),
      isActive: body.isActive ?? true,
    };
    await this.prisma.coupon.upsert({
      where: { code },
      update: data,
      create: { ...data, code, createdBy: TenantContext.current().userId },
    });
    return { ok: true };
  }

  /**
   * כיבוי קופון — ולא מחיקה.
   *
   * מחיקה הייתה מוחקת גם את העדות: משרד שנרשם עם הקוד ממשיך לשאת
   * אותו ב-`coupon_code`, ובלי הרשומה אי אפשר לענות לשאלה "מה
   * הבטחנו לו". קופון כבוי פשוט אינו מתקבל יותר.
   */
  @Delete("coupons/:code")
  async disableCoupon(@Param("code") code: string): Promise<{ ok: true }> {
    await this.prisma.coupon.updateMany({
      where: { code: normalizeCouponCode(code) },
      data: { isActive: false },
    });
    return { ok: true };
  }

  /* ==================== השכרות מספרים מ-015 ==================== */

  /**
   * כל ההשכרות בפלטפורמה — הרשימה שהטיפול הידני עובד מולה.
   *
   * הרכישה והתפיסה אוטומטיות, אבל הניתוב הסופי אצל 015 ידני —
   * וזה המסך שמראה מה ממתין: השכרה ששולמה בלי `provisioned` היא
   * תפיסה שנכשלה, ו-`past_due` הוא חיוב חודשי שנדחה.
   */
  @Get("number-rentals")
  async listNumberRentals(
    /** סינון למשרד אחד — לשולחן החיבורים, שמציג חיוב ליד כל מספר. */
    @Query("tenantId", new ZodValidationPipe(IdSchema.optional())) tenantId?: string,
  ): Promise<{
    rentals: {
      id: string;
      tenantId: string;
      tenantName: string;
      number: string;
      numberDisplay: string;
      monthlyAgorot: number;
      status: string;
      currentPeriodEnd: Date | null;
      provisioned: boolean;
      /** `purchased` מהמלאי של 015, או `platform` — חיוב שנפתח מכאן. */
      origin: string;
      providerError: string | null;
      createdAt: Date;
    }[];
  }> {
    const rows = await this.prisma.rentedNumber.findMany({
      where: tenantId === undefined ? {} : { tenantId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    return {
      rentals: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        tenantName: names.get(row.tenantId) ?? row.tenantId,
        number: row.number,
        numberDisplay: formatRentalNumber(row.number),
        monthlyAgorot: row.monthlyAgorot,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd,
        provisioned: row.providerPurchasedAt !== null,
        origin: row.origin,
        providerError: row.providerError,
        createdAt: row.createdAt,
      })),
    };
  }

  /**
   * חיוב חודשי על מספר שכבר בידי המשרד — נפתח מהפלטפורמה.
   *
   * לא השכרה מהמלאי של 015: המספר של המשרד (למשל ממרכזייה משלו),
   * והפלטפורמה גובה עליו שירות. אותו סורק חידושים ואותו כרטיס שמור.
   * ראו `NumberRentalService.createPlatformCharge`.
   */
  @Post("number-rentals")
  @HttpCode(200)
  async createNumberCharge(
    @Body(new ZodValidationPipe(CreateNumberChargeSchema))
    body: z.infer<typeof CreateNumberChargeSchema>,
  ): Promise<{ id: string; number: string; warning: string | null }> {
    return this.numberRentals.createPlatformCharge({
      ...body,
      createdBy: TenantContext.current().userId,
    });
  }

  /**
   * שחרור מיידי — כלי הטיפול הידני של מנהל הפלטפורמה.
   *
   * עוקף את ההמתנה לסוף התקופה: משמש כשמשרד לא שילם והוחלט לשחרר,
   * או כשתפיסה נכשלה והמספר מוחלף. פעולה מפורשת של מנהל — אין כאן
   * החזר כספי אוטומטי; זיכוי נעשה במסך התשלומים כרגיל.
   */
  @Post("number-rentals/:id/release")
  @HttpCode(200)
  async releaseNumberRental(
    @Param("id", IdParam) id: string,
  ): Promise<{ ok: true }> {
    const result = await this.numberRentals.releaseNow(id);
    if (!result.ok) throw new BadRequestException(result.message);
    return { ok: true };
  }

  /* ==================== הצעות מנוי בלינק ==================== */

  /**
   * ההצעות שנוצרו, החדשות קודם — כולל הלינק המוכן להעתקה ומונה
   * המימושים, שהוא המספר שבודקים אחרי ששולחים לינק ללקוח.
   */
  @Get("offers")
  async listOffers(): Promise<{ offers: PlatformOfferRow[] }> {
    return { offers: await this.subscriptionOffers.list() };
  }

  /**
   * יצירת הצעה — התשובה כוללת את הלינק לשליחה ללקוח.
   *
   * משרד יעד ⇒ הצעה אישית: מסלול + תוספות + מחיר סופי + תכונות,
   * נעולה למשרד וחד-פעמית כברירת מחדל. בלי יעד ⇒ לינק מכירה לחבילה,
   * לכל משרד מחובר — מה שסוכן מכירות שולח אחרי שיחה.
   */
  @Post("offers")
  @HttpCode(200)
  async createOffer(
    @Body(new ZodValidationPipe(CreateOfferSchema)) body: z.infer<typeof CreateOfferSchema>,
  ): Promise<{ ok: true; offer: PlatformOfferRow }> {
    const offer = await this.subscriptionOffers.create(
      {
        tenantId: body.tenantId ?? null,
        planCode: body.planCode,
        billingCycle: body.billingCycle,
        priceAgorot: body.priceAgorot ?? null,
        lineItems: body.lineItems,
        featureGrants: sanitizeFeatures(body.featureGrants),
        note: body.note,
        maxRedemptions: body.maxRedemptions ?? null,
        expiresAt:
          body.expiresAt === undefined || body.expiresAt === null
            ? null
            : new Date(body.expiresAt),
      },
      TenantContext.current().userId,
    );
    return { ok: true, offer };
  }

  /**
   * ביטול הצעה — הלינק מפסיק להתקבל. לא מחיקה: תשלום שמימש את
   * ההצעה מפנה אליה, ובלי השורה אין תשובה ל"מה הובטח לו".
   */
  @Delete("offers/:id")
  @HttpCode(200)
  async revokeOffer(
    @Param("id", IdParam) id: string,
  ): Promise<{ ok: true }> {
    await this.subscriptionOffers.revoke(id);
    return { ok: true };
  }
}
