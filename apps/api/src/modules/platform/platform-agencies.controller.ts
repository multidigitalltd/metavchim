import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import {
  BLOCKABLE_MODULE_KEYS,
  IdSchema,
  isFreePlan,
  PLAN_FEATURES,
  PlanCodeSchema,
  blockedModulesRejectionReason,
  TenantStatusSchema,
  downgradeWarnings,
  MAX_RENTAL_MONTHLY_AGOROT,
  sanitizeFeatures,
  whatsappAgentSeats,
  whatsappPairingLink,
  whatsappSeatGrant,
  WhatsappSeatGrantError,
  whatsappSeatOriginLabel,
  linkNeedsReverification,
  emailDomainStatus,
  WHATSAPP_CONNECTION_LIVE_STATUSES,
} from "@metavchim/shared";
import { OfficeSettingsService } from "../settings/office-settings.service";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { whatsappSeatQuotaWhere } from "../../core/whatsapp-seat-quota";
import { CryptoService } from "../../core/crypto.service";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe, IdParam } from "../../common/zod-validation.pipe";
import { EmailService } from "../../core/email.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";
import { WhatsAppLinkService } from "../messaging/whatsapp-link.service";
import { FunnelEnrollmentService } from "../funnel/funnel-enrollment.service";
import { AccountDeletionService } from "../settings/account-deletion.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { AuthService, tenantPeriodEnded } from "../auth/auth.service";
import { setSessionCookie } from "../../common/session-token";

/**
 * ‎**מייל מהפלטפורמה למשרד.**
 *
 * ‏הגבולות אינם קישוט: נושא ריק יוצא כהודעה בלי שורת נושא, וגוף
 * ‏ריק שולח דף ריק ללקוח משלם. התקרות הן מה ש-Postmark מקבלת.
 */
const AgencyEmailSchema = z.object({
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(20000),
});

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

/**
 * חריגי הפלטפורמה על משרד יחיד.
 *
 * שתי רשימות ולא אחת עם סימנים: „מה נפתח” ו„מה נסגר” הן שתי שאלות
 * שונות שנשאלות בזמנים שונים, וערבוב שלהן היה הופך כל שינוי לקריאה
 * של כל הרשימה. הקודים מאומתים מול הקטלוג — קוד שאינו קיים הוא
 * הבטחה שאף שורת קוד אינה אוכפת.
 */
const TenantFeaturesSchema = z
  .object({
    grants: z.array(z.string().min(1).max(40)).max(PLAN_FEATURES.length),
    denials: z.array(z.string().min(1).max(40)).max(PLAN_FEATURES.length),
  })
  .strict();

/**
 * הוספת מקום וואטסאפ ממסך הפלטפורמה.
 *
 * ‎`.strict()` ושדות מותנים: „ניסיון בלי תאריך” ו„בתשלום בלי מחיר”
 * הם שתי בקשות חסרות שהיו נשמרות כמקום חינם לנצח. ההכרעה עצמה
 * ‎(`whatsappSeatGrant`) דוחה אותן גם היא — כאן זו דחייה עם 400
 * במקום חריגה, ושם זה הכלל.
 */
const GrantWhatsappSeatSchema = z
  .object({
    mode: z.enum(["free", "trial", "billed"]),
    /** ל-`trial`: מתי המקום נסגר מעצמו. */
    endsAt: z.string().datetime().optional(),
    /** ל-`billed`: המחיר החודשי שסוכם, באגורות. */
    monthlyAgorot: z.number().int().min(1).max(MAX_RENTAL_MONTHLY_AGOROT).optional(),
  })
  .strict();

/**
 * חלון החינם ומחיר מוסכם.
 *
 * `null` בכל שדה = ביטול החריגה, לא „אפס”. זו ההבחנה שמאפשרת
 * להחזיר משרד להתנהגות הרגילה בלי למחוק אותו ולהקים מחדש.
 *
 * המחיר **חיובי בלבד**: „חינם למשרד הזה” הוא הארכת החלון ולא סכום
 * אפס, שהיה נשלח לסולק כחיוב על אפס ונדחה.
 */
const TenantBillingOverrideSchema = z
  .object({
    trialEndsAt: z.union([z.string().datetime(), z.null()]).optional(),
    paidUntil: z.union([z.string().datetime(), z.null()]).optional(),
    priceOverrideMonthlyAgorot: z.union([z.number().int().min(1).max(10_000_000), z.null()]).optional(),
    priceOverrideYearlyAgorot: z.union([z.number().int().min(1).max(100_000_000), z.null()]).optional(),
    /**
     * מקומות **נוספים** לסוכן הוואטסאפ, מעבר לאחד שכלול במסלול.
     *
     * זו רכישה: המשרד משלם לכל סוכן נוסף, ובעל הפלטפורמה מעלה כאן
     * את המספר. תקרה של עשרים — מעבר לה זו כמעט בוודאות טעות
     * הקלדה, ולא משרד עם עשרים ואחד סוכנים בוואטסאפ.
     */
    whatsappAgentSeatsExtra: z.number().int().min(0).max(20).optional(),
  })
  .strict();

/** מחיקת משרד: שם המשרד במדויק — ההגנה מפני השורה הלא נכונה. */
const DeleteAgencySchema = z.object({ confirmName: z.string().min(1).max(120) }).strict();

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

/**
 * ‎**מה שרואים כשפותחים שורה של משרד.**
 *
 * ‏ארבע קבוצות ולא רשימה שטוחה: „מי הם”, „מה יש להם”, „מה הם
 * ‏משלמים” ו„האם הם חיים”. בעל הפלטפורמה שואל את ארבע השאלות
 * ‏האלה בנפרד, וערבוב שלהן בטור אחד הוא מה שהופך מסך לרשימת
 * ‏שדות.
 */
export interface AgencyDetails {
  contact: {
    ownerName: string | null;
    ownerEmail: string | null;
    ownerPhone: string | null;
    officePhone: string | null;
    officeAddress: string | null;
    licenseNumber: string | null;
  };
  usage: { properties: number; buyers: number; leads: number; calls: number };
  billing: {
    signupSource: string;
    couponCode: string | null;
    couponPercentOff: number | null;
    couponPlanCode: string | null;
    whatsappAgentSeatsExtra: number;
  };
  activity: {
    lastLoginAt: Date | null;
    whatsappConnected: boolean;
    telephonyConnected: boolean;
    emailDomainConnected: boolean;
    filesLocked: boolean;
  };
}

export interface AgencyRow {
  id: string;
  /** ‏מספר הלקוח — מה שאפשר להקריא בטלפון ולחפש לפיו ברשימה. */
  customerNo: number;
  name: string;
  plan: string;
  status: string;
  userCount: number;
  createdAt: Date;
  /** חלון גישת תמיכה פתוח — null כשאין הסכמה בתוקף. */
  supportAccessUntil: Date | null;
  /** מודולים שהפלטפורמה חסמה למשרד — מפתחות מקטלוג המודולים. */
  blockedModules: string[];
  /** חריגי התכונות של המשרד — מה נפתח מעבר למסלול ומה נסגר בתוכו. */
  featureGrants: string[];
  featureDenials: string[];
  /** מחיר מוסכם באגורות; null = מחיר המסלול. */
  priceOverrideMonthlyAgorot: number | null;
  priceOverrideYearlyAgorot: number | null;
  /** מקומות נוספים שנרכשו לסוכן הוואטסאפ, מעבר לאחד שכלול במסלול */
  whatsappAgentSeatsExtra: number;
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

/**
 * ‏ניהול המשרדים במסך הפלטפורמה — רשימה ופרטים, הקמה ועדכון, מודולים
 * ‏ותכונות, מקומות בסוכן הוואטסאפ, חריגי חיוב, מחיקה וכניסת תמיכה.
 *
 * ‏אחד מארבעה בקרים תחת `/platform`, כולם מאחורי `PlatformAdminGuard` —
 * ‏פוצלו מבקר אחד של 3,600 שורות לפי תחום, בלי שינוי בנתיבים או בשערים.
 */
@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class PlatformAgenciesController {
  private readonly logger = new Logger(PlatformAgenciesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly plans: PlanCatalogService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly officeSettings: OfficeSettingsService,
    private readonly whatsappSender: WhatsAppSendService,
    private readonly whatsappLinks: WhatsAppLinkService,
    private readonly crypto: CryptoService,
    /*
     * ‏רק לפתיחה מחדש של רישום שנסגר כשמחזירים למשרד ניסיון. אין
     * ‏כאן שליחה — מודול המשפך אינו מחזיק ערוץ יוצא כלל.
     */
    private readonly funnel: FunnelEnrollmentService,
  ) {}

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
        featureGrants: true,
        featureDenials: true,
        priceOverrideMonthlyAgorot: true,
        priceOverrideYearlyAgorot: true,
        whatsappAgentSeatsExtra: true,
        customerNo: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    });
    // המסלולים נטענים פעם אחת לכל הרשימה, ולא פעם לכל שורה
    const freeCodes = new Set(
      (await this.plans.all()).filter((p) => isFreePlan(p)).map((p) => p.code),
    );
    return tenants.map((t) => ({
      id: t.id,
      customerNo: t.customerNo,
      name: t.name,
      plan: t.plan,
      status: t.status,
      userCount: t._count.users,
      blockedModules: t.blockedModules,
      featureGrants: t.featureGrants,
      featureDenials: t.featureDenials,
      priceOverrideMonthlyAgorot: t.priceOverrideMonthlyAgorot,
      whatsappAgentSeatsExtra: t.whatsappAgentSeatsExtra,
      priceOverrideYearlyAgorot: t.priceOverrideYearlyAgorot,
      createdAt: t.createdAt,
      trialEndsAt: t.trialEndsAt,
      paidUntil: t.paidUntil,
      // חלון גישת תמיכה פתוח? המסך מראה כפתור כניסה רק כשיש הסכמה
      supportAccessUntil:
        t.supportAccessUntil !== null && t.supportAccessUntil.getTime() > Date.now()
          ? t.supportAccessUntil
          : null,
      // אותה פונקציה שהשרת אוכף לפיה, ולא העתק שלה
      periodEnded: tenantPeriodEnded({ ...t, planIsFree: freeCodes.has(t.plan) }),
    }));
  }

  /**
   * ‎**פרטי משרד אחד — לפי דרישה, ולא ברשימה.**
   *
   * ‏הרשימה נטענת בשאילתה אחת על `tenants` בלבד, וזה מה שמחזיק
   * ‏אותה מהירה. ספירות ופרטי קשר לכל משרד היו הופכים אותה
   * ‏ל-N שאילתות בכל טעינה — גם למשרדים שאיש לא פתח. לכן הם כאן,
   * ‏ונקראים כשהשורה נפתחת.
   *
   * ‎**וכל מה שנקרא מתוך המשרד עובר ב-`withExplicitTenant`** —
   * ‏כלומר RLS ממשיך להיאכף, ובעל הפלטפורמה רואה משרד אחד שביקש
   * ‏ולא צובר גישה רוחבית. זו הדרך היחידה שמותרת לכך (ראו
   * ‏`PrismaService`).
   */
  @Get("agencies/:id/details")
  async agencyDetails(@Param("id") id: string): Promise<AgencyDetails> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        signupSource: true,
        couponCode: true,
        couponPercentOff: true,
        couponPlanCode: true,
        whatsappAgentSeatsExtra: true,
        filesLockedAt: true,
      },
    });
    if (tenant === null) throw new NotFoundException("משרד לא נמצא");

    const office = await this.officeSettings.read(id);

    /*
     * ‏הבעלים הוא הנמען של „שלח מייל”, ולכן הוא נקרא כאן ולא
     * ‏מחושב שוב שם: שתי קריאות לאותה שאלה נפרדות ביום שבו משרד
     * ‏יחזיק שני בעלים.
     */
    const owner = await this.agencyOwner(id);

    /*
     * ‏„מתי מישהו נכנס לאחרונה” היא שאלה על המשרד ולא על משתמש,
     * ‏ולכן המקסימום מכולם — משרד חי הוא משרד שמישהו בו נכנס.
     */
    const lastLogin = await this.prisma.user.aggregate({
      where: { tenantId: id, isActive: true },
      _max: { lastLoginAt: true },
    });

    /*
     * ‎**הכול בטרנזקציה אחת עם הקשר דייר.**
     *
     * ‏גם `integration` ו-`email_domains` יושבות תחת RLS, ולכן
     * ‏ספירה ישירה עליהן עם `where: { tenantId }` הייתה מפרידה
     * ‏בתנאי במקום במסד — בדיוק מה שהשער `rls-access` תפס. הפרדה
     * ‏שנשענת על תנאי היא הפרדה שהשאילתה הבאה יכולה לשכוח.
     */
    const [properties, buyers, leads, calls, telephony, domain] =
      await this.prisma.withExplicitTenant(id, async (tx) =>
        Promise.all([
          /*
           * ‎`deletedAt: null` — אותו תנאי שמסך המשרד ושירות הניתוח
           * ‏סופרים לפיו. בלעדיו הפאנל היה מציג מספר גדול יותר ממה
           * ‏שהמשרד עצמו רואה ברשימותיו, והפער הזה נקרא כתקלה.
           */
          tx.property.count({ where: { deletedAt: null } }),
          tx.buyer.count({ where: { deletedAt: null } }),
          /* ‏לידים ושיחות אינם נמחקים רכות — אין להם `deletedAt` */
          tx.lead.count(),
          tx.call.count(),
          tx.integration.count({ where: { status: "active" } }),
          /*
           * ‏השורה נוצרת ברגע שהמשרד מזין דומיין, וה-DNS עדיין
           * ‏ממתין; היא גם שורדת אימות שנשבר. „מחובר” הוא מה
           * ‏ש-`EmailService` באמת שולח דרכו, ולכן אותו כלל בדיוק.
           */
          tx.emailDomain.findFirst({
            select: { dkimVerified: true, returnPathVerified: true },
          }),
        ]),
      );

    /* ‏חיבור הוואטסאפ יושב מחוץ ל-RLS (הוובהוק מגיע בלי הקשר), ולכן
       הסינון כאן מפורש — וזה מה ששער `tenant-filter` דורש. */
    const whatsapp = await this.prisma.whatsAppBusinessConnection.count({
      where: { tenantId: id, status: { in: [...WHATSAPP_CONNECTION_LIVE_STATUSES] } },
    });

    return {
      contact: {
        ownerName: owner?.name ?? null,
        ownerEmail: owner?.email ?? null,
        ownerPhone: owner?.phone ?? null,
        officePhone: office.officePhone ?? null,
        officeAddress: office.officeAddress ?? null,
        licenseNumber: office.licenseNumber ?? null,
      },
      usage: { properties, buyers, leads, calls },
      billing: {
        signupSource: tenant.signupSource,
        couponCode: tenant.couponCode,
        couponPercentOff: tenant.couponPercentOff,
        couponPlanCode: tenant.couponPlanCode,
        whatsappAgentSeatsExtra: tenant.whatsappAgentSeatsExtra,
      },
      activity: {
        lastLoginAt: lastLogin._max.lastLoginAt,
        whatsappConnected: whatsapp > 0,
        telephonyConnected: telephony > 0,
        emailDomainConnected: domain !== null && emailDomainStatus(domain) === "verified",
        filesLocked: tenant.filesLockedAt !== null,
      },
    };
  }

  /**
   * ‎**בעל המשרד — נקודה אחת.**
   *
   * ‏גם הפרטים וגם השליחה שואלים „מי הבעלים”, ושתי תשובות לאותה
   * ‏שאלה נפרדות ביום מן הימים. `isActive` הוא חלק מהשאלה: מייל
   * ‏לבעלים שהושבת אינו מגיע לאיש.
   */
  private async agencyOwner(
    tenantId: string,
  ): Promise<{ name: string; email: string; phone: string | null } | null> {
    return this.prisma.user.findFirst({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { name: true, email: true, phone: true },
    });
  }

  /**
   * ‎**מייל מהפלטפורמה לבעל המשרד.**
   *
   * ‏עד היום כל פנייה למשרד יצאה מחוץ למערכת — מתיבה אישית, בלי
   * ‏זכר לכך שנשלחה. כאן היא יוצאת מהשולח של המערכת, עם אותה
   * ‏תבנית שכל מייל אחר לובש.
   *
   * ‎`required: true` — שליחה שנכשלת חייבת להיאמר. „נשלח” על מייל
   * ‏שלא יצא הוא בדיוק מה שגורם למישהו לחכות לתשובה שלא תגיע.
   *
   * ‎`tenantId` **אינו** נמסר בכוונה: המייל יוצא מהפלטפורמה ולא
   * ‏מהדומיין של המשרד — הוא זה שמקבל אותו.
   */
  @Post("agencies/:id/email")
  async emailAgency(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AgencyEmailSchema)) body: z.infer<typeof AgencyEmailSchema>,
  ): Promise<{ sentTo: string }> {
    const owner = await this.agencyOwner(id);
    if (owner === null) {
      throw new BadRequestException("למשרד אין בעלים פעיל — אין למי לשלוח");
    }
    /*
     * ‎**שורות, ולא פסקה אחת.**
     *
     * ‏מה שנכתב בתיבה נמסר כמחרוזת, ו-`send` עוטף מחרוזת בפסקה
     * ‏יחידה — ואז HTML בולע את ירידות השורה. מי שכתב שלוש פסקאות
     * ‏היה רואה אותן נמרחות לשורה אחת אצל הנמען.
     */
    const paragraphs = body.body
      .split(/\n+/u)
      .map((line) => line.trim())
      .filter((line) => line !== "");

    /*
     * ‎**מפתח לכל שליחה, ולא `null`.**
     *
     * ‏עם `null` אין שורת ניסיון כלל, כלומר גם לא חצי עקבה. המפתח
     * ‏ייחודי ללחיצה (ולא לתוכן), כי הודעה שנכתבה ביד פעמיים היא
     * ‏שתי הודעות — אבל שליחה שנפלה באמצע מזוהה ואינה נשלחת פעמיים.
     */
    const key = `platformmail:${ulid()}`;
    await this.email.send(owner.email, body.subject, { paragraphs }, {
      idempotency: { key, purpose: "platform_office" },
      required: true,
      tenantId: undefined,
    });

    /*
     * ‎**והעקבה נשארת אצל המשרד.**
     *
     * ‏שורת הניסיון נמחקת אחרי חודש ואינה נושאת את הנמען — היא
     * ‏זיכרון לניסיון חוזר, לא היסטוריה. מה שהופך „מי פנה אלינו
     * ‏ומתי” לשאלה שאפשר לענות עליה הוא יומן המשרד, וזה גם מה
     * ‏שהופך את הפעולה **גלויה למשרד עצמו** — אותו דפוס בדיוק
     * ‏שבו שולחן החיבורים נוגע במשרד.
     */
    await this.prisma.withExplicitTenant(id, async (tx) => {
      await tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId: id,
          userId: null,
          action: "office.platform_email",
          entityType: "tenant",
          entityId: id,
          metadata: { subject: body.subject, to: owner.email } as object,
        },
      });
    });
    return { sentTo: owner.email };
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
    @Param("id", IdParam) id: string,
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
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(UpdateAgencySchema)) body: z.infer<typeof UpdateAgencySchema>,
  ): Promise<{ ok: true }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");
    /*
     * קוד מסלול נבדק מול הקטלוג ולא מול enum: מסלול שאינו קיים היה
     * נשמר על המשרד ומשאיר אותו בלי אף פיצ'ר, בלי שום שגיאה.
     */
    const target = body.plan === undefined ? undefined : await this.plans.byCode(body.plan);
    if (body.plan !== undefined && target === undefined) {
      throw new BadRequestException("מסלול לא מוכר");
    }
    /*
     * שיוך למסלול חינמי מנקה את התפוגה שהמסלול הקודם הותיר.
     *
     * השער כבר אינו נשען על השדות האלה כשהמסלול חינמי, אבל שורה
     * שממשיכה לשאת תאריך תפוגה משקרת: היא מזינה באנרים של „הניסיון
     * מסתיים”, והיא הופכת לאמת ברגע שהמשרד יוחזר למסלול בתשלום.
     *
     * **הסטטוס משתנה רק מ-`trial`.** משרד מושהה ששויך למסלול חינמי
     * היה חוזר לאוויר בשקט — המסך שולח `{ plan }` בלבד, ולכן גם
     * ניתוק ה-Sessions למטה לא היה רץ, וההשהיה של בעל הפלטפורמה
     * הייתה מתבטלת מאליה (ביקורת Codex). המסלול נוגע בחיוב, לא
     * בהחלטה מי חסום — בדיוק כפי שהמיגרציה משאירה מושהים בצד.
     */
    const toFree = target !== undefined && isFreePlan(target);
    const activateFromTrial = toFree && tenant.status === "trial";
    const now = new Date();

    /*
     * ‎**כל כתיבה שנוגעת בחצי מ„ניסיון חי” שואלת על הפתיחה מחדש**
     * ‏(ביקורת Codex, P2).
     *
     * ‏„ניסיון חי” הוא סטטוס **וגם** תאריך, ולכן מנהל יכול להגיע
     * ‏אליו בשני צעדים: תאריך עתידי דרך מסך העקיפה בזמן שהמשרד
     * ‏`active`, ואז שינוי הסטטוס כאן. הצעד השני לא קרא למשפך
     * ‏כלל, והתוצאה **קבועה**: ניסיון חי לצד רישום סגור,
     * ‏ש-`reopenLapsed` אינו סורק (הוא סורק `paid` בלבד)
     * ‏ו-`enrollDue` אינו מקבל (היה לו רישום).
     *
     * ‏הקריאה אינה מותנית בכלום: `reopenRows` כבר מכריע בעצמו על
     * ‏השורה שאחרי הכתיבה, ותנאי כאן היה עותק שני שלו.
     */
    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          ...(body.plan !== undefined ? { plan: body.plan } : {}),
          /*
           * ‎**כל מי שמוחק את תאריך הניסיון רושם גם למה.**
           *
           * ‏תאריך ריק לבדו הוא דו-משמעי — „נגמר” או „אופס זמנית” —
           * ‏ומשפך ההמרה מכריע הפוך בין השניים. שני המסלולים כאן
           * ‏**מסיימים** את הניסיון, ולכן שניהם רושמים זאת.
           */
          ...(toFree
            ? { trialEndsAt: null, trialConcludedAt: now, paidUntil: null }
            : {}),
          ...(activateFromTrial ? { status: "active" } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.paidUntil !== undefined
            ? {
                paidUntil: body.paidUntil === null ? null : new Date(body.paidUntil),
                /*
                 * הענקה ידנית מסיימת גם את הניסיון: משרד עם שני
                 * תאריכים פעילים היה נחסם לפי זה שרלוונטי לסטטוס שלו,
                 * ומנהל שהעניק גישה לא היה מבין למה היא לא נכנסה לתוקף.
                 *
                 * ‎**וזה חל גם על „פתח ללא תפוגה”**, ששולח
                 * ‏`paidUntil: null`: הוא משאיר את הסטטוס „ניסיון” ובלי
                 * ‏`paid_until`, כלומר מצב שאינו ניתן להבחנה מאיפוס
                 * ‏זמני — ורישום המשפך היה נשאר פתוח לנצח (ביקורת
                 * ‏Codex). הסיום נרשם, ולכן אין מה להסיק.
                 */
                trialEndsAt: null,
                trialConcludedAt: now,
              }
            : {}),
        },
      });
      if (body.status !== undefined || toFree) {
        await this.funnel.reopenWithin(tx, id, now);
      }
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
    @Param("id", IdParam) id: string,
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
   * חריגי תכונות למשרד יחיד — פתיחה מעבר למסלול, וסגירה בתוכו.
   *
   * המסלול הוא ברירת מחדל מסחרית ולא גזירה. עסקה מיוחדת, פיילוט על
   * תכונה אחת, או סגירה זמנית בגלל חוב — כולם חיים כאן ולא בקטלוג,
   * שאחרת היה הופך לרשימת לקוחות במקום לרשימת מסלולים.
   *
   * גם כאן אין מחיקת Sessions: התכונות נפתרות בכל בקשה מחדש, ולכן
   * השינוי תופס בקליק הבא בלי לנתק איש באמצע עבודה.
   */
  @Patch("agencies/:id/features")
  async setTenantFeatures(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(TenantFeaturesSchema)) body: z.infer<typeof TenantFeaturesSchema>,
  ): Promise<{ ok: true; grants: string[]; denials: string[] }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, featureGrants: true, featureDenials: true },
    });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");

    /*
     * `sanitizeFeatures` ולא שמירה כמות שהיא: קוד שאינו בקטלוג הוא
     * טעות הקלדה, ושמירה שלו הייתה יוצרת חריג שנראה שמור ואינו
     * נאכף בשום מקום — אותו כלל שנוהג בשמירת מסלול.
     */
    const grants = sanitizeFeatures(body.grants);
    const denials = sanitizeFeatures(body.denials);

    await this.prisma.tenant.update({
      where: { id },
      data: { featureGrants: grants, featureDenials: denials },
    });
    this.plans.invalidate();

    // ביומן של המשרד עצמו: בעל המשרד יראה למה תכונה הופיעה או נעלמה
    await this.prisma.withExplicitTenant(id, (tx) =>
      tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId: id,
          userId: null,
          action: "platform.tenant_features",
          entityType: "tenant",
          entityId: id,
          metadata: {
            before: { grants: tenant.featureGrants, denials: tenant.featureDenials },
            after: { grants, denials },
          },
        },
      }),
    );
    return { ok: true, grants, denials };
  }

  /* ============================================================
     מנויי הוואטסאפ של משרד — מי מחזיק, מי אימת, ומה אפשר להוסיף.

     ‎**למה זה כאן ולא במסך של המשרד.** המשרד רואה כמה מקומות יש לו
     וקונה עוד; מי שמוסיף מקום בחינם, פותח פיילוט לחודש או קובע מחיר
     שסוכם בטלפון הוא מפעיל הפלטפורמה. ובעיקר: כשסוכן אינו מצליח
     לאמת את המספר שלו, מי שמקבל את הטלפון הוא התמיכה — ועד היום לא
     הייתה לה שום דרך לראות מה מצבו, ולא כלי לעזור.
     ============================================================ */

  /**
   * ‎**המספרים עצמם אינם מוחזרים — רק ארבע ספרות אחרונות.**
   *
   * מסך התמיכה צריך לענות על „האם המכשיר שלי מחובר”, ולזה די בזנב:
   * הוא מספיק כדי שהסוכן יזהה את המספר שלו בטלפון, ואינו מספיק כדי
   * לבנות ממנו רשימת מספרים של כל הסוכנים בכל המשרדים. אותה הכרעה
   * בדיוק כמו ב-`WhatsAppLinkService.status`, ומאותה סיבה.
   */
  @Get("agencies/:id/whatsapp")
  async agencyWhatsapp(@Param("id", IdParam) id: string): Promise<{
    seats: { total: number; used: number; grantedCounter: number };
    rows: {
      id: string;
      origin: string;
      label: string;
      monthlyAgorot: number;
      status: string;
      currentPeriodEnd: string | null;
      createdAt: string;
    }[];
    subscribers: {
      userId: string;
      name: string;
      role: string;
      isActive: boolean;
      whatsappAccess: boolean;
      linked: boolean;
      tail: string | null;
      verifiedAt: string | null;
      needsReverification: boolean;
      implicit: boolean;
    }[];
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, whatsappAgentSeatsExtra: true },
    });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");

    const now = new Date();
    const [users, rows, paid] = await Promise.all([
      this.prisma.withExplicitTenant(id, (tx) =>
        tx.user.findMany({
          where: { tenantId: id },
          select: { id: true, name: true, role: true, isActive: true, whatsappAccess: true },
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
        }),
      ),
      this.prisma.whatsappSeat.findMany({
        where: { tenantId: id, status: { not: "released" } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.whatsappSeat.count({ where: whatsappSeatQuotaWhere(id, now) }),
    ]);

    /*
     * ‎`whatsapp_links` יושב מחוץ ל-RLS (הוא נקרא בנתיב הוובהוק לפני
     * שידוע מיהו הדייר), ולכן הסינון לפי דייר נאכף כאן: המשתמשים
     * נשלפו תחת הדייר, והקישורים נשלפים לפיהם בלבד.
     */
    const links =
      users.length === 0
        ? []
        : await this.prisma.whatsAppLink.findMany({
            where: { userId: { in: users.map((u) => u.id) }, revokedAt: null },
            select: { userId: true, waIdEncrypted: true, verifiedAt: true, source: true },
          });
    const byUser = new Map(links.map((link) => [link.userId, link]));

    return {
      seats: {
        total: whatsappAgentSeats({
          planHasAgent: await this.plans.tenantHasFeature(id, "voice_intake"),
          granted: tenant.whatsappAgentSeatsExtra,
          paid,
        }),
        used: users.filter((u) => u.isActive && u.whatsappAccess).length,
        grantedCounter: tenant.whatsappAgentSeatsExtra,
      },
      rows: rows.map((row) => ({
        id: row.id,
        origin: row.origin,
        label: whatsappSeatOriginLabel(row),
        monthlyAgorot: row.monthlyAgorot,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      subscribers: users.map((user) => {
        const link = byUser.get(user.id);
        return {
          userId: user.id,
          name: user.name,
          role: user.role,
          isActive: user.isActive,
          whatsappAccess: user.whatsappAccess,
          linked: link !== undefined,
          tail: link === undefined ? null : this.crypto.decrypt(link.waIdEncrypted).slice(-4),
          verifiedAt: link?.verifiedAt.toISOString() ?? null,
          needsReverification:
            link !== undefined && linkNeedsReverification(link.verifiedAt, now),
          implicit: link?.source === "phone",
        };
      }),
    };
  }

  /**
   * הפקת קוד חיבור **עבור סוכן מסוים**, כדי שהתמיכה תוכל לשלוח לו
   * ברקוד או קישור במקום להכתיב שש אותיות בטלפון.
   *
   * ‎**וזה נרשם ביומן.** הקוד מקשר את המכשיר ששולח אותו לחשבון של
   * אותו סוכן — כלומר מי שמחזיק בו יכול לקשר את המכשיר **שלו**.
   * הסמכות קיימת ממילא (מפעיל הפלטפורמה יכול הכול), אבל פעולה
   * שמייצרת מפתח לחשבון של מישהו אחר חייבת להשאיר עקבות.
   */
  @Post("agencies/:id/whatsapp/link-code")
  async agencyWhatsappLinkCode(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(z.object({ userId: IdSchema }).strict()))
    body: { userId: string },
  ): Promise<{ code: string; expiresInSeconds: number; botNumber: string | null; link: string | null }> {
    const user = await this.prisma.user.findFirst({
      where: { id: body.userId, tenantId: id },
      select: { id: true, name: true, isActive: true },
    });
    if (!user) throw new BadRequestException("המשתמש אינו שייך למשרד הזה");
    if (!user.isActive) throw new BadRequestException("החשבון אינו פעיל");

    const issued = await this.whatsappLinks.issueCode(id, user.id);
    this.logger.warn(
      `קוד חיבור וואטסאפ הופק ממסך הפלטפורמה עבור ${user.name} (${user.id}) במשרד ${id}`,
    );
    /*
     * ‎`botNumber` ולא רק `link`: הקישור והברקוד מסתירים את המספר
     * בתוכם, והמסך היה אומר „שלחו ידנית” בלי לומר למי. המספר הוא
     * מה שמאפשר לבצע את ההוראה כשהקיצור אינו עובד.
     */
    const botNumber = await this.whatsappSender.businessNumber();
    return {
      ...issued,
      botNumber,
      link: whatsappPairingLink(botNumber, issued.code),
    };
  }

  /**
   * הוספת מקום למשרד — בחינם, לניסיון, או בתשלום חודשי.
   *
   * ההכרעה מה נכתב בשורה יושבת ב-`whatsappSeatGrant` שב-shared, ולא
   * כאן: היא נבדקת בלי מסד ובלי סולק, וכל תנאי שלה הוא כלל עסקי
   * ולא פרט מימוש.
   */
  @Post("agencies/:id/whatsapp/seats")
  async grantWhatsappSeat(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(GrantWhatsappSeatSchema))
    body: z.infer<typeof GrantWhatsappSeatSchema>,
  ): Promise<{ id: string }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");

    let grant;
    try {
      grant = whatsappSeatGrant({
        mode: body.mode,
        now: new Date(),
        endsAt: body.endsAt === undefined ? null : new Date(body.endsAt),
        monthlyAgorot: body.monthlyAgorot ?? null,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof WhatsappSeatGrantError ? error.message : "בקשה לא תקינה",
      );
    }

    const seat = await this.prisma.whatsappSeat.create({
      data: {
        id: ulid(),
        tenantId: id,
        origin: grant.origin,
        monthlyAgorot: grant.monthlyAgorot,
        /*
         * ‎`active` ולא `pending`: `pending` פירושו „ממתין לתשלום”,
         * וכאן אין דף תשלום שממתינים לו. המקום פתוח מרגע הלחיצה,
         * וזו גם המשמעות של „הוספתי לו מקום”.
         */
        status: "active",
        currentPeriodEnd: grant.currentPeriodEnd,
        billingAnchorDay: grant.billingAnchorDay,
        createdBy: TenantContext.current().userId,
      },
      select: { id: true },
    });
    this.logger.log(`מקום וואטסאפ (${body.mode}) נוסף למשרד ${id}: ${seat.id}`);
    return seat;
  }

  /**
   * סגירת מקום שנוסף מהמסך הזה.
   *
   * ‎**רק מה שהוענק, ומיד.** מקום שהמשרד קנה מבוטל אצלו ונשאר פתוח
   * עד תום התקופה ששולמה — סגירה שלו מכאן הייתה מוחקת חודש ששולם.
   */
  @Delete("agencies/:id/whatsapp/seats/:seatId")
  async releaseWhatsappSeat(
    @Param("id", IdParam) id: string,
    @Param("seatId", IdParam) seatId: string,
  ): Promise<{ ok: true }> {
    const now = new Date();
    const closed = await this.prisma.whatsappSeat.updateMany({
      where: { id: seatId, tenantId: id, origin: "granted", status: { not: "released" } },
      data: { status: "released", releasedAt: now, cancelledAt: now },
    });
    if (closed.count === 0) {
      throw new BadRequestException("המקום לא נמצא, או שהוא מקום בתשלום של המשרד");
    }
    this.logger.warn(`מקום וואטסאפ שהוענק נסגר ממסך הפלטפורמה: ${seatId} (משרד ${id})`);
    return { ok: true };
  }

  /**
   * חלון החינם והמחיר המוסכם של משרד יחיד.
   *
   * שתי היכולות יושבות יחד משום שהן אותה שאלה מסחרית: כמה המשרד
   * הזה משלם, ומתי הוא מתחיל לשלם. הפרדה שלהן לשני מסכים הייתה
   * מאלצת לזכור את השני בכל פעם שנוגעים בראשון.
   *
   * `null` = ביטול החריגה וחזרה להתנהגות הרגילה; שדה שלא נשלח כלל
   * נשאר כפי שהוא. ההבחנה הזו היא מה שמאפשר לשנות מחיר בלי לגעת
   * בתאריכים ולהפך.
   */
  @Patch("agencies/:id/billing-override")
  async setBillingOverride(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(TenantBillingOverrideSchema))
    body: z.infer<typeof TenantBillingOverrideSchema>,
  ): Promise<{ ok: true }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        trialEndsAt: true,
        paidUntil: true,
        priceOverrideMonthlyAgorot: true,
        priceOverrideYearlyAgorot: true,
        whatsappAgentSeatsExtra: true,
      },
    });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");

    const data: {
      trialEndsAt?: Date | null;
      trialConcludedAt?: Date | null;
      paidUntil?: Date | null;
      priceOverrideMonthlyAgorot?: number | null;
      priceOverrideYearlyAgorot?: number | null;
      whatsappAgentSeatsExtra?: number;
    } = {};
    // `in` ולא בדיקת ערך: `null` הוא הוראה מפורשת לבטל, ושדה חסר
    // הוא "אל תיגע" — שני מצבים שונים שאסור לאחד
    /*
     * ‎**תאריך ניסיון אמיתי מבטל „הניסיון נגמר”.**
     *
     * ‏המסך הזה הוא הדרך היחידה להחזיר משרד לניסיון, ולכן הוא גם
     * ‏המקום היחיד שבו הסיום שנרשם חדל להיות נכון. בלי האיפוס, משרד
     * ‏שהוחזר לניסיון היה נושא „נגמר” לצד תאריך חי — סתירה ששלבי
     * ‏הניסיון שלו משלמים עליה (ביקורת Codex).
     *
     * ‎`null` **אינו** מאפס: איפוס התאריך לבדו הוא בדיוק המצב הזמני
     * ‏שאין להסיק ממנו דבר, ומי שסיים את הניסיון קודם לכן לא חזר בו.
     */
    if ("trialEndsAt" in body) {
      data.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
      if (data.trialEndsAt !== null) data.trialConcludedAt = null;
    }
    if ("paidUntil" in body) data.paidUntil = body.paidUntil ? new Date(body.paidUntil) : null;
    if ("priceOverrideMonthlyAgorot" in body) {
      data.priceOverrideMonthlyAgorot = body.priceOverrideMonthlyAgorot ?? null;
    }
    if ("priceOverrideYearlyAgorot" in body) {
      data.priceOverrideYearlyAgorot = body.priceOverrideYearlyAgorot ?? null;
    }
    if ("whatsappAgentSeatsExtra" in body && body.whatsappAgentSeatsExtra !== undefined) {
      /*
       * ‎**הורדה מתחת למספר המוקצים נדחית.**
       *
       * הזכאות בזמן ריצה קוראת את הדגל של המשתמש ואת המסלול — לא את
       * המכסה. כלומר הורדת המספר לבדה אינה מנתקת איש: המחזיקים
       * הקיימים ממשיכים לעבוד מעל מה ששולם, ללא הגבלת זמן (ביקורת
       * Codex). ההכרעה היא לדחות ולא לנתק בשקט — ניתוק אוטומטי של מי
       * שעובד היה מפתיע את המשרד בלי שאיש החליט מי יורד.
       *
       * הנעילה זהה לזו של ההקצאה, ולכן הספירה אינה מתיישנת בין
       * הבדיקה לכתיבה.
       */
      const next = body.whatsappAgentSeatsExtra;
      await this.prisma.withExplicitTenant(id, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seat-quota:${id}`}))`;
        const holders = await tx.user.count({
          where: { tenantId: id, isActive: true, whatsappAccess: true },
        });
        const seats = whatsappAgentSeats({
          planHasAgent: await this.plans.tenantHasFeature(id, "voice_intake", tx),
          granted: next,
          /*
           * מקומות בתשלום נספרים גם כאן — אחרת הורדת ההענקה הידנית
           * הייתה נדחית על מחזיקים שיושבים על מקומות **ששולמו**,
           * כלומר בעל הפלטפורמה לא היה יכול לבטל הענקה למשרד שקנה.
           */
          paid: await this.prisma.whatsappSeat.count({
            where: whatsappSeatQuotaWhere(id, new Date()),
          }),
        });
        if (holders > seats) {
          throw new BadRequestException(
            `במשרד ${holders} סוכנים מחזיקים בסוכן הוואטסאפ, והמספר המבוקש מאפשר ${seats}. הסירו את ההקצאה מהעודפים לפני ההורדה.`,
          );
        }
      });
      data.whatsappAgentSeatsExtra = next;
    }
    if (Object.keys(data).length === 0) return { ok: true };

    /*
     * ‎**הכתיבה והפתיחה-מחדש באותה טרנזקציה.**
     *
     * ‏רישום שנסגר כ„מוצה” נפתח כשהניסיון חוזר — יש לו שוב תפוגה
     * ‏שאפשר להזהיר מפניה, ו-`enrollDue` לעולם לא היה מכניס אותו
     * ‏שוב. בשתי פעולות נפרדות, תקלה ביניהן מותירה ניסיון חי לצד
     * ‏רישום סגור, וזה מצב **קבוע**: הסורק אינו רואה רישומים סגורים
     * ‏והכניסה אינה מקבלת מי שכבר היה לו רישום (ביקורת Codex).
     */
    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data });
      /*
       * ‏בלי תנאי: `reopenRows` מכריע בעצמו על השורה שאחרי הכתיבה
       * ‏(„ניסיון חי” — סטטוס וגם תאריך), ותנאי כאן היה עותק שני
       * ‏שלו. אותה קריאה בדיוק יושבת גם ב-`PATCH agencies/:id`.
       */
      if ("trialEndsAt" in body) await this.funnel.reopenWithin(tx, id);
    });
    await this.prisma.withExplicitTenant(id, (tx) =>
      tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId: id,
          userId: null,
          action: "platform.billing_override",
          entityType: "tenant",
          entityId: id,
          metadata: {
            before: {
              trialEndsAt: tenant.trialEndsAt,
              paidUntil: tenant.paidUntil,
              monthly: tenant.priceOverrideMonthlyAgorot,
              yearly: tenant.priceOverrideYearlyAgorot,
              whatsappSeatsExtra: tenant.whatsappAgentSeatsExtra,
            },
            after: data,
          },
        },
      }),
    );
    return { ok: true };
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
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(DeleteAgencySchema)) body: z.infer<typeof DeleteAgencySchema>,
  ): Promise<{ ok: true }> {
    return this.accountDeletion.deleteTenantFromPlatform(id, body.confirmName);
  }

  /* ====================================================================
   * ‏משפטי המוטבציה של הפלטפורמה
   * ==================================================================== */

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
    @Param("id", IdParam) id: string,
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

    setSessionCookie(res, token, until);
    return { ok: true, until: until.toISOString() };
  }
}
