import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import {
  CAPABILITIES,
  IdSchema,
  PLAN_FEATURES,
  AssignableRoleSchema,
  clearEffect,
  describeOverride,
  isOverrideActive,
  limitState,
  overrideRejectionReason,
  resolveCapabilities,
  type Capability,
  type LimitState,
  DEFAULT_MATCH_WEIGHTS,
  MIN_HARD_WEIGHT,
  resolveMatchWeights,
  type MatchWeights,
  AUTOMATIONS,
  automationRejectionReason,
  resolveAutomationSettings,
  type AutomationSettings,
  type AutomationSpec,
  normalizePhone,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { onboardingSteps, type OnboardingProgress } from "@metavchim/shared";
import {
  AnyAuthenticated,
  RequireCapability,
} from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { AuthService, type SessionInfo } from "../auth/auth.service";
import { LoginThrottleService } from "../auth/login-throttle.service";
import { MatchRefreshService } from "../matching/match-refresh.service";
import {
  WhatsAppLinkService,
  type LinkStatus,
} from "../messaging/whatsapp-link.service";
import { AccountDeletionService } from "./account-deletion.service";
import { MAX_LOGO_BYTES, TenantLogoService } from "./tenant-logo.service";

/**
 * הגדרת האוטומציות שמגיעה מהמסך.
 *
 * מפה פתוחה ולא שדות מפורשים: הקטלוג חי ב-`@metavchim/shared`, והוא
 * שקובע אילו מפתחות תקפים ומה התחום של כל סף. סכימה שמונה את
 * המפתחות בעצמה הייתה מקור שני שנפרד ביום שמוסיפים אוטומציה.
 */
const AutomationsSchema = z
  .record(
    z.string().max(40),
    z
      .object({
        enabled: z.boolean().optional(),
        value: z.number().optional(),
      })
      .strict(),
  )
  .refine((body) => Object.keys(body).length > 0, {
    message: "לא נשלחה שום הגדרה",
  });

const TenantSettingsSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    /** המספר העסקי לוואטסאפ — ספרות בלבד; "" מנתק את השיוך */
    whatsappNumber: z
      .union([z.string().regex(/^\d{9,15}$/u), z.literal("")])
      .optional(),
    /* פרטי המשרד שנכנסים לנוסחי ההסכמים. מספר רישיון התיווך הוא
       פרט חובה בהזמנה בכתב לפי חוק המתווכים במקרקעין. */
    licenseNumber: z.union([z.string().max(40), z.literal("")]).optional(),
    officeAddress: z.union([z.string().max(200), z.literal("")]).optional(),
    officePhone: z.union([z.string().max(30), z.literal("")]).optional(),
    /* ברירות המחדל לנוסחי ההסכמים. דמי התיווך ומועד התשלום הם פרטי
       חובה בתקנות, ושער ההחתמה יוצר הסכם בלי שאיש הזין אותם — בלי
       ברירת מחדל ברמת המשרד הוא לא יכול לייצר מסמך תקף כלל. */
    defaultCommission: z.union([z.string().max(80), z.literal("")]).optional(),
    defaultPaymentTerms: z
      .union([z.string().max(120), z.literal("")])
      .optional(),
    /*
     * מדיניות הרשת של המשרד: כל נכס/קונה חדש מתפרסם לרשת השיתופים
     * אוטומטית. ההחלטה של מי שמחזיק settings.manage — הסוכן שקולט
     * את הנכס מבצע מדיניות משרד, לא בחירה אישית.
     */
    autoShareProperties: z.boolean().optional(),
    autoShareBuyers: z.boolean().optional(),
  })
  .strict();

// owner אינו ניתן להקצאה דרך ה-API — מוקם בהקמת הסוכנות בלבד.
// הסכימה מיובאת ואינה מוגדרת כאן שוב: המסכים בונים את התפריט
// מאותה רשימה בדיוק, ושני עותקים היו מתפצלים בתפקיד הבא שנוסף.

/**
 * שינוי הרשאות: רשימת יכולות ולא יכולת בודדת, כדי שחסימת מודול שלם
 * תהיה פעולה אחת בטרנזקציה אחת. `clear` מחזיר לברירת המחדל של התפקיד.
 */
const SetCapabilitiesSchema = z
  .object({
    capabilities: z.array(z.enum(CAPABILITIES)).min(1).max(CAPABILITIES.length),
    effect: z.enum(["grant", "deny", "clear"]),
    /** ISO; null/חסר = לצמיתות */
    expiresAt: z.string().datetime().nullish(),
    reason: z.string().max(200).optional(),
  })
  .strict();

type UserCapabilitiesDto = {
  userId: string;
  name: string;
  role: string;
  protected: boolean;
  effective: string[];
  overrides: {
    capability: string;
    effect: string;
    expiresAt?: string;
    reason?: string;
    description: string;
    active: boolean;
  }[];
};

const CreateUserSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(254),
    role: AssignableRoleSchema,
  })
  .strict();

const UpdateUserSchema = z
  .object({
    role: AssignableRoleSchema.optional(),
    isActive: z.boolean().optional(),
    /** אותו כלל בדיוק כמו בפרופיל האישי; "" מנקה את השדה */
    phone: z.union([z.string().regex(/^[\d\-+ ]{9,20}$/u), z.literal("")]).optional(),
    /** מנוי הסוכן בוואטסאפ — נפרד לכל סוכן, בעל המשרד מפעיל */
    whatsappAccess: z.boolean().optional(),
  })
  .strict();

const AuditQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();

/** שם המקור נכנס כ-source של הליד — ולכן מוגבל לאורך העמודה שם (20) */
const LeadWebhookSchema = z
  .object({ sourceLabel: z.string().trim().min(2).max(20) })
  .strict();

/** מחיקת חשבון: שם המשרד כאישור + סיסמה (לחשבון Google — שם בלבד). */
/**
 * משקלי ההתאמה. כל קריטריון בין 0 ל-1, וסכום חיובי אחד לפחות —
 * איפוס מוחלט היה מייצר ציון 0 לכל נכס, כלומר מסך ריק בלי הסבר.
 */
const MatchWeightsSchema = z
  .object({
    // הפוסלים לא יורדים מתחת למינימום — ראו HARD_MATCH_CRITERIA
    location: z.number().min(MIN_HARD_WEIGHT).max(1),
    budget: z.number().min(MIN_HARD_WEIGHT).max(1),
    rooms: z.number().min(MIN_HARD_WEIGHT).max(1),
    property_type: z.number().min(0).max(1),
    features_must: z.number().min(MIN_HARD_WEIGHT).max(1),
    features_nice: z.number().min(0).max(1),
    area: z.number().min(0).max(1),
    entry_date: z.number().min(0).max(1),
  })
  .strict()
  .refine((w) => Object.values(w).reduce((sum, v) => sum + v, 0) > 0, {
    message: "לפחות קריטריון אחד חייב משקל גדול מאפס",
  });

const DeleteAccountSchema = z
  .object({
    confirmName: z.string().min(1).max(120),
    currentPassword: z.string().max(200).optional(),
  })
  .strict();

export interface TeamUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: Date;
  /** נעול זמנית בגלל ניסיונות התחברות כושלים — ניתן לשחרור ע"י המנהל */
  locked: boolean;
  /** מספר הוואטסאפ האישי — הזהות מול הסוכן החכם */
  phone?: string;
  /** מנוי הסוכן בוואטסאפ פעיל למשתמש הזה (בעל המשרד כלול תמיד) */
  whatsappAccess: boolean;
}

@Controller("settings")
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loginThrottle: LoginThrottleService,
    private readonly auth: AuthService,
    private readonly tenantLogo: TenantLogoService,
    private readonly plans: PlanCatalogService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly matchRefresh: MatchRefreshService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly whatsappLinks: WhatsAppLinkService,
  ) {}

  /**
   * מחיקת חשבון מלאה. הבדיקות המהותיות — בעלים בלבד, שם המשרד
   * והסיסמה — בשירות; ראו AccountDeletionService על מה נמחק ומה
   * נשאר (payments בחובת שמירה, audit_log מוגן ברמת המסד).
   */
  @Post("delete-account")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async deleteAccount(
    @Body(new ZodValidationPipe(DeleteAccountSchema))
    body: z.infer<typeof DeleteAccountSchema>,
  ): Promise<{ ok: true }> {
    return this.accountDeletion.deleteAccount(body);
  }

  /**
   * משקלי ההתאמה של המשרד.
   *
   * **חלים בתוך המשרד בלבד.** התאמות בשוק השת"פ ממשיכות לרוץ
   * בברירת המחדל, אחרת משרד היה משנה את הציון שמשרד אחר רואה על
   * הביקוש שלו — ו"80% התאמה" היה מאבד כל משמעות משותפת.
   */
  /**
   * האוטומציות הפנימיות — מה המערכת עושה מעצמה.
   *
   * הקטלוג חוזר יחד עם ההגדרה, כדי שהמסך לא יחזיק רשימה משלו: תיאור
   * שמתיישן במסך הוא הבטחה לא נכונה על מה שקורה בפועל.
   */
  @Get("automations")
  @RequireCapability("settings.manage")
  async automations(): Promise<{
    settings: AutomationSettings;
    catalogue: readonly AutomationSpec[];
  }> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    return {
      settings: resolveAutomationSettings(settings["automations"]),
      catalogue: AUTOMATIONS,
    };
  }

  /**
   * שמירת ההגדרה.
   *
   * מיזוג עם הקיים ולא דריסה: המסך יכול לשלוח אוטומציה אחת שהשתנתה,
   * ואין סיבה שלחיצה על מתג אחד תשלח את כל הטבלה ותסתכן בדריסת שינוי
   * שנעשה במקביל בכרטיסייה אחרת.
   *
   * הערך נשמר **אחרי** שעבר את הבדיקה של הקטלוג, ולכן מה שיושב ב-DB
   * תמיד בתחום. `resolveAutomationSettings` חותך בקריאה בכל מקרה,
   * כהגנה על ערכים שנשמרו לפני שהתחום הזה היה קיים.
   */
  @Patch("automations")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async saveAutomations(
    @Body(new ZodValidationPipe(AutomationsSchema))
    body: z.infer<typeof AutomationsSchema>,
  ): Promise<{ settings: AutomationSettings }> {
    const tenantId = TenantContext.current().tenantId;

    for (const [key, setting] of Object.entries(body)) {
      const problem = automationRejectionReason(key, setting);
      if (problem !== null) throw new BadRequestException(problem);
    }

    /*
     * כתיבה אטומית **לכל מפתח בנפרד**, ולא מיזוג בזיכרון.
     *
     * הגרסה הראשונה קראה את כל האובייקט, מיזגה ב-JS וכתבה אותו
     * בשלמותו — כלומר שתי בקשות שנגעו במפתחות שונים קראו את אותו
     * מצב ישן, והאחרונה שסיימה החזירה בשקט את המפתח של השנייה לערכו
     * הקודם. זה בדיוק הכשל ש-`jsonb_set` נועד למנוע, והוא חזר כאן
     * ברמת האובייקט (ביקורת Codex).
     *
     * ה-`||` ממזג רק את השדות שנשלחו לתוך הרשומה הקיימת, ולכן בקשה
     * ששולחת `enabled` בלבד אינה מוחקת את הסף. הקינון הפנימי מבטיח
     * שהמפתח `automations` קיים: `jsonb_set` על נתיב דו-שלבי אינו
     * יוצר את האב החסר, ובלעדיו השמירה הראשונה של כל משרד הייתה
     * נבלעת בשקט.
     */
    for (const [key, setting] of Object.entries(body)) {
      await this.prisma.$executeRaw`
        UPDATE tenants
        SET settings = jsonb_set(
          jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{automations}',
            COALESCE(settings -> 'automations', '{}'::jsonb),
            true
          ),
          ARRAY['automations', ${key}],
          COALESCE(settings -> 'automations' -> ${key}, '{}'::jsonb) || ${JSON.stringify(setting)}::jsonb,
          true
        )
        WHERE id = ${tenantId}
      `;
    }

    const saved = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.automations",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { changed: Object.keys(body) },
      }),
    );

    return {
      settings: resolveAutomationSettings(
        ((saved?.settings ?? {}) as Record<string, unknown>)["automations"],
      ),
    };
  }

  @Get("match-weights")
  @RequireCapability("settings.manage")
  async matchWeights(): Promise<{
    weights: MatchWeights;
    defaults: MatchWeights;
    /** הכיול האוטומטי מהדחיות — דולק כברירת מחדל. */
    autoTune: boolean;
    /** הכיול האחרון, אם היה — לשקיפות במסך. */
    calibration: { at: string; adjusted: unknown[] } | null;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const rawCalibration = settings["matchWeightsCalibration"] as
      | { at?: unknown; adjusted?: unknown }
      | null
      | undefined;
    return {
      weights: resolveMatchWeights(settings["matchWeights"]),
      defaults: { ...DEFAULT_MATCH_WEIGHTS },
      autoTune: settings["autoTuneMatchWeights"] !== false,
      calibration:
        rawCalibration !== null &&
        typeof rawCalibration === "object" &&
        typeof rawCalibration.at === "string" &&
        Array.isArray(rawCalibration.adjusted)
          ? { at: rawCalibration.at, adjusted: rawCalibration.adjusted }
          : null,
    };
  }

  /**
   * הפעלה/כיבוי של הכיול האוטומטי. מפתח נפרד ולא חלק מסכימת
   * המשקלים: מתג שמצורף לשמירת המשקלים היה גורר סבב חישוב מלא על
   * כל הקשה, והכיבוי הוא בדיוק הפעולה של מי שרוצה שקט.
   */
  @Patch("match-weights/auto-tune")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async setMatchWeightsAutoTune(
    @Body(new ZodValidationPipe(z.object({ enabled: z.boolean() }).strict()))
    body: { enabled: boolean },
  ): Promise<{ autoTune: boolean }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.$executeRaw`
      UPDATE tenants
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{autoTuneMatchWeights}', ${JSON.stringify(body.enabled)}::jsonb, true)
      WHERE id = ${tenantId}
    `;
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.match_weights_auto_tune",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { enabled: body.enabled },
      }),
    );
    return { autoTune: body.enabled };
  }

  /**
   * שמירת המשקלים — **ומיד אחריה סבב חישוב מחדש.**
   *
   * זה היה הפער המטעה ביותר במערכת: המסך אישר "נשמר", והציונים
   * נשארו של המשקלים הישנים עד שמישהו יערוך כל נכס בנפרד. מנהל
   * ששינה משקל עשה זאת **כדי** לראות תוצאה אחרת, וראה בדיוק את מה
   * שראה קודם — ומכאן המסקנה הסבירה שהמנוע לא באמת מושפע מההגדרה.
   */
  @Patch("match-weights")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async saveMatchWeights(
    @Body(new ZodValidationPipe(MatchWeightsSchema))
    body: z.infer<typeof MatchWeightsSchema>,
  ): Promise<{ weights: MatchWeights }> {
    const tenantId = TenantContext.current().tenantId;
    /*
     * ‎jsonb_set‎ ולא קריאה-שינוי-כתיבה של כל העמודה.
     *
     * שמירה מקבילה של פרטי המשרד הייתה נדרסת: שתי הבקשות קוראות את
     * אותו JSON ישן, וזו שמסיימת אחרונה מוחקת בשקט את השינוי של
     * השנייה (ביקורת Codex). העדכון כאן נוגע במפתח אחד בלבד, ברמת
     * בסיס הנתונים.
     */
    await this.prisma.$executeRaw`
      UPDATE tenants
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{matchWeights}', ${JSON.stringify(body)}::jsonb, true)
      WHERE id = ${tenantId}
    `;
    /*
     * החותמת נכתבת **בנפרד ולפני** ההרצה, וזו לא קוסמטיקה: אם השרת
     * ייפול באמצע הסבב, החותמת נשארת מאוחרת מתוצאת הסבב האחרון
     * והסורק היומי יריץ אותו שוב. בלעדיה שינוי משקלים היה יכול
     * להיעלם בלי שאיש ידע.
     */
    await this.prisma.$executeRaw`
      UPDATE tenants
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{matchWeightsChangedAt}', ${JSON.stringify(new Date().toISOString())}::jsonb, true)
      WHERE id = ${tenantId}
    `;

    /*
     * הסבב רץ **ברקע**, והתשובה חוזרת מיד. סבב על מאגר גדול נמשך
     * דקות, ובקשת שמירה שתלויה כל אותו זמן נראית תקועה — המשתמש
     * ילחץ שוב, ואז ירוצו שני סבבים. המסך עוקב אחרי ההתקדמות דרך
     * `GET /matches/refresh`.
     */
    void this.matchRefresh.refreshTenant(tenantId, "weights").catch(() => {
      // נרשם בשירות עצמו; הסורק היומי יתפוס את מה שלא הושלם
    });
    return { weights: resolveMatchWeights(body) };
  }

  /**
   * הלוגו של המשרד — העלאה, מחיקה, והקובץ עצמו.
   *
   * ההעלאה והמחיקה דורשות `settings.manage`, אבל **הקריאה פתוחה לכל
   * מי שמחובר למשרד**: הלוגו מוצג בסרגל הצד של כל משתמש, וסוכן אינו
   * מחזיק את היכולת הזו. `@AnyAuthenticated` הוא הצהרה מפורשת ולא
   * שכחה — ראו `auth-coverage.test.ts`.
   */
  @Post("tenant/logo")
  @RequireCapability("settings.manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_LOGO_BYTES, files: 1 } }))
  uploadLogo(@UploadedFile() file: Express.Multer.File | undefined): Promise<{ ok: true }> {
    return this.tenantLogo.upload(file?.buffer ?? Buffer.alloc(0));
  }

  @Delete("tenant/logo")
  @RequireCapability("settings.manage")
  removeLogo(): Promise<{ ok: true }> {
    return this.tenantLogo.remove();
  }

  @Get("tenant/logo/raw")
  @AnyAuthenticated()
  @Header("Cache-Control", "private, max-age=300")
  // ראו ההסבר בנתיבי המדיה של הרשת — `helmet()` מגדיר CORP
  // `same-origin`, שחוסם `<img>` מפורט אחר בפיתוח
  @Header("Cross-Origin-Resource-Policy", "same-site")
  async logoRaw(): Promise<StreamableFile> {
    const obj = await this.tenantLogo.raw();
    return new StreamableFile(obj.body as never, {
      type: obj.contentType,
      ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
    });
  }

  @Get("tenant")
  @RequireCapability("settings.manage")
  async tenant(): Promise<{
    name: string;
    whatsappNumber?: string;
    plan: string;
    licenseNumber?: string;
    officeAddress?: string;
    officePhone?: string;
    defaultCommission?: string;
    defaultPaymentTerms?: string;
    autoShareProperties: boolean;
    autoShareBuyers: boolean;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, plan: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    return {
      name: tenant?.name ?? "",
      whatsappNumber:
        typeof settings["whatsappNumber"] === "string"
          ? settings["whatsappNumber"]
          : undefined,
      plan: tenant?.plan ?? "basic",
      licenseNumber:
        typeof settings["licenseNumber"] === "string"
          ? settings["licenseNumber"]
          : undefined,
      officeAddress:
        typeof settings["officeAddress"] === "string"
          ? settings["officeAddress"]
          : undefined,
      officePhone:
        typeof settings["officePhone"] === "string"
          ? settings["officePhone"]
          : undefined,
      defaultCommission:
        typeof settings["defaultCommission"] === "string"
          ? settings["defaultCommission"]
          : undefined,
      defaultPaymentTerms:
        typeof settings["defaultPaymentTerms"] === "string"
          ? settings["defaultPaymentTerms"]
          : undefined,
      // חסר = כבוי: מדיניות שמפרסמת נתונים החוצה חייבת הפעלה מפורשת
      autoShareProperties: settings["autoShareProperties"] === true,
      autoShareBuyers: settings["autoShareBuyers"] === true,
    };
  }

  /**
   * המסלול של המשרד — מה כלול בו ואיפה הוא עומד מול המגבלות.
   *
   * `@AnyAuthenticated` ולא `settings.manage`: זו לא הגדרה אלא מידע
   * שכל מי שנתקל בקיר במסך צריך לראות. סוכן שלוחץ "ייצוא" ומקבל
   * חסימה זכאי לדעת שזה המסלול ולא תקלה.
   *
   * המחירים לא מוחזרים כאן — זה מסך של מה מותר, לא של כמה זה עולה.
   */
  @Get("plan")
  @AnyAuthenticated()
  async plan(): Promise<{
    code: string;
    name: string;
    description: string;
    /**
     * false = קוד המסלול של המשרד אינו נפתר לשום הגדרה.
     *
     * זה לא "בלי מגבלות" אלא מצב תקלה: האכיפה חוסמת כל הוספה, ולכן
     * מסך שמציג "ללא הגבלה" היה סותר את מה שהמשתמש חווה בפועל
     * (ביקורת Codex).
     */
    resolved: boolean;
    features: {
      code: string;
      label: string;
      description: string;
      included: boolean;
    }[];
    limits: {
      users: { used: number; limit: number | null; state: LimitState };
      properties: { used: number; limit: number | null; state: LimitState };
      networkListings: { used: number; limit: number | null; state: LimitState };
      networkDemands: { used: number; limit: number | null; state: LimitState };
    };
  }> {
    const tenantId = TenantContext.current().tenantId;
    /*
     * ספירת הנכסים דרך `withTenant`, ובנפרד ממוני המשתמשים.
     *
     * `properties` תחת FORCE RLS, ולכן `_count` דרך הלקוח הישיר החזיר
     * **אפס** — המסך היה מדווח שאין נכסים בכלל, גם למשרד עם מאות.
     * `users` מחוץ ל-RLS (ראו הערה ב-schema.prisma) ולכן נשאר כאן
     * (ביקורת Codex — הפעם החמישית שהתבנית הזו חוזרת).
     *
     * הסינונים זהים לאלה של האכיפה: משתמש פעיל בלבד, ונכס שאינו
     * בארכיון.
     */
    const [plan, openFeatures, tenant, users, properties, network] = await Promise.all([
      this.plans.forTenant(tenantId),
      this.plans.tenantFeatures(tenantId),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { plan: true },
      }),
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.withTenant((tx) =>
        tx.property.count({ where: { tenantId, deletedAt: null } }),
      ),
      /*
       * מכסות הרשת נספרות באותה שאילתה זוגית, ובאותם תנאים בדיוק
       * שבהם האכיפה סופרת (`status: "active"` בלבד). מסך שסופר
       * אחרת מהאכיפה הוא מסך שמשקר — המשרד רואה "2 מתוך 3" ונחסם.
       */
      this.prisma.withTenant(async (tx) => ({
        listings: await tx.sharedListing.count({
          where: { tenantId, status: "active" },
        }),
        demands: await tx.sharedDemand.count({
          where: { tenantId, status: "active" },
        }),
      })),
    ]);
    /*
     * מסלול שלא נפתר מוצג כחסום ולא כ"ללא הגבלה".
     *
     * `null` במגבלה פירושו ללא הגבלה, וזו בדיוק התשובה ההפוכה
     * מהמציאות: האכיפה דוחה כל הוספה. `blocked: true` עם `limit: 0`
     * הוא הייצוג הכן של המצב.
     */
    const unresolved: LimitState = {
      blocked: true,
      remaining: 0,
      percent: 100,
      warn: true,
    };
    const limitFor = (used: number, limit: number | null): LimitState =>
      plan === undefined ? unresolved : limitState(used, limit);

    return {
      code: plan?.code ?? tenant?.plan ?? "",
      // מסלול לא מוכר לא נופל אלא מוצג ככזה: הוא מצב תקלה שדורש
      // טיפול של בעל הפלטפורמה, ומסך ריק לא היה מסגיר אותו
      name: plan?.name ?? "מסלול לא מוגדר",
      description: plan?.description ?? "",
      resolved: plan !== undefined,
      /*
       * מה שפתוח בפועל, כולל חריגי הפלטפורמה. משרד שקיבל תכונה
       * מעבר למסלול צריך לראות אותה מסומנת — אחרת המסך סותר את מה
       * שהוא חווה, והוא פונה לתמיכה על "כתוב שאין לי אבל עובד".
       */
      features: PLAN_FEATURES.map((feature) => ({
        ...feature,
        included: openFeatures.includes(feature.code),
      })),
      limits: {
        users: {
          used: users,
          limit: plan?.maxUsers ?? null,
          state: limitFor(users, plan?.maxUsers ?? null),
        },
        properties: {
          used: properties,
          limit: plan?.maxProperties ?? null,
          state: limitFor(properties, plan?.maxProperties ?? null),
        },
        networkListings: {
          used: network.listings,
          limit: plan?.maxNetworkListings ?? null,
          state: limitFor(network.listings, plan?.maxNetworkListings ?? null),
        },
        networkDemands: {
          used: network.demands,
          limit: plan?.maxNetworkDemands ?? null,
          state: limitFor(network.demands, plan?.maxNetworkDemands ?? null),
        },
      },
    };
  }

  /*
   * מפתחות קליטת הלידים — כמה לכל משרד, עם שם מקור לכל אחד ("אתר",
   * "פייסבוק"...). כל מפתח מזהה את המשרד בנקודת הקצה הציבורית
   * ‎/public/leads/:key, ושם המקור שלו נכנס כ-source של הליד.
   */

  @Get("lead-webhooks")
  @RequireCapability("settings.manage")
  async leadWebhooks(): Promise<
    { id: string; key: string; sourceLabel: string; createdAt: Date }[]
  > {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.leadWebhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, key: true, sourceLabel: true, createdAt: true },
    });
  }

  @Post("lead-webhooks")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async createLeadWebhook(
    @Body(new ZodValidationPipe(LeadWebhookSchema))
    body: z.infer<typeof LeadWebhookSchema>,
  ): Promise<{ id: string; key: string; sourceLabel: string }> {
    const tenantId = TenantContext.current().tenantId;
    // גבול שפוי, לא מכסה: מונע יצירה בלולאה ממסך תקוע
    const count = await this.prisma.leadWebhook.count({ where: { tenantId } });
    if (count >= 20) {
      throw new BadRequestException("אפשר עד 20 מקורות קליטה — מחקו אחד קיים");
    }
    const created = await this.prisma.leadWebhook.create({
      data: {
        id: ulid(),
        tenantId,
        key: randomBytes(24).toString("base64url"), // 32 תווים
        sourceLabel: body.sourceLabel,
      },
      select: { id: true, key: true, sourceLabel: true },
    });
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.lead_webhook_create",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { sourceLabel: body.sourceLabel },
      }),
    );
    return created;
  }

  /** מחיקת מפתח — הטופס שמצביע עליו יפסיק לעבוד מיד. */
  @Delete("lead-webhooks/:id")
  @RequireCapability("settings.manage")
  @HttpCode(204)
  async deleteLeadWebhook(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    // deleteMany עם tenantId — מזהה של משרד אחר פשוט לא מוחק כלום
    const result = await this.prisma.leadWebhook.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) throw new NotFoundException("מקור הקליטה לא נמצא");
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.lead_webhook_delete",
        entityType: "tenant",
        entityId: tenantId,
      }),
    );
  }

  @Patch("tenant")
  @RequireCapability("settings.manage")
  async updateTenant(
    @Body(new ZodValidationPipe(TenantSettingsSchema))
    body: z.infer<typeof TenantSettingsSchema>,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;

    // מספר וואטסאפ ייחודי בין משרדים — אחרת הודעות לקוחות ינותבו למשרד
    // שגוי (ביקורת Codex, PR #5). אינדקס DB ייחודי משמש כקו הגנה שני.
    if (body.whatsappNumber) {
      const taken = await this.prisma.tenant.findFirst({
        where: {
          id: { not: tenantId },
          settings: { path: ["whatsappNumber"], equals: body.whatsappNumber },
        },
        select: { id: true },
      });
      if (taken) throw new BadRequestException("המספר כבר משויך למשרד אחר");
    }

    const current = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = {
      ...((current?.settings ?? {}) as Record<string, unknown>),
    };

    /*
     * כל השדות שיושבים ב-settings עוברים באותה לולאה.
     *
     * קודם רק whatsappNumber נכתב, ושלושת פרטי המשרד נבלעו בשקט: הם
     * עברו ולידציה, חזרו ב-GET, ומעולם לא נשמרו. משתמש שמילא מספר
     * רישיון, שמר, וראה "נשמר" — קיבל שדה ריק בטעינה הבאה. שמירה
     * שמדווחת הצלחה ולא כותבת גרועה משדה שלא קיים.
     *
     * מחרוזת ריקה מוחקת את המפתח (ניקוי שדה), ולא שומרת "" —
     * כדי שהתבניות יראו "חסר" ולא ידפיסו רישיון ריק בהסכם.
     */
    const SETTINGS_FIELDS = [
      "whatsappNumber",
      "licenseNumber",
      "officeAddress",
      "officePhone",
      "defaultCommission",
      "defaultPaymentTerms",
    ] as const;
    let settingsTouched = false;
    for (const field of SETTINGS_FIELDS) {
      const value = body[field];
      if (value === undefined) continue;
      settingsTouched = true;
      if (value === "") delete settings[field];
      else settings[field] = value;
    }

    /*
     * הדגלים הבוליאניים: false מוחק את המפתח ולא שומר false —
     * מאותה סיבה ש-"" מוחק למעלה. חסר = ברירת המחדל (כבוי), ואין
     * טעם לשמור במסד הצהרה על ברירת המחדל.
     */
    const BOOLEAN_FIELDS = ["autoShareProperties", "autoShareBuyers"] as const;
    for (const field of BOOLEAN_FIELDS) {
      const value = body[field];
      if (value === undefined) continue;
      settingsTouched = true;
      if (value === false) delete settings[field];
      else settings[field] = true;
    }

    try {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(settingsTouched ? { settings: settings as object } : {}),
        },
      });
    } catch {
      // מרוץ מול משרד אחר — האינדקס הייחודי ב-DB חסם
      throw new BadRequestException("המספר כבר משויך למשרד אחר");
    }
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.update",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { changedFields: Object.keys(body) },
      }),
    );
    return { ok: true };
  }

  @Get("users")
  @RequireCapability("users.manage")
  async users(): Promise<TeamUserDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        phone: true,
        whatsappAccess: true,
      },
    });
    return Promise.all(
      rows.map(async (u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt ?? undefined,
        locked: await this.loginThrottle.isLocked(u.email),
        phone: u.phone ?? undefined,
        whatsappAccess: u.whatsappAccess,
      })),
    );
  }

  /**
   * שחרור נעילת התחברות — משתמש שננעל אחרי יותר מדי ניסיונות שגויים
   * לא צריך לחכות 15 דקות; המנהל משחרר אותו כאן.
   */
  @Post("users/:id/unlock")
  @RequireCapability("users.manage")
  @HttpCode(200)
  async unlockUser(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { email: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");
    await this.loginThrottle.unlockEmail(target.email);
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "users.unlock",
        entityType: "user",
        entityId: id,
      }),
    );
    return { ok: true };
  }

  /**
   * החיבורים הפתוחים של איש צוות — מאיפה הוא מחובר עכשיו.
   *
   * זו יכולת פיקוח אמיתית: מכשיר שאבד, סוכן שעזב ונשאר מחובר,
   * או חיבור ממקום שאין לו שום הסבר. בלי המסך הזה התשובה היחידה
   * הייתה „תחליף סיסמה”, שגם היא לא תמיד מגיעה בזמן.
   *
   * `findFirst({ id, tenantId })` ולא `findUnique({ id })`: מזהה
   * משתמש של משרד אחר חייב לא להימצא, ולא להימצא ואז להיבדק.
   */
  @Get("users/:id/sessions")
  @RequireCapability("users.manage")
  async userSessions(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ sessions: SessionInfo[] }> {
    const tenantId = TenantContext.current().tenantId;
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");
    /*
     * בלי טוקן נוכחי: „המכשיר הזה” הוא של המנהל, ואף אחד מהחיבורים
     * ברשימה אינו שלו. סימון אחד מהם כ„נוכחי” היה שקר.
     */
    return { sessions: await this.auth.listSessions(id) };
  }

  /**
   * ניתוק **כל** החיבורים של איש צוות.
   *
   * גורף בכוונה, כולל החיבור שממנו הוא עובד ברגע זה: מנהל שמנתק
   * מכשיר שאבד ומשאיר חיבור פתוח אחד לא עשה כלום.
   *
   * המנהל אינו יכול לנתק את **עצמו** דרך הנתיב הזה — לא כדי להגן
   * עליו, אלא כי לזה יש כפתור משלו בפרופיל שיודע להשאיר את המכשיר
   * הנוכחי חי. נתיב אחד שעושה את שניהם היה מוציא מנהל מהמערכת
   * בלחיצה שנועדה לנקות מכשירים ישנים.
   *
   * נרשם ביומן הביקורת: ניתוק כפוי של עובד הוא פעולה ניהולית
   * שמישהו צריך לתת עליה דין וחשבון.
   */
  @Post("users/:id/sessions/revoke")
  @RequireCapability("users.manage")
  @HttpCode(200)
  async revokeUserSessions(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ revoked: number }> {
    const ctx = TenantContext.current();
    if (id === ctx.userId) {
      throw new BadRequestException("לניתוק החיבורים שלך — במסך הפרופיל");
    }
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");

    const revoked = await this.auth.revokeAllSessions(id);
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "users.sessions_revoke",
        entityType: "user",
        entityId: id,
      }),
    );
    return { revoked };
  }

  /**
   * ההרשאות בפועל של איש צוות אחד — התפקיד, החריגים, והתוצאה.
   *
   * המסך צריך את שלושתם: התפקיד כדי להראות מאיפה התחלנו, החריגים
   * כדי להראות מה המנהל שינה ועד מתי, והתוצאה כדי שלא יצטרך לחשב
   * בעצמו מה יוצא מהצירוף.
   */
  @Get("users/:id/capabilities")
  @RequireCapability("users.manage")
  async userCapabilities(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<UserCapabilitiesDto> {
    const tenantId = TenantContext.current().tenantId;
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, role: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");

    const rows = await this.prisma.withTenant((tx) =>
      tx.userCapability.findMany({
        where: { userId: id, tenantId },
        select: {
          capability: true,
          effect: true,
          expiresAt: true,
          reason: true,
        },
        orderBy: { capability: "asc" },
      }),
    );
    const now = new Date();
    const overrides = rows.map((row) => ({
      capability: row.capability as Capability,
      effect: row.effect === "grant" ? ("grant" as const) : ("deny" as const),
      expiresAt: row.expiresAt,
    }));

    return {
      userId: target.id,
      name: target.name,
      role: target.role,
      // בעל המשרד מוגן בשרת; המסך מקבל את הדגל כדי להסביר למה
      protected:
        target.role === "owner" || target.id === TenantContext.current().userId,
      effective: [...resolveCapabilities(target.role, overrides, now)],
      overrides: rows.map((row, index) => ({
        capability: row.capability,
        effect: row.effect,
        expiresAt: row.expiresAt?.toISOString(),
        reason: row.reason ?? undefined,
        description: describeOverride(overrides[index]!, now),
        active: isOverrideActive(overrides[index]!, now),
      })),
    };
  }

  /**
   * שינוי הרשאות של איש צוות — יכולת בודדת או מודול שלם.
   *
   * הרשימה במקום ערך יחיד היא מה שמאפשר "חסום את מודול הנכסים
   * לשבוע" בפעולה אחת ובטרנזקציה אחת, במקום ארבע קריאות שיכולות
   * להיכשל באמצע ולהשאיר חצי מודול חסום.
   *
   * שלוש מגבלות ההגנה (לא על עצמך, לא על בעל המשרד, ואי אפשר להעניק
   * מה שאין לך) נאכפות כאן בשרת ולא רק במסך — הנימוק המלא יושב
   * ב-overrideRejectionReason.
   */
  @Put("users/:id/capabilities")
  @RequireCapability("users.manage")
  async setUserCapabilities(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SetCapabilitiesSchema))
    body: z.infer<typeof SetCapabilitiesSchema>,
  ): Promise<{ ok: true }> {
    const ctx = TenantContext.current();
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, role: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");

    /*
     * הבדיקה נעשית לפי מה שהשינוי *עושה בפועל*, לא לפי שמו.
     *
     * ניקוי חריג אינו ניטרלי: מחיקת חסימה על יכולת שהתפקיד כן נותן
     * מחזירה גישה — כלומר היא הענקה. בלי ההבחנה הזו מנהל שנחסמה
     * ממנו יכולת יכול היה לנקות אותה אצל מנהל אחר ולהחזיר גישה
     * שהוא עצמו אינו רשאי להעניק (ביקורת Codex).
     */
    const current = await this.prisma.withTenant((tx) =>
      tx.userCapability.findMany({
        where: {
          userId: id,
          tenantId: ctx.tenantId,
          capability: { in: body.capabilities },
        },
        select: { capability: true, effect: true },
      }),
    );
    const currentEffect = new Map(
      current.map(
        (row) =>
          [row.capability, row.effect === "grant" ? "grant" : "deny"] as const,
      ),
    );

    for (const capability of body.capabilities) {
      const effect =
        body.effect === "clear"
          ? clearEffect(
              target.role,
              capability,
              currentEffect.get(capability) ?? null,
            )
          : body.effect;
      const reason = overrideRejectionReason({
        actorUserId: ctx.userId,
        actorCapabilities: ctx.capabilities,
        targetUserId: target.id,
        targetRole: target.role,
        capability,
        effect,
      });
      if (reason) throw new BadRequestException(reason);
    }

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("מועד סיום החסימה חייב להיות בעתיד");
    }

    await this.prisma.withTenant(async (tx) => {
      for (const capability of body.capabilities) {
        if (body.effect === "clear") {
          await tx.userCapability.deleteMany({
            where: { userId: id, tenantId: ctx.tenantId, capability },
          });
          continue;
        }
        // upsert ידני על צמד (משתמש, יכולת): שינוי חוזר מעדכן שורה
        // אחת ולא מערים שורות סותרות
        const updated = await tx.userCapability.updateMany({
          where: { userId: id, tenantId: ctx.tenantId, capability },
          data: { effect: body.effect, expiresAt, reason: body.reason ?? null },
        });
        if (updated.count === 0) {
          await tx.userCapability.create({
            data: {
              id: ulid(),
              tenantId: ctx.tenantId,
              userId: id,
              capability,
              effect: body.effect,
              expiresAt,
              reason: body.reason ?? null,
              createdBy: ctx.userId,
            },
          });
        }
      }
      await this.audit.record(tx, {
        action: `users.capabilities.${body.effect}`,
        entityType: "user",
        entityId: id,
        metadata: {
          capabilities: body.capabilities,
          expiresAt: expiresAt?.toISOString() ?? null,
          reason: body.reason ?? null,
        },
      });
    });

    return { ok: true };
  }

  /** הוספת איש צוות: סיסמה זמנית מוצגת פעם אחת בלבד — לא נשמרת בגלוי. */
  /**
   * מכסת המשתמשים הפעילים של המסלול.
   *
   * נבדקת על **המושב הבא** ולא על המצב הקיים: משרד שהמכסה שלו הוקטנה
   * ממשיך לעבוד עם מי שכבר יש לו, ורק תפיסת מושב נוסף נחסמת. חסימת
   * הקיימים הייתה מנתקת סוכנים באמצע יום עבודה בגלל שינוי תמחור.
   *
   * נקראת משתי נקודות ולא רק מיצירה: **הפעלה מחדש של משתמש מושבת
   * תופסת מושב בדיוק כמו יצירה**. בלי זה אפשר היה להשבית סוכן, ליצור
   * מחליף, ולהפעיל את הראשון בחזרה — ולעבור את המכסה בלי שום חסימה
   * (ביקורת Codex).
   *
   * הטבלה users מחוץ ל-RLS (ראו הערה ב-schema.prisma), ולכן הספירה
   * הישירה כאן תקפה — התנאי `tenantId` הוא זה שמבודד.
   */
  private async assertSeatAvailable(
    tx: TenantTx,
    tenantId: string,
  ): Promise<void> {
    const plan = await this.plans.forTenant(tenantId, tx);
    // מסלול שאי אפשר לפתור חוסם ולא פותח — ראו properties.service
    if (plan === undefined) {
      throw new BadRequestException("המסלול של המשרד אינו מוגדר — פנו לתמיכה");
    }
    if (plan.maxUsers === null) return;
    /*
     * מנעול ייעוץ ברמת הדייר, בתוך הטרנזקציה שכותבת.
     *
     * שתי בקשות מקבילות שספרו את אותו מצב לפני שאחת מהן כתבה היו
     * שתיהן עוברות, והמכסה הייתה נחצית בשקט (ביקורת Codex).
     */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seat-quota:${tenantId}`}))`;
    const used = await tx.user.count({ where: { tenantId, isActive: true } });
    if (limitState(used, plan.maxUsers).blocked) {
      throw new BadRequestException(
        `מסלול "${plan.name}" כולל ${plan.maxUsers} משתמשים. לתוספת משתמשים יש לשדרג מסלול.`,
      );
    }
  }

  @Post("users")
  @RequireCapability("users.manage")
  async createUser(
    @Body(new ZodValidationPipe(CreateUserSchema))
    body: z.infer<typeof CreateUserSchema>,
  ): Promise<{ user: TeamUserDto; tempPassword: string }> {
    const tenantId = TenantContext.current().tenantId;
    const email = body.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException("האימייל כבר רשום במערכת");

    const tempPassword = `Mv-${randomBytes(9).toString("base64url")}`;
    const id = ulid();
    const passwordHash = await AuthService.hashPassword(tempPassword);
    // יצירה + Audit בטרנזקציה אחת — אין חשבון בלי רישום (ביקורת Codex)
    await this.prisma.withTenant(async (tx) => {
      // המכסה נבדקת באותה טרנזקציה שיוצרת, אחרי נעילת הדייר
      await this.assertSeatAvailable(tx, tenantId);
      await tx.user.create({
        data: {
          id,
          tenantId,
          name: body.name,
          email,
          role: body.role,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await this.audit.record(tx, {
        action: "users.create",
        entityType: "user",
        entityId: id,
        metadata: { role: body.role },
      });
    });
    return {
      user: {
        id,
        name: body.name,
        email,
        role: body.role,
        isActive: true,
        locked: false,
        whatsappAccess: false,
      },
      tempPassword,
    };
  }

  @Patch("users/:id")
  @RequireCapability("users.manage")
  async updateUser(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema))
    body: z.infer<typeof UpdateUserSchema>,
  ): Promise<{ ok: true }> {
    const ctx = TenantContext.current();
    if (id === ctx.userId) {
      throw new BadRequestException("אי אפשר לשנות את המשתמש של עצמך מכאן");
    }
    /*
     * מנוי הסוכן בוואטסאפ הוא תוספת בתשלום — הדלקה וכיבוי הם החלטה
     * כספית, לא ניהול צוות. admin מחזיק users.manage אבל בכוונה לא
     * billing.manage, ובלי הבדיקה הזו הוא היה רוכש מנויים בשם
     * המשרד (ביקורת Codex).
     */
    if (body.whatsappAccess !== undefined && !ctx.capabilities.has("billing.manage")) {
      throw new ForbiddenException(
        "הפעלת מנוי הסוכן בוואטסאפ דורשת הרשאת ניהול מנוי ותשלומים — פנו לבעל המשרד",
      );
    }
    await this.prisma.withTenant(async (tx) => {
      /*
       * המנעול נלקח **לפני** קריאת המצב, והמצב נקרא בתוך הטרנזקציה.
       *
       * קריאה מחוץ לנעילה יכולה להתיישן: הבקשה רואה את המשתמש כפעיל,
       * בקשה אחרת משביתה אותו ויוצרת מחליף עד המכסה, ואז הבקשה הזו
       * מדלגת על הבדיקה — כי לפי מה שהיא קראה זו לא הפעלה מחדש —
       * ומחזירה אותו לפעילות מעל המכסה (ביקורת Codex).
       *
       * pg_advisory_xact_lock ניתן לנעילה חוזרת באותה טרנזקציה, ולכן
       * assertSeatAvailable שלוקח אותו שוב אינו נחסם.
       */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seat-quota:${ctx.tenantId}`}))`;
      const target = await tx.user.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { role: true, isActive: true, phone: true },
      });
      if (!target) throw new BadRequestException("משתמש לא נמצא");
      if (target.role === "owner") {
        throw new BadRequestException("אי אפשר לשנות את בעל המשרד");
      }
      // הפעלה מחדש תופסת מושב — אותה מכסה בדיוק כמו ביצירה
      if (body.isActive === true && !target.isActive) {
        await this.assertSeatAvailable(tx, ctx.tenantId);
      }
      const nextPhone =
        body.phone === undefined ? undefined : body.phone.trim() === "" ? null : body.phone.trim();
      await tx.user.update({
        where: { id },
        data: {
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          /*
           * הטלפון נערך גם כאן ולא רק בפרופיל האישי (בקשת בעל
           * הפלטפורמה): בעל המשרד מזין את מספרי הסוכנים כדי לחבר
           * אותם לסוכן הוואטסאפ. שורת ה-owner מוגנת למעלה — מנהל
           * אינו יכול להחליף את מספר בעל המשרד ולחטוף את זהותו.
           */
          ...(nextPhone === undefined ? {} : { phone: nextPhone }),
          ...(body.whatsappAccess !== undefined
            ? { whatsappAccess: body.whatsappAccess }
            : {}),
        },
      });
      /*
       * **גם כאן המספר משנה זהות, ולכן גם כאן הקישור מנותק.**
       *
       * המסלול הזה הוא הצד השני של אותו שינוי: בעל המשרד מעדכן את
       * מספר הסוכן מניהול הצוות. בלי הניתוק המכשיר הישן — זה שמחזיק
       * במספר שהוחלף — היה ממשיך להיפתר לחשבון הסוכן ולקרוא את
       * המאגר, בעוד המסך מציג מספר אחר לגמרי (ביקורת Codex).
       *
       * בתוך אותה טרנזקציה, מאותו נימוק: חצי כתיבה כאן היא בדיוק
       * החור שהניתוק נועד לסגור.
       */
      const phoneChanging =
        nextPhone !== undefined &&
        normalizePhone(nextPhone ?? "") !== normalizePhone(target.phone ?? "");
      /*
       * **והשבתת חשבון מנתקת גם היא.**
       *
       * השורה מתחת מוחקת את כל ה-Session של המושבת, אבל הקישור
       * בוואטסאפ שרד: ההודעות נחסמו רק משום ש-`loadUser` דורש חשבון
       * פעיל, וברגע שהחשבון הופעל מחדש המכשיר הישן חזר לגישה מלאה
       * בלי לאמת דבר (ביקורת Codex). „הושבת” פירושו שהמכשיר מתנתק,
       * בדיוק כמו הדפדפן.
       */
      if (phoneChanging || body.isActive === false) {
        await this.whatsappLinks.revoke(id, phoneChanging ? "phone_changed" : "user", tx);
      }
    });
    if (body.isActive === false) {
      // ניתוק מיידי: משתמש שהושבת לא ממשיך לעבוד עם Session חי
      await this.prisma.session.deleteMany({ where: { userId: id } });
    }
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "users.update",
        entityType: "user",
        entityId: id,
        metadata: { changedFields: Object.keys(body) },
      }),
    );
    return { ok: true };
  }

  /** "מי ראה מה, מי שלח מה, ומתי" (אפיון §19) — יומן הביקורת של המשרד. */
  @Get("audit")
  @RequireCapability("audit.view")
  async auditLog(
    @Query(new ZodValidationPipe(AuditQuerySchema))
    query: z.infer<typeof AuditQuerySchema>,
  ): Promise<{
    items: {
      action: string;
      entityType: string;
      userName?: string;
      /** פעולה שבוצעה ע"י התמיכה — הכתובת שנכנסה. היומן אומר אמת. */
      supportAdmin?: string;
      createdAt: Date;
    }[];
  }> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: query.limit,
        select: {
          action: true,
          entityType: true,
          userId: true,
          createdAt: true,
          metadata: true,
        },
      }),
    );
    const userIds = [
      ...new Set(
        rows.map((r) => r.userId).filter((u): u is string => u !== null),
      ),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: rows.map((r) => {
        const supportAdmin =
          typeof r.metadata === "object" &&
          r.metadata !== null &&
          "supportAdmin" in r.metadata
            ? String((r.metadata as Record<string, unknown>)["supportAdmin"])
            : undefined;
        return {
          action: r.action,
          entityType: r.entityType,
          userName: r.userId ? nameById.get(r.userId) : undefined,
          ...(supportAdmin ? { supportAdmin } : {}),
          createdAt: r.createdAt,
        };
      }),
    };
  }

  /**
   * סטטוס חיבור הוואטסאפ של המשרד — מה מוגדר, מה חסר, והאם זורמות
   * הודעות בפועל (ההודעה הנכנסת האחרונה). משמש את מסך ההגדרות כדי
   * שהמתווך יידע בדיוק איפה החיבור עומד בלי לנחש.
   */
  @Get("whatsapp-status")
  @RequireCapability("settings.manage")
  async whatsappStatus(): Promise<{
    serverConfigured: boolean;
    numberConfigured: boolean;
    lastInboundAt?: Date;
  }> {
    const env = loadEnv();
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const numberConfigured = typeof settings["whatsappNumber"] === "string";

    // ההודעה הנכנסת האחרונה — ההוכחה שהחיבור חי מקצה לקצה
    const lastInbound = await this.prisma.withTenant((tx) =>
      tx.interaction.findFirst({
        // נכנסות בלבד — הצעה שנשלחה בוואטסאפ היא direction:out ולא
        // מעידה שה-webhook מ-Meta עובד (ביקורת Codex)
        where: { tenantId, kind: "whatsapp", direction: "in" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    );

    /*
     * שני המקורות, ובאותו סדר שבו ה-Webhook עצמו קורא אותם.
     *
     * הבדיקה כאן הסתכלה על משתני הסביבה בלבד — אבל הדרך המומלצת
     * להגדיר את המפתחות היא מסך /platform, שכותב אותם למסד. כלומר
     * בעל הפלטפורמה מגדיר הכול כהלכה, הודעות נכנסות זורמות, וכל
     * משרד ממשיך לראות "חיבור השרת ל-Meta ✗" לנצח — עם הנחיה לפנות
     * לתמיכה על תקלה שאינה קיימת.
     *
     * `configuredKeys` ולא קריאת הערכים עצמם: למנהל משרד אין עסק
     * עם סוד של הפלטפורמה, והשאלה כאן היא "האם הוגדר" בלבד.
     */
    const dbKeys = await this.platformSettings.configuredKeys();
    const serverConfigured =
      (dbKeys.includes("whatsappAppSecret") &&
        dbKeys.includes("whatsappVerifyToken")) ||
      (env.WHATSAPP_APP_SECRET !== undefined &&
        env.WHATSAPP_VERIFY_TOKEN !== undefined);

    return {
      serverConfigured,
      numberConfigured,
      /*
       * כתובת ה-Webhook **אינה** מוחזרת כאן.
       *
       * היא מוגדרת פעם אחת במטא לכל הפלטפורמה, ולמנהל משרד אין אפליקציית
       * Meta שאפשר להזין אותה בה. הצגתה לו רק שידרה שיש כאן משהו שהוא
       * צריך לעשות — ובמקביל חשפה פרט תפעולי של הפלטפורמה לכל דייר.
       * מקומה במסך /platform, שם היא באמת ניתנת לפעולה.
       */
      lastInboundAt: lastInbound?.createdAt,
    };
  }

  /**
   * הקישור בין המכשיר של המתווך לחשבון שלו.
   *
   * `@AnyAuthenticated` ולא `settings.manage`: זו אינה הגדרת משרד
   * אלא **הזהות של הסוכן עצמו**, וכל סוכן מנהל את המכשיר שלו. כל
   * שלוש הפעולות עובדות על `userId` מההקשר בלבד — אין פרמטר שמאפשר
   * לגעת בקישור של מישהו אחר.
   */
  @Get("whatsapp-link")
  @AnyAuthenticated()
  async whatsappLink(): Promise<LinkStatus> {
    return this.whatsappLinks.status(TenantContext.current().userId);
  }

  /**
   * קוד חדש. הוא מוחזר **פעם אחת** ואינו נשמר בגלוי בשום מקום —
   * המסך מציג אותו, והמתווך שולח אותו מהמכשיר שהוא רוצה לקשר.
   */
  @Post("whatsapp-link/code")
  @AnyAuthenticated()
  async whatsappLinkCode(): Promise<{ code: string; expiresInSeconds: number }> {
    const ctx = TenantContext.current();
    return this.whatsappLinks.issueCode(ctx.tenantId, ctx.userId);
  }

  /**
   * ניתוק. מכאן ואילך אותו מספר חוזר להיות „לא מוכר” — כולל אם הוא
   * עדיין רשום בשדה הטלפון של המשתמש: ניתוק מפורש גובר על השוואה.
   */
  @Delete("whatsapp-link")
  @AnyAuthenticated()
  async whatsappUnlink(): Promise<{ ok: true }> {
    await this.whatsappLinks.revoke(TenantContext.current().userId, "user");
    return { ok: true };
  }

  /**
   * הגרסה המותקנת — לתצוגה בלבד, לכל מי שרשאי לראות הגדרות. *הפעלת*
   * העדכון עברה ל-/platform: השרת משותף לכל המשרדים, ומנהל משרד אחד
   * שלוחץ "עדכן" היה מפעיל מחדש את השירות לכולם.
   */
  @Get("system")
  @RequireCapability("settings.manage")
  systemInfo(): { version: string } {
    return { version: loadEnv().APP_VERSION };
  }

  /**
   * "מה נשאר להפעיל" — מסך הקליטה של משרד חדש.
   *
   * מוצג לכל מי שרואה את הדשבורד ולא רק למנהל: סוכן שמגלה שאפשר
   * לקלוט נכס בדיבור מאמץ את המערכת מהר יותר. הצעדים עצמם מוגדרים
   * בלוגיקה משותפת (packages/shared — onboarding.ts).
   */
  @AnyAuthenticated()
  @Get("onboarding")
  async onboarding(): Promise<OnboardingProgress> {
    const tenantId = TenantContext.current().tenantId;
    const env = loadEnv();

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const filled = (key: string): boolean =>
      typeof settings[key] === "string" &&
      (settings[key] as string).trim() !== "";

    const [activeUsers, properties, buyers, leadWebhooks] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.withTenant((tx) =>
        tx.property.count({ where: { tenantId, deletedAt: null } }),
      ),
      this.prisma.withTenant((tx) =>
        tx.buyer.count({ where: { tenantId, deletedAt: null } }),
      ),
      this.prisma.leadWebhook.count({ where: { tenantId } }),
    ]);

    return onboardingSteps({
      // מספר הרישיון הוא פרט חובה בהזמנה בכתב — בלעדיו ההסכמים פגומים
      officeProfileComplete:
        (tenant?.name ?? "").trim() !== "" &&
        filled("licenseNumber") &&
        filled("officePhone"),
      activeUsers,
      properties,
      buyers,
      leadWebhookConfigured: leadWebhooks > 0,
      whatsappConfigured: filled("whatsappNumber"),
      transcriptionAvailable:
        env.STT_URL !== undefined && env.STT_SECRET !== undefined,
    });
  }

  /* ==================== גישת תמיכה בהסכמה ==================== */

  /**
   * חלון גישת התמיכה — המודל של "המשתמש לוחץ, התמיכה נכנסת".
   *
   * אין למנהל הפלטפורמה דלת קבועה למשרד. הדלת נפתחת רק כאן, בלחיצה
   * של מי שמחזיק settings.manage, נסגרת מעצמה אחרי שעה, וניתנת
   * לסגירה מוקדמת בלחיצה. הפתיחה, הכניסה והביטול נרשמים ביומן
   * הפעילות של המשרד — השקיפות היא חלק מהעסקה, לא תוספת.
   */
  @Get("support-access")
  @RequireCapability("settings.manage")
  async supportAccess(): Promise<{ activeUntil: string | null }> {
    const { tenantId } = TenantContext.current();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { supportAccessUntil: true },
    });
    const until = tenant?.supportAccessUntil ?? null;
    return {
      activeUntil:
        until !== null && until.getTime() > Date.now()
          ? until.toISOString()
          : null,
    };
  }

  @Post("support-access")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async grantSupportAccess(): Promise<{ activeUntil: string }> {
    const { tenantId, userId } = TenantContext.current();
    // 60 דקות — קבוע ולא פרמטר: חלון שמישהו יכול למתוח הוא לא חלון
    const until = new Date(Date.now() + 60 * 60 * 1000);
    /*
     * ההענקה והתיעוד בטרנזקציה אחת. בנפרד, כשל בכתיבת היומן היה
     * מחזיר שגיאה למשתמש ומשאיר את הדלת פתוחה לשעה — חלון פתוח,
     * מסך שאומר "נכשל", ואפס עדות ביומן (ביקורת Codex).
     */
    await this.prisma.withTenant(async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { supportAccessUntil: until, supportAccessGrantedBy: userId },
      });
      await this.audit.record(tx, {
        action: "support.access.grant",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { until: until.toISOString() },
      });
    });
    return { activeUntil: until.toISOString() };
  }

  @Delete("support-access")
  @RequireCapability("settings.manage")
  async revokeSupportAccess(): Promise<{ ok: true }> {
    const { tenantId } = TenantContext.current();
    // אותה אטומיות של ההענקה — הסגירה והעדות הן פעולה אחת
    await this.prisma.withTenant(async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { supportAccessUntil: null, supportAccessGrantedBy: null },
      });
      await this.audit.record(tx, {
        action: "support.access.revoke",
        entityType: "tenant",
        entityId: tenantId,
      });
    });
    /*
     * ה-Sessions של התמיכה נמחקים אחרי הסגירה, מחוץ לטרנזקציה: הם
     * כבר מתים ממילא — resolveSession דוחה אותם ברגע שהחלון נסגר —
     * והמחיקה היא ניקיון, לא אכיפה. גם אם היא נכשלת, הדלת סגורה.
     */
    await this.prisma.session.deleteMany({
      where: { supportAdminEmail: { not: null }, user: { tenantId } },
    });
    return { ok: true };
  }
}
