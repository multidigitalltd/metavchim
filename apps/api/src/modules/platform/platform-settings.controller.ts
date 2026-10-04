import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  AGENT_ACTIONS,
  DEFAULT_VAT_PERCENT,
  buildInterpretPrompt,
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
  resolveReferralFeePercent,
  checkReplyChain,
  replyChainVerdict,
  type ReplyChainResult,
  MAX_RENTAL_MONTHLY_AGOROT,
  whatsappButtonUrlTemplate,
  whatsappButtonLandsOn,
  whatsappDeepLinkSuffix,
  OptionalEmailSchema,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { EmailService } from "../../core/email.service";
import { PlatformSettingsService, type PlatformSettingKey } from "../../core/platform-settings.service";
import { CardcomService } from "../../core/cardcom.service";
import { LinetService } from "../../core/linet.service";
import { GeminiService } from "../../core/gemini.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";
import { GeocodingService } from "../../core/geocoding.service";
import { CreditEconomyService } from "../../core/credit-economy.service";
import { EmailInboxService } from "../email-inbox/email-inbox.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { Pbx015NumbersService } from "../../core/pbx015-numbers.service";

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
    emailFrom: OptionalEmailSchema.optional(),
    /** תיבת הדואר הפנימית — כתובת ה-Inbound של שרת Postmark והסוד שבנתיב ה-Webhook */
    emailInboundAddress: OptionalEmailSchema.optional(),
    emailInboundSecret: z.union([z.string().trim().min(16).max(200), z.literal("")]).optional(),
    /** תיבת התמיכה של הפלטפורמה — שרת Inbound נפרד מזה של המשרדים */
    supportInboundAddress: OptionalEmailSchema.optional(),
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
    /**
     * ‎**`standard` ולא `""`.** מחרוזת ריקה בנתיב הזה פירושה „מחק את
     * השורה, חזור למשתנה הסביבה”, ולכן היא לא יכלה לשאת בחירה —
     * ‏„רגיל” היה נמחק והדו-קיום היה חוזר בשקט (ביקורת Codex).
     */
    whatsappSignupFeatureType: z
      .union([z.literal("whatsapp_business_app_onboarding"), z.literal("standard")])
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
    /** תבנית הסיכום החודשי לסוכן — פנייה יזומה, מחוץ לחלון */
    whatsappOfficeDigestTemplate: z
      .union([z.string().trim().regex(/^[a-z0-9_]{1,512}$/u), z.literal("")])
      .optional(),
    whatsappOfficeDigestTemplateLang: z
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
    /** התבנית נרשמה עם שורה לכל עדכון ולא עם פירוט אחד */
    whatsappNotifyTemplateLines: z.boolean().optional(),
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
    supportEmail: OptionalEmailSchema.optional(),

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
    legalPrivacyEmail: OptionalEmailSchema.optional(),
    legalAccessibilityEmail: OptionalEmailSchema.optional(),
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
 * ‏הגדרות הפלטפורמה — קריאה ועדכון, ובדיקות החיבור לספקים (מייל,
 * ‏סליקה, חשבוניות, וואטסאפ, Gemini) ולשרשרת התשובות במייל.
 *
 * ‏אחד מארבעה בקרים תחת `/platform`, כולם מאחורי `PlatformAdminGuard` —
 * ‏פוצלו מבקר אחד של 3,600 שורות לפי תחום, בלי שינוי בנתיבים או בשערים.
 */
@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class PlatformSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly email: EmailService,
    private readonly plans: PlanCatalogService,
    private readonly cardcom: CardcomService,
    private readonly geocoding: GeocodingService,
    private readonly creditEconomy: CreditEconomyService,
    private readonly gemini: GeminiService,
    private readonly whatsappSender: WhatsAppSendService,
    private readonly pbx015: Pbx015NumbersService,
    private readonly linet: LinetService,
    /* ‏רק ל-`inboundConfig()` — מקור אמת אחד ל„כתובת קליטה + סוד”. */
    private readonly emailInbox: EmailInboxService,
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
   * הגדרות הפלטפורמה — מצב בלבד, בלי לחשוף ערכים. מפתחות שהוגדרו
   * במשתני סביבה מסומנים כמקור "env" (נשלטים מהשרת, לא מהמסך).
   */
  /**
   * ‎**„למה התשובה של הלקוח הגיעה לתמיכה?” — כפתור שעונה על זה.**
   *
   * ‏מסך ההגדרות מראה שדות: כתובת קליטה מלאה, סוד מוגדר. שדות מלאים
   * ‏אינם מוכיחים ששרשרת התשובה עובדת — כתובת כמו `reply+office@…`
   * ‏נראית תקינה לחלוטין, עוברת את בניית ה-`Reply-To`, והספק מחזיר
   * ‏ממנה טוקן מעוות; **כל** תשובה של **כל** לקוח נופלת אז לתמיכה,
   * ‏ושום שדה במסך אינו נראה שגוי. לכן הבדיקה מריצה את הכתובת
   * ‏האמיתית דרך אותן פונקציות שרצות בשליחה ובקליטה, ומפרקת את
   * ‏התוצאה כפי שהספק מפרק אותה.
   *
   * ‎**ומה שהיא אינה קוראת חשוב לא פחות.** היא אינה נוגעת בהודעות,
   * ‏בפניות או בכרטיסים של אף משרד. המונה היחיד שהיא קוראת הוא
   * ‏`email_reply_tokens` — טבלה שבמכוון אינה תחת RLS ואין בה PII
   * ‏(טוקן אקראי ומזהים בלבד; שמות וטלפונים חיים ב-contacts
   * ‏המוצפנת). המונה עונה על השאלה הראשונה שצריך לשאול: האם בכלל
   * ‏יצא אי פעם מייל עם כתובת תשובה.
   */
  @Get("email-reply-chain")
  async emailReplyChain(): Promise<{
    chain: ReplyChainResult;
    /** הסוד מוגדר. הערך עצמו לעולם אינו חוזר בשום נתיב. */
    secretSet: boolean;
    outgoing: {
      /** כמה כתובות תשובה הונפקו אי פעם. 0 = שום מייל לא נשא Reply-To. */
      tokensIssued: number;
      /** מתי הונפקה האחרונה — `null` כשאין אף אחת. */
      lastIssuedAt: string | null;
    };
    verdict: string;
  }> {
    /*
     * ‏דרך `inboundConfig()` ולא בקריאה ישירה להגדרות: הכלל „צריך
     * ‏גם כתובת וגם סוד” הוא בדיוק מה שמכריע אם `replyAddressFor`
     * ‏יחזיר כתובת, ועותק שני שלו כאן היה יכול לומר „מוגדר” על מה
     * ‏שהשליחה רואה כלא מוגדר.
     */
    const config = await this.emailInbox.inboundConfig();
    const chain = checkReplyChain(config?.address ?? null);
    const [tokensIssued, newest] = await Promise.all([
      this.prisma.emailReplyToken.count(),
      this.prisma.emailReplyToken.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    return {
      chain,
      secretSet: config !== null,
      outgoing: {
        tokensIssued,
        lastIssuedAt: newest?.createdAt.toISOString() ?? null,
      },
      verdict: replyChainVerdict({ chainOk: chain.ok, tokensIssued }),
    };
  }

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
        /** איזו זרימה הפופאפ פותח — דו-קיום או Embedded Signup רגיל */
        signupFeatureType: string;
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
        /**
         * ‎**הכתובת שצריך לרשום ב-Meta לכפתור, מילה במילה, ולאן
         * ‏היא נוחתת.** החצי הזה נקבע בעורך התבניות של Meta ולא
         * ‏במאגר, ולכן המסך הציג עד היום תיאור שלו („כתובת הבסיס
         * ‏ואחריה {{1}}”) ולא אותו. תיאור מזמין את הצורה השגויה —
         * ‏בסיס בלי לוכסן, או בסיס עם מקטע נוסף — ואז כל לחיצה על
         * ‏„פתח במערכת” נוחתת על „העמוד לא נמצא”.
         */
        notifyTemplateButtonUrl: string;
        /** דוגמה מלאה: לאן נוחתת לחיצה בהתראה על נכס */
        notifyTemplateButtonExample: string;
        /** התבנית נושאת שורה לכל עדכון; חסר/false = פירוט אחד */
        notifyTemplateLines: boolean;
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
        officeDigestTemplate: string;
        officeDigestTemplateLang: string;
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
    /*
     * ריק במסד = ברירת המחדל של הקוד (דו-קיום), ולא „ES רגיל”.
     * ההבחנה נשמרת כאן כדי שהמסך יציג את מה שיקרה בפועל.
     */
    const waSignupFeatureChoice =
      (await this.platformSettings.get("whatsappSignupFeatureType")) ??
      env.WHATSAPP_SIGNUP_FEATURE_TYPE ??
      "whatsapp_business_app_onboarding";
    /* המסך מציג את שתי האפשרויות בלבד; `""` בסביבה הוא „רגיל” */
    const waSignupFeatureType =
      waSignupFeatureChoice === "whatsapp_business_app_onboarding"
        ? "whatsapp_business_app_onboarding"
        : "standard";
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
          signupFeatureType: waSignupFeatureType,
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
           * ‏נגזר מ-`WEB_ORIGIN` ולא נשמר: ערך שמור הוא עותק שני
           * ‏של מה שכבר ידוע, ושניים כאלה נפרדים ביום שהדומיין
           * ‏משתנה.
           */
          notifyTemplateButtonUrl: whatsappButtonUrlTemplate(env.WEB_ORIGIN),
          notifyTemplateButtonExample: whatsappButtonLandsOn(
            whatsappButtonUrlTemplate(env.WEB_ORIGIN),
            whatsappDeepLinkSuffix("/properties/01HQ0000000000000000000001"),
          ),
          /*
           * ‎**ברירת המחדל היא הפירוט האחד**: זה מה שנרשם עד היום,
           * ומעבר שקט לשורות היה שולח חמישה שמות לתבנית שיש בה
           * שניים — כלומר שקט מוחלט בהתראות.
           */
          notifyTemplateLines:
            (await this.platformSettings.get("whatsappNotifyTemplateLines")) === "true",
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
          /* ריק = הסיכום החודשי מגיע בהתראות בלבד למי שמחוץ לחלון */
          officeDigestTemplate:
            (await this.platformSettings.get("whatsappOfficeDigestTemplate")) ?? "",
          officeDigestTemplateLang:
            (await this.platformSettings.get("whatsappOfficeDigestTemplateLang")) ?? "he",
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
   * ‎**שליחת הודעת בדיקה אמיתית — מה שהבדיקה שמעליה אינה מוכיחה.**
   *
   * ‏קריאת פרטי המספר עוברת בהצלחה גם כשהטוקן חסר את הרשאת
   * השליחה, וגם כשהמספר אינו ברשימת הבדיקה במצב Development. שני
   * המקרים מתגלים היום רק בהודעה הראשונה של מתווך אמיתי — כלומר
   * במקום הגרוע ביותר. הודעה שיוצאת באמת היא הראיה היחידה.
   *
   * ‏הנוסח קבוע בשירות ואינו מגיע מכאן: המסך מוסר מספר בלבד, כדי
   * שזה יישאר בדיקת חיבור ולא כלי לשליחת טקסט חופשי לכל מספר.
   */
  @Post("settings/test-whatsapp-send")
  @HttpCode(200)
  async testWhatsAppSend(
    @Body(
      new ZodValidationPipe(
        z.object({
          /*
           * תחביר של מספר בלבד. אורך לבדו קיבל גם „abc0501234567”,
           * והנרמול שמסיר אותיות היה הופך אותו למספר תקין של מישהו
           * אחר — כלומר הודעה לאדם זר (ביקורת Codex).
           */
          to: z
            .string()
            .trim()
            .regex(/^\+?[\d\s()-]{6,20}$/u, "מספר לא תקין"),
        }),
      ),
    )
    body: { to: string },
  ): Promise<{ ok: boolean; message: string }> {
    return this.whatsappSender.probeSend(body.to);
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
}
