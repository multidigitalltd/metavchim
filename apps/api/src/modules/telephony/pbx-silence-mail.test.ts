import { beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../config/env";
import type { EmailService } from "../../core/email.service";
import type { PrismaService } from "../../core/prisma.service";
import { PbxSilenceMailService } from "./pbx-silence-mail.service";

/**
 * ‏בקשת המשתמש: „רק מי שמנוי על הסוכן בוואטסאפ יקבל הודעה שהוובהוק
 * ‏במרכזייה כנראה לא פעיל; מי שלא מנוי יקבל רק את ההודעה במייל.”
 *
 * ‏החצי של הוואטסאפ נבדק ב-`whatsapp-notify.test.ts`; כאן — מי מקבל
 * ‏את המייל, ושהמייל אינו יוצא פעמיים.
 */

const NOW = new Date("2026-09-30T08:00:00.000Z");
const TENANT = "01JTENANT0000000000000000A";
const ALERT = {
  id: "01JALERT00000000000000000A",
  title: "לא נקלטו שיחות מהמרכזייה",
  body: "לא נקלטה שיחה נכנסת כבר 5 שעות עבודה.",
};

interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: string;
  whatsappAccess: boolean;
}
interface OverrideRow {
  userId: string;
  capability: string;
  effect: string;
  expiresAt: Date | null;
}

function harness(input: {
  staff: StaffRow[];
  overrides?: OverrideRow[];
  alerts?: (typeof ALERT)[];
  configured?: boolean;
}) {
  const sent: { to: string; subject: string; key: string | undefined; url: string | undefined; tenantId: unknown }[] = [];
  const notificationWheres: unknown[] = [];
  const tx = {
    notification: {
      findMany: async (args: { where: unknown }) => {
        notificationWheres.push(args.where);
        return input.alerts ?? [ALERT];
      },
    },
    userCapability: {
      findMany: async (args: { where: { userId: { in: string[] } } }) =>
        (input.overrides ?? []).filter((row) => args.where.userId.in.includes(row.userId)),
    },
  };
  const prisma = {
    tenant: { findMany: async () => [{ id: TENANT, blockedModules: [] }] },
    user: {
      // ‏השאילתה עצמה מסננת את מחזיקי המקום — הזיוף מכבד אותה
      findMany: async (args: { where: { whatsappAccess: boolean } }) =>
        input.staff.filter((user) => user.whatsappAccess === args.where.whatsappAccess),
    },
    withExplicitTenant: async <T>(tenantId: string, fn: (t: typeof tx) => Promise<T>) => {
      expect(tenantId).toBe(TENANT);
      return fn(tx);
    },
  };
  const email = {
    isConfigured: async () => input.configured ?? true,
    send: async (
      to: string,
      subject: string,
      content: { button?: { url: string } },
      options: { idempotency: { key: string } | null; tenantId?: string },
    ) => {
      sent.push({
        to,
        subject,
        key: options.idempotency?.key,
        url: content.button?.url,
        tenantId: options.tenantId,
      });
    },
  };
  const service = new PbxSilenceMailService(
    prisma as unknown as PrismaService,
    email as unknown as EmailService,
  );
  return { service, sent, notificationWheres };
}

const owner = (over: Partial<StaffRow> = {}): StaffRow => ({
  id: "01JOWNER00000000000000000A",
  name: "דנה כהן",
  email: "owner@example.com",
  role: "owner",
  whatsappAccess: false,
  ...over,
});
const agent = (over: Partial<StaffRow> = {}): StaffRow => ({
  id: "01JAGENT00000000000000000A",
  name: "יוסי לוי",
  email: "agent@example.com",
  role: "agent",
  whatsappAccess: false,
  ...over,
});

beforeAll(() => {
  process.env["WEB_ORIGIN"] ??= "https://test.invalid";
  process.env["DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
  process.env["DIRECT_DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
  process.env["REDIS_URL"] ??= "redis://localhost:6379";
  process.env["DATA_ENCRYPTION_KEY"] ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env["PHONE_HASH_KEY"] ??= "test-phone-hash-key-not-a-real-secret-0000";
});

describe("‏מי מקבל את „המרכזייה השתתקה” במייל", () => {
  it("‏בעל משרד בלי מקום בסוכן — מקבל מייל", async () => {
    const { service, sent } = harness({ staff: [owner()] });
    await service.tick(NOW);
    expect(sent.map((mail) => mail.to)).toEqual(["owner@example.com"]);
    expect(sent[0]?.subject).toBe(ALERT.title);
  });

  it("‏מי שמחזיק מקום בסוכן — אינו מקבל מייל (הוא מקבל בוואטסאפ)", async () => {
    const { service, sent } = harness({ staff: [owner({ whatsappAccess: true })] });
    await service.tick(NOW);
    expect(sent).toEqual([]);
  });

  it("‏סוכן שאינו רשאי לגעת בהגדרות — אינו מקבל מייל שאין לו מה לעשות איתו", async () => {
    const { service, sent } = harness({ staff: [agent()] });
    await service.tick(NOW);
    expect(sent).toEqual([]);
  });

  it("‏סוכן שקיבל `settings.manage` בחריג — מקבל", async () => {
    const { service, sent } = harness({
      staff: [agent()],
      overrides: [
        { userId: agent().id, capability: "settings.manage", effect: "grant", expiresAt: null },
      ],
    });
    await service.tick(NOW);
    expect(sent.map((mail) => mail.to)).toEqual(["agent@example.com"]);
  });

  it("‏בעל משרד שנשללה ממנו היכולת בחריג — אינו מקבל", async () => {
    const { service, sent } = harness({
      staff: [owner()],
      overrides: [
        { userId: owner().id, capability: "settings.manage", effect: "deny", expiresAt: null },
      ],
    });
    await service.tick(NOW);
    expect(sent).toEqual([]);
  });
});

describe("‏המייל עצמו", () => {
  it("‏מפתח לכל התראה ונמען — סבב חוזר הוא אותה שליחה, ולא מייל שני", async () => {
    const { service, sent } = harness({ staff: [owner()] });
    await service.tick(NOW);
    expect(sent[0]?.key).toBe(`pbxsilent:${ALERT.id}:${owner().id}`);
  });

  it("‏נשלח מהשולח של המערכת ולא מהדומיין של המשרד", async () => {
    const { service, sent } = harness({ staff: [owner()] });
    await service.tick(NOW);
    expect(sent[0]?.tenantId).toBeUndefined();
  });

  it("‏הכפתור נוחת במסך החיבורים — אותו יעד כמו הפעמון", async () => {
    const { service, sent } = harness({ staff: [owner()] });
    await service.tick(NOW);
    const origin = loadEnv().WEB_ORIGIN.replace(/\/+$/u, "");
    expect(sent[0]?.url).toBe(`${origin}/settings/integrations`);
  });

  it("‏שואל רק על התראות „המרכזייה השתתקה” מהשעות האחרונות", async () => {
    const { service, notificationWheres } = harness({ staff: [owner()] });
    await service.tick(NOW);
    const where = notificationWheres[0] as { type: string; createdAt: { gte: Date } };
    expect(where.type).toBe("pbx_silent");
    expect(where.createdAt.gte.getTime()).toBeLessThan(NOW.getTime());
    expect(NOW.getTime() - where.createdAt.gte.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("‏בלי ספק מייל מחובר — אינו מנסה לשלוח", async () => {
    const { service, sent } = harness({ staff: [owner()], configured: false });
    await service.tick(NOW);
    expect(sent).toEqual([]);
  });

  it("‏אין התראה — אין מייל", async () => {
    const { service, sent } = harness({ staff: [owner()], alerts: [] });
    await service.tick(NOW);
    expect(sent).toEqual([]);
  });
});
