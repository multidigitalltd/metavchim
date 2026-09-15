import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { PrismaService } from "../../core/prisma.service";
import type { MentorPracticeService } from "../mentor/mentor-practice.service";
import { WhatsAppAssistantService } from "./whatsapp-assistant.service";

/*
 * ‎**תרגול שיחה מהוואטסאפ** — לולאת התורים מקצה לקצה, בלי מסד.
 *
 * ‏מה שנבדק כאן הוא מה שהוואטסאפ מוסיף: איזו הודעה היא תור בתרגול,
 * ‏איזו מסיימת אותו, ומה קורה כשהדמות סיימה בעצמה. השירות עצמו
 * ‏(המכסה, המשוב, הדמות) נבדק בנפרד ואינו משוכפל כאן — הוא מזויף
 * ‏במקום שבו הלולאה נוגעת בו.
 *
 * ‏הצריכה האטומית של המצב הממתין מזויפת כמו בבדיקת הרפלקציה: זו
 * ‏אותה מכניקה בדיוק, ובכוונה.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";
const PRACTICE = "01PRACTICEAAAAAAAAAAAAAAAA";

interface Seen {
  replies: string[];
  finished: number;
}

function harness(
  opts: { closing?: boolean; failReply?: boolean; failFinish?: boolean } = {},
) {
  const seen: Seen = { replies: [], finished: 0 };
  const chat = {
    pending: {
      transcript: "",
      proposal: {
        actionId: "mentor_reflect",
        title: "תרגול שיחה",
        risk: "update",
        summary: "תרגול שיחה",
        fields: [],
        missing: [],
        warnings: [],
        degraded: [],
        fallback: false,
      },
      awaiting: "mentor_practice",
      extraParams: {},
      token: "01TOKENAAAAAAAAAAAAAAAAAAA",
      mentor: { practiceId: PRACTICE, counterpart: "דנה" },
    } as unknown,
    history: [],
    added: [],
    handledIds: [],
  };
  const prisma = {
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

  const practice = {
    reply: async (_id: string, text: string) => {
      if (opts.failReply) throw new Error("המסד לא ענה");
      seen.replies.push(text);
      return {
        turn: { role: "counterpart" as const, text: "ועדיין, המחיר גבוה" },
        closing: opts.closing ?? false,
        source: "fallback" as const,
        agentTurns: 7,
      };
    },
    finish: async () => {
      seen.finished += 1;
      if (opts.failFinish) throw new Error("עוד לא אמרת כלום");
      return {
        id: PRACTICE,
        scenario: "seller_price" as const,
        scenarioLabel: "מוכר על המחיר",
        counterpartName: "דנה",
        turns: [],
        agentTurns: 2,
        closed: true,
        feedback: {
          worked: ["שאלת מה חשוב לו"],
          missed: [],
          tryNext: "לסגור מועד לסיור",
          score: 4,
          checklist: [],
          source: "checklist" as const,
        },
        createdAt: new Date(),
        endedAt: new Date(),
      };
    },
  } as unknown as MentorPracticeService;

  const stub = {} as never;
  const plans = { tenantHasFeature: async () => true } as never;
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
    stub,
    practice,
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
            ) => Promise<{ text: string }>;
          }
        ).converse(user, chat, text, false),
    );
  const pending = () =>
    chat.pending as { awaiting: string; token?: string } | null;
  return { say, pending, seen };
}

describe("תרגול בוואטסאפ — ההודעה הבאה היא תור, לא בקשה", () => {
  /*
   * ‎**זו הבדיקה שהמסלול קיים בשבילה.** „אני מבין אותך, אבל המחיר
   * ‏גבוה” הוא משפט שמנוע ההבנה יחפש בו פעולה ולא ימצא. המצב
   * ‏הממתין הוא מה שמונע את זה — ובלעדיו התרגול היה נשבר בתור
   * ‏הראשון.
   */
  it("מה שהמתווך אומר נשלח לתרגול, והדמות עונה", async () => {
    const { say, pending, seen } = harness();
    const reply = await say("אני מבין אותך, אבל המחיר גבוה מהשוק");
    expect(seen.replies).toEqual(["אני מבין אותך, אבל המחיר גבוה מהשוק"]);
    expect(reply.text).toContain("דנה");
    expect(reply.text).toContain("ועדיין, המחיר גבוה");
    /* ‏והתרגול נמשך — עם חותם חדש, כדי שכפתור ישן לא ייחשב תור */
    expect(pending()?.awaiting).toBe("mentor_practice");
    expect(pending()?.token).not.toBe("01TOKENAAAAAAAAAAAAAAAAAAA");
  });

  it("„סיום” מביא את המשוב ומסיים את המצב הממתין", async () => {
    const { say, pending, seen } = harness();
    const reply = await say("סיום");
    expect(seen.replies).toEqual([]);
    expect(seen.finished).toBe(1);
    expect(reply.text).toContain("מוכר על המחיר");
    expect(reply.text).toContain("שאלת מה חשוב לו");
    expect(pending()).toBeNull();
  });

  /*
   * ‏הדמות סיימה מעצמה — המשוב מגיע **מיד**, ולא ממתין ל„סיום”
   * ‏שהמתווך לא ידע שהוא צריך לשלוח.
   */
  it("כשהדמות סיימה — המשוב מגיע בלי שביקשו", async () => {
    const { say, pending, seen } = harness({ closing: true });
    const reply = await say("בוא נסכם: נעלה את המחיר בחודש");
    expect(seen.finished).toBe(1);
    expect(reply.text).toContain("מוכר על המחיר");
    expect(pending()).toBeNull();
  });

  it("הודעה קצרה מדי אינה תור — והתרגול נשאר פתוח", async () => {
    const { say, pending, seen } = harness();
    const reply = await say("או");
    expect(seen.replies).toEqual([]);
    expect(reply.text).toContain("לא קלטתי");
    expect(pending()?.awaiting).toBe("mentor_practice");
  });

  /*
   * ‎**„סיום” לפני שנאמרה מילה אחת נכשל דטרמיניסטית** — השירות
   * ‏מחזיר „עוד לא אמרת כלום”. המצב הממתין כבר נצרך בשלב הזה,
   * ‏ובלי השחזור התרגול היה נעלם בדיוק בגלל שהמתווך שלח את המילה
   * ‏שהמסך הציע לו (ביקורת Codex).
   */
  it("משוב שנכשל משאיר את התרגול פתוח", async () => {
    const { say, pending } = harness({ failFinish: true });
    const reply = await say("סיום");
    expect(reply.text).toContain("המשוב לא נוצר");
    expect(pending()?.awaiting).toBe("mentor_practice");
    expect(pending()?.token).not.toBe("01TOKENAAAAAAAAAAAAAAAAAAA");
  });

  /*
   * ‏כישלון אינו מפיל את התרגול: מי שהשקיע שבעה תורים לא צריך
   * ‏להתחיל מחדש בגלל שגיאה אחת.
   */
  it("כישלון משאיר את התרגול פתוח, עם חותם חדש", async () => {
    const { say, pending } = harness({ failReply: true });
    const reply = await say("אני מבין אותך, אבל המחיר גבוה");
    expect(reply.text).toContain("התרגול נתקע");
    expect(pending()?.awaiting).toBe("mentor_practice");
    expect(pending()?.token).not.toBe("01TOKENAAAAAAAAAAAAAAAAAAA");
  });
});
