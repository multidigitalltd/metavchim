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
