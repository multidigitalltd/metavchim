import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PropertiesService } from "./properties.service";

/**
 * ‎**המעקף: כרטיס הנכס.**
 *
 * ‏רשימת הנכסים משרדית בכוונה, ולכן לכל סוכן יש את מזהה כל נכס.
 * ‏כשההפרדה החדשה הסתירה את בעל הנכס מהדואר, מהשיחות, מההסכמים
 * ‏ומהחיפוש — `GET /properties/:id` המשיך להחזיר את השם, הטלפון
 * ‏והמייל שלו, כי הוא דורש רק `properties.view` (ביקורת Codex, P1).
 * ‏הגנה שיש לה מעקף בן צעד אחד אינה הגנה.
 *
 * ‏מה שיורד הוא **האדם**, לא הכרטיס: הכתובת, המחיר והמצב נשארים
 * ‏גלויים, כי הנכס עצמו אכן משותף.
 */

const OWNER_CONTACT = "01OWNERCONTACT00000000001";

function serviceFor(propertyAgentUserId: string | null): PropertiesService {
  const tx = {
    property: {
      findFirst: async (args: { where: { agentUserId?: string } }) => {
        // ‏הבדיקה של `canSeeContact` מגיעה עם `agentUserId` כשאין view_all
        if (args.where.agentUserId !== undefined) {
          return args.where.agentUserId === propertyAgentUserId ? { id: "01PROP" } : null;
        }
        return {
          id: "01PROP",
          tenantId: "01TENANT",
          status: "active",
          city: "רעננה",
          street: "אחוזה",
          propertyType: "apartment",
          dealType: "sale",
          ownerContactId: OWNER_CONTACT,
          occupantContactId: null,
          agentUserId: propertyAgentUserId,
          marketingTitle: null,
          marketingDescription: null,
          internalNotes: null,
          features: {},
          leaseEndsAt: null,
          noticePeriodDays: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    propertyMedia: { findFirst: async () => null },
    buyer: { findFirst: async () => null, findMany: async () => [] },
    lead: { findFirst: async () => null, findMany: async () => [] },
    contactLink: { findFirst: async () => null },
    user: { findMany: async () => [] },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const contacts = {
    getById: async () => ({
      id: OWNER_CONTACT,
      name: "בעל הנכס",
      phone: "+972501234567",
      email: "owner@example.com",
    }),
  };
  return new PropertiesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    contacts as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
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

const SCOPED: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const DEFAULT: Capability[] = [...SCOPED, "properties.view_all"];

describe("כרטיס נכס — פרטי הבעלים", () => {
  it("ברירת המחדל אינה משנה דבר: הבעלים מוצג", async () => {
    const dto = await asUser(DEFAULT, () => serviceFor("01OTHER").getById("01PROP"));
    expect(dto.ownerContact?.phone).toBe("+972501234567");
  });

  it("נכס של סוכן אחר — הבעלים יורד מהכרטיס", async () => {
    const dto = await asUser(SCOPED, () => serviceFor("01OTHER").getById("01PROP"));
    expect(dto.ownerContact).toBeUndefined();
  });

  /*
   * ‏הצד השני: השמטה ולא חסימה. הכרטיס עצמו נשאר — הנכס אכן משותף,
   * ‏ומה שאינו משותף הוא האדם.
   */
  it("הכרטיס עצמו נשאר גלוי — רק האדם יורד", async () => {
    const dto = await asUser(SCOPED, () => serviceFor("01OTHER").getById("01PROP"));
    expect(dto.id).toBe("01PROP");
    expect(dto.city).toBe("רעננה");
  });

  it("הנכס שלי — הבעלים מוצג כרגיל", async () => {
    const dto = await asUser(SCOPED, () => serviceFor("01ME").getById("01PROP"));
    expect(dto.ownerContact?.phone).toBe("+972501234567");
  });
});
