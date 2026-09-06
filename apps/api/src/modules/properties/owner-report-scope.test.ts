import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PropertyActivityService } from "./property-activity.service";

/**
 * ‎**דוח הפעילות לבעל הנכס — שתי דלתות, לא אחת.**
 *
 * ‏`ownerChannels` נכתב במפורש כדי **לא** להחזיר פרטים: שני
 * ‏בוליאנים במקום טלפון ואימייל. אבל הוא החזיר גם **שם**, ושם הוא
 * ‏פרט — הוא יצא לכל מי שהנכס פתוח אצלו, כלומר לכל המשרד.
 *
 * ‏והדלת השנייה חמורה יותר: `sendToOwner` שולח בפועל, בוואטסאפ או
 * ‏במייל, בשם המשרד. שער שמסתיר את השם ומשאיר את הכפתור עובד נעצר
 * ‏בדיוק לפני המקום שבו יש נזק (ביקורת Codex, P1).
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";
const OWNER_CONTACT = "01OWNERCONTACT00000000001";

const SCOPED: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const DEFAULT: Capability[] = [...SCOPED, "properties.view_all"];

/** ‏המסד המדומה מכבד את ה-`where`: בלי `view_all` נוסף `agentUserId`. */
function serviceFor(
  propertyAgentUserId: string,
  sent: string[],
  /** ‏האם ללקוח יש **גם** כרטיס קונה של המשתמש הנוכחי. */
  alsoMyBuyer = false,
): PropertyActivityService {
  const tx = {
    property: {
      findFirst: async (args: { where: { agentUserId?: string } }) => {
        if (args.where.agentUserId !== undefined) {
          return args.where.agentUserId === propertyAgentUserId ? { id: "01PROP" } : null;
        }
        return {
          id: "01PROP",
          ownerContactId: OWNER_CONTACT,
          // ‏הפעולה היא על הבעלים **בהקשר הנכס**, ולכן השיוך נדרש
          agentUserId: propertyAgentUserId,
          marketingTitle: "דירת גן ברעננה",
          street: "אחוזה",
          houseNumber: "5",
          city: "רעננה",
        };
      },
    },
    contact: {
      findFirst: async () => ({
        nameEncrypted: "enc:בעל הנכס",
        phoneEncrypted: "enc:+972501234567",
        emailEncrypted: "enc:owner@example.com",
      }),
    },
    tenant: { findFirst: async () => ({ name: "משרד הבדיקה" }) },
    appointment: { findMany: async () => [] },
    call: { findMany: async () => [] },
    /*
     * ‎`assertContactAccess` הוא **איחוד** מקורות: כרטיס קונה שלי
     * ‏פותח את הלקוח גם כשהנכס אינו שלי. זה בדיוק התרחיש שנבדק
     * ‏למטה — לקוח שקונה דרכי ומוכר דרך עמית.
     */
    buyer: {
      findFirst: async () => (alsoMyBuyer ? { id: "01MYBUYER" } : null),
      findMany: async () => (alsoMyBuyer ? [{ contactId: OWNER_CONTACT }] : []),
    },
    lead: { findFirst: async () => null, findMany: async () => [] },
    contactLink: { findFirst: async () => null, findMany: async () => [] },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const crypto = { decrypt: (value: string) => value.replace(/^enc:/u, "") };
  const audit = { record: async () => undefined };
  const whatsapp = {
    sendAsTenant: async (_tenantId: string, to: string) => {
      sent.push(to);
      return "sent";
    },
  };
  const plans = { tenantHasFeature: async () => true };
  const email = {
    send: async (input: { to: string }) => {
      sent.push(input.to);
      return true;
    },
  };
  return new PropertyActivityService(
    prisma as never,
    audit as never,
    crypto as never,
    email as never,
    whatsapp as never,
    plans as never,
  );
}

function asUser<T>(userId: string, capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

/**
 * ‎**„מותר לי האדם” אינו „מותר לי האדם על הנכס הזה”.**
 *
 * ‏שער הלקוח הוא איחוד מקורות, ובתרחיש שכיח לגמרי — לקוח שקונה
 * ‏דרכי ומוכר דרך עמית — הוא נפתח דרך כרטיס הקונה **שלי**. משם
 * ‏יכולתי לשלוח לו דוח פעילות על הנכס של העמית, כלומר לעקוף את כל
 * ‏ההפרדה בלי שום חריגה (ביקורת Codex, P1).
 */
describe("לקוח שהוא גם הקונה שלי וגם בעל נכס של עמית", () => {
  it("הדוח על הנכס של העמית עדיין נחסם", async () => {
    await expect(
      asUser(ME, SCOPED, () =>
        serviceFor(OTHER, [], true).sendToOwner("01PROP", "whatsapp"),
      ),
    ).rejects.toThrow(/סוכן אחר/u);
  });

  it("והשם אינו מוצג בדוח של הנכס ההוא", async () => {
    const report = await asUser(ME, SCOPED, () =>
      serviceFor(OTHER, [], true).ownerChannels("01PROP"),
    );
    expect(report?.name).toBeUndefined();
  });
});

/**
 * ‎**ושני השערים נדרשים, לא אחד מהם.**
 *
 * ‏שער הנכס שואל „הנכס שלי?”, ושער הלקוח שואל „מותר לי האדם?”.
 * ‏נכס **שלי** עובר את הראשון — ואם מודול הנכסים חסום אצלי, אין לי
 * ‏דרך להגיע לבעליו בכלל. זה המקרה שבו מחיקת השער הראשון אינה
 * ‏נראית בשום בדיקה אחרת.
 */
describe("הנכס שלי, אבל המודול חסום", () => {
  /* ‏הצד החיובי נבדק למטה ב„שליחה לבעלים של הנכס שלי יוצאת כרגיל”. */
  /** ‏בלי `properties.view`: המודול חסום, ואין דרך אחרת ללקוח. */
  const NO_MODULE: Capability[] = ["buyers.view_own", "leads.view_own"];

  it("שליחה נדחית גם על הנכס שלי", async () => {
    await expect(
      asUser(ME, NO_MODULE, () =>
        serviceFor(ME, []).sendToOwner("01PROP", {}, {
          channel: "whatsapp",
          periodLabel: "החודש",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("דוח פעילות לבעל הנכס — מי רואה ומי שולח", () => {
  it("נכס של סוכן אחר — אין שם ואין ערוצים", async () => {
    const report = await asUser(ME, SCOPED, () => serviceFor(OTHER, []).report("01PROP", {}));
    expect(report.owner.name).toBeUndefined();
    expect(report.owner.whatsapp).toBe(false);
    expect(report.owner.email).toBe(false);
  });

  /*
   * ‏הצד השני: הדוח עצמו — פעילות הנכס — נשאר. הנכס משותף בכוונה,
   * ‏ומה שאינו משותף הוא האדם.
   */
  it("הדוח עצמו נשאר גלוי — רק האדם יורד", async () => {
    const report = await asUser(ME, SCOPED, () => serviceFor(OTHER, []).report("01PROP", {}));
    expect(report.summary.total).toBe(0);
    expect(report.entries).toEqual([]);
  });

  it("הנכס שלי — השם והערוצים מוצגים", async () => {
    const report = await asUser(ME, SCOPED, () => serviceFor(ME, []).report("01PROP", {}));
    expect(report.owner.name).toBe("בעל הנכס");
    expect(report.owner.whatsapp).toBe(true);
  });

  it("ברירת המחדל אינה משנה דבר", async () => {
    const report = await asUser(ME, DEFAULT, () => serviceFor(OTHER, []).report("01PROP", {}));
    expect(report.owner.name).toBe("בעל הנכס");
  });

  it("שליחה לבעלים של סוכן אחר נדחית — ושום דבר לא יוצא", async () => {
    const sent: string[] = [];
    await expect(
      asUser(ME, SCOPED, () =>
        serviceFor(OTHER, sent).sendToOwner("01PROP", {}, {
          channel: "whatsapp",
          periodLabel: "החודש",
        }),
      ),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("שליחה לבעלים של הנכס שלי יוצאת כרגיל", async () => {
    const sent: string[] = [];
    await asUser(ME, SCOPED, () =>
      serviceFor(ME, sent).sendToOwner("01PROP", {}, {
        channel: "whatsapp",
        periodLabel: "החודש",
      }),
    );
    expect(sent).toEqual(["+972501234567"]);
  });
});
