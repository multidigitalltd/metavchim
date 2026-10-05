import { describe, expect, it } from "vitest";
import { OpenHousePhoneBackfillService } from "./open-house-phone-backfill.service";

/**
 * ‎**מבקר בית פתוח שנשמר בכתיב הישן — עובר לכתיב האחיד, פעם אחת.**
 *
 * ‏בלי ההמרה, הרשמה חוזרת שלו — לאותו אירוע או לאחר — הייתה פותחת כרטיס
 * ‏שני (ביקורת Codex).
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const CANONICAL = "+972501234567";

const crypto = {
  phoneHash: (phone: string) => `hash:${phone}`,
  encrypt: (plain: string) => `enc:${plain}`,
  decrypt: (stored: string) => stored.replace(/^enc:/u, ""),
};

interface Seed {
  contacts: { id: string; phone: string }[];
  /** ‏ליד → איש קשר, ומקור הליד */
  leads: { id: string; contactId: string; source: string }[];
  /** ‏סיורים באירועי בית פתוח — לפי ליד */
  visits?: string[];
}

function setup({ contacts, leads, visits = [] }: Seed) {
  const rows = contacts.map((c) => ({ id: c.id, phoneHash: `hash:${c.phone}`, phoneEncrypted: `enc:${c.phone}` }));
  const locks: string[] = [];
  const tx = {
    $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
      locks.push(key);
      return 0;
    },
    appointment: { findMany: async () => visits.map((leadId) => ({ leadId })) },
    lead: {
      findMany: async ({ where }: { where: { OR: [{ source: string }, { id: { in: string[] } }] } }) => {
        const [bySource, byId] = where.OR;
        const hit = leads.filter((l) => l.source === bySource.source || byId.id.in.includes(l.id));
        return [...new Set(hit.map((l) => l.contactId))].map((contactId) => ({ contactId }));
      },
    },
    contact: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => rows.filter((r) => where.id.in.includes(r.id)),
      findUnique: async ({ where }: { where: { tenantId_phoneHash: { phoneHash: string } } }) =>
        rows.find((r) => r.phoneHash === where.tenantId_phoneHash.phoneHash) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { phoneHash: string; phoneEncrypted: string } }) => {
        Object.assign(rows.find((r) => r.id === where.id) ?? {}, data);
      },
    },
  };
  const service = new OpenHousePhoneBackfillService(
    {
      tenant: { findMany: async () => [{ id: TENANT }] },
      withExplicitTenant: <T>(_tenantId: string, fn: (t: never) => Promise<T>) => fn(tx as never),
    } as never,
    crypto as never,
  );
  return { rows, locks, service, run: () => service.backfillTenant(tx as never, TENANT) };
}

describe("המרת טלפוני מבקרי בית פתוח", () => {
  it("מבקר עם ליד מבית פתוח — עובר לכתיב האחיד, תחת נעילת המספר", async () => {
    const { rows, locks, run } = setup({
      contacts: [{ id: "C1", phone: "050-123-4567" }],
      leads: [{ id: "L1", contactId: "C1", source: "בית פתוח" }],
    });
    expect(await run()).toBe(1);
    expect(rows[0]).toEqual({ id: "C1", phoneHash: `hash:${CANONICAL}`, phoneEncrypted: `enc:${CANONICAL}` });
    expect(locks.some((key) => key.includes(`hash:${CANONICAL}`))).toBe(true);
  });

  it("מבקר שצורף לליד ממקור אחר — נמצא דרך הסיור שלו", async () => {
    const { rows, run } = setup({
      contacts: [{ id: "C1", phone: "0501234567" }],
      leads: [{ id: "L1", contactId: "C1", source: "אתר" }],
      visits: ["L1"],
    });
    expect(await run()).toBe(1);
    expect(rows[0]?.phoneHash).toBe(`hash:${CANONICAL}`);
  });

  it("כבר יש כרטיס בכתיב האחיד — שניהם נשארים, למסך הכפילויות", async () => {
    const { rows, run } = setup({
      contacts: [
        { id: "C1", phone: "050-123-4567" },
        { id: "C2", phone: CANONICAL },
      ],
      leads: [{ id: "L1", contactId: "C1", source: "בית פתוח" }],
    });
    expect(await run()).toBe(0);
    expect(rows[0]?.phoneHash).toBe("hash:050-123-4567");
  });

  it("כרטיס שלא הגיע מבית פתוח, או מספר שאינו תקין — לא נוגעים", async () => {
    const { rows, run } = setup({
      contacts: [
        { id: "C1", phone: "050-123-4567" },
        { id: "C2", phone: "מספר חסוי" },
      ],
      leads: [
        { id: "L1", contactId: "C1", source: "אתר" },
        { id: "L2", contactId: "C2", source: "בית פתוח" },
      ],
    });
    expect(await run()).toBe(0);
    expect(rows.map((r) => r.phoneHash)).toEqual(["hash:050-123-4567", "hash:מספר חסוי"]);
  });

  it("כל המשרדים, ובטוח להרצה חוזרת", async () => {
    const { rows, service } = setup({
      contacts: [{ id: "C1", phone: "050-123-4567" }],
      leads: [{ id: "L1", contactId: "C1", source: "בית פתוח" }],
    });
    await service.tick();
    await service.tick();
    expect(rows[0]).toEqual({ id: "C1", phoneHash: `hash:${CANONICAL}`, phoneEncrypted: `enc:${CANONICAL}` });
  });
});
