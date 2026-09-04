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
const WEEK = new Date("2026-08-22T21:00:00.000Z");

/** בסיס מזויף: הסיכום שמתחייבים עליו, ואולי סיכום מאוחר יותר. */
function harness(opts: { laterReviewExists: boolean }) {
  const updates: Record<string, unknown>[] = [];
  const row = {
    id: REVIEW,
    tenantId: TENANT,
    userId: USER,
    weekStart: WEEK,
    mood: "encourage",
    headline: "x",
    body: { ask: { metric: "offers_sent", period: "week", target: 5 } },
    reflectionAnswer: null,
    commitment: null,
    committedAt: null,
    commitmentNote: null,
    createdAt: new Date(),
  };
  const tx = {
    mentorReview: {
      findFirst: async (args: {
        where: { id?: string; weekStart?: { gt: Date } };
      }) => {
        if (args.where.id === REVIEW) return row;
        if (args.where.weekStart?.gt !== undefined)
          return opts.laterReviewExists ? { id: "later" } : null;
        return null;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { ...row, ...args.data };
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
  return { svc, run, updates };
}

describe("MentorService.commit — מחויבות על הסיכום האחרון בלבד", () => {
  it("על הסיכום האחרון — נשמרת עם ההערה", async () => {
    const { svc, run, updates } = harness({ laterReviewExists: false });
    const dto = await run(() => svc.commit(REVIEW, "accepted", "בבוקר"));
    expect(updates[0]).toMatchObject({
      commitment: "accepted",
      commitmentNote: "בבוקר",
    });
    expect(dto.commitment).toBe("accepted");
  });

  it("אחרי שהסיכום הבא כבר בדק אותה — נדחית (409), ושום דבר לא נכתב", async () => {
    const { svc, run, updates } = harness({ laterReviewExists: true });
    await expect(
      run(() => svc.commit(REVIEW, "declined", undefined)),
    ).rejects.toMatchObject({ status: 409 });
    expect(updates).toHaveLength(0);
  });
});
