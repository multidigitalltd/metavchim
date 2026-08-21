import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AgentUsageService, type AgentUsageReport } from "./agent-usage.service";

/**
 * דוח השימוש והעלות של הסוכן — לבעל הפלטפורמה בלבד.
 *
 * בקר נפרד מ-`PlatformController` רק בגלל גודלו של האחרון; השערים
 * זהים — `PlatformAdminGuard` מעל התחברות רגילה.
 */

/**
 * חלון הדוח — עד 90 יום.
 *
 * לא בגלל ביצועים בלבד: הצבירה רצה משרד-משרד, וחלון פתוח היה הופך
 * את הנתיב לכלי עומס. 90 יום מספיקים לראות מגמה של עלות.
 */
const WindowSchema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(30),
  })
  .strict();

/** תקרת שורות הייצוא — קובץ אימון, לא dump של המסד. */
const EXPORT_MAX_ROWS = 50_000;

@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class AgentUsageController {
  constructor(private readonly usage: AgentUsageService) {}

  @Get("agent-usage")
  async report(
    @Query(new ZodValidationPipe(WindowSchema)) query: z.infer<typeof WindowSchema>,
  ): Promise<AgentUsageReport> {
    return this.usage.report(query.days);
  }

  /**
   * הורדת דאטת האימון — JSONL.
   *
   * הקובץ נשלח כהורדה ולא כ-JSON בגוף: אלה אלפי שורות שמיועדות לכלי
   * כוונון, לא למסך. השם נושא את החלון כדי ששני ייצואים לא יתערבבו.
   */
  @Get("agent-usage/export")
  async exportJsonl(
    @Query(new ZodValidationPipe(WindowSchema)) query: z.infer<typeof WindowSchema>,
    @Res() res: Response,
  ): Promise<void> {
    const body = await this.usage.exportJsonl(query.days, EXPORT_MAX_ROWS);
    res
      .status(200)
      .setHeader("content-type", "application/x-ndjson; charset=utf-8")
      .setHeader(
        "content-disposition",
        `attachment; filename="agent-training-${query.days}d.jsonl"`,
      )
      .send(body);
  }
}
