import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ulid } from "ulid";
import { z } from "zod";
import {
  PRACTICE_DAILY_CAP,
  PRACTICE_FEEDBACK_JSON_SCHEMA,
  PRACTICE_MAX_AGENT_TURNS,
  PRACTICE_REPLY_JSON_SCHEMA,
  buildPracticeFeedbackPrompt,
  buildPracticeReplyPrompt,
  jerusalemDayRange,
  practiceChecklist,
  practiceFallbackFeedback,
  practiceFallbackReply,
  practiceModelFeedback,
  practiceOpening,
  practiceScenario,
  resolveMentorPersona,
  type MentorPracticeFeedback,
  type PracticeScenario,
  type PracticeScenarioInfo,
  type PracticeTurn,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { GeminiService } from "../../core/gemini.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { AgentEventsService } from "../agent/agent-events.service";

const MODEL_TIMEOUT_MS = 20_000;

const ReplySchema = z
  .object({ reply: z.string().trim().min(1).max(600), closing: z.boolean() })
  .strict();
const FeedbackSchema = z
  .object({
    worked: z.array(z.string().trim().min(1).max(300)).max(6),
    missed: z.array(z.string().trim().min(1).max(300)).max(6),
    tryNext: z.string().trim().min(3).max(400),
    score: z.number().int().min(1).max(5),
  })
  .strict();

export interface MentorPracticeDto {
  id: string;
  scenario: PracticeScenario;
  scenarioLabel: string;
  counterpartName: string;
  turns: PracticeTurn[];
  agentTurns: number;
  feedback: MentorPracticeFeedback | null;
  createdAt: Date;
  endedAt: Date | null;
}

/** מה המסך טוען — התרגול הפתוח (אם יש) והאחרונים שנגמרו. */
export interface MentorPracticeOverview {
  active: MentorPracticeDto | null;
  recent: MentorPracticeDto[];
}

/** מה הסיכום השבועי והשיחה צריכים לדעת על התרגולים. */
export interface MentorPracticeStats {
  count: number;
  last: {
    scenarioLabel: string;
    score: number;
    tryNext: string;
    endedAt: Date;
  } | null;
}

interface PracticeRow {
  id: string;
  scenario: string;
  turns: unknown;
  agentTurns: number;
  feedback: unknown;
  createdAt: Date;
  endedAt: Date | null;
}

/**
 * תרגול שיחה — המנטור משחק את הצד השני ונותן משוב (docs/14 §7.3).
 *
 * המודל מציע, הקוד מכריע: הדמות עונה מהמודל כשיש, ומשלוש תשובות
 * קבועות כשאין; המשוב הוא הרשימה של הקוד תמיד, והמודל מוסיף עליה.
 * אותה מכסה יומית כמו השיחה, ואותו יומן אסימונים.
 */
@Injectable()
export class MentorPracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
    private readonly events: AgentEventsService,
  ) {}

  async overview(): Promise<MentorPracticeOverview> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const [active, recent] = await Promise.all([
        tx.mentorPractice.findFirst({
          where: { tenantId, userId, endedAt: null },
          orderBy: { createdAt: "desc" },
        }),
        tx.mentorPractice.findMany({
          where: { tenantId, userId, endedAt: { not: null } },
          orderBy: { endedAt: "desc" },
          take: 5,
        }),
      ]);
      return {
        active: active === null ? null : MentorPracticeService.dto(active),
        recent: recent.map(MentorPracticeService.dto),
      };
    });
  }

  async start(scenarioCode: string): Promise<MentorPracticeDto> {
    const ctx = TenantContext.current();
    if (ctx.billingOnly) throw new ForbiddenException("החשבון במצב חיוב בלבד");
    const { tenantId, userId } = ctx;
    const scenario = practiceScenario(scenarioCode);
    if (scenario === null) throw new BadRequestException("תרחיש לא מוכר");
    return this.prisma.withTenant(async (tx) => {
      /*
       * תרגול פתוח שלא נגמר — נסגר בלי משוב: מי שהתחיל ונטש לא צריך
       * לגרור אותו, והמסך מציג תרגול אחד בכל רגע.
       */
      await tx.mentorPractice.updateMany({
        where: { tenantId, userId, endedAt: null },
        data: { endedAt: new Date() },
      });
      const row = await tx.mentorPractice.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          scenario: scenario.code,
          turns: [practiceOpening(scenario)] as object[],
          agentTurns: 0,
        },
      });
      return MentorPracticeService.dto(row);
    });
  }

  /** תור של המתווך — והדמות עונה. */
  async reply(
    id: string,
    text: string,
    now: Date = new Date(),
  ): Promise<{
    turn: PracticeTurn;
    closing: boolean;
    source: "model" | "fallback";
    agentTurns: number;
  }> {
    const ctx = TenantContext.current();
    if (ctx.billingOnly) throw new ForbiddenException("החשבון במצב חיוב בלבד");
    const { tenantId, userId } = ctx;
    const { row, scenario, turns, overCap } = await this.prisma.withTenant(
      async (tx) => {
        const row = await this.openRow(tx, tenantId, userId, id);
        if (row.agentTurns >= PRACTICE_MAX_AGENT_TURNS)
          throw new BadRequestException("התרגול הגיע לסופו — עכשיו המשוב.");
        const scenario = practiceScenario(row.scenario);
        if (scenario === null) throw new NotFoundException("תרחיש לא מוכר");
        const today = jerusalemDayRange(now);
        const used = await tx.mentorPractice.aggregate({
          where: {
            tenantId,
            userId,
            createdAt: { gte: today.start, lt: today.end },
          },
          _sum: { agentTurns: true },
        });
        const turns: PracticeTurn[] = [
          ...MentorPracticeService.turnsOf(row.turns),
          { role: "agent", text },
        ];
        return {
          row,
          scenario,
          turns,
          overCap: (used._sum.agentTurns ?? 0) >= PRACTICE_DAILY_CAP,
        };
      },
    );
    const agentTurns = row.agentTurns + 1;
    let reply: { reply: string; closing: boolean } | null = null;
    if (!overCap && (await this.gemini.isConfigured())) {
      const detailed = await this.gemini.generateStructuredDetailed(
        buildPracticeReplyPrompt(scenario, turns),
        PRACTICE_REPLY_JSON_SCHEMA,
        { maxOutputTokens: 512, timeoutMs: MODEL_TIMEOUT_MS },
      );
      const parsed = ReplySchema.safeParse(detailed.value);
      if (parsed.success) reply = parsed.data;
      await this.events.record({
        channel: "web",
        kind: "mentor",
        transcript: text,
        payload: { practice: scenario.code, replied: parsed.success },
        source: "llm",
        model: detailed.model,
        latencyMs: detailed.latencyMs,
        ...(detailed.usage === undefined ? {} : { usage: detailed.usage }),
      });
    }
    const source: "model" | "fallback" = reply === null ? "fallback" : "model";
    // בלי מודל — שלוש התשובות הקבועות, והשלישית סוגרת
    const turn: PracticeTurn = {
      role: "counterpart",
      text: reply?.reply ?? practiceFallbackReply(scenario, agentTurns),
    };
    const closing =
      reply?.closing ?? agentTurns >= Math.min(3, PRACTICE_MAX_AGENT_TURNS);
    await this.prisma.withTenant((tx) =>
      tx.mentorPractice.update({
        where: { id: row.id },
        data: { turns: [...turns, turn] as object[], agentTurns },
      }),
    );
    return { turn, closing, source, agentTurns };
  }

  /** המשוב — סוגר את התרגול. אידמפוטנטי: משוב שכבר ניתן חוזר כפי שהוא. */
  async finish(id: string, now: Date = new Date()): Promise<MentorPracticeDto> {
    const ctx = TenantContext.current();
    if (ctx.billingOnly) throw new ForbiddenException("החשבון במצב חיוב בלבד");
    const { tenantId, userId } = ctx;
    const { row, scenario, turns, persona } = await this.prisma.withTenant(
      async (tx) => {
        const row = await tx.mentorPractice.findFirst({
          where: { id, tenantId, userId },
        });
        if (row === null) throw new NotFoundException("תרגול לא נמצא");
        const scenario = practiceScenario(row.scenario);
        if (scenario === null) throw new NotFoundException("תרחיש לא מוכר");
        if (row.agentTurns === 0)
          throw new BadRequestException(
            "עוד לא אמרת כלום — תשובה אחת לפחות, ואז המשוב.",
          );
        const user = await tx.user.findFirst({
          where: { id: userId, tenantId },
          select: { preferences: true },
        });
        return {
          row,
          scenario,
          turns: MentorPracticeService.turnsOf(row.turns),
          persona: resolveMentorPersona(user?.preferences),
        };
      },
    );
    if (row.feedback !== null && row.endedAt !== null)
      return MentorPracticeService.dto(row);
    const checklist = practiceChecklist(scenario, turns);
    let feedback: MentorPracticeFeedback | null = null;
    if (await this.gemini.isConfigured()) {
      const detailed = await this.gemini.generateStructuredDetailed(
        buildPracticeFeedbackPrompt(scenario, turns, checklist, persona),
        PRACTICE_FEEDBACK_JSON_SCHEMA,
        { maxOutputTokens: 1_024, timeoutMs: MODEL_TIMEOUT_MS },
      );
      const parsed = FeedbackSchema.safeParse(detailed.value);
      if (parsed.success)
        feedback = practiceModelFeedback(parsed.data, checklist);
      await this.events.record({
        channel: "web",
        kind: "mentor",
        payload: {
          practice: scenario.code,
          feedback: true,
          replied: parsed.success,
        },
        source: "llm",
        model: detailed.model,
        latencyMs: detailed.latencyMs,
        ...(detailed.usage === undefined ? {} : { usage: detailed.usage }),
      });
    }
    feedback ??= practiceFallbackFeedback(scenario, turns);
    const updated = await this.prisma.withTenant((tx) =>
      tx.mentorPractice.update({
        where: { id: row.id },
        data: {
          feedback: feedback as unknown as object,
          score: feedback.score,
          endedAt: now,
        },
      }),
    );
    return MentorPracticeService.dto(updated);
  }

  /** לסיכום השבועי ולשיחה — כמה תרגולים נגמרו בטווח, והאחרון שבהם. */
  static async stats(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    range: { start: Date; end: Date },
  ): Promise<MentorPracticeStats> {
    const rows = await tx.mentorPractice.findMany({
      where: {
        tenantId,
        userId,
        endedAt: { gte: range.start, lt: range.end },
        feedback: { not: undefined },
      },
      orderBy: { endedAt: "desc" },
      select: { scenario: true, score: true, feedback: true, endedAt: true },
    });
    const finished = rows.filter(
      (r) => r.feedback !== null && r.score !== null,
    );
    const last = finished[0];
    const scenario =
      last === undefined ? null : practiceScenario(last.scenario);
    return {
      count: finished.length,
      last:
        last === undefined || scenario === null || last.endedAt === null
          ? null
          : {
              scenarioLabel: scenario.label,
              score: last.score ?? 1,
              tryNext:
                (last.feedback as Partial<MentorPracticeFeedback>).tryNext ??
                scenario.tip,
              endedAt: last.endedAt,
            },
    };
  }

  private async openRow(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<PracticeRow> {
    const row = await tx.mentorPractice.findFirst({
      where: { id, tenantId, userId, endedAt: null },
    });
    if (row === null) throw new NotFoundException("התרגול נגמר או לא נמצא");
    return row;
  }

  static turnsOf(raw: unknown): PracticeTurn[] {
    return Array.isArray(raw)
      ? raw.flatMap((t: unknown): PracticeTurn[] => {
          if (typeof t !== "object" || t === null) return [];
          const { role, text } = t as Record<string, unknown>;
          return (role === "agent" || role === "counterpart") &&
            typeof text === "string"
            ? [{ role, text }]
            : [];
        })
      : [];
  }

  static dto(row: PracticeRow): MentorPracticeDto {
    const scenario: PracticeScenarioInfo | null = practiceScenario(
      row.scenario,
    );
    return {
      id: row.id,
      scenario: (scenario?.code ?? row.scenario) as PracticeScenario,
      scenarioLabel: scenario?.label ?? row.scenario,
      counterpartName: scenario?.counterpart.name ?? "",
      turns: MentorPracticeService.turnsOf(row.turns),
      agentTurns: row.agentTurns,
      feedback:
        row.feedback === null || typeof row.feedback !== "object"
          ? null
          : (row.feedback as unknown as MentorPracticeFeedback),
      createdAt: row.createdAt,
      endedAt: row.endedAt,
    };
  }
}
