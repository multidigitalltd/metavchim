import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import {
  IdSchema,
  MARKETING_ACTION_KINDS,
  MIN_BROKERS_FOR_NETWORK_ACTION,
  MIN_MARKETING_ACTIONS,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  ExclusivityService,
  type ExclusivityDto,
  type ExclusivityListItem,
} from "./exclusivity.service";

const StartSchema = z
  .object({
    subject: z.enum(["apartment", "other"]),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    agreedCustomAction: z.boolean().default(false),
    agreementId: IdSchema.optional(),
  })
  .strict();

const ActionSchema = z
  .object({
    kind: z.enum(MARKETING_ACTION_KINDS),
    performedAt: z.coerce.date(),
    detail: z.string().max(300).optional(),
    evidenceUrl: z.string().url().max(500).optional(),
    /*
     * חסם עליון שפוי: המספר משמש לספירה מצטברת מול הסף שבתקנות,
     * ו-"שלחתי ל-9999 מתווכים" הוא מספר שאיש לא יוכל להגן עליו.
     */
    brokerCount: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const EndSchema = z.object({ reason: z.enum(["cancelled", "sold", "expired"]) }).strict();

/**
 * תיק הבלעדיות.
 *
 * ההרשאות הן של הנכס עצמו (`properties.view/edit`) ולא יכולת חדשה:
 * בלעדיות היא תכונה של הנכס, ומי שמורשה לערוך אותו מורשה לנהל את
 * הבלעדיות עליו. יכולת נפרדת הייתה מחייבת מיגרציה של תפקידים בלי
 * להוסיף שום הבחנה אמיתית.
 */
@Controller()
export class ExclusivityController {
  constructor(private readonly exclusivity: ExclusivityService) {}

  /** הבלעדיויות הפתוחות של המשרד — הדחוף קודם. */
  @Get("exclusivity")
  @RequireCapability("properties.view")
  async list(): Promise<{ items: ExclusivityListItem[]; minActions: number; minBrokers: number }> {
    return {
      items: await this.exclusivity.list(),
      minActions: MIN_MARKETING_ACTIONS,
      minBrokers: MIN_BROKERS_FOR_NETWORK_ACTION,
    };
  }

  @Get("properties/:id/exclusivity")
  @RequireCapability("properties.view")
  async current(@Param("id") id: string): Promise<{ exclusivity: ExclusivityDto | null }> {
    return { exclusivity: await this.exclusivity.current(id) };
  }

  @Post("properties/:id/exclusivity")
  @HttpCode(201)
  @RequireCapability("properties.edit")
  async start(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(StartSchema)) body: z.infer<typeof StartSchema>,
  ): Promise<ExclusivityDto> {
    return this.exclusivity.start(id, {
      subject: body.subject,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      agreedCustomAction: body.agreedCustomAction,
      ...(body.agreementId === undefined ? {} : { agreementId: body.agreementId }),
    });
  }

  @Post("exclusivity/:id/end")
  @HttpCode(200)
  @RequireCapability("properties.edit")
  async end(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EndSchema)) body: z.infer<typeof EndSchema>,
  ): Promise<{ ok: true }> {
    await this.exclusivity.end(id, body.reason);
    return { ok: true };
  }

  @Post("properties/:id/exclusivity/actions")
  @HttpCode(201)
  @RequireCapability("properties.edit")
  async logAction(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ActionSchema)) body: z.infer<typeof ActionSchema>,
  ): Promise<ExclusivityDto> {
    return this.exclusivity.logAction(id, {
      kind: body.kind,
      performedAt: body.performedAt,
      ...(body.detail === undefined ? {} : { detail: body.detail }),
      ...(body.evidenceUrl === undefined ? {} : { evidenceUrl: body.evidenceUrl }),
      ...(body.brokerCount === undefined ? {} : { brokerCount: body.brokerCount }),
    });
  }

  @Delete("exclusivity/actions/:id")
  @HttpCode(204)
  @RequireCapability("properties.edit")
  async removeAction(@Param("id") id: string): Promise<void> {
    await this.exclusivity.removeAction(id);
  }
}
