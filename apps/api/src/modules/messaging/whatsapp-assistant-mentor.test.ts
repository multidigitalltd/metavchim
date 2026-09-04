import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { PrismaService } from "../../core/prisma.service";
import type { MentorService } from "../mentor/mentor.service";
import { WhatsAppAssistantService } from "./whatsapp-assistant.service";

/*
 * המנטור בשיחה — הרפלקציה והתוכנית מקצה לקצה, בלי מסד ובלי Meta.
 *
 * ‎`converse` היא הליבה: מה שנכנס, מה יוצא, ומה נשמר ב-`pending`.
 * המסד מזויף במקום היחיד שהיא נוגעת בו — הצריכה האטומית של ההצעה
 * הממתינה — והמנטור נרשם על מה שנקרא לו.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";
const REVIEW = "01REVIEWAAAAAAAAAAAAAAAAAA";

function harness(opts: {
  reflection: string | null;
  hasCoach?: boolean;
  failAnswer?: boolean;
}) {
  const calls: { answered?: string; plan?: string } = {};
  const chat = {
    pending: null as unknown,
    history: [],
    added: [],
    handledIds: [],
  };
  const prisma = {
    // הצריכה האטומית — מחזירה את מה שממתין ומרוקנת, כמו ה-SQL
    withExplicitTenant: async (
      _t: string,
      fn: (tx: unknown) => Promise<unknown>,
    ) =>
      fn({
        $queryRaw: async () => {
          const pending = chat.pending;
          chat.pending = null;
          return [{ pending }];
        },
      }),
  } as unknown as PrismaService;
  const mentor = {
    latestReview: async () => ({
      id: REVIEW,
      reflection: opts.reflection,
      reflectionAnswer: null,
      planSuggestions: [
        "כשאין זמן — אז בבוקר",
        "כשאין התאמות — אז מרחיב חיפוש",
        "שלישית",
      ],
    }),
    answerReflection: async (_id: string, answer: string) => {
      if (opts.failAnswer) throw new Error("המסד לא ענה");
      calls.answered = answer;
      return {
        planSuggestions: [
          "כשאין זמן — אז בבוקר",
          "כשאין התאמות — אז מרחיב חיפוש",
          "שלישית",
        ],
      };
    },
    setPlan: async (_id: string, plan: string) => {
      calls.plan = plan;
      return {};
    },
  } as unknown as MentorService;
  const stub = {} as never;
  const plans = {
    tenantHasFeature: async () => opts.hasCoach ?? true,
  } as never;
  const svc = new WhatsAppAssistantService(
    prisma,
    stub,
    plans,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    mentor,
  );
  const user = { id: USER, tenantId: TENANT, name: "דנה כהן", role: "agent" };
  const say = (text: string) =>
    TenantContext.run(
      {
        tenantId: TENANT,
        userId: USER,
        capabilities: new Set(),
        billingOnly: false,
      } as Parameters<typeof TenantContext.run>[0],
      () =>
        (
          svc as unknown as {
            converse: (
              u: unknown,
              c: unknown,
              t: string,
              v: boolean,
            ) => Promise<{
              text: string;
              buttons?: { arg?: string; token?: string }[];
            }>;
          }
        ).converse(user, chat, text, false),
    );
  const pending = () =>
    chat.pending as {
      awaiting: string;
      token?: string;
      mentor?: { reviewId: string; plans?: string[] };
    } | null;
  return { say, pending, calls, chat };
}

describe("המנטור בוואטסאפ — „לענות למנטור” ⟵ תשובה ⟵ תוכנית", () => {
  it("בלי שאלה השבוע — הסבר, ולא מצב ממתין", async () => {
    const { say, pending } = harness({ reflection: null });
    const reply = await say("לענות למנטור");
    expect(reply.text).toContain("לא שאל שאלה השבוע");
    expect(pending()).toBeNull();
  });

  it("השאלה נשלחת, ההודעה הבאה נשמרת כתשובה, ואז שלוש הצעות עם חותם", async () => {
    const { say, pending, calls } = harness({
      reflection: "מה עצר את ההצעות השבוע?",
    });
    const opened = await say("לענות למנטור");
    expect(opened.text).toContain("מה עצר את ההצעות השבוע?");
    expect(pending()?.awaiting).toBe("mentor_reflection");
    expect(pending()?.mentor?.reviewId).toBe(REVIEW);

    const answered = await say("לא היה זמן, היו מילואים");
    expect(calls.answered).toBe("לא היה זמן, היו מילואים");
    expect(answered.text).toContain("ואם זה יקרה שוב");
    expect(pending()?.awaiting).toBe("mentor_plan");
    expect(pending()?.mentor?.plans).toHaveLength(3);
    // כפתורי הבחירה נושאים את החותם של ההצעה הממתינה — לחיצה ישנה תידחה
    expect(answered.buttons?.every((b) => b.token === pending()?.token)).toBe(
      true,
    );

    const planned = await say("2");
    expect(calls.plan).toBe("כשאין התאמות — אז מרחיב חיפוש");
    expect(planned.text).toContain("נכנסה ליעד");
    expect(pending()).toBeNull();
  });

  it("תוכנית במילים של המתווך נשמרת כלשונה; „דלג” משאיר את התשובה בלי תוכנית", async () => {
    const own = harness({ reflection: "מה עצר?" });
    await own.say("לענות למנטור");
    await own.say("לא היו התאמות");
    await own.say("כשאין התאמות — אז מרחיב את הרדיוס");
    expect(own.calls.plan).toBe("כשאין התאמות — אז מרחיב את הרדיוס");

    const skip = harness({ reflection: "מה עצר?" });
    await skip.say("לענות למנטור");
    await skip.say("לא היה זמן");
    const reply = await skip.say("דלג");
    expect(skip.calls.plan).toBeUndefined();
    expect(reply.text).toContain("בלי תוכנית");
    expect(skip.pending()).toBeNull();
  });

  it("„בטל” באמצע — מבטל, וההודעה הבאה אינה נשמרת כתשובה", async () => {
    const { say, pending, calls } = harness({ reflection: "מה עצר?" });
    await say("לענות למנטור");
    const cancelled = await say("בטל");
    expect(cancelled.text).toContain("בוטל");
    expect(pending()).toBeNull();
    expect(calls.answered).toBeUndefined();
  });

  it("משרד בלי ai_coach — הסבר, בלי מצב ממתין ובלי קריאה למנטור", async () => {
    const { say, pending } = harness({
      reflection: "מה עצר?",
      hasCoach: false,
    });
    const reply = await say("לענות למנטור");
    expect(reply.text).toContain("אינו כלול במסלול");
    expect(pending()).toBeNull();
  });

  it("כשהשמירה נכשלת — המצב הממתין חוזר עם חותם חדש, וההודעה הבאה עדיין תשובה", async () => {
    const { say, pending } = harness({
      reflection: "מה עצר?",
      failAnswer: true,
    });
    await say("לענות למנטור");
    const before = pending()?.token;
    const reply = await say("לא היה זמן");
    expect(reply.text).toContain("לא נשמרה");
    expect(pending()?.awaiting).toBe("mentor_reflection");
    expect(pending()?.token).not.toBe(before);
  });
});
