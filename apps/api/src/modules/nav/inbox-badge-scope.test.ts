import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { NavController } from "./nav.controller";

/**
 * ‎**הבאדג' סופר את מה שהתיבה מראה.**
 *
 * ‏אחרי שתיבת הדואר קיבלה סינון לפי בעלות, `/nav/summary` המשיך
 * ‏לספור כל מייל שלא נקרא במשרד. באדג' שסופר יותר מהרשימה הוא שתי
 * ‏תקלות בבת אחת: הוא **מסגיר** שיש התכתבות שהסוכן אינו רואה, והוא
 * ‏מספר שאי אפשר לאפס — אין שיחה לפתוח שתוריד אותו (ביקורת Codex).
 */

/** ‏שני מיילים שלא נקראו: אחד שלי, אחד של עמית. */
const UNREAD = [
  { contactId: "01MINE" },
  { contactId: "01THEIRS" },
];

function controllerFor(ownedContactIds: readonly string[]): NavController {
  const tx = {
    buyer: {
      count: async () => 0,
      findMany: async (args: { where: { ownerUserId?: string } }) =>
        (args.where.ownerUserId === undefined
          ? ["01MINE", "01THEIRS"]
          : ownedContactIds
        ).map((contactId) => ({ contactId })),
    },
    lead: { count: async () => 0, findMany: async () => [] },
    property: { count: async () => 0, findMany: async () => [] },
    contactLink: { findFirst: async () => null },
    match: { count: async () => 0 },
    creditLedger: { aggregate: async () => ({ _sum: { amount: 0 }, _count: 0 }) },
    task: { findMany: async () => [] },
    emailMessage: {
      count: async (args: { where: { contactId?: { in?: string[] } } }) => {
        const scope = args.where.contactId?.in;
        return scope === undefined
          ? UNREAD.length
          : UNREAD.filter((m) => scope.includes(m.contactId)).length;
      },
    },
  };
  const prisma = {
    tenant: { findUnique: async () => ({ blockedModules: [] }) },
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const plans = { tenantFeatures: async () => new Set<string>() };
  return new NavController(prisma as never, plans as never);
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: "01TENANT",
      userId: "01ME",
      capabilities: new Set(capabilities),
      billingOnly: false,
    },
    fn,
  );
}

const AGENT: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const MANAGER: Capability[] = [
  "properties.view",
  "properties.view_all",
  "buyers.view_all",
  "leads.view_all",
];

describe("באדג' התיבה בסרגל", () => {
  it("סוכן סופר רק את מה שהוא רואה", async () => {
    const summary = await asUser(AGENT, () => controllerFor(["01MINE"]).summary());
    expect(summary.emailUnread).toBe(1);
  });

  it("מנהל סופר את כל המשרד", async () => {
    const summary = await asUser(MANAGER, () => controllerFor([]).summary());
    expect(summary.emailUnread).toBe(2);
  });

  /*
   * ‏המקרה שהופך את זה לתקלה ולא לאי-דיוק: לסוכן אין ולו מייל אחד
   * ‏שהוא רואה, ובכל זאת הוצג לו „1” שאי אפשר לאפס.
   */
  it("בלי שיחות שלו — אפס, ולא מספר תקוע", async () => {
    const summary = await asUser(AGENT, () => controllerFor([]).summary());
    expect(summary.emailUnread).toBe(0);
  });
});
