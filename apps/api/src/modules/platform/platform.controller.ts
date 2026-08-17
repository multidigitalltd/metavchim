import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import {
  BLOCKABLE_MODULE_KEYS,
  IdSchema,
  MAX_CREDIT_BONUS_PERCENT,
  MAX_CREDIT_EXPIRY_MONTHS,
  MAX_CREDIT_PACKAGES,
  MAX_CREDIT_UNIT_PRICE_AGOROT,
  MAX_CREDITS_PER_PACKAGE,
  MAX_ECONOMY_FEE_PERCENT,
  MAX_INITIAL_GRANT_CREDITS,
  MAX_PAYOUT_MINIMUM_AGOROT,
  type CreditEconomy,
  MAX_PLATFORM_FEE_PERCENT,
  resolveReferralFeePercent,
  PLAN_FEATURES,
  blockedModulesRejectionReason,
  couponDefinitionRejection,
  describeCoupon,
  normalizeCouponCode,
  type CouponDefinition,
  type CouponKind,
  TenantStatusSchema,
  downgradeWarnings,
  leadPriceRejectionReason,
  type LeadSourcePrice,
  planRejectionReason,
  sanitizeFeatures,
  type PlanDefinition,
  type ServiceVersion,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { EmailService } from "../../core/email.service";
import {
  PlatformSettingsService,
  type PlatformSettingKey,
} from "../../core/platform-settings.service";
import { CardcomService } from "../../core/cardcom.service";
import { GeocodingService } from "../../core/geocoding.service";
import { CreditEconomyService } from "../../core/credit-economy.service";
import { AccountDeletionService } from "../settings/account-deletion.service";
import { LeadPricingService } from "../../core/lead-pricing.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { AuthService, tenantPeriodEnded } from "../auth/auth.service";
import { SESSION_COOKIE } from "../auth/auth.controller";
import {
  BackupsService,
  type BackupsOverview,
  type BackupRunStatus,
  type RestoreStatus,
} from "./backups.service";
import { callUpdaterAgent, updaterFailure } from "./updater-agent";
import { ServiceVersionsService } from "./service-versions.service";

/**
 * ניהול הפלטפורמה — הקמת משרדי תיווך חדשים מהממשק, בלי SSH.
 * גישה רק למי שמופיע ב-PLATFORM_ADMIN_EMAILS (בעל הפלטפורמה), בנוסף
 * להתחברות רגילה. כשהרשימה ריקה — המסך כבוי לגמרי.
 */

/**
 * קוד מסלול — מחרוזת ולא enum.
 *
 * המסלולים הפכו לנתונים שבעל הפלטפורמה עורך, ולכן enum בקוד היה
 * חוסם בדיוק את מה שהמסך נועד לאפשר: מסלול חדש. התקינות נבדקת מול
 * הקטלוג בפועל, שם היא גם רלוונטית.
 */
const PlanCodeSchema = z
  .string()
  .min(2)
  .max(20)
  .regex(/^[a-z0-9_]+$/u, "קוד מסלול באותיות לטיניות קטנות, ספרות וקו תחתון");

const CreateAgencySchema = z
  .object({
    name: z.string().min(2).max(120),
    ownerEmail: z.string().email().max(254),
    ownerName: z.string().min(2).max(120),
    plan: PlanCodeSchema.default("pro"),
  })
  .strict();

/** חסימת מודולים: הרשימה המבוקשת במלואה, לא תוספת. */
const BlockedModulesSchema = z
  .object({
    blockedModules: z.array(z.string().min(1).max(40)).max(BLOCKABLE_MODULE_KEYS.length),
  })
  .strict();

/** מחיקת משרד: שם המשרד במדויק — ההגנה מפני השורה הלא נכונה. */
const DeleteAgencySchema = z.object({ confirmName: z.string().min(1).max(120) }).strict();

/**
 * מחיקת מסלול: חובה לנקוב במסלול היעד.
 *
 * לא אופציונלי בכוונה. מסלול שנמחק בלי יעד משאיר משרדים עם קוד
 * שאינו בקטלוג — ומשרד כזה מאבד את כל הפיצ'רים והמכסות בשקט.
 */
const DeletePlanSchema = z.object({ moveTo: PlanCodeSchema }).strict();

const UpdateAgencySchema = z
  .object({
    plan: PlanCodeSchema.optional(),
    status: TenantStatusSchema.optional(),
    /**
     * הענקת גישה ידנית: תאריך, או `null` ל"בלי תפוגה".
     *
     * זה הכלי שהיה חסר. משרד שתקופתו נגמרה נשאר חסום גם אחרי
     * שהסטטוס שלו `active`, כי הסטטוס אינו התנאי היחיד — ולמנהל
     * הפלטפורמה לא הייתה שום דרך לשחרר אותו בלי לגעת בבסיס הנתונים.
     *
     * שדה נפרד ולא תופעת לוואי של שינוי הסטטוס: מחיקה שקטה של
     * תאריך תשלום בזמן שמישהו רק החזיר משרד מהשהיה היא בדיוק סוג
     * ההפתעה שאסור שתהיה בכלי ניהול.
     */
    paidUntil: z.union([z.string().datetime(), z.null()]).optional(),
  })
  .strict();

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
    maxNetworkListings: LimitSchema.default(null),
    maxNetworkDemands: LimitSchema.default(null),
    features: z.array(z.string().max(40)).max(50),
    trialDays: z.number().int().min(0).max(90),
    isPublic: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
  })
  .strict();

/** ערך ריק = מחיקת ההגדרה מה-DB וחזרה למשתנה הסביבה (אם קיים). */
/*
 * ‎.trim()‎ על כל סוד ומזהה: הערכים מודבקים מלוחות של ספקים, ורווח
 * או שורת-חדשה שנגררים בהדבקה נשמרים ונשלחים כמו שהם — Google, למשל,
 * מחזיר על זה ‎invalid_client‎ ושובר את ההתחברות לכל המערכת.
 */
const UpdateSettingsSchema = z
  .object({
    postmarkServerToken: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    emailFrom: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
    whatsappAppSecret: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    whatsappVerifyToken: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    loginOtpEnabled: z.boolean().optional(),
    googleClientId: z.union([z.string().trim().min(10).max(200), z.literal("")]).optional(),
    googleClientSecret: z.union([z.string().trim().min(10).max(200), z.literal("")]).optional(),
    /** Gemini לפקודות קוליות — מפתח בלבד מספיק; המודל אופציונלי */
    geminiApiKey: z.union([z.string().trim().min(10).max(200), z.literal("")]).optional(),
    geminiModel: z.union([z.string().trim().min(3).max(60), z.literal("")]).optional(),
    // מספר המסוף מגיע כמחרוזת ולא כמספר: הוא מזהה, לא כמות, ואפסים
    // מובילים בו משמעותיים
    cardcomTerminalNumber: z.union([z.string().trim().regex(/^\d{1,12}$/u), z.literal("")]).optional(),
    cardcomApiName: z.union([z.string().trim().min(3).max(100), z.literal("")]).optional(),
    cardcomApiPassword: z.union([z.string().trim().min(6).max(200), z.literal("")]).optional(),
    /*
     * עמלת ההפניות באחוזים. ריק = חזרה לברירת המחדל של המערכת;
     * אפס = החלטה מפורשת לא לגבות. התקרה היא הגנת שפיות — עמלה
     * שמעליה הופכת את ההפניה ללא כדאית למי שמפנה, כלומר סוגרת את
     * הלוח.
     */
    referralFeePercent: z
      .union([z.number().int().min(0).max(MAX_PLATFORM_FEE_PERCENT), z.literal("")])
      .optional(),
    /** טוקן פענוח כתובות — ‎pk.*‎ אצל Mapbox. אינו קשור לאריחי המפה. */
    mapboxToken: z.union([z.string().trim().min(20).max(200), z.literal("")]).optional(),
    /**
     * כתובת סגנון האריחים. ריק = הסגנון הפתוח שברירת המחדל.
     *
     * חייבת להיות HTTPS: MapLibre אינה מפענחת `mapbox://`, וסגנון
     * כזה נטען בלי לצייר דבר — בדיוק התקלה שהייתה.
     */
    mapStyleUrl: z
      .union([z.string().trim().url().startsWith("https://").max(300), z.literal("")])
      .optional(),
    /** ספק פענוח הכתובות. ‎none‎ = לא פונים לאיש. */
    geocodingProvider: z.enum(["none", "govmap", "mapbox"]).optional(),
    /**
     * כתובת שאליה נשלחת התראה על פנייה חדשה לתמיכה.
     *
     * ריק = בלי התראה, לא "בלי תמיכה": הפנייה נשמרת ומופיעה בתור
     * שבמסך הזה בכל מקרה. הכתובת רק מקצרת את זמן התגובה.
     */
    supportEmail: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),

    /*
     * כלכלת הקרדיטים. **ריק בכל שדה = חזרה לברירת המחדל**, ולא אפס:
     * `Number("")` הוא 0, ושדה שנוקה בטעות היה מאפס מחיר בשקט.
     * התקרות הן הגנת שפיות מפני טעות הקלדה, לא מדיניות מחירים.
     */
    creditUnitPriceAgorot: z
      .union([z.number().int().min(1).max(MAX_CREDIT_UNIT_PRICE_AGOROT), z.literal("")])
      .optional(),
    creditPackages: z
      .array(
        z
          .object({
            credits: z.number().int().min(1).max(MAX_CREDITS_PER_PACKAGE),
            priceAgorot: z.number().int().min(1),
          })
          .strict(),
      )
      .max(MAX_CREDIT_PACKAGES)
      .optional(),
    creditBonusPercent: z
      .union([z.number().int().min(0).max(MAX_CREDIT_BONUS_PERCENT), z.literal("")])
      .optional(),
    creditFeeCashPercent: z
      .union([z.number().int().min(0).max(MAX_ECONOMY_FEE_PERCENT), z.literal("")])
      .optional(),
    creditPayoutMinimumAgorot: z
      .union([z.number().int().min(0).max(MAX_PAYOUT_MINIMUM_AGOROT), z.literal("")])
      .optional(),
    creditExpiryMonths: z
      .union([z.number().int().min(0).max(MAX_CREDIT_EXPIRY_MONTHS), z.literal("")])
      .optional(),
    creditInitialGrant: z
      .union([z.number().int().min(0).max(MAX_INITIAL_GRANT_CREDITS), z.literal("")])
      .optional(),
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

/** שם קובץ גיבוי — הוולידציה המחייבת היא ב-BackupsService (רשימת היתר). */
const BackupNameSchema = z.object({ name: z.string().min(1).max(120) }).strict();

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

export interface AgencyRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  userCount: number;
  createdAt: Date;
  /** חלון גישת תמיכה פתוח — null כשאין הסכמה בתוקף. */
  supportAccessUntil: Date | null;
  /** מודולים שהפלטפורמה חסמה למשרד — מפתחות מקטלוג המודולים. */
  blockedModules: string[];
  /**
   * התפוגות, ומה שנגזר מהן.
   *
   * בלעדיהן המסך הזה מציג "פעיל" למשרד שאינו מצליח להיכנס: הסטטוס
   * הוא רק אחד משלושת התנאים, והשניים האחרים הם תאריכים. מנהל
   * פלטפורמה שרואה "פעיל" ושומע "אני לא נכנס" אין לו מה לעשות עם
   * זה.
   */
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  /** true = המשרד מחובר אך מוגבל למסך המנוי. */
  periodEnded: boolean;
}

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

@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly email: EmailService,
    private readonly backups: BackupsService,
    private readonly plans: PlanCatalogService,
    private readonly leadPricing: LeadPricingService,
    private readonly cardcom: CardcomService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly geocoding: GeocodingService,
    private readonly creditEconomy: CreditEconomyService,
    private readonly serviceVersions: ServiceVersionsService,
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

      const moved = await tx.tenant.updateMany({
        where: { plan: code },
        data: { plan: body.moveTo },
      });
      /*
       * המנוי ולא רק המשרד. `subscriptions.plan_code` הוא מה
       * ש-RenewalService מתמחר לפיו, והוא מדלג על מסלול שאינו מוכר —
       * כלומר לקוח משלם היה מפסיק להתחדש בשקט בזמן שהמשרד שלו נראה
       * תקין לגמרי (ביקורת Codex).
       */
      await tx.subscription.updateMany({
        where: { planCode: code },
        data: { planCode: body.moveTo },
      });
      await tx.coupon.updateMany({ where: { planCode: code }, data: { planCode: body.moveTo } });
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
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

  @Get("agencies")
  async list(): Promise<AgencyRow[]> {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        trialEndsAt: true,
        paidUntil: true,
        supportAccessUntil: true,
        blockedModules: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    });
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      status: t.status,
      userCount: t._count.users,
      blockedModules: t.blockedModules,
      createdAt: t.createdAt,
      trialEndsAt: t.trialEndsAt,
      paidUntil: t.paidUntil,
      // חלון גישת תמיכה פתוח? המסך מראה כפתור כניסה רק כשיש הסכמה
      supportAccessUntil:
        t.supportAccessUntil !== null && t.supportAccessUntil.getTime() > Date.now()
          ? t.supportAccessUntil
          : null,
      // אותה פונקציה שהשרת אוכף לפיה, ולא העתק שלה
      periodEnded: tenantPeriodEnded(t),
    }));
  }

  /** הקמת משרד חדש: Tenant + בעלים עם סיסמה זמנית (מוצגת פעם אחת). */
  @Post("agencies")
  async create(
    @Body(new ZodValidationPipe(CreateAgencySchema)) body: z.infer<typeof CreateAgencySchema>,
  ): Promise<{ tenantId: string; ownerEmail: string; tempPassword: string }> {
    const email = body.ownerEmail.toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new BadRequestException("האימייל כבר רשום במערכת");
    if ((await this.plans.byCode(body.plan)) === undefined) {
      throw new BadRequestException("מסלול לא מוכר");
    }

    const tempPassword = `Mv-${randomBytes(9).toString("base64url")}`;
    const passwordHash = await AuthService.hashPassword(tempPassword);
    const tenantId = ulid();

    await this.prisma.$transaction([
      this.prisma.tenant.create({
        data: { id: tenantId, name: body.name, plan: body.plan, status: "active" },
      }),
      this.prisma.user.create({
        data: {
          id: ulid(),
          tenantId,
          name: body.ownerName,
          email,
          passwordHash,
          role: "owner",
          mustChangePassword: true,
        },
      }),
    ]);

    return { tenantId, ownerEmail: email, tempPassword };
  }

  /**
   * מה ייחסם אם המשרד יעבור למסלול הזה — לפני האישור.
   *
   * הורדת מסלול בשקט היא הדרך המהירה ביותר לשבור משרד עובד: סוכנים
   * מעל המכסה, מרכזייה שמפסיקה לקלוט שיחות. עדיף לראות את זה כאן
   * מאשר בטלפון של התמיכה.
   */
  @Get("agencies/:id/plan-preview")
  async planPreview(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Query(new ZodValidationPipe(z.object({ plan: PlanCodeSchema }).strict()))
    query: { plan: string },
  ): Promise<{ warnings: string[] }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { plan: true },
    });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");
    const target = await this.plans.byCode(query.plan);
    if (!target) throw new BadRequestException("מסלול לא מוכר");

    /*
     * הספירות בדיוק כמו באכיפה: משתמש פעיל בלבד, ונכס שאינו בארכיון.
     *
     * הנכסים דרך `withExplicitTenant` — הטבלה תחת FORCE RLS, ובלי
     * הקשר דייר הספירה מחזירה אפס, כלומר אזהרת ההורדה הייתה שותקת
     * בדיוק כשהיא הכי נחוצה (ביקורת Codex).
     */
    const [users, properties] = await Promise.all([
      this.prisma.user.count({ where: { tenantId: id, isActive: true } }),
      this.prisma.withExplicitTenant(id, (tx) =>
        tx.property.count({ where: { tenantId: id, deletedAt: null } }),
      ),
    ]);
    return {
      warnings: downgradeWarnings(await this.plans.byCode(tenant.plan), target, {
        users,
        properties,
      }),
    };
  }

  /** מעבר מסלול / שינוי סטטוס (השהיה מנתקת את כל המשתמשים מיידית). */
  @Patch("agencies/:id")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateAgencySchema)) body: z.infer<typeof UpdateAgencySchema>,
  ): Promise<{ ok: true }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");
    /*
     * קוד מסלול נבדק מול הקטלוג ולא מול enum: מסלול שאינו קיים היה
     * נשמר על המשרד ומשאיר אותו בלי אף פיצ'ר, בלי שום שגיאה.
     */
    if (body.plan !== undefined && (await this.plans.byCode(body.plan)) === undefined) {
      throw new BadRequestException("מסלול לא מוכר");
    }

    await this.prisma.tenant.update({
      where: { id },
      data: {
        ...(body.plan !== undefined ? { plan: body.plan } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.paidUntil !== undefined
          ? {
              paidUntil: body.paidUntil === null ? null : new Date(body.paidUntil),
              /*
               * הענקה ידנית מסיימת גם את הניסיון: משרד עם שני
               * תאריכים פעילים היה נחסם לפי זה שרלוונטי לסטטוס שלו,
               * ומנהל שהעניק גישה לא היה מבין למה היא לא נכנסה לתוקף.
               */
              trialEndsAt: null,
            }
          : {}),
      },
    });
    // השהיה — ניתוק מיידי של כל ה-sessions של המשרד
    if (body.status === "suspended") {
      const users = await this.prisma.user.findMany({
        where: { tenantId: id },
        select: { id: true },
      });
      await this.prisma.session.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
    }
    return { ok: true };
  }

  /**
   * חסימת מודולים למשרד — החלטת פלטפורמה שמנהל המשרד אינו יכול לבטל.
   *
   * הרשימה **מוחלפת** ולא מתווספת: מסך שמסמן תיבות שולח את המצב
   * המבוקש, ופעולה מצטברת הייתה מחייבת אותו לזכור מה כבר חסום כדי
   * לבטל. אין תפוגה — זו החלטה עסקית ולא ענישה זמנית; להסיר, שולחים
   * רשימה בלי המודול.
   *
   * אין כאן מחיקת Sessions: היכולות נפתרות בכל בקשה מחדש, ולכן
   * החסימה תופסת בקליק הבא בלי לנתק אף אחד באמצע עבודה.
   */
  @Patch("agencies/:id/modules")
  async setBlockedModules(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(BlockedModulesSchema)) body: z.infer<typeof BlockedModulesSchema>,
  ): Promise<{ ok: true; blockedModules: string[] }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, blockedModules: true },
    });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");
    const reason = blockedModulesRejectionReason(body.blockedModules);
    if (reason) throw new BadRequestException(reason);

    // כפילויות אינן שגיאה אבל גם אינן נשמרות פעמיים
    const blockedModules = [...new Set(body.blockedModules)];
    await this.prisma.tenant.update({ where: { id }, data: { blockedModules } });
    /*
     * ביומן של המשרד עצמו ולא רק בלוג השרת: בעל המשרד יראה למה
     * מודול נעלם לו, ובלי הרישום הזה ההיעלמות נראית כמו תקלה.
     */
    await this.prisma.withExplicitTenant(id, (tx) =>
      tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId: id,
          userId: null,
          action: "platform.blocked_modules",
          entityType: "tenant",
          entityId: id,
          metadata: { before: tenant.blockedModules, after: blockedModules },
        },
      }),
    );
    return { ok: true, blockedModules };
  }

  /**
   * מחיקת משרד לצמיתות — כל התכנים, כמו מחיקה עצמית של בעל המשרד.
   *
   * האישור הוא הקלדת שם המשרד: אין לפלטפורמה סיסמה של הבעלים, ומה
   * שצריך למנוע כאן הוא לחיצה על השורה הלא נכונה ברשימה.
   */
  @Delete("agencies/:id")
  @HttpCode(200)
  async deleteAgency(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(DeleteAgencySchema)) body: z.infer<typeof DeleteAgencySchema>,
  ): Promise<{ ok: true }> {
    return this.accountDeletion.deleteTenantFromPlatform(id, body.confirmName);
  }

  /**
   * הגדרות הפלטפורמה — מצב בלבד, בלי לחשוף ערכים. מפתחות שהוגדרו
   * במשתני סביבה מסומנים כמקור "env" (נשלטים מהשרת, לא מהמסך).
   */
  @Get("settings")
  async settings(): Promise<{
    postmark: { configured: boolean; source: "db" | "env" | "none"; emailFrom?: string };
    /** webhookUrl מוגדר פעם אחת במטא לכל הפלטפורמה — ולכן הוא כאן ולא בהגדרות המשרד. */
    whatsapp: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
    /**
     * אותם Client ID ו-Secret משרתים שלושה חיבורים — התחברות, יומן
     * ו-Gmail — ולכן מוחזרות **כל** כתובות החזרה. הצגת אחת בלבד
     * הובילה לרישום חלקי ב-Google Cloud, ואז הסנכרון נפל על
     * redirect_uri_mismatch בלי שיהיה ברור למה.
     */
    google: {
      configured: boolean;
      source: "db" | "env" | "none";
      redirectUri: string;
      redirectUris: { label: string; url: string }[];
    };
    /** Gemini לפקודות קוליות — model מוצג כדי שיהיה ברור מה באמת רץ. */
    gemini: { configured: boolean; source: "db" | "env" | "none"; model: string };
    /** webhookUrl היא הכתובת שנרשמת אצל קארדקום — מוצגת כדי שלא ינחשו אותה. */
    cardcom: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
    loginOtpEnabled: boolean;
    /**
     * אחוז העמלה ממכירת הפניה — **הערך עצמו ולא רק "מוגדר".**
     *
     * זה מספר עסקי ולא סוד ספק: הוא מוצג לשני צדדי העסקה ממילא, ומי
     * שעורך אותו חייב לראות מה הוא משנה. תיבה ריקה שמתיימרת לייצג
     * מספר שגובים בפועל היא בדיוק איך משנים אותו בטעות.
     */
    referralFeePercent: number;
    /** כלכלת הקרדיטים כפי שהיא בפועל — כולל ברירות מחדל שלא נשמרו */
    creditEconomy: CreditEconomy;
    /** אריחי המפה — סטטוס בלבד; הטוקן עצמו נמסר לאפליקציה בנתיב שלה. */
    maps: { configured: boolean; customStyle: boolean };
    /** פענוח כתובות: מי הספק ומה הוא יודע לעשות. */
    geocoding: { provider: string; forward: boolean; reverse: boolean };
    /**
     * כתובת התמיכה — **הערך עצמו ולא רק "מוגדר".**
     *
     * אותו נימוק כמו ב-`referralFeePercent`: זו אינה סוד ספק אלא
     * כתובת תפעולית, ומי שעורך אותה חייב לראות מה כתוב שם. בלי זה
     * השדה חזר ריק אחרי כל שמירה — השמירה הצליחה, השורה נכתבה,
     * והמסך נראה כאילו לא קרה כלום. משתמש שלא רואה את מה שהזין
     * מסיק, בצדק, שהכפתור אינו עובד.
     */
    supportEmail: string;
  }> {
    const env = loadEnv();
    const dbKeys = await this.platformSettings.configuredKeys();
    const has = (k: PlatformSettingKey): boolean => dbKeys.includes(k);

    const postmarkDb = has("postmarkServerToken") && has("emailFrom");
    const postmarkEnv = env.POSTMARK_SERVER_TOKEN !== undefined && env.EMAIL_FROM !== undefined;
    const waDb = has("whatsappAppSecret") && has("whatsappVerifyToken");
    const waEnv = env.WHATSAPP_APP_SECRET !== undefined && env.WHATSAPP_VERIFY_TOKEN !== undefined;
    const googleDb = has("googleClientId") && has("googleClientSecret");
    const googleEnv = env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined;
    const geminiDb = has("geminiApiKey");
    const geminiEnv = env.GEMINI_API_KEY !== undefined;
    // שלושת השדות יחד: מסוף בלי סיסמת API הוא סליקה שנופלת בלחיצה
    // הראשונה, וזה בדיוק המצב שאסור להציג כ"מוגדר"
    const cardcomDb =
      has("cardcomTerminalNumber") && has("cardcomApiName") && has("cardcomApiPassword");
    const cardcomEnv =
      env.CARDCOM_TERMINAL_NUMBER !== undefined &&
      env.CARDCOM_API_NAME !== undefined &&
      env.CARDCOM_API_PASSWORD !== undefined;
    const otpDb = await this.platformSettings.get("loginOtpEnabled");
    // אותה פונקציה שהשרת גובה לפיה — לא העתק שלה
    const referralFeePercent = resolveReferralFeePercent(
      await this.platformSettings.get("referralFeePercent"),
    );

    return {
      referralFeePercent,
      creditEconomy: await this.creditEconomy.current(),
      // המפה עובדת תמיד — ברירת המחדל היא סגנון פתוח בלי מפתח
      maps: { configured: true, customStyle: has("mapStyleUrl") },
      geocoding: {
        provider: await this.geocoding.provider(),
        ...(await this.geocoding.capabilities()),
      },
      // הערך ולא רק "מוגדר" — ראו ההסבר בטיפוס המוחזר
      supportEmail: (await this.platformSettings.get("supportEmail")) ?? "",
      postmark: {
        configured: postmarkDb || postmarkEnv,
        source: postmarkDb ? "db" : postmarkEnv ? "env" : "none",
        emailFrom: (await this.platformSettings.get("emailFrom")) ?? env.EMAIL_FROM,
      },
      whatsapp: {
        configured: waDb || waEnv,
        source: waDb ? "db" : waEnv ? "env" : "none",
        webhookUrl: `${env.WEB_ORIGIN}/api/v1/webhooks/whatsapp`,
      },
      google: {
        configured: googleDb || googleEnv,
        source: googleDb ? "db" : googleEnv ? "env" : "none",
        // הכתובת שחייבת להירשם ב-Google Cloud Console — מוצגת כדי
        // שלא יהיה צורך לנחש אותה
        redirectUri: `${env.WEB_ORIGIN}/api/v1/auth/google/callback`,
        // הכתובות נבנות כאן ולא במסך: הן חייבות להתאים תו-בתו למה
        // ששלושת השירותים שולחים בפועל ב-redirect_uri
        redirectUris: [
          { label: "התחברות עם Google", url: `${env.WEB_ORIGIN}/api/v1/auth/google/callback` },
          {
            label: "סנכרון יומן Google",
            url: `${env.WEB_ORIGIN}/api/v1/calendar/google/callback`,
          },
          { label: "סנכרון Gmail", url: `${env.WEB_ORIGIN}/api/v1/gmail/callback` },
        ],
      },
      gemini: {
        configured: geminiDb || geminiEnv,
        source: geminiDb ? "db" : geminiEnv ? "env" : "none",
        model:
          (await this.platformSettings.get("geminiModel")) ??
          env.GEMINI_MODEL ??
          "gemini-2.5-flash-lite",
      },
      cardcom: {
        configured: cardcomDb || cardcomEnv,
        source: cardcomDb ? "db" : cardcomEnv ? "env" : "none",
        webhookUrl: `${env.WEB_ORIGIN}/api/v1/webhooks/cardcom`,
      },
      loginOtpEnabled: otpDb !== undefined ? otpDb === "true" : env.LOGIN_OTP_ENABLED,
    };
  }

  @Patch("settings")
  async updateSettings(
    @Body(new ZodValidationPipe(UpdateSettingsSchema)) body: z.infer<typeof UpdateSettingsSchema>,
  ): Promise<{ ok: true }> {
    const userId = TenantContext.current().userId;
    for (const [key, value] of Object.entries(body) as [
      PlatformSettingKey,
      string | boolean | number | unknown[],
    ][]) {
      /*
       * החבילות הן רשימה ונשמרות כ-JSON. בלי הענף הזה `String()`
       * הגנרי היה כותב "[object Object]" — הגדרה שנראית שמורה
       * ואינה נקראת.
       */
      if (Array.isArray(value)) {
        if (value.length === 0) await this.platformSettings.remove(key);
        else await this.platformSettings.set(key, JSON.stringify(value), userId);
        continue;
      }
      // מספר (אחוז העמלה) נשמר כמחרוזת, כמו כל שאר הערכים; אפס הוא
      // ערך תקין ולכן ההשוואה היא לטיפוס ולא לאמיתות
      if (typeof value === "boolean" || typeof value === "number") {
        await this.platformSettings.set(key, String(value), userId);
      } else if (value === "") {
        await this.platformSettings.remove(key); // ריק ⇒ חזרה למשתנה הסביבה
      } else {
        await this.platformSettings.set(key, value, userId);
      }
    }
    return { ok: true };
  }

  /** שליחת מייל בדיקה לכתובת של מנהל הפלטפורמה — אימות שהחיבור עובד. */
  @Post("settings/test-email")
  @HttpCode(200)
  async testEmail(): Promise<{ sentTo: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: TenantContext.current().userId },
      select: { email: true },
    });
    if (!user) throw new BadRequestException("משתמש לא נמצא");
    if (!(await this.email.isConfigured())) {
      throw new BadRequestException("אין ספק אימייל מוגדר — מלאו את פרטי Postmark ושמרו");
    }
    await this.email.sendTest(user.email);
    return { sentTo: user.email };
  }

  /**
   * בדיקת חיבור לקארדקום.
   *
   * שדה מלא אינו אישור תקין. ספרה שהוקלדה לא נכון במספר המסוף מתגלה
   * אחרת רק בעסקה הראשונה של לקוח משלם — כלומר במקום הגרוע ביותר.
   */
  @Post("settings/test-cardcom")
  @HttpCode(200)
  async testCardcom(): Promise<{ ok: boolean; terminalNumber: number; message: string }> {
    if (!(await this.cardcom.isConfigured())) {
      throw new BadRequestException("הסליקה טרם הוגדרה — מלאו מספר מסוף ושם API ושמרו");
    }
    return this.cardcom.testConnection();
  }

  /**
   * גרסה מותקנת + זמינות סוכן העדכון — למסך הפלטפורמה.
   *
   * `services` הוא התיקון למה שקרה בפועל: המסך הציג `version` יחיד,
   * של ה-API, בזמן ששלושה קונטיינרים רצים. עדכון שהצליח בשניים
   * מתוכם נראה כמו הצלחה מלאה — "גרסה מותקנת bfd8d0a" מול משתמש
   * שלא רואה שום שינוי. `version` נשאר כפי שהיה, לתאימות.
   *
   * ה-web חסר כאן במתכוון: את הגרסה שלו שואל הדפדפן ישירות
   * מהקונטיינר ששירת אותו (`/version`), וזו המדידה הכנה מבין השתיים.
   */
  @Get("system")
  async systemInfo(): Promise<{
    version: string;
    updateAvailable: boolean;
    services: ServiceVersion[];
  }> {
    const env = loadEnv();
    return {
      version: env.APP_VERSION,
      updateAvailable: env.UPDATER_URL !== undefined && env.UPDATE_SECRET !== undefined,
      services: await this.serviceVersions.collect(),
    };
  }

  /**
   * עדכון גרסה בלחיצת כפתור — **בעל הפלטפורמה בלבד**. הקריאה מגיעה
   * לסוכן העדכון שרץ לצד המערכת (infra/updater), שמושך תמונות עדכניות
   * ומרים אותן מחדש. ההפעלה מחדש היא של כל השרת, כלומר של כל המשרדים
   * יחד — ולכן זו לא פעולה של מנהל משרד.
   */
  @Post("system/update")
  @HttpCode(200)
  async triggerUpdate(): Promise<{ status: "started" }> {
    const env = loadEnv();
    if (env.UPDATER_URL === undefined || env.UPDATE_SECRET === undefined) {
      throw new ServiceUnavailableException("עדכון מרחוק אינו מוגדר בסביבה זו");
    }
    const res = await callUpdaterAgent("/update", { method: "POST" });
    if (res.status === 409) throw new ConflictException("עדכון כבר רץ — המתינו לסיומו");
    if (!res.ok) throw updaterFailure(res);
    return { status: "started" };
  }

  /**
   * עדכון סוכן העדכון עצמו.
   *
   * נפרד מ-`system/update` בכוונה ולא חלק ממנו: הסוכן מחליף את עצמו,
   * וכל כישלון שם היה מפיל עדכון מערכת תקין. הפרדה גם אומרת שאפשר
   * לעדכן את המערכת עשר פעמים בלי לגעת בסוכן, ולגעת בו כשצריך.
   *
   * עד כה זו הייתה פקודה שמדביקים ב-SSH.
   */
  @Post("system/update-agent")
  @HttpCode(200)
  async updateAgent(): Promise<{ status: "started" }> {
    const res = await callUpdaterAgent("/update/self", { method: "POST" });
    if (res.status === 409) throw new ConflictException("פעולה כבר רצה — המתינו לסיומה");
    if (!res.ok) throw updaterFailure(res);
    return { status: "started" };
  }

  /** מצב הגיבויים: רשימה מקומית, חיווי טריות ומצב העותק מחוץ לשרת. */
  @Get("backups")
  async backupsOverview(): Promise<BackupsOverview> {
    return this.backups.overview();
  }

  /**
   * מחיקת גיבוי. השירות חוסם מחיקה של הדאמפ האחרון של המסד — ואם
   * הסנכרון החיצוני פעיל, העותק המרוחק עובר לארכיון ולא נמחק.
   */
  @Post("backups/delete")
  @HttpCode(200)
  async deleteBackup(
    @Body(new ZodValidationPipe(BackupNameSchema)) body: z.infer<typeof BackupNameSchema>,
  ): Promise<{ ok: true }> {
    await this.backups.remove(body.name);
    return { ok: true };
  }

  /**
   * שחזור מגיבוי — **בעל הפלטפורמה בלבד**, והפעולה ההרסנית ביותר
   * במערכת: היא מחליפה את הנתונים של כל המשרדים יחד ומפילה את
   * השירות לכמה דקות. סוכן העדכון לוקח דאמפ בטיחות לפני שהוא מתחיל.
   */
  @Post("backups/restore")
  @HttpCode(202)
  async restoreBackup(
    @Body(new ZodValidationPipe(BackupNameSchema)) body: z.infer<typeof BackupNameSchema>,
  ): Promise<{ status: "started" }> {
    await this.backups.startRestore(body.name);
    return { status: "started" };
  }

  @Get("backups/restore/status")
  async restoreStatus(): Promise<RestoreStatus> {
    return this.backups.restoreStatus();
  }

  /**
   * גיבוי ידני — "גבה עכשיו". לפני עדכון גרסה, לפני שינוי גדול, או
   * פשוט כדי לא לחכות לגיבוי היומי הבא. הקובץ שנוצר זהה לחלוטין
   * לגיבוי האוטומטי ומופיע באותה רשימה.
   */
  @Post("backups/run")
  @HttpCode(202)
  async runBackup(): Promise<{ status: "started" }> {
    await this.backups.startBackup();
    return { status: "started" };
  }

  /*
   * תרגיל שחזור לפי דרישה. אותו סקריפט שרץ שבועית — הראיה הידנית
   * והמתוזמנת חייבות להיות אותה בדיקה, אחרת "בדקנו" לא אומר כלום.
   */
  @Post("backups/verify")
  @HttpCode(202)
  async runVerify(): Promise<{ started: true }> {
    await this.backups.startVerify();
    return { started: true };
  }

  @Get("backups/run/status")
  async backupRunStatus(): Promise<BackupRunStatus> {
    return this.backups.backupStatus();
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

  /**
   * כניסת תמיכה למשרד — **רק דרך חלון שהמשרד פתח בעצמו**.
   *
   * אין כאן כוח פלטפורמה: בלי הסכמה בתוקף הנתיב מסרב, נקודה. גם עם
   * הסכמה, ה-Session שנוצר:
   * - שייך למי שהעניק את הגישה (או לבעלים) — ההרשאות הן שלו, לא יותר
   * - פג יחד עם החלון, לא אחרי שבועיים כמו Session רגיל
   * - מסומן בכתובת של איש התמיכה, וביטול ההסכמה הורג אותו מיד
   * - נרשם ביומן הפעילות **של המשרד**, גלוי לעיני בעל המשרד
   *
   * העוגייה מוחלפת: מנהל הפלטפורמה הופך זמנית למשתמש במשרד, וכדי
   * לחזור לפלטפורמה הוא מתנתק ומתחבר שוב. פשוט עדיף על שתי זהויות
   * חיות באותו דפדפן.
   */
  @Post("agencies/:id/support-session")
  @HttpCode(200)
  async supportSession(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; until: string }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { supportAccessUntil: true, supportAccessGrantedBy: true },
    });
    const until = tenant?.supportAccessUntil ?? null;
    if (until === null || until.getTime() <= Date.now()) {
      throw new ForbiddenException(
        "המשרד לא פתח חלון גישת תמיכה. בקשו מבעל המשרד ללחוץ על 'אפשר גישת תמיכה' בהגדרות.",
      );
    }

    // מי שהעניק — או הבעלים, אם המעניק כבר אינו פעיל
    const target =
      (tenant?.supportAccessGrantedBy
        ? await this.prisma.user.findFirst({
            where: { id: tenant.supportAccessGrantedBy, tenantId: id, isActive: true },
          })
        : null) ??
      (await this.prisma.user.findFirst({
        where: { tenantId: id, role: "owner", isActive: true },
        orderBy: { createdAt: "asc" },
      }));
    if (!target) throw new BadRequestException("למשרד אין משתמש פעיל להיכנס אליו");

    const admin = await this.prisma.user.findUnique({
      where: { id: TenantContext.current().userId },
      select: { email: true },
    });

    const token = randomBytes(32).toString("base64url");
    await this.prisma.session.create({
      data: {
        id: ulid(),
        userId: target.id,
        tokenHash: AuthService.hashToken(token),
        // פג עם חלון ההסכמה — לא TTL רגיל של שבועיים
        expiresAt: until,
        passwordEpoch: target.passwordChangedAt,
        supportAdminEmail: admin?.email ?? "support",
        userAgent: `support:${(req.headers["user-agent"] ?? "").slice(0, 280)}`,
        ipAddress: req.ip ?? null,
      },
    });

    // ביומן של **המשרד** — בעל המשרד רואה מי נכנס ומתי
    await this.prisma.withExplicitTenant(id, (tx) =>
      tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId: id,
          userId: target.id,
          action: "support.session.start",
          entityType: "tenant",
          entityId: id,
          metadata: { supportAdmin: admin?.email ?? "" } as object,
        },
      }),
    );

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: loadEnv().COOKIE_SECURE,
      sameSite: "lax",
      expires: until,
      path: "/",
    });
    return { ok: true, until: until.toISOString() };
  }
}
