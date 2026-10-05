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
  /** ‏טלפונים נוספים — ושל מי */
  secondary?: { phone: string; contactId: string }[];
}

function setup({ contacts, leads, visits = [], secondary: extra = [] }: Seed) {
  const secondary = extra.map((p, i) => ({ id: `P${i}`, phoneHash: `hash:${p.phone}`, contactId: p.contactId }));
  const rows = contacts.map((c) => ({ id: c.id, phoneHash: `hash:${c.phone}`, phoneEncrypted: `enc:${c.phone}` }));
  const locks: string[] = [];
  let transactions = 0;
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
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        rows.filter((r) => where.id.in.includes(r.id)).map((r) => ({ ...r })),
      findUnique: async ({ where }: { where: { tenantId_phoneHash: { phoneHash: string } } }) =>
        rows.find((r) => r.phoneHash === where.tenantId_phoneHash.phoneHash) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; phoneHash: string }; data: { phoneHash: string; phoneEncrypted: string } }) => {
        const row = rows.find((r) => r.id === where.id && r.phoneHash === where.phoneHash);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
    contactPhone: {
      findUnique: async ({ where }: { where: { tenantId_phoneHash: { phoneHash: string } } }) =>
        secondary.find((p) => p.phoneHash === where.tenantId_phoneHash.phoneHash) ?? null,
      deleteMany: async ({ where }: { where: { id: string } }) => {
        const at = secondary.findIndex((p) => p.id === where.id);
        if (at >= 0) secondary.splice(at, 1);
        return { count: at >= 0 ? 1 : 0 };
      },
    },
  };
  const service = new OpenHousePhoneBackfillService(
    {
      tenant: { findMany: async () => [{ id: TENANT }] },
      withExplicitTenant: <T>(_tenantId: string, fn: (t: never) => Promise<T>) => {
        transactions += 1;
        return fn(tx as never);
      },
    } as never,
    crypto as never,
  );
  return { rows, secondary, locks, service, transactions: () => transactions };
}

describe("המרת טלפוני מבקרי בית פתוח", () => {
  it("מבקר עם ליד מבית פתוח — עובר לכתיב האחיד, תחת נעילת המספר", async () => {
    const { rows, locks, service } = setup({
      contacts: [{ id: "C1", phone: "050-123-4567" }],
      leads: [{ id: "L1", contactId: "C1", source: "בית פתוח" }],
    });
    await service.tick();
    expect(rows[0]).toEqual({ id: "C1", phoneHash: `hash:${CANONICAL}`, phoneEncrypted: `enc:${CANONICAL}` });
    expect(locks.some((key) => key.includes(`hash:${CANONICAL}`))).toBe(true);
  });

  it("מבקר שצורף לליד ממקור אחר — נמצא דרך הסיור שלו", async () => {
    const { rows, service } = setup({
      contacts: [{ id: "C1", phone: "0501234567" }],
      leads: [{ id: "L1", contactId: "C1", source: "אתר" }],
      visits: ["L1"],
    });
    await service.tick();
    expect(rows[0]?.phoneHash).toBe(`hash:${CANONICAL}`);
  });

  it("המספר הוא הטלפון הראשי של כרטיס אחר — שניהם נשארים, למסך הכפילויות", async () => {
    const { rows, service } = setup({
      contacts: [
        { id: "C1", phone: "050-123-4567" },
        { id: "C2", phone: CANONICAL },
      ],
      leads: [{ id: "L1", contactId: "C1", source: "בית פתוח" }],
    });
    await service.tick();
    expect(rows[0]?.phoneHash).toBe("hash:050-123-4567");
  });

  it("המספר הוא טלפון נוסף של כרטיס אחר — לא נוגעים (ביקורת Codex, P1)", async () => {
    const { rows, service } = setup({
      contacts: [{ id: "C1", phone: "050-123-4567" }],
      leads: [{ id: "L1", contactId: "C1", source: "בית פתוח" }],
      secondary: [{ phone: CANONICAL, contactId: "C2" }],
    });
    await service.tick();
    expect(rows[0]?.phoneHash).toBe("hash:050-123-4567");
  });

  it("המספר האחיד הוא טלפון נוסף של המבקר עצמו — עולה לראשי, והנוסף יורד", async () => {
    const { rows, secondary, service } = setup({
      contacts: [{ id: "C1", phone: "050-123-4567" }],
      leads: [{ id: "L1", contactId: "C1", source: "בית פתוח" }],
      secondary: [{ phone: CANONICAL, contactId: "C1" }],
    });
    await service.tick();
    expect(rows[0]?.phoneHash).toBe(`hash:${CANONICAL}`);
    expect(secondary).toEqual([]);
  });

  it("כרטיס שלא הגיע מבית פתוח, או מספר שאינו תקין — לא נוגעים", async () => {
    const { rows, service } = setup({
      contacts: [
        { id: "C1", phone: "050-123-4567" },
        { id: "C2", phone: "מספר חסוי" },
      ],
      leads: [
        { id: "L1", contactId: "C1", source: "אתר" },
        { id: "L2", contactId: "C2", source: "בית פתוח" },
      ],
    });
    await service.tick();
    expect(rows.map((r) => r.phoneHash)).toEqual(["hash:050-123-4567", "hash:מספר חסוי"]);
  });

  it("כל כרטיס בטרנזקציה משלו — היסטוריה ארוכה אינה חורגת מזמן הטרנזקציה (ביקורת Codex)", async () => {
    const { service, transactions } = setup({
      contacts: [
        { id: "C1", phone: "050-123-4567" },
        { id: "C2", phone: "052-765-4321" },
        { id: "C3", phone: "+972541112233" },
      ],
      leads: ["C1", "C2", "C3"].map((contactId, i) => ({ id: `L${i}`, contactId, source: "בית פתוח" })),
    });
    await service.tick();
    /* ‏אחת לאיסוף, ואחת לכל כרטיס שדרש העברה — C3 כבר בכתיב האחיד */
    expect(transactions()).toBe(3);
  });

  it("בטוח להרצה חוזרת", async () => {
    const { rows, service } = setup({
      contacts: [{ id: "C1", phone: "050-123-4567" }],
      leads: [{ id: "L1", contactId: "C1", source: "בית פתוח" }],
    });
    await service.tick();
    await service.tick();
    expect(rows[0]).toEqual({ id: "C1", phoneHash: `hash:${CANONICAL}`, phoneEncrypted: `enc:${CANONICAL}` });
  });
});
