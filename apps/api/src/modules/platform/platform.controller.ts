import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import {
  AGENT_ACTIONS,
  BLOCKABLE_MODULE_KEYS,
  DEFAULT_VAT_PERCENT,
  buildInterpretPrompt,
  IdSchema,
  interpretJsonSchema,
  InterpretResponseSchema,
  isFreePlan,
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
  MAX_BURN_CREDITS,
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
  MAX_OFFER_ITEM_LABEL,
  MAX_RENTAL_MONTHLY_AGOROT,
  formatRentalNumber,
  MAX_OFFER_LINE_ITEMS,
  MAX_OFFER_NOTE,
  MAX_OFFER_PRICE_AGOROT,
  planRejectionReason,
  sanitizeFeatures,
  whatsappAgentSeats,
  whatsappPairingLink,
  whatsappSeatGrant,
  WhatsappSeatGrantError,
  whatsappSeatOriginLabel,
  linkNeedsReverification,
  type PlanDefinition,
  type ServiceVersion,
  cleanQuoteAuthor,
  cleanQuoteText,
  QUOTE_AUTHOR_MAX_LENGTH,
  QUOTE_LIMIT_PER_SCOPE,
  QUOTE_MAX_LENGTH,
  type MentorQuote,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { lockMentorQuotes } from "../../common/locks";
import { whatsappSeatQuotaWhere } from "../../core/whatsapp-seat-quota";
import { CryptoService } from "../../core/crypto.service";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { EmailService } from "../../core/email.service";
import {
  PlatformSettingsService,
  type PlatformSettingKey,
} from "../../core/platform-settings.service";
import { CardcomService } from "../../core/cardcom.service";
import { LinetService } from "../../core/linet.service";
import { GeminiService } from "../../core/gemini.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";
import { WhatsAppLinkService } from "../messaging/whatsapp-link.service";
import { GeocodingService } from "../../core/geocoding.service";
import { CreditEconomyService } from "../../core/credit-economy.service";
import {
  PlatformCreditsService,
  type PlatformCreditRow,
  type PlatformCreditsReport,
} from "./platform-credits.service";
import { AccountDeletionService } from "../settings/account-deletion.service";
import { LeadPricingService } from "../../core/lead-pricing.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { AuthService, tenantPeriodEnded } from "../auth/auth.service";
import { SESSION_COOKIE } from "../auth/auth.controller";
import {
  SubscriptionOfferService,
  type PlatformOfferRow,
} from "../billing/subscription-offer.service";
import { InvoiceService } from "../billing/invoice.service";
import { NumberRentalService } from "../billing/number-rental.service";
import { Pbx015NumbersService } from "../../core/pbx015-numbers.service";
import {
  BackupsService,
  type BackupsOverview,
  type BackupRunStatus,
  type RestoreStatus,
} from "./backups.service";
import { callUpdaterAgent, updaterFailure } from "./updater-agent";
import { type DiskStatus, DiskSpaceService } from "./disk-space.service";
import { ServiceVersionsService } from "./service-versions.service";
import { TelephonyWebhookLogService } from "../telephony/webhook-log.service";

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
 * חלון החינם ומחיר מוסכם.
 *
 * `null` בכל שדה = ביטול החריגה, לא „אפס”. זו ההבחנה שמאפשרת
 * להחזיר משרד להתנהגות הרגילה בלי למחוק אותו ולהקים מחדש.
 *
 * המחיר **חיובי בלבד**: „חינם למשרד הזה” הוא הארכת החלון ולא סכום
 * אפס, שהיה נשלח לסולק כחיוב על אפס ונדחה.
 */
/**
 * הוספת מקום וואטסאפ ממסך הפלטפורמה.
 *
 * ‎`.strict()` ושדות מותנים: „ניסיון בלי תאריך” ו„בתשלום בלי מחיר”
 * הם שתי בקשות חסרות שהיו נשמרות כמקום חינם לנצח. ההכרעה עצמה
 * ‎(`whatsappSeatGrant`) דוחה אותן גם היא — כאן זו דחייה עם 400
 * במקום חריגה, ושם זה הכלל.
 */
/** חיוב חודשי על מספר של משרד — המחיר באגורות, לפני מע"מ, כמו בהשכרה. */
const CreateNumberChargeSchema = z
  .object({
    tenantId: IdSchema,
    phone: z.string().trim().min(3).max(20),
    monthlyAgorot: z.number().int().min(1).max(MAX_RENTAL_MONTHLY_AGOROT),
  })
  .strict();

const GrantWhatsappSeatSchema = z
  .object({
    mode: z.enum(["free", "trial", "billed"]),
    /** ל-`trial`: מתי המקום נסגר מעצמו. */
    endsAt: z.string().datetime().optional(),
    /** ל-`billed`: המחיר החודשי שסוכם, באגורות. */
    monthlyAgorot: z.number().int().min(1).max(MAX_RENTAL_MONTHLY_AGOROT).optional(),
  })
  .strict();

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

/** ערך ריק = מחיקת ההגדרה מה-DB וחזרה למשתנה הסביבה (אם קיים). */
/*
 * ‎.trim()‎ על כל סוד ומזהה: הערכים מודבקים מלוחות של ספקים, ורווח
 * או שורת-חדשה שנגררים בהדבקה נשמרים ונשלחים כמו שהם — Google, למשל,
 * מחזיר על זה ‎invalid_client‎ ושובר את ההתחברות לכל המערכת.
 */
const UpdateSettingsSchema = z
  .object({
    postmarkServerToken: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    /** טוקן ה-Account — ניהול דומיינים שמשרדים מחברים; נפרד מטוקן השרת */
    postmarkAccountToken: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    emailFrom: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
    /** תיבת הדואר הפנימית — כתובת ה-Inbound של שרת Postmark והסוד שבנתיב ה-Webhook */
    emailInboundAddress: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
    emailInboundSecret: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    /** תיבת התמיכה של הפלטפורמה — שרת Inbound נפרד מזה של המשרדים */
    supportInboundAddress: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
    supportInboundSecret: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    /** ה-Server Token של שרת התמיכה — התשובות יוצאות דרכו */
    supportServerToken: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    /*
     * לינט — הפקת חשבוניות. שילוש ההזדהות והקודים של החשבון.
     *
     * הקודים אינם סודות והם **נראים** במסך, בניגוד למפתח: מספר סוג
     * מסמך שאי אפשר לראות הוא מספר שאי אפשר לוודא מול המסך של לינט,
     * ובדיוק שם קורות הטעויות.
     */
    linetLoginId: z.union([z.string().trim().min(2).max(100), z.literal("")]).optional(),
    linetKey: z.union([z.string().trim().min(8).max(300), z.literal("")]).optional(),
    linetCompanyId: z.union([z.string().trim().min(1).max(40), z.literal("")]).optional(),
    linetBaseUrl: z.union([z.string().trim().url().max(200), z.literal("")]).optional(),
    linetDocType: z.union([z.string().trim().max(20), z.literal("")]).optional(),
    linetVatCatTaxable: z.union([z.string().trim().max(20), z.literal("")]).optional(),
    linetPaymentType: z.union([z.string().trim().max(20), z.literal("")]).optional(),
    linetItemId: z.union([z.string().trim().max(20), z.literal("")]).optional(),
    /** שיעור המע"מ באחוזים — משתנה בחקיקה, ולכן הגדרה ולא קבוע. */
    vatPercent: z.union([z.string().trim().regex(/^\d{1,2}$/u), z.literal("")]).optional(),
    whatsappAppSecret: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    whatsappConnectAppSecret: z
      .union([z.string().trim().min(16).max(200), z.literal("")])
      .optional(),
    whatsappVerifyToken: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    whatsappConnectVerifyToken: z
      .union([z.string().trim().min(16).max(200), z.literal("")])
      .optional(),
    /**
     * חיבור המספר של כל משרד (docs/12) — מזהה האפליקציה ומזהה
     * הקונפיגורציה של Embedded Signup. שניהם מזהים ציבוריים של Meta
     * (הם נשלחים לדפדפן כדי לפתוח את הפופאפ), ולכן ספרות בלבד ובלי
     * דרישת אורך של סוד.
     */
    whatsappAppId: z.union([z.string().trim().regex(/^\d{5,30}$/u), z.literal("")]).optional(),
    whatsappSignupConfigId: z
      .union([z.string().trim().regex(/^\d{5,30}$/u), z.literal("")])
      .optional(),
    /** הסוכן האישי — טוקן קבוע של System User, לא הטוקן הזמני ממסך הפיתוח */
    whatsappAccessToken: z.union([z.string().trim().min(20).max(500), z.literal("")]).optional(),
    // מזהה ולא כמות — ספרות בלבד, אפסים מובילים משמעותיים
    whatsappPhoneNumberId: z.union([z.string().trim().regex(/^\d{5,30}$/u), z.literal("")]).optional(),
    /*
     * מספר הבוט לתצוגה — גיבוי ל-`display_phone_number` של Meta.
     * ספרות בלבד, עם קידומת מדינה או בלעדיה; הנרמול ל-`wa.me` נעשה
     * ב-`normalizePhoneForWhatsapp` ולא כאן, כדי שיהיה מקום אחד
     * שיודע להפוך `055…` ל-`972…`.
     */
    whatsappBotNumber: z
      .union([z.string().trim().regex(/^\+?[\d\s()-]{9,20}$/u), z.literal("")])
      .optional(),
    /** תבנית "לקוח ענה במייל" לסוכן — מחוץ לחלון 24 השעות של Meta */
    whatsappEmailReplyTemplate: z
      .union([z.string().trim().regex(/^[a-z0-9_]{1,512}$/u), z.literal("")])
      .optional(),
    whatsappEmailReplyTemplateLang: z
      .union([z.string().trim().regex(/^[a-zA-Z]{2}(_[A-Z]{2})?$/u), z.literal("")])
      .optional(),
    /** המענה למספר לא רשום — ריק = הנוסח המובנה, לא שתיקה */
    whatsappProspectReply: z.union([z.string().trim().min(10).max(2000), z.literal("")]).optional(),
    /*
     * תבנית ההתראה המאושרת ב-Meta. שם תבנית הוא מזהה טכני: אותיות
     * קטנות, ספרות וקו תחתון — בדיוק מה ש-Meta מתירה, כדי שטעות
     * הקלדה תיתפס כאן ולא בדחייה של הודעה בשלוש לפנות בוקר.
     */
    whatsappNotifyTemplate: z
      .union([z.string().trim().regex(/^[a-z0-9_]{1,512}$/u), z.literal("")])
      .optional(),
    whatsappNotifyTemplateLang: z
      .union([z.string().trim().regex(/^[a-zA-Z]{2}(_[A-Z]{2})?$/u), z.literal("")])
      .optional(),
    /** התבנית נרשמה עם כפתור בכתובת דינמית — ראו את התיעוד בהגדרות */
    whatsappNotifyTemplateButton: z.boolean().optional(),
    /*
     * תבנית ההזמנה למילוי טופס הדרישות. אותה צורה בדיוק, ובכוונה
     * תבנית נפרדת: זו נשלחת ל**לקוח** שהתקשר ולא נענה, ולא לסוכן.
     */
    whatsappIntakeTemplate: z
      .union([z.string().trim().regex(/^[a-z0-9_]{1,512}$/u), z.literal("")])
      .optional(),
    whatsappIntakeTemplateLang: z
      .union([z.string().trim().regex(/^[a-zA-Z]{2}(_[A-Z]{2})?$/u), z.literal("")])
      .optional(),
    whatsappIntakeTemplateButton: z.boolean().optional(),
    /*
     * תבנית התזכורת שלפני סיור. אותה צורה בדיוק — שם תבנית הוא
     * מזהה טכני אצל Meta, וטעות הקלדה נתפסת כאן ולא בדחייה של
     * הודעה חמש שעות לפני שהלקוח היה אמור להגיע.
     */
    whatsappViewingReminderTemplate: z
      .union([z.string().trim().regex(/^[a-z0-9_]{1,512}$/u), z.literal("")])
      .optional(),
    whatsappViewingReminderTemplateLang: z
      .union([z.string().trim().regex(/^[a-zA-Z]{2}(_[A-Z]{2})?$/u), z.literal("")])
      .optional(),
    /** התבנית נרשמה עם חמישה שדות ולא עם נוסח אחד */
    whatsappViewingReminderTemplateFields: z.boolean().optional(),
    whatsappViewingReminderTemplateButtons: z.boolean().optional(),
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
     * המסלול שאליו יורד חשבון שלא הופעל. ריק = אין כזה, והתזכורת
     * אומרת „החשבון ננעל” במקום לנקוב בשם של מסלול שאינו קיים.
     * הערך אינו מאומת מול הקטלוג כאן: מסלול נמחק או נוצר אחרי
     * ההגדרה, והשולח בודק בזמן השליחה — שם זה נכון.
     */
    partnerPlanCode: z.union([z.string().trim().max(20), z.literal("")]).optional(),
    // (הערך נבחר מרשימת המסלולים במסך; הקאפ כאן הוא הגנה בעומק)

    /*
     * השכרת מספרים — חשבון 015 **של הפלטפורמה**. ריק = מחיקת ההגדרה.
     * ה-ingroup הוא מזהה ולא כמות (ספרות בלבד, אפסים משמעותיים),
     * והמחיר באגורות — ריק מוחק, לא מאפס: `Number("")` הוא 0, ושדה
     * שנוקה בטעות היה מאפס את מחיר ההשכרה בשקט.
     */
    pbx015AuthUsername: z.union([z.string().trim().min(2).max(100), z.literal("")]).optional(),
    pbx015AuthPassword: z.union([z.string().trim().min(4).max(200), z.literal("")]).optional(),
    pbx015Ingroup: z.union([z.string().trim().regex(/^\d{1,12}$/u), z.literal("")]).optional(),
    virtualNumberMonthlyAgorot: z
      .union([z.number().int().min(1).max(MAX_RENTAL_MONTHLY_AGOROT), z.literal("")])
      .optional(),

    /*
     * המסמכים המשפטיים. **ריק בכל שדה = הנוסח שבקוד**, ולא מסמך ריק:
     * עמוד תנאי שימוש שנמחק בטעות והוצג ריק הוא גרוע יותר מנוסח
     * ברירת מחדל, ובמדינה שדורשת מסמכים כאלה הוא גם חשיפה.
     *
     * התקרה על הנוסחים נדיבה בכוונה — מסמך משפטי אמיתי מעורך/ת דין
     * הוא ארוך, וגבול הדוק היה חותך אותו באמצע בלי שאיש ישים לב.
     */
    legalOperator: z.union([z.string().trim().min(2).max(200), z.literal("")]).optional(),
    // ח.פ. ישראלי הוא תשע ספרות; מקפים ורווחים נפוצים בהקלדה ולכן מותרים
    legalCompanyId: z.union([z.string().trim().min(2).max(40), z.literal("")]).optional(),
    legalAddress: z.union([z.string().trim().min(5).max(300), z.literal("")]).optional(),
    legalPrivacyEmail: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
    legalAccessibilityEmail: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
    // מוצג כמות שהוא ("9 באוגוסט 2026") — טקסט ולא תאריך, כי נוסח
    // עברי קריא עדיף כאן על פורמט מכונה
    legalUpdatedAt: z.union([z.string().trim().min(3).max(60), z.literal("")]).optional(),
    legalTermsText: z.union([z.string().trim().min(50).max(80_000), z.literal("")]).optional(),
    legalPrivacyText: z.union([z.string().trim().min(50).max(80_000), z.literal("")]).optional(),

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
/** ‏משפט מוטבציה של הפלטפורמה. הגבולות הם אורכי העמודות במסד. */
const PlatformQuoteSchema = z
  .object({
    text: z.string().trim().min(1).max(QUOTE_MAX_LENGTH),
    author: z.string().trim().max(QUOTE_AUTHOR_MAX_LENGTH).default(""),
  })
  .strict();

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

@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class PlatformController {
  private readonly logger = new Logger(PlatformController.name);

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
    private readonly disk: DiskSpaceService,
    private readonly telephonyWebhookLog: TelephonyWebhookLogService,
    private readonly platformCredits: PlatformCreditsService,
    private readonly gemini: GeminiService,
    private readonly whatsappSender: WhatsAppSendService,
    private readonly whatsappLinks: WhatsAppLinkService,
    private readonly subscriptionOffers: SubscriptionOfferService,
    private readonly pbx015: Pbx015NumbersService,
    private readonly numberRentals: NumberRentalService,
    private readonly linet: LinetService,
    private readonly invoices: InvoiceService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * מסלול השותפים כפי שהוא נפתר **באותם שני תנאים** שהשולח בודק:
   * הקוד בקטלוג, והמסלול חינמי. הכפילות מכוונת — כאן זו תצוגה ושם
   * זו הכרעה — אבל שתיהן חייבות לומר את אותו דבר, ולכן שתיהן עוברות
   * דרך `PlanCatalogService` ולא דרך שאילתה משלהן.
   */
  private async resolvePartnerPlan(
    code: string,
  ): Promise<{ name: string; isFree: boolean } | null> {
    if (code === "") return null;
    const plan = await this.plans.byCode(code);
    if (plan === undefined) return null;
    return { name: plan.name, isFree: await this.plans.isFreeCode(code) };
  }


  /**
   * יומן הפניות לנתיב הוובהוק של המרכזיות — **כולל אלה שנדחו**.
   *
   * בפלטפורמה ולא בהגדרות המשרד, כי הפנייה המעניינת ביותר היא זו
   * שלא הצלחנו לשייך לאף משרד: מפתח שאינו מוכר. מסך המשרד יכול
   * להראות רק את מה שכבר זוהה כשלו, וזו בדיוק ההצגה שהחמיצה את
   * התקלה — "לא התקבל אף אירוע" נראה זהה בין מרכזייה שלא פנתה
   * לבין מרכזייה שפנתה ונדחתה.
   *
   * המפתח מוחזר בקידומת בת שישה תווים בלבד; ראו `webhook-log.service`.
   */
  @Get("telephony-webhooks")
  async telephonyWebhooks(): Promise<{
    hits: {
      id: string;
      receivedAt: Date;
      outcome: string;
      /** למה הפנייה לא הפכה לשיחה — `null` כשהיא כן. */
      issue: string | null;
      tenantId: string | null;
      tenantName: string | null;
      keyPrefix: string;
      method: string;
      fieldKeys: string | null;
      /** מה שהספק שלח ואיננו צורכים — ראו `unmappedFields`. */
      unmapped: string | null;
    }[];
  }> {
    const hits = await this.telephonyWebhookLog.recent(50);
    /*
     * שם המשרד ולא רק המזהה: בעל הפלטפורמה מסתכל על היומן כדי לענות
     * למישהו ששאל למה השיחות לא מגיעות, ומזהה ULID אינו תשובה.
     * שאילתה אחת לכל המשרדים ולא אחת לשורה.
     */
    const tenantIds = [...new Set(hits.map((h) => h.tenantId).filter((id) => id !== null))];
    const tenants =
      tenantIds.length > 0
        ? await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));
    return {
      hits: hits.map((hit) => ({
        ...hit,
        tenantName: hit.tenantId === null ? null : (nameById.get(hit.tenantId) ?? null),
      })),
    };
  }

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
        featureGrants: true,
        featureDenials: true,
        priceOverrideMonthlyAgorot: true,
        priceOverrideYearlyAgorot: true,
        whatsappAgentSeatsExtra: true,
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

    await this.prisma.tenant.update({
      where: { id },
      data: {
        ...(body.plan !== undefined ? { plan: body.plan } : {}),
        ...(toFree ? { trialEndsAt: null, paidUntil: null } : {}),
        ...(activateFromTrial ? { status: "active" } : {}),
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
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
  async agencyWhatsapp(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Param("seatId", new ZodValidationPipe(IdSchema)) seatId: string,
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
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
      paidUntil?: Date | null;
      priceOverrideMonthlyAgorot?: number | null;
      priceOverrideYearlyAgorot?: number | null;
      whatsappAgentSeatsExtra?: number;
    } = {};
    // `in` ולא בדיקת ערך: `null` הוא הוראה מפורשת לבטל, ושדה חסר
    // הוא "אל תיגע" — שני מצבים שונים שאסור לאחד
    if ("trialEndsAt" in body) data.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
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

    await this.prisma.tenant.update({ where: { id }, data });
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(DeleteAgencySchema)) body: z.infer<typeof DeleteAgencySchema>,
  ): Promise<{ ok: true }> {
    return this.accountDeletion.deleteTenantFromPlatform(id, body.confirmName);
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
   * הגדרות הפלטפורמה — מצב בלבד, בלי לחשוף ערכים. מפתחות שהוגדרו
   * במשתני סביבה מסומנים כמקור "env" (נשלטים מהשרת, לא מהמסך).
   */
  @Get("settings")
  async settings(): Promise<{
    postmark: {
      configured: boolean;
      source: "db" | "env" | "none";
      emailFrom?: string;
      /** טוקן ה-Account מוגדר — משרדים יכולים לחבר דומיין משלהם */
      officeDomains: boolean;
      /** תיבת הדואר הפנימית — כתובת ה-Inbound; ריק = לא הוגדרה */
      inboundAddress: string;
      inboundSecretSet: boolean;
      /** תיבת התמיכה של הפלטפורמה — שרת Inbound נפרד. */
      supportInboundAddress: string;
      supportInboundSecretSet: boolean;
      supportServerTokenSet: boolean;
    };
    /** webhookUrl מוגדר פעם אחת במטא לכל הפלטפורמה — ולכן הוא כאן ולא בהגדרות המשרד. */
    whatsapp: {
      configured: boolean;
      source: "db" | "env" | "none";
      webhookUrl: string;
      /**
       * המספר שמוצג במסך חיבור המכשיר כשלא נשלף מ-Meta.
       * הערך ולא „מוגדר”: זה מסך העריכה שלו.
       */
      botNumber: string;
      /**
       * אפליקציית החיבור — נתיב משלה, ומאיפה הסוד שלה מגיע.
       * ‎`source: "env"` הוא מה שהופך „ניקוי מהמסך” ללא-מספיק.
       */
      connect: {
        configured: boolean;
        source: "db" | "env" | "none";
        /** האם `WHATSAPP_CONNECT_APP_SECRET` קיים — גם כשהמסד גובר. */
        envFallback: boolean;
        webhookUrl: string;
        secretSet: boolean;
        verifyTokenSet: boolean;
        /** מזהים ציבוריים — הערך עצמו, כי המסך מציג אותם לעריכה. */
        appId: string;
        signupConfigId: string;
      };
      /** הצד היוצא — הסוכן האישי עונה רק כשהוא מוגדר */
      assistant: {
        configured: boolean;
        source: "db" | "env" | "none";
        /** הערך ולא "מוגדר" — זה מסך העריכה שלו; ריק = הנוסח שבקוד */
        prospectReply: string;
        /** תבנית ההתראות; ריק = דחיפה רק בתוך חלון 24 השעות של Meta */
        notifyTemplate: string;
        notifyTemplateLang: string;
        /** התבנית נרשמה עם כפתור בכתובת דינמית — ראו את ההגדרה */
        notifyTemplateButton: boolean;
        intakeTemplate: string;
        intakeTemplateLang: string;
        intakeTemplateButton: boolean;
        viewingReminderTemplate: string;
        viewingReminderTemplateLang: string;
        /** התבנית נושאת חמישה שדות; חסר/false = נוסח אחד */
        viewingReminderTemplateFields: boolean;
        viewingReminderTemplateButtons: boolean;
        emailReplyTemplate: string;
        emailReplyTemplateLang: string;
      };
    };
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
    gemini: {
      configured: boolean;
      source: "db" | "env" | "none";
      /** המודל בתוקף — הגדרה, סביבה, או ברירת המחדל שבקוד */
      model: string;
      /** הערך השמור בלבד; ריק = הולכים אחרי הסביבה/ברירת המחדל */
      modelOverride: string;
    };
    /** webhookUrl היא הכתובת שנרשמת אצל קארדקום — מוצגת כדי שלא ינחשו אותה. */
    cardcom: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
    /**
     * לינט — הפקת חשבוניות. הקודים מוצגים כערכם (הם אינם סודות
     * ומוודאים מול המסך של לינט), המפתח רק "מוגדר/לא".
     */
    linet: {
      configured: boolean;
      loginId: string;
      companyId: string;
      keySet: boolean;
      baseUrl: string;
      docType: string;
      vatCatTaxable: string;
      paymentType: string;
      itemId: string;
      vatPercent: number;
      /** מה חסר להפקה — ריק כשהכול מוגדר. */
      missing: string[];
    };
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
    /** קוד מסלול השותפים — ערך ולא „מוגדר”, מאותו טעם כמו `supportEmail`. */
    partnerPlanCode: string;
    /**
     * ‎**למה הקוד הזה נפתר עכשיו — ולא רק מה נכתב בשדה.**
     *
     * השולח בודק את הקוד בזמן השליחה, ואם הוא אינו בקטלוג או שהמסלול
     * בתשלום הוא מוותר על ההעברה ורושם אזהרה ביומן. מי שהקליד קוד
     * שגוי לא רואה שום דבר במסך: התזכורות ממשיכות לצאת, אף משרד אינו
     * עובר, והתקלה מתגלה חודש אחר כך. השורה הזאת היא ההבדל.
     *
     * ‎`null` = הקוד ריק או שאינו בקטלוג; ה-`partnerPlanCode` שלצדו
     * מבחין בין השניים.
     */
    partnerPlan: { name: string; isFree: boolean } | null;
    /**
     * המסלולים שאפשר לבחור מהם — **הבחירה מהקטלוג ולא הקלדה.**
     *
     * קוד שמוקלד ביד יכול להיות שגוי, ואז אין העברה ואיש אינו יודע.
     * רשימה סוגרת את זה במקור. המסלולים בתשלום נשלחים גם הם ומסומנים
     * ‎`isFree: false` — הם מוצגים מנוטרלים ולא נעלמים, כי „למה
     * המסלול שלי לא ברשימה” היא שאלה בלי תשובה במסך.
     */
    partnerPlanOptions: { code: string; name: string; isFree: boolean }[];
    /**
     * השכרת מספרים מ-015 — **הערכים העסקיים ולא רק "מוגדר"**: שם
     * המשתמש, הקבוצה והמחיר מוצגים כי זה מסך העריכה שלהם; הסיסמה
     * לעולם לא חוזרת — רק אם היא מוגדרת.
     */
    numberRental: {
      configured: boolean;
      username: string;
      passwordSet: boolean;
      ingroup: string;
      monthlyAgorot: number | null;
    };
    /**
     * המסמכים המשפטיים — **ערכים ולא "מוגדר"**, כמו `supportEmail`
     * ומאותו טעם: זה מסך העריכה שלהם, ועורך שאינו רואה את הנוסח
     * הקיים אינו יכול לתקן בו מילה — רק לכתוב אותו מחדש.
     *
     * מחרוזת ריקה = לא נערך, והעמוד מציג את הנוסח שבקוד.
     */
    legal: {
      operator: string;
      companyId: string;
      address: string;
      privacyEmail: string;
      accessibilityEmail: string;
      updatedAt: string;
      termsText: string;
      privacyText: string;
    };
  }> {
    const env = loadEnv();
    const dbKeys = await this.platformSettings.configuredKeys();
    const has = (k: PlatformSettingKey): boolean => dbKeys.includes(k);

    const postmarkDb = has("postmarkServerToken") && has("emailFrom");
    const postmarkEnv = env.POSTMARK_SERVER_TOKEN !== undefined && env.EMAIL_FROM !== undefined;
    const postmarkAccount =
      has("postmarkAccountToken") || env.POSTMARK_ACCOUNT_TOKEN !== undefined;
    const waDb = has("whatsappAppSecret") && has("whatsappVerifyToken");
    const waEnv = env.WHATSAPP_APP_SECRET !== undefined && env.WHATSAPP_VERIFY_TOKEN !== undefined;
    // הצד היוצא של הסוכן האישי — טוקן ומזהה מספר, שניהם יחד
    /*
     * ‎**מאיפה מגיע הסוד של אפליקציית החיבור** — והאם ניקוי מהמסך
     * בכלל ישפיע. כשהוא מוגדר במשתנה סביבה, מחיקת השורה במסד
     * מחזירה את הנפילה לסביבה, והמסך היה מבטיח „חזרה לאפליקציה
     * אחת" בזמן שהסוד הנפרד ממשיך לפעול (ביקורת Codex).
     */
    const waConnectEnv = env.WHATSAPP_CONNECT_APP_SECRET !== undefined;
    const waConnectSecret = has("whatsappConnectAppSecret") || waConnectEnv;
    const waConnectVerify = has("whatsappConnectVerifyToken");
    const waConnectDb = has("whatsappConnectAppSecret") || has("whatsappConnectVerifyToken");
    /*
     * ‎**שני המזהים חוזרים כערך ולא כ„מוגדר".**
     *
     * הם ציבוריים מעצם טיבם — נשלחים לדפדפן של המתווך כדי לפתוח את
     * הפופאפ — ולכן אין סיבה להסתיר אותם. וזה גם מה שהופך את המסך
     * לשמיש: בלי הערך המוצג, מי שהזין אותם ולחץ „שמור" ראה שדה ריק
     * ולא יכול היה לדעת אם נשמרו (דיווח מהשטח).
     */
    const waAppId = (await this.platformSettings.get("whatsappAppId")) ?? "";
    const waSignupConfigId = (await this.platformSettings.get("whatsappSignupConfigId")) ?? "";
    const waOutDb = has("whatsappAccessToken") && has("whatsappPhoneNumberId");
    const whatsappBotNumber = (await this.platformSettings.get("whatsappBotNumber")) ?? "";
    const waOutEnv =
      env.WHATSAPP_ACCESS_TOKEN !== undefined && env.WHATSAPP_PHONE_NUMBER_ID !== undefined;
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
    const partnerPlanCode = (await this.platformSettings.get("partnerPlanCode")) ?? "";
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
      partnerPlanCode: partnerPlanCode,
      partnerPlan: await this.resolvePartnerPlan(partnerPlanCode),
      partnerPlanOptions: (await this.plans.all()).map((plan) => ({
        code: plan.code,
        name: plan.name,
        isFree: isFreePlan(plan),
      })),
      numberRental: {
        configured: await this.pbx015.isConfigured(),
        username: (await this.platformSettings.get("pbx015AuthUsername")) ?? "",
        passwordSet: (await this.platformSettings.get("pbx015AuthPassword")) !== undefined,
        ingroup: (await this.platformSettings.get("pbx015Ingroup")) ?? "",
        monthlyAgorot: await this.pbx015.monthlyPriceAgorot(),
      },
      legal: {
        operator: (await this.platformSettings.get("legalOperator")) ?? "",
        companyId: (await this.platformSettings.get("legalCompanyId")) ?? "",
        address: (await this.platformSettings.get("legalAddress")) ?? "",
        privacyEmail: (await this.platformSettings.get("legalPrivacyEmail")) ?? "",
        accessibilityEmail: (await this.platformSettings.get("legalAccessibilityEmail")) ?? "",
        updatedAt: (await this.platformSettings.get("legalUpdatedAt")) ?? "",
        termsText: (await this.platformSettings.get("legalTermsText")) ?? "",
        privacyText: (await this.platformSettings.get("legalPrivacyText")) ?? "",
      },
      postmark: {
        configured: postmarkDb || postmarkEnv,
        source: postmarkDb ? "db" : postmarkEnv ? "env" : "none",
        emailFrom: (await this.platformSettings.get("emailFrom")) ?? env.EMAIL_FROM,
        officeDomains: postmarkAccount,
        /*
         * התיבה הפנימית: הכתובת מוצגת (אינה סוד — היא כתובת דואר),
         * הסוד רק "מוגדר/לא". ה-Webhook להדבקה אצל הספק נבנה במסך.
         */
        inboundAddress:
          (await this.platformSettings.get("emailInboundAddress")) ??
          env.EMAIL_INBOUND_ADDRESS ??
          "",
        inboundSecretSet:
          has("emailInboundSecret") || env.EMAIL_INBOUND_SECRET !== undefined,
        /*
         * תיבת התמיכה — אותה הצגה בדיוק: הכתובת גלויה, הסוד רק
         * "מוגדר/לא". ה-Webhook נבנה במסך מהסוד שהוקלד.
         */
        supportInboundAddress:
          (await this.platformSettings.get("supportInboundAddress")) ??
          env.SUPPORT_INBOUND_ADDRESS ??
          "",
        supportInboundSecretSet:
          has("supportInboundSecret") || env.SUPPORT_INBOUND_SECRET !== undefined,
        // ריק = התשובות יוצאות בטוקן הכללי, ועדיין מכתובת התמיכה
        supportServerTokenSet: has("supportServerToken"),
      },
      whatsapp: {
        configured: waDb || waEnv,
        source: waDb ? "db" : waEnv ? "env" : "none",
        webhookUrl: `${env.WEB_ORIGIN}/api/v1/webhooks/whatsapp`,
        botNumber: whatsappBotNumber,
        /* אפליקציית החיבור — הנתיב שלה, והאם היא מוגדרת ומאיפה */
        connect: {
          configured: waConnectDb || waConnectEnv,
          source: waConnectDb ? "db" : waConnectEnv ? "env" : "none",
          /*
           * ‎**דגל נפרד, כי `source` מדווח מי גובר ולא מי קיים.**
           *
           * כששניהם מוגדרים `source` הוא `"db"`, והאזהרה על הסביבה
           * הייתה נעלמת — דווקא במקרה שבו היא הכי נחוצה: הניקוי
           * מוחק את שורות המסד, והסוד שבסביבה משתלט מיד (ביקורת
           * Codex).
           */
          envFallback: waConnectEnv,
          webhookUrl: `${env.WEB_ORIGIN}/api/v1/webhooks/whatsapp/connect`,
          /* „מוגדר" לכל סוד בנפרד — אחרת המסך אינו יכול לומר מה נשמר */
          secretSet: waConnectSecret,
          verifyTokenSet: waConnectVerify,
          /* ערכים, לא „מוגדר": מזהים ציבוריים שמוצגים חזרה לעריכה */
          appId: waAppId,
          signupConfigId: waSignupConfigId,
        },
        assistant: {
          configured: waOutDb || waOutEnv,
          source: waOutDb ? "db" : waOutEnv ? "env" : "none",
          prospectReply: (await this.platformSettings.get("whatsappProspectReply")) ?? "",
          /*
           * תבנית ההתראה — ריק פירושו שדחיפת ההתראות עובדת רק בתוך
           * חלון 24 השעות של Meta. זו הגדרה תקינה, ולכן המסך מציג
           * אותה כמצב ולא כשגיאה.
           */
          notifyTemplate: (await this.platformSettings.get("whatsappNotifyTemplate")) ?? "",
          notifyTemplateLang:
            (await this.platformSettings.get("whatsappNotifyTemplateLang")) ?? "he",
          /*
           * ‎**לא מסומן היא ברירת המחדל הבטוחה**: תבנית שנרשמה לפני
           * שהאפשרות הזו קיימת אינה נושאת כפתור, ושליחת רכיב כפתור
           * אליה הייתה מפילה כל התראה.
           */
          notifyTemplateButton:
            (await this.platformSettings.get("whatsappNotifyTemplateButton")) === "true",
          /*
           * ריק = הקישור לטופס הדרישות אינו נשלח אוטומטית, וההודעה
           * המוכנה חוזרת בגוף ההתראה לסוכן. מצב, לא שגיאה.
           */
          intakeTemplate: (await this.platformSettings.get("whatsappIntakeTemplate")) ?? "",
          intakeTemplateLang:
            (await this.platformSettings.get("whatsappIntakeTemplateLang")) ?? "he",
          intakeTemplateButton:
            (await this.platformSettings.get("whatsappIntakeTemplateButton")) === "true",
          // ריק = התזכורת שלפני סיור יוצאת במייל בלבד. מצב, לא שגיאה.
          viewingReminderTemplate:
            (await this.platformSettings.get("whatsappViewingReminderTemplate")) ?? "",
          viewingReminderTemplateLang:
            (await this.platformSettings.get("whatsappViewingReminderTemplateLang")) ?? "he",
          /*
           * ברירת המחדל היא **הנוסח האחד**: זה מה שנרשם עד היום,
           * ומעבר שקט לשדות היה משבית את התזכורות בלי סימן.
           */
          viewingReminderTemplateFields:
            (await this.platformSettings.get("whatsappViewingReminderTemplateFields")) === "true",
          /*
           * ברירת המחדל היא **בלי כפתורים**: תבנית שנרשמה בלעדיהם
           * ומקבלת רכיבי כפתור נדחית, ואז אין תזכורת כלל.
           */
          viewingReminderTemplateButtons:
            (await this.platformSettings.get("whatsappViewingReminderTemplateButtons")) ===
            "true",
          // ריק = "הלקוח ענה במייל" מגיע במערכת ובדחיפה בלבד. מצב, לא שגיאה.
          emailReplyTemplate:
            (await this.platformSettings.get("whatsappEmailReplyTemplate")) ?? "",
          emailReplyTemplateLang:
            (await this.platformSettings.get("whatsappEmailReplyTemplateLang")) ?? "he",
        },
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
        // אותו מקום שקורא בפועל — לא העתק של ההיגיון (ראו DEFAULT_GEMINI_MODEL)
        model: await this.gemini.activeModel(),
        /*
         * הערך **השמור** בלבד, ולא המודל בתוקף.
         *
         * המסך ממלא בו את השדה, ולכן `activeModel()` היה הופך כל
         * שמירה לקיבוע של ברירת המחדל שבקוד — ומודל שיוחלף בגרסה
         * הבאה היה ממשיך לרוץ אצל מי שרק לחץ "שמור" פעם אחת.
         */
        modelOverride: (await this.platformSettings.get("geminiModel")) ?? "",
      },
      cardcom: {
        configured: cardcomDb || cardcomEnv,
        source: cardcomDb ? "db" : cardcomEnv ? "env" : "none",
        webhookUrl: `${env.WEB_ORIGIN}/api/v1/webhooks/cardcom`,
      },
      linet: {
        configured: await this.linet.isConfigured(),
        loginId: (await this.platformSettings.get("linetLoginId")) ?? "",
        companyId: (await this.platformSettings.get("linetCompanyId")) ?? "",
        keySet: has("linetKey"),
        baseUrl: (await this.platformSettings.get("linetBaseUrl")) ?? "",
        docType: (await this.platformSettings.get("linetDocType")) ?? "",
        vatCatTaxable: (await this.platformSettings.get("linetVatCatTaxable")) ?? "",
        paymentType: (await this.platformSettings.get("linetPaymentType")) ?? "",
        itemId: (await this.platformSettings.get("linetItemId")) ?? "",
        vatPercent: Number((await this.platformSettings.get("vatPercent")) ?? DEFAULT_VAT_PERCENT),
        missing: await this.linet.missingSettings(),
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
   * בדיקת חיבור ללינט — חיפוש חשבון שאינו יוצר דבר.
   *
   * מדווחת גם על קודים חסרים: עדיף שהמפעיל יגלה הגדרה חלקית כאן,
   * ולא מחשבונית שנכשלת אחרי שכסף כבר נגבה מהמשרד.
   */
  @Post("settings/test-linet")
  @HttpCode(200)
  async testLinet(): Promise<{ ok: boolean; message: string }> {
    return this.linet.testConnection();
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.invoices.issueOne(id);
  }

  /** רישום חשבונית לתשלום ששולם ואין לו שורה — ואז הפקה בסבב הבא. */
  @Post("payments/:id/invoice")
  @HttpCode(200)
  async invoiceForPayment(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    /*
     * ‎**תיקון ידני מדווח מה קרה באמת.** `queueForPayment` בולעת
     * כשלים בכוונה — היא נקראת גם מהוובהוק, ושם הסורק ידווח שוב —
     * אבל כאן זו פעולת תיקון מפורשת, והמסך אמר „נרשם” גם כשלא נרשם
     * דבר והתשלום נשאר בלי מסמך (ביקורת Codex).
     */
    return this.invoices.queueForPayment(id);
  }

  /**
   * בדיקת חיבור הסוכן האישי בוואטסאפ — קריאת אמת אל Graph על המספר
   * עצמו. טוקן שפג (הזמני ממסך הפיתוח חי 24 שעות) או מזהה מספר שגוי
   * מתגלים כאן, ולא בהודעה הראשונה של מתווך אמיתי.
   */
  @Post("settings/test-whatsapp")
  @HttpCode(200)
  async testWhatsApp(): Promise<{ ok: boolean; message: string }> {
    return this.whatsappSender.probe();
  }

  /**
   * בדיקת חיבור למנוע ההבנה החכמה — **שתי קריאות אמת, לא בדיקת שדה.**
   *
   * "זיהוי בסיסי" בכל פקודה כשמפתח מוגדר הוא כשל שקט: הסיבה נרשמת
   * רק ביומן השרת (דיווח המשתמש). הבדיקה כאן מפרידה בין הגורמים:
   *
   * 1. **פינג** — פרומפט זעיר עם סכימה זעירה. כשל כאן = מפתח פסול,
   *    שם מודל שגוי, או שרת שחסום ליציאה אל Google.
   * 2. **קריאת פענוח מלאה** — אותו פרומפט ואותה סכימה שהסוכן שולח
   *    באמת. פינג תקין וכשל כאן = הסכימה הגדולה היא הבעיה.
   *
   * מוחזרות גם ההצלחה/הכשל האחרונים מהשימוש האמיתי — כדי לראות אם
   * התקלה חיה עכשיו או הייתה נקודתית.
   */
  @Post("settings/test-gemini")
  @HttpCode(200)
  async testGemini(): Promise<{
    configured: boolean;
    model: string;
    ping: { ok: boolean; latencyMs: number; error?: string };
    interpret: { ok: boolean; latencyMs: number; error?: string; action?: string };
    lastFailure: { at: string; detail: string } | null;
    lastSuccessAt: string | null;
  }> {
    if (!(await this.gemini.isConfigured())) {
      throw new BadRequestException("לא מוגדר מפתח Gemini — מלאו מפתח ושמרו");
    }
    const model = await this.gemini.activeModel();

    const ping = await this.gemini.probe('החזר JSON: {"ok": true}', {
      type: "object",
      properties: { ok: { type: "boolean" } },
    });

    const prompt = buildInterpretPrompt("תוסיף הערה לישראל ישראלי שהוא נוסע לחו\"ל עד סוף החודש", {
      nowText: new Intl.DateTimeFormat("he-IL", {
        timeZone: "Asia/Jerusalem",
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date()),
      allowedActions: AGENT_ACTIONS.map((a) => a.id),
    });
    const interpretProbe = await this.gemini.probe(prompt, interpretJsonSchema());
    let interpretOk = interpretProbe.ok;
    let interpretError = interpretProbe.error;
    let interpretAction: string | undefined;
    if (interpretProbe.ok) {
      /*
       * אותה ולידציה שהפענוח האמיתי מריץ, על אותה תשובה — לא קריאה
       * שנייה. במצב ה-JSON החופשי "JSON תקין" לבדו אינו הוכחה: `{}`
       * עובר פענוח ונופל בוולידציה, ובדיקה שמדווחת עליו "תקין"
       * מסתירה בדיוק את הכשל שהיא נועדה לחשוף (ביקורת Codex).
       */
      const parsed = InterpretResponseSchema.safeParse(interpretProbe.value);
      if (parsed.success) {
        interpretAction = parsed.data.action;
      } else {
        interpretOk = false;
        /*
         * דגימה מהתשובה הגולמית — בלעדיה האבחון עיוור: "לא במבנה"
         * אינו אומר אם המודל עטף את התשובה, שינה שמות מפתחות או
         * החזיר משהו אחר לגמרי. הפרומפט של הבדיקה סינתטי, אין כאן
         * נתוני לקוחות.
         */
        const sample = JSON.stringify(interpretProbe.value).slice(0, 220);
        interpretError = `המודל החזיר JSON שאינו במבנה התשובה — פקודות אמיתיות היו נופלות לזיהוי הבסיסי. תחילת התשובה: ${sample}`;
      }
    }

    const { lastFailure, lastSuccessAt } = this.gemini.status();
    return {
      configured: true,
      model,
      ping,
      // מפורש ולא spread — התשובה הגולמית של המודל אינה חלק מה-API
      interpret: {
        ok: interpretOk,
        latencyMs: interpretProbe.latencyMs,
        ...(interpretError === undefined ? {} : { error: interpretError }),
        ...(interpretAction === undefined ? {} : { action: interpretAction }),
      },
      lastFailure,
      lastSuccessAt,
    };
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
    /**
     * מצב הדיסק של השרת. מוצג תמיד ולא רק כשהוא נמוך: „כמה נשאר”
     * הוא מה שמפעיל הפלטפורמה בא לבדוק, ומספר שמופיע רק כשכבר
     * מאוחר אינו ניטור.
     */
    disk: DiskStatus;
  }> {
    const env = loadEnv();
    const [services, disk] = await Promise.all([
      this.serviceVersions.collect(),
      this.disk.status(),
    ]);
    return {
      version: env.APP_VERSION,
      updateAvailable: env.UPDATER_URL !== undefined && env.UPDATE_SECRET !== undefined,
      services,
      disk,
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
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
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.subscriptionOffers.revoke(id);
    return { ok: true };
  }

  /* ====================================================================
   * ‏משפטי המוטבציה של הפלטפורמה
   * ==================================================================== */

  /**
   * ‎**המשפטים שכל המשרדים רואים.**
   *
   * ‏שורה ב-`mentor_quotes` בלי משרד מוצגת בסליידר של כל מתווך
   * במערכת, ולכן היא נכתבת רק מכאן: פוליסת ה-RLS על השורות האלה
   * היא `FOR SELECT` בלבד לכל טרנזקציית משרד, ו-`withPlatformQuotes`
   * הוא הדגל היחיד שפותח אותן לכתיבה. הוא גם חסום בשני הכיוונים —
   * ‏`tenant_id IS NULL` נדרש גם בקריאה — ולכן לשולחן הזה אין גישה
   * למשפטים שמשרד כתב לעצמו, גם לא בטעות.
   */
  @Get("mentor-quotes")
  async mentorQuotes(): Promise<{ quotes: MentorQuote[] }> {
    const rows = await this.prisma.withPlatformQuotes((tx) =>
      tx.mentorQuote.findMany({ orderBy: { createdAt: "asc" } }),
    );
    return {
      quotes: rows.map((r) => ({
        id: r.id,
        text: r.text,
        author: r.author,
        scope: "platform" as const,
      })),
    };
  }

  @Post("mentor-quotes")
  @HttpCode(200)
  async addMentorQuote(
    @Body(new ZodValidationPipe(PlatformQuoteSchema))
    body: z.infer<typeof PlatformQuoteSchema>,
  ): Promise<{ ok: true; quote: MentorQuote }> {
    const text = cleanQuoteText(body.text);
    if (text === null) throw new BadRequestException("אין משפט לשמור");
    const userId = TenantContext.current().userId;
    const row = await this.prisma.withPlatformQuotes(async (tx) => {
      /* ‏אותה הסדרה כמו בצד המשרד — ראו `lockMentorQuotes` */
      await lockMentorQuotes(tx, "platform");
      const existing = await tx.mentorQuote.count({});
      if (existing >= QUOTE_LIMIT_PER_SCOPE) {
        throw new BadRequestException(
          `הגעת ל-${QUOTE_LIMIT_PER_SCOPE} משפטים. מחק אחד כדי להוסיף חדש.`,
        );
      }
      return tx.mentorQuote.create({
        data: {
          id: ulid(),
          tenantId: null,
          text,
          author: cleanQuoteAuthor(body.author),
          createdBy: userId,
        },
      });
    });
    return {
      ok: true,
      quote: { id: row.id, text: row.text, author: row.author, scope: "platform" },
    };
  }

  @Delete("mentor-quotes/:id")
  @HttpCode(200)
  async removeMentorQuote(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: true }> {
    const removed = await this.prisma.withPlatformQuotes((tx) =>
      tx.mentorQuote.deleteMany({ where: { id } }),
    );
    if (removed.count === 0) throw new NotFoundException("המשפט לא נמצא");
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
