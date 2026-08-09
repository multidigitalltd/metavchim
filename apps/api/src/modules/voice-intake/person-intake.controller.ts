import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import {
  BuyerMaturitySchema,
  FinancingStatusSchema,
  LeadIntentSchema,
  parseAppointmentKind,
  parseHebrewDateTime,
  parseOfferTargets,
  PhoneSchema,
  routeVoiceCommand,
  stripCommandPrefix,
  type VoiceCommand,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { BuyerDto } from "../buyers/buyers.service";
import { OfferIntakeService, type OfferResolution } from "./offer-intake.service";
import {
  PersonIntakeService,
  type LeadIntakeResult,
  type PersonIntakePreview,
} from "./person-intake.service";

const TranscriptSchema = z.object({ transcript: z.string().min(2).max(4000) }).strict();

const PreviewSchema = TranscriptSchema.extend({
  target: z.enum(["lead", "buyer"]),
}).strict();

const CreateLeadSchema = z
  .object({
    transcript: z.string().min(2).max(4000),
    name: z.string().min(2).max(120),
    phone: PhoneSchema,
    intent: LeadIntentSchema,
  })
  .strict();

const CreateBuyerSchema = z
  .object({
    transcript: z.string().min(2).max(4000),
    name: z.string().min(2).max(120),
    phone: PhoneSchema,
    cities: z.array(z.string().min(1).max(80)).min(1),
    dealType: z.enum(["sale", "rent"]),
    budgetMaxAgorot: z.number().int().positive(),
    budgetMinAgorot: z.number().int().nonnegative().optional(),
    roomsMin: z.number().multipleOf(0.5).min(1).max(20).optional(),
    roomsMax: z.number().multipleOf(0.5).min(1).max(20).optional(),
    areaSqmMin: z.number().int().min(10).max(2000).optional(),
    features: z
      .record(
        z.enum(["hasElevator", "hasParking", "hasBalcony", "hasSafeRoom", "hasStorage"]),
        z.enum(["must", "nice"]),
      )
      .default({}),
    maturity: BuyerMaturitySchema.optional(),
    financing: FinancingStatusSchema.optional(),
  })
  .strict();

/**
 * קליטה בקול של אנשים (ליד/קונה) + ניתוב פקודות קוליות כלליות.
 * הזרימה תמיד דו-שלבית: חילוץ ⟵ אישור המתווך ⟵ יצירה. פעולה
 * לעולם לא מתבצעת ישירות מהדיבור.
 */
/*
 * אותו שער של /voice-intakes.
 *
 * הדפדפן יכול לייצר תמלול בעצמו (Speech Recognition) בלי לעבור
 * בנתיב המתומלל בשרת, ואז /voice/preview, /voice/buyers ו-/voice/leads
 * היו ממשיכים לחלץ וליצור רשומות — כלומר קליטה קולית שממשיכה לעבוד
 * אחרי שהפיצ'ר בוטל במסלול (ביקורת Codex).
 */
@RequireFeature("voice_intake")
@Controller("voice")
export class PersonIntakeController {
  constructor(
    private readonly service: PersonIntakeService,
    private readonly offers: OfferIntakeService,
  ) {}

  /** מה המתווך ביקש לעשות — לניתוב במסך הפקודה הקולית. */
  @Post("route")
  @HttpCode(200)
  @RequireCapability("properties.view")
  route(
    @Body(new ZodValidationPipe(TranscriptSchema)) body: z.infer<typeof TranscriptSchema>,
  ): VoiceCommand & {
    content: string;
    /** לפגישה: התאריך והסוג שזוהו — למילוי מראש של הטופס */
    appointment?: { startsAt?: string; timeExplicit: boolean; kind: string };
  } {
    const command = routeVoiceCommand(body.transcript);
    const base = { ...command, content: stripCommandPrefix(body.transcript) };
    if (command.action !== "schedule_appointment") return base;

    const parsed = parseHebrewDateTime(body.transcript, new Date());
    return {
      ...base,
      appointment: {
        ...(parsed.date ? { startsAt: parsed.date.toISOString() } : {}),
        timeExplicit: parsed.timeExplicit,
        kind: parseAppointmentKind(body.transcript),
      },
    };
  }

  /**
   * זיהוי נכס+קונה לשליחת הצעה — החזרת מועמדים לאישור בלבד.
   * היצירה והשליחה נעשות במסלול ההצעות הרגיל, אחרי לחיצה מפורשת.
   */
  @Post("offer-resolve")
  @HttpCode(200)
  @RequireCapability("offers.send")
  async offerResolve(
    @Body(new ZodValidationPipe(TranscriptSchema)) body: z.infer<typeof TranscriptSchema>,
  ): Promise<OfferResolution> {
    const targets = parseOfferTargets(body.transcript.replace(/\s+/gu, " ").trim());
    return this.offers.resolve(targets);
  }

  @Post("preview")
  @HttpCode(200)
  @RequireCapability("properties.view")
  preview(
    @Body(new ZodValidationPipe(PreviewSchema)) body: z.infer<typeof PreviewSchema>,
  ): PersonIntakePreview {
    return this.service.preview(body.transcript, body.target);
  }

  @Post("leads")
  @RequireCapability("leads.edit")
  async createLead(
    @Body(new ZodValidationPipe(CreateLeadSchema)) body: z.infer<typeof CreateLeadSchema>,
  ): Promise<LeadIntakeResult> {
    return this.service.createLead(body);
  }

  @Post("buyers")
  @RequireCapability("buyers.edit")
  async createBuyer(
    @Body(new ZodValidationPipe(CreateBuyerSchema)) body: z.infer<typeof CreateBuyerSchema>,
  ): Promise<BuyerDto> {
    return this.service.createBuyer(body);
  }
}
