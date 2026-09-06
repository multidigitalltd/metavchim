import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { AuditService } from "../../core/audit.service";
import type { GeminiService } from "../../core/gemini.service";
import type { PrismaService } from "../../core/prisma.service";
import type { AgentEventsService } from "../agent/agent-events.service";
import { MentorSignalsService } from "./mentor-signals.service";
import { MentorService } from "./mentor.service";

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";

/**
 * בסיס ריק שעונה לכל מה שהשיחה שואלת: אין יעדים, אין סיכומים, אין
 * פעילות. מה שנבדק כאן הוא הרישום ביומן — לא התוכן.
 */
function emptyTx(opts: { userCreatedAt?: Date } = {}): unknown {
  const modelFor = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => {
          if (method === "count") return async () => 0;
          if (method === "findMany") return async () => [];
          if (method === "findFirst")
            return async () =>
              name === "user" && opts.userCreatedAt !== undefined
                ? { name: "דנה כהן", createdAt: opts.userCreatedAt }
                : null;
          if (method === "create")
            return async (args: { data: Record<string, unknown> }) => ({
              createdAt: new Date(),
              ...args.data,
            });
          if (method === "updateMany") return async () => ({ count: 0 });
          return async () => null;
        },
      },
    );
  return new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === "$queryRaw")
          return async (strings: TemplateStringsArray) => {
            const sql = strings.join("?");
            if (sql.includes("percentile_cont")) return [{ median: null }];
            return [{ n: 0n }];
          };
        if (name === "$executeRaw") return async () => 0;
        return modelFor(name);
      },
    },
  );
}

function harness(opts: {
  configured: boolean;
  value: unknown;
  userCreatedAt?: Date;
}) {
  const recorded: Record<string, unknown>[] = [];
  let calls = 0;
  const tx = emptyTx(
    opts.userCreatedAt === undefined
      ? {}
      : { userCreatedAt: opts.userCreatedAt },
  );
  const prisma = {
    withTenant: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  const audit = { record: async () => undefined } as unknown as AuditService;
  const gemini = {
    isConfigured: async () => opts.configured,
    generateStructuredDetailed: async () => {
      calls += 1;
      return {
        value: opts.value,
        model: "gemini-test",
        latencyMs: 321,
        usage: {
          promptTokens: 900,
          outputTokens: 40,
          thoughtTokens: 10,
          cachedTokens: 600,
        },
      };
    },
  } as unknown as GeminiService;
  const events = {
    record: async (event: Record<string, unknown>) => {
      recorded.push(event);
    },
  } as unknown as AgentEventsService;
  const signals = new MentorSignalsService();
  const svc = new MentorService(prisma, audit, gemini, signals, events);
  const run = <T>(fn: () => Promise<T>) =>
    TenantContext.run(
      {
        tenantId: TENANT,
        userId: USER,
        role: "agent",
        permissions: new Set<string>(),
        billingOnly: false,
      },
      fn,
    );
  return { svc, run, recorded, signals, modelCalls: () => calls };
}

describe("השיחה עם המנטור — האסימונים נרשמים ביומן הסוכן", () => {
  it("קריאה למודל נרשמת כ-mentor עם הערוץ, המודל והאסימונים", async () => {
    const h = harness({ configured: true, value: { reply: "יופי של שבוע." } });
    const res = await h.run(() =>
      h.svc.ask("איך היה השבוע שלי?", new Date(), "whatsapp"),
    );
    expect(res.source).toBe("model");
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatchObject({
      channel: "whatsapp",
      kind: "mentor",
      source: "llm",
      model: "gemini-test",
      latencyMs: 321,
      transcript: "איך היה השבוע שלי?",
      payload: { replied: true },
      usage: { promptTokens: 900, outputTokens: 40 },
    });
  });

  it("תשובה שלא עברה את הסכמה עדיין נרשמת — האסימונים נצרכו", async () => {
    const h = harness({ configured: true, value: { nonsense: 1 } });
    const res = await h.run(() => h.svc.ask("מה כדאי לי לשפר?"));
    expect(res.source).toBe("fallback");
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatchObject({
      channel: "web",
      kind: "mentor",
      payload: { replied: false },
    });
  });

  it("בלי מפתח אין קריאה ואין רישום — לא שולם דבר", async () => {
    const h = harness({ configured: false, value: null });
    const res = await h.run(() => h.svc.ask("מה המצב?"));
    expect(res.source).toBe("fallback");
    expect(h.modelCalls()).toBe(0);
    expect(h.recorded).toHaveLength(0);
  });
});

describe("השיחה — מול שבוע שעבר, אותו חלק של השבוע", () => {
  it("שאלה ביום שני 10:00 משווה לראשון–שני 10:00 של שבוע שעבר, לא לשבוע שלם", async () => {
    const h = harness({
      configured: false,
      value: null,
      userCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const ranges: { start: Date; end: Date; at: Date }[] = [];
    h.signals.activity = async (_tx, _tenant, _user, range, at) => {
      ranges.push({ ...range, at });
      return {
        deals_closed: 0,
        offers_sent: 0,
        viewings_held: 0,
        leads_answered: 0,
        new_buyers: 0,
        new_properties: 0,
        calls_made: 0,
        calls_answered: 0,
        leads_answered_fast: 0,
        followups_done: 0,
        owner_updates_sent: 0,
      };
    };
    // שני 07/09 10:00 ישראל
    await h.run(() =>
      h.svc.ask("מה כדאי לי לשפר?", new Date("2026-09-07T07:00:00.000Z")),
    );
    // שבוע שעבר מתחיל בראשון 30/08 00:00 ישראל — ונגמר בשני 31/08 10:00, לא בראשון 06/09
    const previous = ranges.find(
      (r) => r.start.toISOString() === "2026-08-29T21:00:00.000Z",
    );
    expect(previous?.end.toISOString()).toBe("2026-08-31T07:00:00.000Z");
    expect(previous?.at.toISOString()).toBe("2026-08-31T07:00:00.000Z");
  });
});
