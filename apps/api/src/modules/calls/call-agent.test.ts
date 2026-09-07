import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { CallsService } from "./calls.service";

/**
 * ‎**„לאיזה סוכן השיחה הגיעה” — למנהל, ורק לו.**
 *
 * ## ‏שתי טענות
 *
 * ‎1. **מי רואה.** סוכן רגיל רואה ממילא רק את השיחות שלו, ושם
 *    ‏הסוכן לידן היה רעש; אבל חשוב מזה — הוא לא אמור לדעת שהשיחה
 *    ‏של הלקוח שאינו שלו הגיעה דווקא לעמית מסוים. השרת מכריע,
 *    ‏ולא הדפדפן: השדה פשוט אינו נשלח.
 * ‎2. **מה נאמר כשאין סוכן מוכר.** „שלוחה 203” היא תשובה חלקית
 *    ‏ושימושית; שורה שותקת אינה תשובה בכלל. וניחוש — למשל להחזיר
 *    ‏את מי שרשם את השיחה ידנית — הוא בדיוק מה שהעמודות האלה
 *    ‏נכתבו כדי למנוע.
 */

interface Row {
  agentUserId: string | null;
  agentExtension: string | null;
}

function serviceFor(): CallsService {
  const prisma = {
    withTenant: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}),
  };
  return new CallsService(
    prisma as never,
    { encrypt: (v: string) => v, decrypt: (v: string) => v } as never,
    { getById: () => Promise.resolve(null) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

/** ‏קריאה ישירה ל-`toDto` — הפונקציה הפרטית שכל שלושת הנתיבים עוברים בה. */
async function dto(
  capabilities: Capability[],
  row: Row,
  names: Map<string, string>,
): Promise<{ agentName?: string; agentExtension?: string }> {
  return TenantContext.run(
    {
      tenantId: "01TENANT",
      userId: "01ME",
      capabilities: new Set(capabilities),
      billingOnly: false,
    },
    () =>
      (
        serviceFor() as unknown as {
          toDto: (
            tx: unknown,
            row: unknown,
            c: undefined,
            l: undefined,
            n: Map<string, string>,
          ) => Promise<{ agentName?: string; agentExtension?: string }>;
        }
      ).toDto(
        {},
        {
          id: "01CALL",
          direction: "inbound",
          source: "provider",
          contactId: null,
          leadId: null,
          phoneEncrypted: null,
          occurredAt: new Date(),
          durationMinutes: null,
          outcome: "answered",
          summary: null,
          createdAt: new Date(),
          ...row,
        },
        undefined,
        undefined,
        names,
      ),
  );
}

/** ‏סוכן: רואה את שלו בלבד. */
const AGENT: Capability[] = ["buyers.view_own", "leads.view_own", "properties.view"];
/**
 * ‏מנהל: `seesAllContacts()` מחזירה `true` רק כששלושת המקורות
 * ‏פתוחים לרוחב — קונים, לידים **ונכסים**. שניים מתוך שלושה אינם
 * ‏„רואה הכול”.
 */
const MANAGER: Capability[] = [
  ...AGENT,
  "buyers.view_all",
  "leads.view_all",
  "properties.view_all",
];

const NAMES = new Map([["01AGENT", "רותם"]]);

describe("מי קיבל את השיחה", () => {
  it("מנהל רואה את שם הסוכן", async () => {
    const out = await dto(MANAGER, { agentUserId: "01AGENT", agentExtension: "203" }, NAMES);
    expect(out.agentName).toBe("רותם");
  });

  /** ‏הטענה המרכזית: אצל סוכן רגיל השדה **אינו נשלח**, ולא רק מוסתר. */
  it("סוכן רגיל אינו מקבל את השדה כלל", async () => {
    const out = await dto(AGENT, { agentUserId: "01AGENT", agentExtension: "203" }, NAMES);
    expect(out.agentName).toBeUndefined();
    expect(out.agentExtension).toBeUndefined();
  });

  it("בלי סוכן מוכר — השלוחה, ולא שתיקה", async () => {
    const out = await dto(MANAGER, { agentUserId: null, agentExtension: "203" }, NAMES);
    expect(out.agentName).toBeUndefined();
    expect(out.agentExtension).toBe("203");
  });

  it("יש שם — השלוחה אינה מוצגת גם היא", async () => {
    const out = await dto(MANAGER, { agentUserId: "01AGENT", agentExtension: "203" }, NAMES);
    expect(out.agentExtension).toBeUndefined();
  });

  it("סוכן שעזב — לא ממציאים שם, וגם לא נופלים לשלוחה", async () => {
    const out = await dto(MANAGER, { agentUserId: "01GONE", agentExtension: null }, NAMES);
    expect(out.agentName).toBeUndefined();
    expect(out.agentExtension).toBeUndefined();
  });

  /**
   * ‎**„כמעט מנהל” אינו מנהל.** התנאי הוא שלושת המקורות יחד, וזו
   * ‏בדיוק הבדיקה שתיפול ביום שמישהו יחליף אותו ביכולת אחת נוחה.
   */
  it("מי שחסרה לו ראייה רוחבית על הקונים אינו רואה", async () => {
    const out = await dto(
      [...AGENT, "leads.view_all", "properties.view_all"],
      { agentUserId: "01AGENT", agentExtension: "203" },
      NAMES,
    );
    expect(out.agentName).toBeUndefined();
    expect(out.agentExtension).toBeUndefined();
  });

  it("שיחה ישנה בלי שתי העמודות אינה שוברת דבר", async () => {
    const out = await dto(MANAGER, { agentUserId: null, agentExtension: null }, NAMES);
    expect(out.agentName).toBeUndefined();
    expect(out.agentExtension).toBeUndefined();
  });
});

/**
 * ‎**כלל ההכרעה בכתיבה — נבדק מול הקוד.**
 *
 * ‏השלוחה שענתה קודמת לניתוב שנצפה: שיחה שנותבה לאחד וענה עליה
 * ‏אחר **הגיעה** לשני. זו הכרעה שקל להפוך בעריכה תמימה, והיא
 * ‏אינה נראית בשום בדיקה התנהגותית בלי מרכזייה אמיתית.
 */
describe("שער: מי קיבל נקבע לפי מי שענה", () => {
  it("השלוחה מנצחת את הניתוב בכתיבת שורת השיחה", () => {
    const source = readFileSync(
      join(__dirname, "..", "telephony", "telephony.service.ts"),
      "utf8",
    );
    const write = source.slice(source.indexOf("agentUserId:"), source.indexOf("agentExtension:"));
    const answered = write.indexOf("answeredBy");
    const routed = write.indexOf("assignedToUserId");
    expect(answered, "‏מי שענה חייב להופיע בביטוי").toBeGreaterThanOrEqual(0);
    expect(routed, "‏והניתוב הוא הנפילה").toBeGreaterThanOrEqual(0);
    /*
     * ‎**סדר ולא נוכחות.** הניסוח הראשון כאן בדק ש-`answeredBy?.id`
     * ‏מופיע לפני `??` — וזה נכון **גם** בשרשרת ההפוכה, שבה הוא
     * ‏האופרנד השני. מוטציה שהפכה את הסדר עברה את השער בשקט. בשרשרת
     * ‏`??` הראשון הוא המנצח, ולכן זו הטענה: מי שענה נשאל **לפני**
     * ‏מי שאליו נותב.
     */
    expect(answered, "‏מי שענה נשאל לפני מי שאליו נותב").toBeLessThan(routed);
  });
});
