import { Logger, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import type { PrismaService } from "../../core/prisma.service";
import type { ContactsService } from "../contacts/contacts.service";
import type { GmailService, GmailLinkRow } from "./gmail.service";
import { GmailOutboundService } from "./gmail-outbound.service";

/**
 * ‎**„לא לראות אותו, לשלוח אליו” — הצורה החמורה של הדליפה.**
 *
 * ‏שאר הממצאים בסבב הזה חושפים מידע. זה **יוצר** אותו: מייל שיוצא
 * ‏מהתיבה של הסוכן אל בעל הנכס של עמיתו נראה ללקוח כפנייה מהמשרד,
 * ‏והוא קיים גם אחרי שנסגור כל מסך (ביקורת Codex, P1).
 *
 * ‏הכתובת אכן נשלפת מהכרטיס ולא מהמסך — אבל **מזהה הלקוח מגיע
 * ‏מהמסך**, ורשימת הנכסים משרדית בכוונה. `leadId` לא כיסה את זה:
 * ‏הוא אופציונלי, והשמטתו דילגה על האימות היחיד שהיה כאן.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const AGENT = "01AGENTAAAAAAAAAAAAAAAAAAA";
const COLLEAGUE = "01COLLEAGUEAAAAAAAAAAAAAAA";
const CONTACT = "01CONTACTAAAAAAAAAAAAAAAAA";

const AGENT_CAPS: Capability[] = ["properties.view", "leads.edit", "leads.view_own"];
const MANAGER_CAPS: Capability[] = [
  "properties.view",
  "properties.view_all",
  "leads.edit",
  "leads.view_all",
  "buyers.view_all",
];

const LINK = { tenantId: TENANT } as unknown as GmailLinkRow;

/** ‏הלקוח הוא **רק** בעל נכס — לא קונה ולא ליד. */
function prismaFor(propertyAgentUserId: string): PrismaService {
  const tx = {
    property: {
      findFirst: async (args: { where: { agentUserId?: string } }) =>
        args.where.agentUserId === undefined || args.where.agentUserId === propertyAgentUserId
          ? { id: "01PROPAAAAAAAAAAAAAAAAAAAA" }
          : null,
    },
    buyer: { findFirst: async () => null },
    lead: { findFirst: async () => null },
    interaction: { create: async () => ({}) },
  };
  return {
    withExplicitTenant: async <T>(_tenantId: string, fn: (t: typeof tx) => Promise<T>): Promise<T> =>
      fn(tx),
  } as unknown as PrismaService;
}

function serviceFor(
  propertyAgentUserId: string,
  sent: string[],
): GmailOutboundService {
  const gmail = {
    sendMail: async (_link: GmailLinkRow, mail: { to: string }) => {
      sent.push(mail.to);
    },
  } as unknown as GmailService;
  const contacts = {
    emailFor: async () => "owner@example.com",
  } as unknown as ContactsService;
  return new GmailOutboundService(prismaFor(propertyAgentUserId), gmail, contacts);
}

async function sendAs(
  userId: string,
  caps: Capability[],
  propertyAgentUserId: string,
  sent: string[],
): Promise<void> {
  const service = serviceFor(propertyAgentUserId, sent);
  return TenantContext.run(
    { tenantId: TENANT, userId, capabilities: new Set(caps), billingOnly: false },
    () => service.sendToContact(LINK, { contactId: CONTACT, subject: "שלום", body: "תוכן" }),
  );
}

describe("שליחת מייל מ-Gmail ללקוח שאינו שלי", () => {
  // ‏שליחה מוצלחת רושמת ביומן; אין מה ללמוד מזה בפלט הבדיקות
  let log: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });
  afterAll(() => log.mockRestore());

  it("סוכן חסום נדחה — ושום דבר לא נשלח", async () => {
    const sent: string[] = [];
    await expect(sendAs(AGENT, AGENT_CAPS, COLLEAGUE, sent)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sent).toEqual([]);
  });

  /*
   * ‏החצי השני: שער שחוסם גם את המנהל אינו הידוק אלא תקלה — ומייל
   * ‏שאינו יוצא הוא לקוח שלא נענה.
   */
  it("המנהל שולח כרגיל", async () => {
    const sent: string[] = [];
    await sendAs(AGENT, MANAGER_CAPS, COLLEAGUE, sent);
    expect(sent).toEqual(["owner@example.com"]);
  });

  it("הנכס שלי — הסוכן שולח כרגיל", async () => {
    const sent: string[] = [];
    await sendAs(AGENT, AGENT_CAPS, AGENT, sent);
    expect(sent).toEqual(["owner@example.com"]);
  });

  /*
   * ‏ברירת המחדל אינה משנה דבר: `properties.view_all` ניתנת לכל
   * ‏תפקיד שיש לו `properties.view`.
   */
  it("סוכן עם היכולת כברירת מחדל שולח כרגיל", async () => {
    const sent: string[] = [];
    await sendAs(AGENT, [...AGENT_CAPS, "properties.view_all"], COLLEAGUE, sent);
    expect(sent).toEqual(["owner@example.com"]);
  });
});

/**
 * ‎**ואיפה התיעוד נוחת — שאלה נפרדת מ„מותר לי הלקוח”** (ביקורת
 * ‏Codex, P1, סבב שני).
 *
 * ‏שער הלקוח הוא **איחוד מקורות**: לקוח שנגיש לי דרך כרטיס הקונה
 * ‏שלי עובר אותו גם כשיש לו ליד פתוח של עמית. ואז הגוף המלא של
 * ‏המייל — הכתובת, הנושא והטקסט — נכתב לציר הזמן של הליד ההוא.
 *
 * ‏שני נתיבים, ושניהם היו פתוחים: `leadId` שנמסר נבדק מול הלקוח
 * ‏בלבד, והשמטתו הפילה את הבחירה על `openLeadFor` שסינן לפי דייר
 * ‏בלבד.
 */
describe("‏הליד שהמייל מתועד בו הוא ליד שמותר לי", () => {
  const MY_LEAD = "01LEADMINEAAAAAAAAAAAAAAAA";
  const THEIR_LEAD = "01LEADTHEIRSAAAAAAAAAAAAAA";

  /*
   * ‏הסוכן רואה את הלקוח **דרך כרטיס הקונה שלו** — זה מה שפותח את
   * ‏שער האיחוד, וזה בדיוק התרחיש שהממצא תיאר. בלי `buyers.view_own`
   * ‏הלקוח כלל לא נגיש, והבדיקה הייתה נופלת מסיבה אחרת.
   */
  const BUYER_AGENT_CAPS: Capability[] = [...AGENT_CAPS, "buyers.view_own"];

  interface LeadRow {
    id: string;
    assignedToUserId: string;
  }

  /** ‏לקוח שנגיש דרך כרטיס הקונה שלי, ויש לו לידים של שני סוכנים. */
  function prismaWithLeads(leads: LeadRow[], written: string[]): PrismaService {
    const tx = {
      property: { findFirst: async () => null },
      /* ‏זה מה שפותח את שער הלקוח — כרטיס קונה שלי */
      buyer: { findFirst: async () => ({ id: "01BUYERAAAAAAAAAAAAAAAAAAA" }) },
      contactLink: { findFirst: async () => null },
      /*
       * ‎**הפיקסצ׳ר מכבד את הצורה ש-`leadOwnershipFilter` בונה
       * ‏בפועל** — `OR` של „משויך אליי” ו„בלי משויך”, ולא שוויון
       * ‏פשוט. פיקסצ׳ר שמתעלם מ-`OR` היה מחזיר את אותה שורה לכל
       * ‏שאילתה, כלומר לא בודק דבר.
       */
      lead: {
        findFirst: async (args: {
          where: {
            id?: string;
            OR?: { assignedToUserId: string | null }[];
            id_in?: { in: string[] };
          };
        }) => {
          const { id, OR } = args.where;
          const allowed = (row: LeadRow): boolean =>
            OR === undefined ||
            OR.some((branch) => branch.assignedToUserId === row.assignedToUserId);
          return (
            leads.find((row) => (id === undefined || row.id === id) && allowed(row)) ?? null
          );
        },
      },
      interaction: {
        create: async (args: { data: { leadId: string } }) => {
          written.push(args.data.leadId);
          return {};
        },
      },
    };
    return {
      withExplicitTenant: async <T>(
        _tenantId: string,
        fn: (t: typeof tx) => Promise<T>,
      ): Promise<T> => fn(tx),
    } as unknown as PrismaService;
  }

  function serviceWithLeads(leads: LeadRow[], written: string[]): GmailOutboundService {
    const gmail = { sendMail: async () => undefined } as unknown as GmailService;
    const contacts = {
      emailFor: async () => "owner@example.com",
    } as unknown as ContactsService;
    return new GmailOutboundService(prismaWithLeads(leads, written), gmail, contacts);
  }

  function asAgent<T>(caps: Capability[], fn: () => T): T {
    return TenantContext.run(
      { tenantId: TENANT, userId: AGENT, capabilities: new Set(caps), billingOnly: false },
      fn,
    );
  }

  /*
   * ‎**זה המקרה שהממצא תיאר.** הליד היחיד של הלקוח הוא של העמית,
   * ‏ולכן אין ליד מותר — המייל נשלח ואינו מתועד, בדיוק כמו כשאין
   * ‏ליד פתוח בכלל.
   */
  it("בלי מזהה — ליד של עמית אינו נבחר לתיעוד", async () => {
    const written: string[] = [];
    const service = serviceWithLeads([{ id: THEIR_LEAD, assignedToUserId: COLLEAGUE }], written);
    await asAgent(BUYER_AGENT_CAPS, () =>
      service.sendToContact(LINK, { contactId: CONTACT, subject: "נושא", body: "גוף" }),
    );
    expect(written, "הגוף המלא נכתב לציר הזמן של העמית").toEqual([]);
  });

  /* ‏והצד השני: הליד שלי כן נבחר, אחרת התיקון מבטל את התיעוד */
  it("והליד שלי כן נבחר", async () => {
    const written: string[] = [];
    const service = serviceWithLeads([{ id: MY_LEAD, assignedToUserId: AGENT }], written);
    await asAgent(BUYER_AGENT_CAPS, () =>
      service.sendToContact(LINK, { contactId: CONTACT, subject: "נושא", body: "גוף" }),
    );
    expect(written).toEqual([MY_LEAD]);
  });

  /* ‏ומנהל רואה את כולם — שער שחוסם אותו הוא תקלה */
  it("המנהל מתעד גם על ליד של סוכן", async () => {
    const written: string[] = [];
    const service = serviceWithLeads([{ id: THEIR_LEAD, assignedToUserId: COLLEAGUE }], written);
    await asAgent(MANAGER_CAPS, () =>
      service.sendToContact(LINK, { contactId: CONTACT, subject: "נושא", body: "גוף" }),
    );
    expect(written).toEqual([THEIR_LEAD]);
  });

  /*
   * ‎**והנתיב השני: מזהה שנמסר מהמסך.** „שייך ללקוח” לבדו עבר על
   * ‏ליד של עמית, כי הלקוח נגיש לי דרך כרטיס אחר.
   */
  it("מזהה ליד של עמית שנמסר במפורש — נדחה", async () => {
    const written: string[] = [];
    const service = serviceWithLeads([{ id: THEIR_LEAD, assignedToUserId: COLLEAGUE }], written);
    await expect(
      asAgent(BUYER_AGENT_CAPS, () =>
        service.sendToContact(LINK, {
          contactId: CONTACT,
          subject: "נושא",
          body: "גוף",
          leadId: THEIR_LEAD,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(written).toEqual([]);
  });

  it("ומזהה הליד שלי עובר", async () => {
    const written: string[] = [];
    const service = serviceWithLeads([{ id: MY_LEAD, assignedToUserId: AGENT }], written);
    await asAgent(BUYER_AGENT_CAPS, () =>
      service.sendToContact(LINK, {
        contactId: CONTACT,
        subject: "נושא",
        body: "גוף",
        leadId: MY_LEAD,
      }),
    );
    expect(written).toEqual([MY_LEAD]);
  });
});
