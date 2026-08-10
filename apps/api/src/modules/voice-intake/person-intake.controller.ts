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
  taskTitleFromTranscript,
  type VoiceCommand,
} from "@metavchim/shared";
import { GeminiService } from "../../core/gemini.service";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { BuyerDto } from "../buyers/buyers.service";
import { OfferIntakeService, type OfferResolution } from "./offer-intake.service";
import {
  PersonIntakeService,
  type BuyerQueryAnswer,
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
/** מה ש-Gemini רשאי להחזיר — כל מה שמחוץ לזה נזרק, לא מנוחש. */
const LlmRouteSchema = z
  .object({
    action: z.enum([
      "add_property",
      "add_buyer",
      "add_lead",
      "schedule_appointment",
      "add_task",
      "query_buyers",
      "send_offer",
      "search",
      "unknown",
    ]),
    content: z.string().max(2000).optional(),
    query: z.string().max(300).optional(),
    offer: z
      .object({
        propertyPhrase: z.string().max(200).optional(),
        buyerPhrase: z.string().max(200).optional(),
      })
      .optional(),
    appointmentKind: z.enum(["viewing", "meeting", "call"]).optional(),
    /** לתזכורת: כותרת המשימה בלי מילות הפקודה. המועד לעולם לא מכאן. */
    taskTitle: z.string().max(200).optional(),
  })
  .passthrough();

@RequireFeature("voice_intake")
@Controller("voice")
export class PersonIntakeController {
  constructor(
    private readonly service: PersonIntakeService,
    private readonly offers: OfferIntakeService,
    private readonly gemini: GeminiService,
  ) {}

  /** מה המתווך ביקש לעשות — לניתוב במסך הפקודה הקולית. */
  @Post("route")
  @HttpCode(200)
  @RequireCapability("properties.view")
  async route(
    @Body(new ZodValidationPipe(TranscriptSchema)) body: z.infer<typeof TranscriptSchema>,
  ): Promise<
    VoiceCommand & {
      content: string;
      /** לפגישה: התאריך והסוג שזוהו — למילוי מראש של הטופס */
      appointment?: { startsAt?: string; timeExplicit: boolean; kind: string };
      /** לתזכורת: כותרת ומועד שזוהו — נוצרת רק אחרי אישור במסך */
      task?: { title: string; dueAt?: string; timeExplicit: boolean };
    }
  > {
    /*
     * Gemini קודם, חוקים כנפילה-לאחור — **וגם כמכריע**.
     *
     * ה-LLM טוב ממנוע החוקים בזיהוי הכוונה בניסוח חופשי, אבל הוא
     * מנחש בתאריכים ("יום שלישי הקרוב" דורש לוח שנה, לא שפה). לכן
     * הכוונה נלקחת ממנו, והתאריך תמיד מחושב אצלנו, דטרמיניסטית,
     * בשעון ירושלים. כל כשל — אין מפתח, timeout, JSON לא צפוי —
     * מחזיר בשקט את החוקים, שעובדים היום.
     */
    const llm = await this.routeViaLlm(body.transcript);
    if (llm) return llm;

    const command = routeVoiceCommand(body.transcript);
    const base = { ...command, content: stripCommandPrefix(body.transcript) };
    if (command.action === "add_task") {
      return { ...base, task: this.taskDraft(body.transcript) };
    }
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

  /** טיוטת תזכורת: כותרת מהמשפט (או מה-LLM), מועד תמיד מהמנוע שלנו. */
  private taskDraft(
    transcript: string,
    llmTitle?: string,
  ): { title: string; dueAt?: string; timeExplicit: boolean } {
    const when = parseHebrewDateTime(transcript, new Date());
    const title = (llmTitle?.trim() || taskTitleFromTranscript(transcript)).slice(0, 200);
    return {
      title,
      ...(when.date ? { dueAt: when.date.toISOString() } : {}),
      timeExplicit: when.timeExplicit,
    };
  }

  /** ניתוב דרך Gemini. null = לא מוגדר או נכשל — נופלים לחוקים. */
  private async routeViaLlm(transcript: string): Promise<
    | (VoiceCommand & {
        content: string;
        appointment?: { startsAt?: string; timeExplicit: boolean; kind: string };
        task?: { title: string; dueAt?: string; timeExplicit: boolean };
      })
    | null
  > {
    if (!(await this.gemini.isConfigured())) return null;
    const raw = await this.gemini.generateJson(
      [
        "אתה מנתב פקודות במערכת CRM למתווכי נדל\"ן. נתח את המשפט וחזור JSON בלבד.",
        'שדות: action (אחד מ: add_property, add_buyer, add_lead, schedule_appointment, add_task, query_buyers, send_offer, search, unknown),',
        'content (המשפט בלי מילות הפקודה), query (לחיפוש בלבד),',
        'offer (לשליחת הצעה: {propertyPhrase, buyerPhrase}),',
        'appointmentKind (לפגישה: viewing/meeting/call),',
        'taskTitle (לתזכורת בלבד: מה להזכיר, בלי "תזכיר לי").',
        'add_task = בקשת תזכורת/משימה ("תזכיר לי…").',
        'query_buyers = כל שאלה או חיפוש של קונים במאגר לפי קריטריונים — "מי מחפש 4 חדרים", "תחפש קונים ארבע חדרים בגבעתיים", "יש לי קונים עד 2 מיליון?". search = חיפוש אדם/נכס ספציפי בשמו.',
        "אל תנחש: אם הכוונה אינה ברורה החזר unknown. אל תמציא שדות.",
        `המשפט: "${transcript.replaceAll('"', "'")}"`,
      ].join("\n"),
    );
    const parsed = LlmRouteSchema.safeParse(raw);
    if (!parsed.success) return null;
    const out = parsed.data;
    const base: VoiceCommand & { content: string } = {
      action: out.action,
      // ה-LLM זיהה בניסוח חופשי — מהימנות גבוהה מהותית מניחוש regex
      confidence: "high",
      matched: transcript.slice(0, 60),
      content: out.content?.trim() || stripCommandPrefix(transcript),
      ...(out.action === "search" && out.query ? { query: out.query } : {}),
      ...(out.action === "send_offer" && out.offer
        ? {
            offer: {
              ...(out.offer.propertyPhrase ? { propertyPhrase: out.offer.propertyPhrase } : {}),
              ...(out.offer.buyerPhrase ? { buyerPhrase: out.offer.buyerPhrase } : {}),
            },
          }
        : {}),
    };
    if (out.action === "unknown") return null; // אולי החוקים דווקא מכירים
    if (out.action === "add_task") {
      return { ...base, task: this.taskDraft(transcript, out.taskTitle) };
    }
    if (out.action !== "schedule_appointment") return base;

    // התאריך תמיד מהמנוע הדטרמיניסטי — לוח שנה אינו עניין של ניסוח
    const when = parseHebrewDateTime(transcript, new Date());
    return {
      ...base,
      appointment: {
        ...(when.date ? { startsAt: when.date.toISOString() } : {}),
        timeExplicit: when.timeExplicit,
        kind: out.appointmentKind ?? parseAppointmentKind(transcript),
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

  /**
   * "מי מחפש 4 חדרים בגבעתיים?" — תשובה אמיתית מהמאגר: חילוץ
   * קריטריונים + הפילטר של מסך הקונים. קריאה בלבד, אותה יכולת כמו
   * רשימת הקונים עצמה (עם ownershipFilter בפנים — סוכן view_own
   * רואה רק את הקונים שלו גם כאן).
   */
  @Post("query-buyers")
  @HttpCode(200)
  @RequireCapability("buyers.view_own")
  async queryBuyers(
    @Body(new ZodValidationPipe(TranscriptSchema)) body: z.infer<typeof TranscriptSchema>,
  ): Promise<BuyerQueryAnswer> {
    return this.service.queryBuyers(body.transcript);
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
