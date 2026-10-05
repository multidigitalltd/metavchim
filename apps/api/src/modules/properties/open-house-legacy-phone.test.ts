import { describe, expect, it } from "vitest";
import { OpenHouseService } from "./open-house.service";

/**
 * ‎**מבקר שנרשם לפני נרמול הטלפון — אינו נפתח שוב כלקוח שני.**
 *
 * ‏הכרטיס שלו נשמר בכתיב שהקליד, והקליטה מחפשת לפי החתימה של הכתיב
 * ‏האחיד. בלי האימוץ, הרשמה חוזרת — לאותו אירוע או לאחר — הייתה יוצרת
 * ‏כרטיס שני, ובאותו אירוע גם תופסת מקום שני (ביקורת Codex).
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const CANONICAL = "+972501234567";

const crypto = {
  phoneHash: (phone: string) => `hash:${phone}`,
  encrypt: (plain: string) => `enc:${plain}`,
  decrypt: (stored: string) => stored.replace(/^enc:/u, ""),
};

/** ‏`openHouse` — אנשי הקשר שיש להם ליד מבית פתוח, בכל אירוע של המשרד */
function setup(contacts: { id: string; phone: string }[], openHouse: string[]) {
  const rows = contacts.map((contact) => ({ id: contact.id, phoneHash: `hash:${contact.phone}`, phoneEncrypted: `enc:${contact.phone}` }));
  const tx = {
    $executeRaw: async () => 0,
    contact: {
      findUnique: async ({ where }: { where: { tenantId_phoneHash: { phoneHash: string } } }) =>
        rows.find((row) => row.phoneHash === where.tenantId_phoneHash.phoneHash) ?? null,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => rows.filter((row) => where.id.in.includes(row.id)),
      update: async ({ where, data }: { where: { id: string }; data: { phoneHash: string; phoneEncrypted: string } }) => {
        Object.assign(rows.find((row) => row.id === where.id) ?? {}, data);
      },
    },
    lead: {
      findMany: async ({ where }: { where: { source: string } }) =>
        where.source === "בית פתוח" ? openHouse.map((contactId) => ({ contactId })) : [],
    },
  };
  const service = new OpenHouseService(
    {} as never, // prisma
    {} as never, // contacts
    {} as never, // audit
    {} as never, // plans
    {} as never, // webLeads
    {} as never, // landing
    {} as never, // outbox
    crypto as never,
  );
  const adopt = () => service["adoptLegacyVisitor"](tx as never, TENANT, CANONICAL);
  return { rows, adopt };
}

describe("מבקר בכתיב הישן", () => {
  it("מבקר של בית פתוח כלשהו במשרד — עובר לכתיב האחיד, והקליטה תמצא אותו", async () => {
    const { rows, adopt } = setup([{ id: "C1", phone: "050-123-4567" }], ["C1"]);
    await adopt();
    expect(rows[0]).toEqual({ id: "C1", phoneHash: `hash:${CANONICAL}`, phoneEncrypted: `enc:${CANONICAL}` });
  });

  it("כבר יש כרטיס בכתיב האחיד — שום דבר אינו משתנה", async () => {
    const { rows, adopt } = setup(
      [
        { id: "C1", phone: "050-123-4567" },
        { id: "C2", phone: CANONICAL },
      ],
      ["C1"],
    );
    await adopt();
    expect(rows[0]?.phoneHash).toBe("hash:050-123-4567");
  });

  it("מספר אחר — אינו נוגע בו", async () => {
    const { rows, adopt } = setup([{ id: "C1", phone: "052-765-4321" }], ["C1"]);
    await adopt();
    expect(rows[0]?.phoneHash).toBe("hash:052-765-4321");
  });

  it("אותו מספר בכרטיס שלא נוצר מבית פתוח — אינו נוגע בו", async () => {
    const { rows, adopt } = setup([{ id: "C1", phone: "050-123-4567" }], []);
    await adopt();
    expect(rows[0]?.phoneHash).toBe("hash:050-123-4567");
  });
});
