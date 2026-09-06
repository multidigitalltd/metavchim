import { describe, expect, it } from "vitest";
import { practiceScenario } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import type { GeminiService } from "../../core/gemini.service";
import type { PrismaService, TenantTx } from "../../core/prisma.service";
import type { AgentEventsService } from "../agent/agent-events.service";
import { MentorPracticeService } from "./mentor-practice.service";

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";

interface Row {
  id: string;
  tenantId: string;
  userId: string;
  scenario: string;
  turns: unknown;
  agentTurns: number;
  feedback: unknown;
  score: number | null;
  closed: boolean;
  createdAt: Date;
  endedAt: Date | null;
}

/** בסיס מזויף: טבלת התרגולים בזיכרון, ומשתמש בלי העדפות. */
function harness(opts: {
  configured: boolean;
  /** מה המודל מחזיר — לפי סדר הקריאות */
  values?: unknown[];
  usedToday?: number;
}) {
  const rows: Row[] = [];
  const recorded: Record<string, unknown>[] = [];
  let call = 0;
  const tx = {
    mentorPractice: {
      // כמו בסיס אמיתי: הקורא מקבל צילום, לא הפניה לשורה החיה
      findFirst: async (args: { where: Record<string, unknown> }) => {
        const row = rows.find(
          (r) =>
            (args.where["id"] === undefined || r.id === args.where["id"]) &&
            (!("endedAt" in args.where) || r.endedAt === args.where["endedAt"]),
        );
        return row === undefined ? null : { ...row };
      },
      findMany: async (args: { where: Record<string, unknown> }) =>
        rows.filter((r) =>
          "endedAt" in args.where && args.where["endedAt"] !== null
            ? r.endedAt !== null
            : true,
        ),
      create: async (args: {
        data: Omit<Row, "createdAt" | "endedAt" | "feedback" | "score">;
      }) => {
        const row: Row = {
          ...args.data,
          feedback: null,
          score: null,
          closed: false,
          createdAt: new Date("2026-09-08T08:00:00.000Z"),
          endedAt: null,
        };
        rows.push(row);
        return row;
      },
      // כתיבה מותנית כמו ב-Postgres: רק שורה שעונה לכל התנאים מתעדכנת
      updateMany: async (args: {
        where: {
          id?: string;
          agentTurns?: number;
          closed?: boolean;
          endedAt?: null;
        };
        data: Partial<Row>;
      }) => {
        const hits = rows.filter(
          (r) =>
            (args.where.id === undefined || r.id === args.where.id) &&
            (args.where.agentTurns === undefined ||
              r.agentTurns === args.where.agentTurns) &&
            (args.where.closed === undefined ||
              r.closed === args.where.closed) &&
            (!("endedAt" in args.where) || r.endedAt === null),
        );
        for (const r of hits) Object.assign(r, args.data);
        return { count: hits.length };
      },
      count: async () => rows.filter((r) => r.feedback !== null).length,
      update: async (args: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      },
      aggregate: async () => ({ _sum: { agentTurns: opts.usedToday ?? 0 } }),
    },
    user: {
      findFirst: async () => ({
        preferences: { mentor: { name: "נועה", style: "direct" } },
      }),
    },
  } as unknown as TenantTx;
  const prisma = {
    withTenant: async (fn: (t: TenantTx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  const gemini = {
    isConfigured: async () => opts.configured,
    generateStructuredDetailed: async () => {
      const value = opts.values?.[call] ?? null;
      call += 1;
      return { value, model: "gemini-test", latencyMs: 100 };
    },
  } as unknown as GeminiService;
  const events = {
    record: async (event: Record<string, unknown>) => {
      recorded.push(event);
    },
  } as unknown as AgentEventsService;
  const svc = new MentorPracticeService(prisma, gemini, events);
  const run = <T>(fn: () => Promise<T>) =>
    TenantContext.run(
      {
        tenantId: TENANT,
        userId: USER,
        role: "agent",
        permissions: new Set<string>(),
        billingOnly: false,
      } as Parameters<typeof TenantContext.run>[0],
      fn,
    );
  return { svc, run, rows, recorded, tx };
}

describe("MentorPracticeService — בלי מודל", () => {
  it("מתחיל בפתיח של הדמות; שלוש תשובות קבועות והשלישית סוגרת; המשוב מהרשימה", async () => {
    const h = harness({ configured: false });
    const started = await h.run(() => h.svc.start("seller_price"));
    expect(started.turns).toEqual([
      { role: "counterpart", text: practiceScenario("seller_price")!.opening },
    ]);
    expect(started.counterpartName).toBe("יוסי");
    const r1 = await h.run(() =>
      h.svc.reply(started.id, "אני מבין. מה השתנה בדירה מאז השיפוץ?"),
    );
    expect(r1.source).toBe("fallback");
    expect(r1.closing).toBe(false);
    expect(r1.turn.text).toBe(
      practiceScenario("seller_price")!.fallbackLines[0],
    );
    await h.run(() =>
      h.svc.reply(started.id, "הנה שלוש עסקאות דומות מהרחוב — 2.1 ו-2.2."),
    );
    const r3 = await h.run(() =>
      h.svc.reply(started.id, "נקבע פגישה בעוד שבועיים לבדוק את התגובות."),
    );
    expect(r3.closing).toBe(true);
    expect(r3.agentTurns).toBe(3);
    expect(h.recorded).toEqual([]);
    const done = await h.run(() => h.svc.finish(started.id));
    expect(done.feedback?.source).toBe("checklist");
    expect(done.feedback?.worked).toContain("עיגנת את המחיר בעסקאות דומות");
    expect(done.feedback?.score).toBe(5);
    expect(done.endedAt).not.toBeNull();
    // אידמפוטנטי — משוב שכבר ניתן חוזר כפי שהוא
    const again = await h.run(() => h.svc.finish(started.id));
    expect(again.feedback).toEqual(done.feedback);
    // ואחרי הסיום אין עוד תורים
    await expect(
      h.run(() => h.svc.reply(started.id, "עוד משהו")),
    ).rejects.toThrow("התרגול נגמר");
  });

  it("הסגירה נשמרת: אחרי שהדמות סיימה אין עוד תורים גם אחרי רענון — רק משוב", async () => {
    const h = harness({ configured: false });
    const started = await h.run(() => h.svc.start("lead_cold"));
    for (const line of ["איזה אזור?", "תקציב?", "אשלח שניים-שלושה"])
      await h.run(() => h.svc.reply(started.id, line));
    expect(h.rows[0]?.closed).toBe(true);
    expect((await h.run(() => h.svc.overview())).active?.closed).toBe(true);
    await expect(h.run(() => h.svc.reply(started.id, "עוד"))).rejects.toThrow(
      "הגיע לסופו",
    );
    const done = await h.run(() => h.svc.finish(started.id));
    expect(done.feedback).not.toBeNull();
  });

  it("שתי לשוניות שעונות יחד — השנייה מקבלת 409 ולא דורסת את הראשונה", async () => {
    const h = harness({ configured: false });
    const started = await h.run(() => h.svc.start("seller_price"));
    const results = await Promise.allSettled([
      h.run(() => h.svc.reply(started.id, "מה השתנה בדירה?")),
      h.run(() => h.svc.reply(started.id, "הנה עסקאות דומות")),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejected = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("כבר נענה");
    // בשורה: תור אחד של המתווך ותשובה אחת של הדמות — לא ארבעה
    expect(h.rows[0]?.agentTurns).toBe(1);
    expect((h.rows[0]?.turns as unknown[]).length).toBe(3);
  });

  it("משוב בלי תור של המתווך — נדחה; תרחיש זר — נדחה", async () => {
    const h = harness({ configured: false });
    const started = await h.run(() => h.svc.start("lead_cold"));
    await expect(h.run(() => h.svc.finish(started.id))).rejects.toThrow(
      "עוד לא אמרת",
    );
    await expect(h.run(() => h.svc.start("nope"))).rejects.toThrow(
      "תרחיש לא מוכר",
    );
  });
});

describe("MentorPracticeService — עם מודל", () => {
  it("הדמות מהמודל, closing מהמודל, והמשוב ממוזג עם הרשימה; הכול נרשם ביומן", async () => {
    const h = harness({
      configured: true,
      values: [
        { reply: "לא, השכן קיבל 2.3 ואני לא מוכר בפחות.", closing: false },
        { reply: "טוב, תשלח לי את העסקאות ונדבר.", closing: true },
        {
          worked: ["שאלת „מה השתנה” — זה פתח אותו"],
          missed: ["לא הצעת תאריך לבדיקה מחדש"],
          tryNext: "„בוא נתחיל ב-2.25 ונבדוק בעוד שבועיים”",
          score: 4,
        },
      ],
    });
    const started = await h.run(() => h.svc.start("seller_price"));
    const r1 = await h.run(() =>
      h.svc.reply(started.id, "מה השתנה בדירה מאז השיפוץ?"),
    );
    expect(r1).toMatchObject({ source: "model", closing: false });
    expect(r1.turn.text).toBe("לא, השכן קיבל 2.3 ואני לא מוכר בפחות.");
    const r2 = await h.run(() =>
      h.svc.reply(started.id, "הנה שלוש עסקאות מהרחוב, 2.1 עד 2.2."),
    );
    expect(r2.closing).toBe(true);
    const done = await h.run(() => h.svc.finish(started.id));
    expect(done.feedback).toMatchObject({
      source: "model",
      score: 4,
      tryNext: "„בוא נתחיל ב-2.25 ונבדוק בעוד שבועיים”",
    });
    expect(
      done.feedback?.checklist.find((c) => c.key === "anchored")?.met,
    ).toBe(true);
    expect(h.recorded).toHaveLength(3);
    expect(h.recorded[2]).toMatchObject({
      kind: "mentor",
      payload: { practice: "seller_price", feedback: true, replied: true },
    });
  });

  it("מעל המכסה היומית — הדמות עונה מהתשובות הקבועות והמשוב מהרשימה, בלי לקרוא למודל", async () => {
    const h = harness({ configured: true, usedToday: 40, values: [] });
    const started = await h.run(() => h.svc.start("commission"));
    const r = await h.run(() =>
      h.svc.reply(started.id, "מה כלול בעמלה — משא ומתן."),
    );
    expect(r.source).toBe("fallback");
    // גם המשוב הוא קריאה למודל — באותו תקציב (ביקורת Codex)
    const done = await h.run(() => h.svc.finish(started.id));
    expect(done.feedback?.source).toBe("checklist");
    expect(h.recorded).toEqual([]);
  });

  it("תשובת מודל שלא עברה את הסכמה — נופלים לתשובה הקבועה, והקריאה נרשמת", async () => {
    const h = harness({ configured: true, values: [{ reply: "" }] });
    const started = await h.run(() => h.svc.start("buyer_hesitant"));
    const r = await h.run(() => h.svc.reply(started.id, "מה הכי מטריד עכשיו?"));
    expect(r.source).toBe("fallback");
    expect(h.recorded[0]).toMatchObject({ payload: { replied: false } });
  });

  it("stats — כמה נגמרו בטווח, והאחרון עם הציון ומה לנסות", async () => {
    const h = harness({ configured: false });
    const a = await h.run(() => h.svc.start("seller_price"));
    await h.run(() => h.svc.reply(a.id, "מה השתנה?"));
    await h.run(() => h.svc.finish(a.id, new Date("2026-09-08T10:00:00.000Z")));
    const stats = await MentorPracticeService.stats(h.tx, TENANT, USER, {
      start: new Date("2026-09-05T21:00:00.000Z"),
      end: new Date("2026-09-12T21:00:00.000Z"),
    });
    expect(stats.count).toBe(1);
    expect(stats.last).toMatchObject({
      scenarioLabel: "מוכר על המחיר",
      tryNext: practiceScenario("seller_price")!.tip,
    });
  });
});
