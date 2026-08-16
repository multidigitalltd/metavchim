import { Body, Controller, Get, HttpCode, Param, Patch, Query } from "@nestjs/common";
import { z } from "zod";
import {
  DISMISS_REASONS,
  IdSchema,
  MAX_DISMISS_NOTE,
  type DismissReason,
  type DismissReport,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MatchingService, type EnrichedMatchDto } from "./matching.service";

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
  constructor(private readonly matching: MatchingService) {}

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
   * "למה התאמות נדחות" — הדוח שמכייל את המשקלים.
   *
   * `settings.manage` ולא `analytics.view`: הדוח יושב ליד משקלי
   * ההתאמה ומסקנתו היא לשנות אותם, ולכן מי שרשאי לשנות הוא מי
   * שצריך לראות. אין בו נתוני לקוחות — ספירת סיבות בלבד.
   */
  @Get("dismiss-report")
  @RequireCapability("settings.manage")
  async dismissReport(
    @Query(new ZodValidationPipe(ReportQuerySchema)) query: z.infer<typeof ReportQuerySchema>,
  ): Promise<DismissReport> {
    return this.matching.dismissReport(query.days);
  }
}
