import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { AuditService } from "../../core/audit.service";
import type { GeminiService } from "../../core/gemini.service";
import type { PrismaService } from "../../core/prisma.service";
import { MentorSignalsService } from "./mentor-signals.service";
import { MentorService } from "./mentor.service";

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";
const REVIEW = "01REVIEWAAAAAAAAAAAAAAAAAA";

function harness(body: Record<string, unknown>) {
  const goalUpdates: Record<string, unknown>[] = [];
  const reviewUpdates: Record<string, unknown>[] = [];
  const row = {
    id: REVIEW,
    tenantId: TENANT,
    userId: USER,
    weekStart: new Date("2026-08-29T21:00:00.000Z"),
    mood: "encourage",
    headline: "x",
    body,
    reflectionAnswer: "לא היה זמן",
    commitment: null,
    committedAt: null,
    commitmentNote: null,
    plan: null,
    createdAt: new Date(),
  };
  const tx = {
    mentorReview: {
      findFirst: async () => row,
      update: async (args: { data: Record<string, unknown> }) => {
        reviewUpdates.push(args.data);
        return { ...row, ...args.data };
      },
    },
    mentorGoal: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        goalUpdates.push({ ...args.where, ...args.data });
        return { count: 1 };
      },
    },
  };
  const prisma = {
    withTenant: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  const audit = { record: async () => undefined } as unknown as AuditService;
  const gemini = {
    isConfigured: async () => false,
  } as unknown as GeminiService;
  const svc = new MentorService(
    prisma,
    audit,
    gemini,
    new MentorSignalsService(),
  );
  const run = <T>(fn: () => Promise<T>) =>
    TenantContext.run(
      {
        tenantId: TENANT,
        userId: USER,
        capabilities: new Set(),
        billingOnly: false,
      } as Parameters<typeof TenantContext.run>[0],
      fn,
    );
  return { svc, run, goalUpdates, reviewUpdates };
}

describe("MentorService.setPlan — מהמכשול לתוכנית", () => {
  it("התוכנית נשמרת על הסיכום ונכנסת ליעד הפעיל של אותו מדד ותקופה", async () => {
    const { svc, run, goalUpdates, reviewUpdates } = harness({
      reflection: "מה עצר את ההצעות?",
      ask: { metric: "offers_sent", period: "week", target: 5 },
    });
    const dto = await run(() =>
      svc.setPlan(REVIEW, "כשלא נשאר זמן — אז ההצעות ראשונות בבוקר"),
    );
    expect(reviewUpdates[0]?.["plan"]).toBe(
      "כשלא נשאר זמן — אז ההצעות ראשונות בבוקר",
    );
    expect(goalUpdates[0]).toMatchObject({
      metric: "offers_sent",
      period: "week",
      endedAt: null,
      intention: "כשלא נשאר זמן — אז ההצעות ראשונות בבוקר",
    });
    expect(dto.plan).toBe("כשלא נשאר זמן — אז ההצעות ראשונות בבוקר");
    expect(dto.planSuggestions).toHaveLength(3);
  });

  it("סיכום בלי שאלה — אין ממה לבנות תוכנית", async () => {
    const { svc, run } = harness({
      ask: { metric: "offers_sent", period: "week", target: 5 },
    });
    await expect(run(() => svc.setPlan(REVIEW, "כש… אז…"))).rejects.toThrow(
      "לא הייתה שאלה",
    );
  });
});
