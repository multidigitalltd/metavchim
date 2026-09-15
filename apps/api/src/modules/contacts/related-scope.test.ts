import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ContactsController } from "./contacts.controller";

/**
 * ‎**„מה עוד קשור לאדם הזה” — שאלה שמאשרת שהוא קיים.**
 *
 * ‏הנתיב בדק את הלקוח לפי `id` ו-`tenantId` בלבד, ולכן מי שיודע
 * ‏מזהה של בעל נכס מוסתר יכול היה לאשר שהוא קיים; וענף הנכסים
 * ‏נשלף בלי סינון בעלות — כי „הנכסים גלויים לכל המשרד”, שהיה נכון
 * ‏עד שנוספה `properties.view_all` — ולכן הוא גם ראה **איזה נכס
 * ‏בדיוק** שייך לו (ביקורת Codex).
 *
 * ‏הנכס עצמו אכן משרדי. מה שאינו משרדי הוא **הקישור** בינו לבין
 * ‏האדם, וזה בדיוק מה שהמסך הזה מציג.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";
const CONTACT = "01CONTACTAAAAAAAAAAAAAAAAA";

const AGENT: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const DEFAULT: Capability[] = [...AGENT, "properties.view_all"];

/** ‏הלקוח הוא **רק** בעל נכס — לא קונה ולא ליד. */
function controllerFor(
  propertyAgentUserId: string,
  buyerOwnerUserId: string | null = null,
): ContactsController {
  const owns = (where: { agentUserId?: string }): boolean =>
    where.agentUserId === undefined || where.agentUserId === propertyAgentUserId;
  const ownsBuyer = (where: { ownerUserId?: string }): boolean =>
    buyerOwnerUserId !== null &&
    (where.ownerUserId === undefined || where.ownerUserId === buyerOwnerUserId);

  const tx = {
    contact: { findFirst: async () => ({ id: CONTACT }) },
    buyer: {
      findFirst: async (args: { where: { ownerUserId?: string } }) =>
        ownsBuyer(args.where) ? { id: "01BUYERAAAAAAAAAAAAAAAAAAA" } : null,
      findMany: async (args: { where: { ownerUserId?: string } }) =>
        ownsBuyer(args.where)
          ? [{ id: "01BUYERAAAAAAAAAAAAAAAAAAA", maturity: "warm" }]
          : [],
    },
    lead: { findFirst: async () => null, findMany: async () => [] },
    property: {
      findFirst: async (args: { where: { agentUserId?: string } }) =>
        owns(args.where) ? { id: "01PROPAAAAAAAAAAAAAAAAAAAA" } : null,
      findMany: async (args: { where: { agentUserId?: string } }) =>
        owns(args.where)
          ? [
              {
                id: "01PROPAAAAAAAAAAAAAAAAAAAA",
                marketingTitle: "דירת גן",
                city: "רעננה",
                status: "active",
              },
            ]
          : [],
    },
  };
  const controller = Object.create(ContactsController.prototype) as Record<string, unknown>;
  controller["prisma"] = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  return controller as never;
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

describe("ישויות מקושרות ללקוח", () => {
  it("בעל נכס של עמית — נדחה, ולא „קיים אבל ריק”", async () => {
    await expect(
      asUser(AGENT, () => controllerFor(OTHER).related(CONTACT)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("הנכס שלי — הקישור מוצג", async () => {
    const result = await asUser(AGENT, () => controllerFor(ME).related(CONTACT));
    expect(result.ownedProperties).toHaveLength(1);
  });

  it("ברירת המחדל אינה משנה דבר", async () => {
    const result = await asUser(DEFAULT, () => controllerFor(OTHER).related(CONTACT));
    expect(result.ownedProperties).toHaveLength(1);
  });

  /*
   * ‎**השער והסינון אינם אותו דבר, וצריך את שניהם.**
   *
   * ‏הלקוח הזה מותר לי לגמרי — הוא הקונה **שלי**. השער נפתח כראוי,
   * ‏וכל מה שנשאר לשמור הוא הקישור בינו לבין הנכס של עמיתי: המסך
   * ‏הזה מציג בדיוק „אילו נכסים שייכים לאדם הזה”, וזה הקישור
   * ‏שהיכולת מגנה עליו. בלי הסינון על הקבוצה, השער לבדו לא היה
   * ‏מספיק.
   */
  it("לקוח שמותר לי דרך כרטיס קונה אינו גורר את הנכס של עמיתי", async () => {
    const result = await asUser(AGENT, () => controllerFor(OTHER, ME).related(CONTACT));
    expect(result.buyers).toHaveLength(1);
    expect(result.ownedProperties).toEqual([]);
  });
});
