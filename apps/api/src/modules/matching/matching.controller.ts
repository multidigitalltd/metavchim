import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  DISMISS_REASONS,
  IdSchema,
  MAX_DISMISS_NOTE,
  PARTNER_PAIR_LIMIT,
  type DismissReason,
  type DismissReport,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MatchRefreshService } from "./match-refresh.service";
import {
  MatchingService,
  type EnrichedMatchDto,
  type PartnerPairDto,
} from "./matching.service";

/*
 * `satisfies` ולא רשימה חופשית: סיבה שאינה בקטלוג תישמר במסד ותיעלם
 * מהדוח בלי שאיש ישים לב, ולכן היא נדחית בשער.
 */
const DismissReasonSchema = z.enum(DISMISS_REASONS) satisfies z.ZodType<DismissReason>;

/**
 * הסיבה אופציונלית בחוזה ונדרשת במסך.
 *
 * לקוח ישן של ה-API שממשיך לשלוח גוף ריק לא יישבר, אבל שום מסך
 * שלנו לא דוחה בלי סיבה — אחרת הדוח יתמלא בדחיות ריקות והתועלת
 * שלו תלך לאיבוד בדיוק כמו קודם.
 */
const DismissSchema = z
  .object({
    reason: DismissReasonSchema.optional(),
    note: z.string().trim().max(MAX_DISMISS_NOTE).optional(),
  })
  .strict();

const ReportQuerySchema = z
  .object({ days: z.coerce.number().int().min(1).max(365).default(90) })
  .strict();

const PartnersQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(PARTNER_PAIR_LIMIT).default(PARTNER_PAIR_LIMIT) })
  .strict();

const ListQuerySchema = z
  .object({
    minScore: z.coerce.number().int().min(0).max(100).default(50),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    /** סינון לנכס אחד — הגעה ישירה מ"17 קונים מתאימים" ברשימת הנכסים */
    propertyId: IdSchema.optional(),
  })
  .strict();

@Controller("matches")
export class MatchingController {
  constructor(
    private readonly matching: MatchingService,
    private readonly refresh: MatchRefreshService,
  ) {}

  @Get()
  @RequireCapability("matches.view")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<EnrichedMatchDto[]> {
    return this.matching.listAll(query);
  }

  /** "סמן לא רלוונטי" — פעולת כתיבה; viewer (צפייה בלבד) חסום (ביקורת Codex). */
  @Patch(":id/dismiss")
  @RequireCapability("matches.manage")
  @HttpCode(200)
  async dismiss(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(DismissSchema)) body: z.infer<typeof DismissSchema>,
  ): Promise<{ ok: true }> {
    await this.matching.dismiss(
      id,
      body.reason === undefined
        ? undefined
        : { reason: body.reason, ...(body.note === undefined ? {} : { note: body.note }) },
    );
    return { ok: true };
  }

  /**
   * מצב סבב הרענון — מתי רצה לאחרונה ומה הוא עשה.
   *
   * `settings.manage` ולא `matches.view`: הכרטיס יושב ליד משקלי
   * ההתאמה, והפעולה שהוא מזמין היא הפעלת סבב — כלומר מי שרשאי לשנות
   * הוא מי שצריך לראות.
   */
  @Get("refresh")
  @RequireCapability("settings.manage")
  async refreshStatus(): Promise<Awaited<ReturnType<MatchRefreshService["statusFor"]>>> {
    return this.refresh.statusFor(TenantContext.current().tenantId, new Date());
  }

  /**
   * "חשב התאמות מחדש" — הסבב בלחיצה, בלי לחכות לסבב היומי.
   *
   * הבקשה **ממתינה** לסיום ואינה משחררת מיד: מנהל שלחץ רוצה לראות
   * את המספר החדש, ותשובת "התחלנו" הייתה מחזירה אותו לרענן את המסך
   * ולנחש מתי נגמר. הסבב חסום בתקרת נכסים, ולכן זמנו חסום.
   */
  @Post("refresh")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async refreshNow(): Promise<Awaited<ReturnType<MatchRefreshService["statusFor"]>>> {
    const tenantId = TenantContext.current().tenantId;
    await this.refresh.refreshTenant(tenantId, "manual");
    return this.refresh.statusFor(tenantId, new Date());
  }

  /**
   * "למה התאמות נדחות" — הדוח שמכייל את המשקלים.
   *
   * `settings.manage` ולא `analytics.view`: הדוח יושב ליד משקלי
   * ההתאמה ומסקנתו היא לשנות אותם, ולכן מי שרשאי לשנות הוא מי
   * שצריך לראות. אין בו נתוני לקוחות — ספירת סיבות בלבד.
   */
  /**
   * ‏שידוך שותפים לנכס בטאבו משותף.
   *
   * ‎`matches.view` ולא יכולת חדשה: זו אותה שאלה שהמנוע עונה עליה
   * ‏— „מי מתאים לנכס הזה” — בהרכב של שניים. הסינון לפי בעלות על
   * ‏הקונים נעשה בשירות, ולכן סוכן ומנהל מקבלים כאן שתי רשימות
   * ‏שונות מאותו נתיב, בדיוק כמו ברשימת ההתאמות.
   */
  @Get("property/:propertyId/partners")
  @RequireCapability("matches.view")
  async partners(
    @Param("propertyId", new ZodValidationPipe(IdSchema)) propertyId: string,
    @Query(new ZodValidationPipe(PartnersQuerySchema))
    query: z.infer<typeof PartnersQuerySchema>,
  ): Promise<PartnerPairDto[]> {
    return this.matching.partnersForProperty(propertyId, query.limit);
  }

  @Get("dismiss-report")
  @RequireCapability("settings.manage")
  async dismissReport(
    @Query(new ZodValidationPipe(ReportQuerySchema)) query: z.infer<typeof ReportQuerySchema>,
  ): Promise<DismissReport> {
    return this.matching.dismissReport(query.days);
  }
}
