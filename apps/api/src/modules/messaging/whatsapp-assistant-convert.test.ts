import { beforeAll, describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { PrismaService } from "../../core/prisma.service";
import type { CallsService } from "../calls/calls.service";
import type { AgentExecuteService } from "../agent/execute.service";
import { WhatsAppAssistantService } from "./whatsapp-assistant.service";

/*
 * ‎**„המר ללקוח” בוואטסאפ — התשובה היא מה שכותב.**
 *
 * ‏הפעולה עצמה רק שואלת (`agent-convert-call.test`). כאן נבדק מה
 * ‏שהוואטסאפ מוסיף: שההודעה הבאה נצרכת כתשובה ולא כבקשה חדשה,
 * ‏שהיא רצה דרך אותם שני צעדים של המסך — ליד ואז המרה — ושמה
 * ‏שאינו סוג אינו כותב דבר.
 */

/*
 * ‎**התשובה מגיעה עד `runProposal`, והוא בונה קישור למסך.**
 *
 * ‏‎`renderSegment` קורא ל-`loadEnv()`, שדורש תצורה שלמה. בלי
 * ‏הבלוק הזה הבדיקה עברה רק אצל מי שיש לו סביבה טעונה — והיא
 * ‏נפלה ב-CI. הערכים מזויפים: הבדיקה אינה נוגעת ברשת ולא במסד.
 */
beforeAll(() => {
  process.env["WEB_ORIGIN"] ??= "https://test.invalid";
  process.env["DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
  process.env["DIRECT_DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
  process.env["REDIS_URL"] ??= "redis://localhost:6379";
  process.env["DATA_ENCRYPTION_KEY"] ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env["PHONE_HASH_KEY"] ??= "test-phone-hash-key-not-a-real-secret-0000";
});

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";
const CALL = "01JCAAAAAAAAAAAAAAAAAAAAAA";
const LEAD = "01JEADAAAAAAAAAAAAAAAAAAAA";

interface Seen {
  ensured: string[];
  executed: { actionId: string; params: Record<string, unknown> }[];
  proposed: string[];
}

function harness(opts: { ensureFails?: boolean } = {}) {
  const seen: Seen = { ensured: [], executed: [], proposed: [] };
  const chat = {
    pending: {
      transcript: "המר ללקוח",
      proposal: {
        actionId: "convert_call",
        title: "המר ללקוח",
        risk: "read",
        summary: "המר ללקוח",
        fields: [],
        missing: [],
        warnings: [],
        degraded: [],
        fallback: false,
      },
      awaiting: "call_convert",
      extraParams: {},
      token: "01TOKENAAAAAAAAAAAAAAAAAAA",
      callConvert: {
        callId: CALL,
        subject: "השיחה עם דנה כהן",
        /* ‏מה שהשיחה ידעה — חייב להגיע לכרטיס שנפתח */
        seed: { city: "רמת גן", rooms: 4, priceShekels: 2_400_000, street: "הרצל 12" },
      },
    } as unknown,
    history: [],
    added: [],
    handledIds: [],
  };
  const prisma = {
    withExplicitTenant: async (_t: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRaw: async () => {
          const pending = chat.pending;
          chat.pending = null;
          return [{ pending }];
        },
      }),
  } as unknown as PrismaService;

  const calls = {
    ensureLead: async (id: string) => {
      seen.ensured.push(id);
      if (opts.ensureFails) throw new Error("המספר הזה משויך ללקוח שאינו נגיש לך");
      return { leadId: LEAD, created: true };
    },
  } as unknown as CallsService;

  const executor = {
    execute: async (actionId: string, params: Record<string, unknown>) => {
      seen.executed.push({ actionId, params });
      return { message: "הליד הפך לכרטיס קונה — דנה כהן", href: "/buyers/01JB" };
    },
  } as unknown as AgentExecuteService;

  const stub = {} as never;
  const svc = new WhatsAppAssistantService(
    prisma,
    stub,
    { tenantHasFeature: async () => true } as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    executor,
    stub,
    stub,
    stub,
    stub,
    stub,
    calls,
  );
  /* ‏„לא סוג” ממשיך למנוע ההבנה — מזויף כדי לראות שהוא אכן נקרא */
  (svc as unknown as { propose: unknown }).propose = async (
    _c: unknown,
    text: string,
  ) => {
    seen.proposed.push(text);
    return { text: "במה אוכל לעזור?", speak: "" };
  };

  const user = { id: USER, tenantId: TENANT, name: "דנה כהן", role: "agent" };
  const say = (text: string) =>
    TenantContext.run(
      { tenantId: TENANT, userId: USER, capabilities: new Set(), billingOnly: false } as
        Parameters<typeof TenantContext.run>[0],
      () =>
        (
          svc as unknown as {
            converse: (u: unknown, c: unknown, t: string, v: boolean) => Promise<{
              text: string;
            }>;
          }
        ).converse(user, chat, text, false),
    );
  return { say, seen, chat };
}

describe("‏התשובה על „מה הצד השני?”", () => {
  /*
   * ‎**שני צעדים, בדיוק כמו במסך:** ליד מהשיחה ואז ההמרה. השני
   * ‏עובר ב-`execute`, ולכן בשער היכולת של הסוג שנבחר — ולא
   * ‏ביכולת שבה נשאלה השאלה.
   */
  it("‏„קונה” פותחת ליד מהשיחה ואז ממירה אותו", async () => {
    const { say, seen } = harness();
    await say("קונה");
    expect(seen.ensured).toEqual([CALL]);
    expect(seen.executed).toEqual([
      {
        actionId: "convert_lead",
        params: {
          cities: ["רמת גן"],
          roomsMin: 4,
          roomsMax: 4,
          budgetMaxShekels: 2_400_000,
          leadId: LEAD,
          dealType: "sale",
        },
      },
    ]);
  });

  /*
   * ‎**הכרטיס אינו נפתח ריק** (ביקורת Codex, P2). עיר, חדרים,
   * ‏תקציב וכתובת חולצו מהשיחה, והמסך ממלא בהם את הטופס מראש —
   * ‏כרטיס בלי דרישות אינו משתתף בהתאמות עד שמישהו מקליד מחדש את
   * ‏מה שכבר נשמע. לנכס אותם נתונים בשמות שלו, והכתובת נכנסת רק
   * ‏שם: לקונה אין „רחוב”.
   */
  it("‏והכרטיס מקבל את מה שהשיחה ידעה, בשמות של הסוג", async () => {
    const { say, seen } = harness();
    await say("מוכר");
    expect(seen.executed[0]?.params).toEqual({
      city: "רמת גן",
      rooms: 4,
      street: "הרצל 12",
      priceShekels: 2_400_000,
      leadId: LEAD,
      dealType: "sale",
    });
  });

  /*
   * ‏ארבעת הסוגים הם שתי צורות כפול סוג עסקה — אותו מיפוי של המסך.
   * ‏„משכיר” שנפתח כמכירה הוא נכס שמופיע בהתאמות הלא נכונות.
   */
  it("‏וכל סוג פותח את הצורה ואת סוג העסקה שלו", async () => {
    for (const [said, actionId, dealType] of [
      ["שוכר", "convert_lead", "rent"],
      ["מוכר", "create_property_from_lead", "sale"],
      ["משכיר", "create_property_from_lead", "rent"],
    ] as const) {
      const { say, seen } = harness();
      await say(said);
      expect(seen.executed[0], said).toMatchObject({
        actionId,
        params: { leadId: LEAD, dealType },
      });
    }
  });

  /*
   * ‎**מה שאינו סוג אינו לולאה.** המתווך פשוט עבר לבקשה אחרת:
   * ‏המצב נסגר, שום דבר לא נכתב, והמשפט נשלח למנוע כרגיל — אותה
   * ‏התנהגות של „אולי התכוונת” כשלא נענה במספר.
   */
  it("‏ומשפט אחר אינו כותב דבר — הוא ממשיך למנוע", async () => {
    const { say, seen, chat } = harness();
    await say("מה יש לי היום?");
    expect(seen.ensured).toEqual([]);
    expect(seen.executed).toEqual([]);
    expect(seen.proposed).toEqual(["מה יש לי היום?"]);
    expect(chat.pending).toBeNull();
  });

  /*
   * ‎**„לא מוכר” אינו „מוכר”.** ההשוואה היא על מילה שלמה, כי מכאן
   * ‏והלאה נפתח כרטיס — זיהוי שגוי כאן פותח כרטיס מסוג לא נכון
   * ‏בשקט, ולא מחזיר „לא הבנתי”.
   */
  it("‏ומשפט שמכיל את המילה אינו בחירה", async () => {
    const { say, seen } = harness();
    await say("לא מוכר");
    expect(seen.executed).toEqual([]);
  });

  /*
   * ‎**„ביטול” יוצא מכאן דרך המנגנון המשותף** (`isCancelMessage`),
   * ‏ולא דרך רשימת מילים משלנו — שתי רשימות ביטול היו נפרדות בשקט.
   */
  it("‏ו„ביטול” יוצא בלי לכתוב", async () => {
    const { say, seen } = harness();
    const reply = await say("ביטול");
    expect(seen.ensured).toEqual([]);
    expect(seen.executed).toEqual([]);
    expect(reply.text).toContain("בוטל");
  });

  /*
   * ‏שיחה שמשויכת ללקוח של עמית — `ensureLead` מסרב. שתיקה כאן
   * ‏נראית בדיוק כמו הצלחה, ולכן הסירוב נאמר.
   */
  it("‏וסירוב של פתיחת הליד נאמר, ואינו ממשיך להמרה", async () => {
    const { say, seen } = harness({ ensureFails: true });
    const reply = await say("קונה");
    expect(seen.executed).toEqual([]);
    expect(reply.text).toContain("השיחה עם דנה כהן");
    expect(reply.text).toContain("אינו נגיש לך");
  });
});
