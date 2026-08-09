import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import {
  IdSchema,
  PLAN_FEATURES,
  TenantStatusSchema,
  downgradeWarnings,
  leadPriceRejectionReason,
  type LeadSourcePrice,
  planRejectionReason,
  sanitizeFeatures,
  type PlanDefinition,
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
import { LeadPricingService } from "../../core/lead-pricing.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { AuthService, tenantPeriodEnded } from "../auth/auth.service";
import {
  BackupsService,
  type BackupsOverview,
  type BackupRunStatus,
  type RestoreStatus,
} from "./backups.service";
import { callUpdaterAgent, updaterFailure } from "./updater-agent";

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
    features: z.array(z.string().max(40)).max(50),
    trialDays: z.number().int().min(0).max(90),
    isPublic: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
  })
  .strict();

/** ערך ריק = מחיקת ההגדרה מה-DB וחזרה למשתנה הסביבה (אם קיים). */
const UpdateSettingsSchema = z
  .object({
    postmarkServerToken: z.union([z.string().min(16).max(200), z.literal("")]).optional(),
    emailFrom: z.union([z.string().email().max(254), z.literal("")]).optional(),
    whatsappAppSecret: z.union([z.string().min(16).max(200), z.literal("")]).optional(),
    whatsappVerifyToken: z.union([z.string().min(16).max(200), z.literal("")]).optional(),
    loginOtpEnabled: z.boolean().optional(),
    googleClientId: z.union([z.string().min(10).max(200), z.literal("")]).optional(),
    googleClientSecret: z.union([z.string().min(10).max(200), z.literal("")]).optional(),
    // מספר המסוף מגיע כמחרוזת ולא כמספר: הוא מזהה, לא כמות, ואפסים
    // מובילים בו משמעותיים
    cardcomTerminalNumber: z.union([z.string().regex(/^\d{1,12}$/u), z.literal("")]).optional(),
    cardcomApiName: z.union([z.string().min(3).max(100), z.literal("")]).optional(),
    cardcomApiPassword: z.union([z.string().min(6).max(200), z.literal("")]).optional(),
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
  planCode: string;
  billingCycle: string;
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
      planCode: row.planCode,
      billingCycle: row.billingCycle,
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
      createdAt: t.createdAt,
      trialEndsAt: t.trialEndsAt,
      paidUntil: t.paidUntil,
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
   * הגדרות הפלטפורמה — מצב בלבד, בלי לחשוף ערכים. מפתחות שהוגדרו
   * במשתני סביבה מסומנים כמקור "env" (נשלטים מהשרת, לא מהמסך).
   */
  @Get("settings")
  async settings(): Promise<{
    postmark: { configured: boolean; source: "db" | "env" | "none"; emailFrom?: string };
    /** webhookUrl מוגדר פעם אחת במטא לכל הפלטפורמה — ולכן הוא כאן ולא בהגדרות המשרד. */
    whatsapp: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
    google: { configured: boolean; source: "db" | "env" | "none"; redirectUri: string };
    /** webhookUrl היא הכתובת שנרשמת אצל קארדקום — מוצגת כדי שלא ינחשו אותה. */
    cardcom: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
    loginOtpEnabled: boolean;
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
    // שלושת השדות יחד: מסוף בלי סיסמת API הוא סליקה שנופלת בלחיצה
    // הראשונה, וזה בדיוק המצב שאסור להציג כ"מוגדר"
    const cardcomDb =
      has("cardcomTerminalNumber") && has("cardcomApiName") && has("cardcomApiPassword");
    const cardcomEnv =
      env.CARDCOM_TERMINAL_NUMBER !== undefined &&
      env.CARDCOM_API_NAME !== undefined &&
      env.CARDCOM_API_PASSWORD !== undefined;
    const otpDb = await this.platformSettings.get("loginOtpEnabled");

    return {
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
    for (const [key, value] of Object.entries(body) as [PlatformSettingKey, string | boolean][]) {
      if (typeof value === "boolean") {
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

  /** גרסה מותקנת + זמינות סוכן העדכון — למסך הפלטפורמה. */
  @Get("system")
  async systemInfo(): Promise<{ version: string; updateAvailable: boolean }> {
    const env = loadEnv();
    return {
      version: env.APP_VERSION,
      updateAvailable: env.UPDATER_URL !== undefined && env.UPDATE_SECRET !== undefined,
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

  @Get("backups/run/status")
  async backupRunStatus(): Promise<BackupRunStatus> {
    return this.backups.backupStatus();
  }
}
