import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ContactsService } from "./contacts.service";

/**
 * ‎**„הוספת אדם קשור” הייתה קריאה לכרטיס מוסתר** (ביקורת Codex, P1).
 *
 * ‏הנתיב `POST /contacts/:id/people` נשמר בשער על כרטיס ה**אב**
 * ‏בלבד, ואילו `findOrCreateByPhone` מחפש משרד-רחב. כלומר סוכן
 * ‏שהקליד את הטלפון של הלקוח של עמית מיחזר את הכרטיס המוסתר שלו:
 * ‏`setEmail` דרס לו את הכתובת, והקישור שנוצר פתח את `peopleFor` —
 * ‏שמפענח שם, טלפון ואימייל. הזנת מספר, ושלושה שדות מוצפנים חזרו.
 *
 * ‏שני מקורות היתר, ולא אחד: לקוח שנגיש לי בזכות עצמו, **או** אדם
 * ‏שכבר מקושר לכרטיס הזה — אחרת עדכון תפקיד של מקושר קיים היה
 * ‏נדחה, כי אדם מקושר אינו קונה, ליד או בעל נכס.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";
const PARENT = "01PARENTAAAAAAAAAAAAAAAAAA";
const HIDDEN = "01HIDDENAAAAAAAAAAAAAAAAAA";

const AGENT: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const MANAGER: Capability[] = [...AGENT, "buyers.view_all", "properties.view_all"];

interface Options {
  /** ‏המספר שהוקלד כבר שייך לכרטיס קיים. */
  existing?: boolean;
  /** ‏ומי מחזיק בו — דרך כרטיס קונה. */
  buyerOwnerUserId?: string;
  /** ‏והאם הוא כבר מקושר לכרטיס האב. */
  alreadyLinked?: boolean;
}

interface Calls {
  emailWrites: number;
  links: number;
}

function serviceFor(options: Options): { service: ContactsService; calls: Calls } {
  const calls: Calls = { emailWrites: 0, links: 0 };
  const owner = options.buyerOwnerUserId ?? OTHER;
  const tx = {
    $executeRaw: async () => 0,
    contact: {
      findUnique: async () => (options.existing === true ? { id: HIDDEN } : null),
      findFirst: async () => ({
        id: HIDDEN,
        nameEncrypted: "n",
        phoneEncrypted: "p",
      }),
      updateMany: async () => {
        calls.emailWrites += 1;
        return { count: 1 };
      },
      create: async () => ({ id: "01NEWAAAAAAAAAAAAAAAAAAAAA" }),
    },
    contactPhone: { findUnique: async () => null },
    contactLink: {
      findFirst: async () => (options.alreadyLinked === true ? { id: "01LINK" } : null),
      upsert: async () => {
        calls.links += 1;
        return { id: "01LINK" };
      },
    },
    /* ‏מקורות `canSeeContact` — הכרטיס המוסתר הוא קונה של מישהו */
    buyer: {
      findFirst: async (args: { where: { ownerUserId?: string } }) =>
        args.where.ownerUserId === undefined || args.where.ownerUserId === owner
          ? { id: "01BUYER" }
          : null,
    },
    lead: { findFirst: async () => null },
    property: { findFirst: async () => null },
  };
  const crypto = {
    phoneHash: () => "hash",
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
    emailHash: () => "ehash",
    nameHash: () => "nhash",
  };
  return { service: new ContactsService(crypto as never), calls, tx } as never;
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

function txOf(built: unknown): never {
  return (built as { tx: unknown }).tx as never;
}

const PERSON = { name: "בת זוג", phone: "+972501234567", role: "spouse" as const };

describe("הוספת אדם קשור — מספר שכבר שייך למישהו", () => {
  it("מספר של לקוח מוסתר — נדחה", async () => {
    const built = serviceFor({ existing: true });
    await expect(
      asUser(AGENT, () =>
        built.service.linkPerson(txOf(built), PARENT, {
          ...PERSON,
          email: "new@example.com",
        }),
      ),
    ).rejects.toThrow(/אינו נגיש/u);
  });

  /*
   * ‎**והדחייה קודמת לכתיבה.** בלי זה השער היה נכון לקריאה בלבד:
   * ‏האימייל של הלקוח המוסתר כבר נדרס, והקישור כבר נוצר.
   */
  it("ולא נכתב דבר לפני הדחייה", async () => {
    const built = serviceFor({ existing: true });
    await asUser(AGENT, () =>
      built.service
        .linkPerson(txOf(built), PARENT, { ...PERSON, email: "new@example.com" })
        .catch(() => undefined),
    );
    expect(built.calls.emailWrites, "האימייל של המוסתר נדרס").toBe(0);
    expect(built.calls.links, "נוצר קישור").toBe(0);
  });

  it("מספר חדש לגמרי — נוצר כרגיל", async () => {
    const built = serviceFor({ existing: false });
    const result = await asUser(AGENT, () =>
      built.service.linkPerson(txOf(built), PARENT, PERSON),
    );
    expect(result.ok).toBe(true);
    expect(built.calls.links).toBe(1);
  });

  it("מספר של הלקוח שלי — מקושר כרגיל", async () => {
    const built = serviceFor({ existing: true, buyerOwnerUserId: ME });
    const result = await asUser(AGENT, () =>
      built.service.linkPerson(txOf(built), PARENT, PERSON),
    );
    expect(result.ok).toBe(true);
  });

  /*
   * ‏המקור השני: אדם שכבר מקושר לכרטיס הזה. „הוספתי אותה כשותפה
   * ‏ואני רוצה בת זוג” היא פעולה סבירה, ולא ניסיון לגעת בזר.
   */
  it("מקושר קיים — עדכון תפקיד עובר", async () => {
    const built = serviceFor({ existing: true, alreadyLinked: true });
    const result = await asUser(AGENT, () =>
      built.service.linkPerson(txOf(built), PARENT, PERSON),
    );
    expect(result.ok).toBe(true);
  });

  it("ומנהל משרד אינו מושפע", async () => {
    const built = serviceFor({ existing: true });
    const result = await asUser(MANAGER, () =>
      built.service.linkPerson(txOf(built), PARENT, PERSON),
    );
    expect(result.ok).toBe(true);
  });
});
