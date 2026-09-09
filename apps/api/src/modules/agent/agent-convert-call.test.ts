import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import {
  CALL_CONVERT_NONE,
  CALL_CONVERT_NO_KINDS,
  agentAction,
  callConvertCommand,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AgentExecuteService } from "./execute.service";
import type { CallDto } from "../calls/calls.service";

/**
 * ‎**„המר ללקוח” — מוצאת את השיחה ושואלת, ולא כותבת דבר.**
 *
 * ‏זה מה שמאפשר לה להיות פעולת קריאה, ולכן להיות ברצפה
 * ‏הדטרמיניסטית — כלומר הכפתור בהתראה עובד גם כשמנוע ההבנה נפול.
 * ‏הכתיבה נעשית על התשובה, ונבדקת ב-`whatsapp-assistant-convert`.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const CALL = "01JCAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01JCBAAAAAAAAAAAAAAAAAAAAA";
const CONTACT = "01JCNTAAAAAAAAAAAAAAAAAAAA";
/* ‏מזהי הבדיקה הם ULID תקינים: `IdSchema` פוסלת I/L/O/U, ומצביע
 * ‏שאינו תקין נדחה כולו — כלומר בדיקה עם מזהה „כמעט” אינה בודקת
 * ‏את מה שהיא חושבת. */
const LEAD = "01JEADAAAAAAAAAAAAAAAAAAAA";

const AT = new Date("2026-09-09T11:05:00Z");

/** ‏מה שהכפתור באמת שולח — מהקטלוג, כמו אצל בונה ההתראה. */
const SAID = agentAction("convert_call")!.examples[0]!;

const call = (over: Partial<CallDto> = {}): CallDto => ({
  id: CALL,
  direction: "inbound",
  source: "pbx",
  occurredAt: AT,
  outcome: "missed",
  highlights: {},
  ...over,
});

interface Seen {
  queries: Record<string, unknown>[];
}

function serviceFor(rows: CallDto[]): { service: AgentExecuteService; seen: Seen } {
  const seen: Seen = { queries: [] };
  const service = new AgentExecuteService(...(Array(40).fill({}) as never[]));
  /*
   * ‏השמה לפי שם ולא לפי מיקום: לבנאי יש עשרות ארגומנטים, ורשימה
   * ‏מסודרת ידנית הייתה נשברת בשקט ביום שמישהו מוסיף תלות באמצע.
   */
  Object.assign(service, {
    calls: {
      list: async (query: Record<string, unknown>) => {
        seen.queries.push(query);
        return rows;
      },
    },
    plans: { tenantHasFeature: async () => true },
    resolver: { resolveForExecution: async () => ({ ok: true }) },
    events: { record: async () => undefined },
    gemini: { isConfigured: async () => false },
  });
  return { service, seen };
}

const CAPS: Capability[] = [
  "leads.edit",
  "leads.view_own",
  "buyers.edit",
  "properties.create",
];

const run = <T,>(fn: () => T, caps: Capability[] = CAPS): T =>
  TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(caps), billingOnly: false },
    fn,
  );

describe("‏„המר ללקוח” בוחרת שיחה", () => {
  /*
   * ‎**שלושת המצביעים.** התראת התמלול מצביעה על השיחה; ההתראה על
   * ‏שיחה שלא נענתה — המקרה שבשבילו זה נבנה — מצביעה על הליד שנפתח,
   * ‏ואחרת על הכרטיס של המתקשר. מצביע מסוג אחד היה מכסה את הסיכום
   * ‏ומחמיץ בדיוק את השיחה שלא נענתה.
   */
  it("‏לפי המצביע שבכפתור — שיחה, ליד או כרטיס", async () => {
    for (const [ref, expected] of [
      [{ kind: "call", id: CALL } as const, { id: CALL }],
      [{ kind: "lead", id: LEAD } as const, { leadId: LEAD }],
      [{ kind: "contact", id: CONTACT } as const, { contactId: CONTACT }],
    ] as const) {
      const built = serviceFor([call()]);
      await run(() =>
        built.service.execute(
          "convert_call",
          {},
          callConvertCommand(SAID, ref),
          "whatsapp",
        ),
      );
      expect(built.seen.queries[0], ref.kind).toMatchObject(expected);
    }
  });

  /*
   * ‏הקלדה חופשית אינה נושאת מצביע — ואז „האחרונה שאפשר להמיר”.
   * ‏השאילתה חייבת להיות בלי מסנן זהות, אחרת המסלול הזה מת.
   */
  it("‏ובלי מצביע — האחרונות, בלי מסנן זהות", async () => {
    const built = serviceFor([call()]);
    await run(() => built.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"));
    const query = built.seen.queries[0]!;
    expect(query["id"]).toBeUndefined();
    expect(query["contactId"]).toBeUndefined();
    expect(query["leadId"]).toBeUndefined();
  });

  /*
   * ‎**ליד שכבר הומר מדלג ואינו עוצר.** שיחה שכבר הפכה ללקוח היא
   * ‏הראשונה ברשימה בדיוק במקרה הנפוץ — דיברו איתו, פתחו כרטיס,
   * ‏ואז נכנסה שיחה חדשה.
   */
  it("‏ומדלגת על שיחה שכבר הומרה", async () => {
    const built = serviceFor([
      call({ leadId: LEAD, leadStatus: "converted" }),
      call({ id: OTHER, contactName: "דנה כהן" }),
    ]);
    const result = await run(() =>
      built.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"),
    );
    expect(result.callConvert?.callId).toBe(OTHER);
  });

  it("‏וכשאין מה להמיר — עובדה, ולא שגיאה", async () => {
    const built = serviceFor([call({ leadId: LEAD, leadStatus: "converted" })]);
    const result = await run(() =>
      built.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"),
    );
    expect(result.message).toBe(CALL_CONVERT_NONE);
    expect(result.callConvert).toBeUndefined();
  });

  /*
   * ‎**השאלה נושאת מי — ולא טלפון.**
   *
   * ‏‎`message` נשמר לזיכרון השיחה, וזיכרון השיחה נוסע לפרומפט של
   * ‏מודל חיצוני. זה אותו כלל שבגללו `link` הוא שדה נפרד — וכאן
   * ‏הוא נבדק, כי המקור היחיד לזיהוי בשיחה של מתקשר לא מוכר הוא
   * ‏המספר שלו.
   */
  it("‏והשאלה מזהה בשם, או במועד — לעולם לא במספר", async () => {
    const named = serviceFor([call({ contactName: "דנה כהן", phone: "+972501234567" })]);
    const withName = await run(() =>
      named.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"),
    );
    expect(withName.message).toContain("דנה כהן");
    expect(withName.message).not.toContain("501234567");

    const unknown = serviceFor([call({ phone: "+972501234567" })]);
    const noName = await run(() =>
      unknown.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"),
    );
    expect(noName.message).not.toContain("501234567");
    /* ‏המועד הוא הזיהוי — בלעדיו השאלה היא בקשה לנחש */
    expect(noName.message).toContain("09.09");
    for (const label of ["קונה", "שוכר", "מוכר", "משכיר"]) {
      expect(noName.message, label).toContain(label);
    }
  });

  /*
   * ‎**רק הסוגים שאפשר להשלים** (ביקורת Codex, P2). בחירה בסוג
   * ‏חסום הייתה פותחת ליד ואז נדחית בשער של פעולת ההמרה — ליד
   * ‏שנפתח לחינם, אחרי תפריט שהבטיח מה שאינו יכול לבצע.
   */
  it("‏והשאלה מונה רק את הסוגים שהמתווך יכול לפתוח", async () => {
    const built = serviceFor([call()]);
    const result = await run(
      () => built.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"),
      ["leads.edit", "leads.view_own", "buyers.edit"],
    );
    expect(result.message).toContain("קונה");
    expect(result.message).not.toContain("משכיר");
  });

  it("‏ובלי אף אחת מהן — אומרת שזו הרשאה, ואינה שואלת", async () => {
    const built = serviceFor([call()]);
    const result = await run(
      () => built.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"),
      ["leads.edit", "leads.view_own"],
    );
    expect(result.message).toBe(CALL_CONVERT_NO_KINDS);
    expect(result.callConvert).toBeUndefined();
  });

  /*
   * ‎**מה שהשיחה ידעה נוסע יחד** (ביקורת Codex, P2) — אחרת הכרטיס
   * ‏נפתח ריק על שיחה שכל הפרטים נאמרו בה.
   */
  it("‏ומה שחולץ מהשיחה נוסע עם המזהה", async () => {
    const built = serviceFor([
      call({ highlights: { city: "רמת גן", rooms: 4, budget: 2_400_000 } }),
    ]);
    const result = await run(() =>
      built.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"),
    );
    expect(result.callConvert?.seed).toEqual({
      city: "רמת גן",
      rooms: 4,
      priceShekels: 2_400_000,
    });
  });

  /*
   * ‎**אותו שער של כל פעולה.** הפעולה מגיעה מגוף הבקשה, ולכן
   * ‏היכולת שהנתיב מצהיר עליה אינה מספיקה.
   */
  it("‏ובלי `leads.edit` — נדחית, ולא מחזירה שיחה", async () => {
    const built = serviceFor([call()]);
    await expect(
      run(
        () => built.service.execute("convert_call", {}, "המר ללקוח", "whatsapp"),
        ["leads.view_own"],
      ),
    ).rejects.toThrow();
    expect(built.seen.queries).toHaveLength(0);
  });
});
