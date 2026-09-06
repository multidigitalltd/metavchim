import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AgentExecuteService } from "./execute.service";

/**
 * ‎**והדלת השלישית: העוזר.**
 *
 * ‏„שלח הודעה לבעלים של הנכס ברחוב אחוזה” הוא משפט שכל סוכן יכול
 * ‏להגיד, והפעולה מקבלת **מזהה נכס** — שהוא משרדי בכוונה. התשובה
 * ‏חוזרת עם קישור שנושא את הטלפון ועם משפט שנושא את השם, וההודעה
 * ‏נרשמת ב-Messages Hub כאילו יצאה מהמשרד (ביקורת Codex, P1).
 *
 * ‏שלוש הדלתות — כרטיס הנכס, דוח הפעילות והעוזר — הן אותה שאלה
 * ‏אחת, ולכן כולן עוברות דרך `assertContactAccess` ולא דרך שלושה
 * ‏תנאים מקומיים.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";
const OWNER_CONTACT = "01OWNERCONTACT00000000001";

const SCOPED: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const DEFAULT: Capability[] = [...SCOPED, "properties.view_all"];

/**
 * ‏הפעולה היא מתודה פרטית בשירות עם עשרות תלויות, ולכן היא נבנית
 * ‏מהפרוטוטיפ עם השדות שהיא באמת נוגעת בהם. זו עדיין בדיקת
 * ‏**התנהגות** — הקוד שרץ הוא הקוד שבייצור, ולא העתק שלו.
 */
function executorFor(
  propertyAgentUserId: string,
  recorded: string[],
): { messageOwner: (params: Record<string, unknown>) => Promise<{ link?: string }> } {
  const tx = {
    property: {
      findFirst: async (args: { where: { agentUserId?: string } }) => {
        if (args.where.agentUserId !== undefined) {
          return args.where.agentUserId === propertyAgentUserId ? { id: "01PROP" } : null;
        }
        return {
          ownerContactId: OWNER_CONTACT,
          // ‏הפעולה היא על הבעלים **בהקשר הנכס**, ולכן השיוך נדרש
          agentUserId: propertyAgentUserId,
          marketingTitle: "דירת גן ברעננה",
          street: "אחוזה",
          city: "רעננה",
        };
      },
    },
    buyer: { findFirst: async () => null },
    lead: { findFirst: async () => null },
  };
  const service = Object.create(AgentExecuteService.prototype) as Record<string, unknown>;
  service["prisma"] = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  service["contacts"] = {
    getById: async () => ({
      id: OWNER_CONTACT,
      name: "בעל הנכס",
      phone: "+972501234567",
    }),
  };
  service["messaging"] = {
    recordOutbound: async (_tx: unknown, input: { contactId: string }) => {
      recorded.push(input.contactId);
    },
  };
  return service as never;
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

const PARAMS = { propertyId: "01PROP", messageBody: "שלום, יש התקדמות" };

describe("העוזר — הודעה לבעל הנכס", () => {
  it("נכס של סוכן אחר — נדחה, ושום דבר לא נרשם", async () => {
    const recorded: string[] = [];
    await expect(
      asUser(SCOPED, () => executorFor(OTHER, recorded).messageOwner(PARAMS)),
    ).rejects.toThrow();
    expect(recorded).toEqual([]);
  });

  it("הנכס שלי — הקישור נבנה כרגיל", async () => {
    const recorded: string[] = [];
    const result = await asUser(SCOPED, () => executorFor(ME, recorded).messageOwner(PARAMS));
    expect(result.link).toContain("972501234567");
    expect(recorded).toEqual([OWNER_CONTACT]);
  });

  it("ברירת המחדל אינה משנה דבר", async () => {
    const recorded: string[] = [];
    const result = await asUser(DEFAULT, () => executorFor(OTHER, recorded).messageOwner(PARAMS));
    expect(result.link).toContain("972501234567");
  });
});
