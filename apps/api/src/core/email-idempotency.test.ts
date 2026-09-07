import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EmailAmbiguousError,
  EmailRejectedError,
  EmailService,
  type EmailIdempotency,
} from "./email.service";

/**
 * ‎**כישלון מסירה אינו „לא נשלח”, והניסיון החוזר הוא ההימור.**
 *
 * ‏‎4xx = הספק בדק ופסל, ובוודאות לא יצאה הודעה. פסק זמן, נפילת
 * ‏רשת או ‎5xx = ייתכן שההודעה יצאה ורק התשובה אבדה. עד כה שני
 * ‏המצבים נראו לקורא כמעט זהים, וכל ניסיון חוזר סיכן מייל כפול
 * ‏ללקוח — או ויתר על מייל שלא הגיע.
 *
 * ‏הבדיקות כאן הן על **המנגנון**: שורה שנכתבת לפני הקריאה, המפתח
 * ‏שנוסע עם ההודעה, והשאלה לספק כשהמצב עמום.
 */

const KEY: EmailIdempotency = { key: "agreement:01JABCDEFGHJKMNPQRSTVWXYZ0", purpose: "agreement" };

interface Row {
  key: string;
  tenantId: string | null;
  purpose: string;
  status: string;
  providerMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** ‏הטבלה בזיכרון — מכבדת את המפתח, כמו המסד. */
function fakePrisma(): { prisma: unknown; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const prisma = {
    emailSendAttempt: {
      createMany: async (args: { data: Row[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const row of args.data) {
          if (rows.has(row.key)) continue;
          rows.set(row.key, { ...row, createdAt: new Date(), providerMessageId: null });
          count += 1;
        }
        return { count };
      },
      findUnique: async (args: { where: { key: string } }) => rows.get(args.where.key) ?? null,
      update: async (args: { where: { key: string }; data: Partial<Row> }) => {
        const row = rows.get(args.where.key);
        if (row === undefined) throw new Error("no such row");
        rows.set(args.where.key, { ...row, ...args.data });
        return rows.get(args.where.key);
      },
      deleteMany: async () => ({ count: 0 }),
    },
    /* ‏אין דומיין משרד בבדיקות האלה — השליחה מכתובת הפלטפורמה */
    withExplicitTenant: async <T>(_t: string, fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({ emailDomain: { findUnique: async () => null } }),
  };
  return { prisma, rows };
}

function serviceWith(prisma: unknown): EmailService {
  const platformSettings = {
    get: async (key: string) =>
      key === "postmarkServerToken" ? "tok" : key === "emailFrom" ? "a@b.example" : undefined,
  };
  return new EmailService(platformSettings as never, prisma as never);
}

/** ‏תשובות הספק, לפי סדר הקריאות. */
function stubFetch(...responses: (number | "network")[]): {
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    calls.push({
      url,
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next === "network") throw new Error("ECONNRESET");
    return {
      ok: next < 400,
      status: next,
      json: async () => ({ MessageID: "mid-1", TotalCount: 0 }),
      text: async () => "",
    };
  });
  return { calls };
}

const send = (service: EmailService, idempotency: EmailIdempotency | null): Promise<void> =>
  service.send("client@example.com", "נושא", "גוף", { idempotency, tenantId: undefined });

beforeAll(() => {
  process.env["WEB_ORIGIN"] ??= "https://test.invalid";
  process.env["DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
  process.env["DIRECT_DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
  process.env["REDIS_URL"] ??= "redis://localhost:6379";
  process.env["DATA_ENCRYPTION_KEY"] ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env["PHONE_HASH_KEY"] ??= "test-phone-hash-key-not-a-real-secret-0000";
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("‏זיכרון השליחה", () => {
  it("‏שליחה ראשונה — יוצאת, ונרשמת כיצאה", async () => {
    const { prisma, rows } = fakePrisma();
    const { calls } = stubFetch(200);
    await send(serviceWith(prisma), KEY);
    expect(calls).toHaveLength(1);
    expect(rows.get(KEY.key)?.status).toBe("sent");
    expect(rows.get(KEY.key)?.providerMessageId).toBe("mid-1");
  });

  /*
   * ‎**המפתח נוסע עם ההודעה** — בלעדיו אפשר לדעת שניסינו, ולעולם
   * ‏לא אם הצלחנו: זה מה שהופך „עמום” לניתן להכרעה מול הספק.
   */
  it("‏והמפתח נוסע עם ההודעה אל הספק", async () => {
    const { prisma } = fakePrisma();
    const { calls } = stubFetch(200);
    await send(serviceWith(prisma), KEY);
    expect((calls[0]?.body as { Metadata?: Record<string, string> }).Metadata).toEqual({
      idem: KEY.key,
    });
  });

  it("‏שליחה שנייה עם אותו מפתח — לא יוצאת פעם שנייה", async () => {
    const { prisma } = fakePrisma();
    const service = serviceWith(prisma);
    const { calls } = stubFetch(200);
    await send(service, KEY);
    await send(service, KEY);
    expect(calls).toHaveLength(1);
  });

  it("‏‎4xx — נדחתה בוודאות, ונרשמת ככזו", async () => {
    const { prisma, rows } = fakePrisma();
    const { calls } = stubFetch(422);
    await expect(send(serviceWith(prisma), KEY)).rejects.toBeInstanceOf(EmailRejectedError);
    expect(rows.get(KEY.key)?.status).toBe("rejected");
    expect(calls).toHaveLength(1);
  });

  /* ‏ומה שנדחה בוודאות **כן** נשלח שוב — אחרת תיקון לא היה יוצא */
  it("‏ואחרי דחייה ודאית — הניסיון הבא יוצא", async () => {
    const { prisma } = fakePrisma();
    const service = serviceWith(prisma);
    const { calls } = stubFetch(422, 200);
    await expect(send(service, KEY)).rejects.toBeInstanceOf(EmailRejectedError);
    await send(service, KEY);
    expect(calls).toHaveLength(2);
  });

  it("‏‎5xx — עמום, ונאמר ככזה", async () => {
    const { prisma, rows } = fakePrisma();
    stubFetch(503);
    await expect(send(serviceWith(prisma), KEY)).rejects.toBeInstanceOf(EmailAmbiguousError);
    expect(rows.get(KEY.key)?.status).toBe("unknown");
  });

  it("‏כשל רשת — אותו דבר, ולא „נכשל” סתם", async () => {
    const { prisma, rows } = fakePrisma();
    stubFetch("network");
    const error = await send(serviceWith(prisma), KEY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailAmbiguousError);
    expect((error as EmailAmbiguousError).idempotencyKey).toBe(KEY.key);
    expect(rows.get(KEY.key)?.status).toBe("unknown");
  });

  /*
   * ‎**וזה הלב:** אחרי כישלון עמום שואלים את הספק. הוא מכיר את
   * ‏ההודעה — כלומר היא יצאה — ולכן הניסיון החוזר אינו שולח שוב.
   */
  it("‏אחרי עמום, כשהספק מכיר את ההודעה — לא נשלחת שוב", async () => {
    const { prisma, rows } = fakePrisma();
    const service = serviceWith(prisma);
    stubFetch(503);
    await expect(send(service, KEY)).rejects.toBeInstanceOf(EmailAmbiguousError);

    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ TotalCount: 1 }), text: async () => "" };
    });
    await send(service, KEY);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("messages/outbound");
    expect(seen[0]).toContain(`metadata_idem=${encodeURIComponent(KEY.key)}`);
    expect(rows.get(KEY.key)?.status).toBe("sent");
  });

  /* ‏והצד השני, שבלעדיו זו הייתה חסימה: הספק אינו מכיר — שולחים */
  it("‏אחרי עמום, כשהספק אינו מכיר — נשלחת שוב", async () => {
    const { prisma } = fakePrisma();
    const service = serviceWith(prisma);
    stubFetch(503);
    await expect(send(service, KEY)).rejects.toBeInstanceOf(EmailAmbiguousError);

    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return url.includes("messages/outbound")
        ? { ok: true, status: 200, json: async () => ({ TotalCount: 0 }), text: async () => "" }
        : { ok: true, status: 200, json: async () => ({ MessageID: "m" }), text: async () => "" };
    });
    await send(service, KEY);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe("https://api.postmarkapp.com/email");
  });

  /* ‏חיפוש שנכשל אינו „יצאה” — מייל שלא הגיע גרוע מכפול כאן */
  it("‏וכשהחיפוש עצמו נכשל — נשלחת שוב", async () => {
    const { prisma } = fakePrisma();
    const service = serviceWith(prisma);
    stubFetch(503);
    await expect(send(service, KEY)).rejects.toBeInstanceOf(EmailAmbiguousError);

    let sent = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("messages/outbound")) throw new Error("ECONNRESET");
      sent += 1;
      return { ok: true, status: 200, json: async () => ({ MessageID: "m" }), text: async () => "" };
    });
    await send(service, KEY);
    expect(sent).toBe(1);
  });
});

describe("‏שליחה בלי מפתח", () => {
  it("‏אינה נוגעת בזיכרון, ואינה נושאת מפתח לספק", async () => {
    const { prisma, rows } = fakePrisma();
    const { calls } = stubFetch(200);
    await send(serviceWith(prisma), null);
    expect(rows.size).toBe(0);
    expect((calls[0]?.body as { Metadata?: unknown }).Metadata).toBeUndefined();
  });

  it("‏ושתי שליחות בלי מפתח יוצאות שתיהן", async () => {
    const { prisma } = fakePrisma();
    const service = serviceWith(prisma);
    const { calls } = stubFetch(200);
    await send(service, null);
    await send(service, null);
    expect(calls).toHaveLength(2);
  });
});

/*
 * ‏מפתח פסול הוא באג של הקורא: הספק חותך ערך מטא-דאטה, והחיפוש
 * ‏בדיעבד היה מחפש מחרוזת שאינה קיימת — כלומר ההגנה נשברת בשקט
 * ‏בדיוק כשנזקקים לה.
 */
describe("‏מפתח פסול", () => {
  it("‏נעצר, ולא מוריד את ההגנה בשקט", async () => {
    const { prisma } = fakePrisma();
    stubFetch(200);
    await expect(
      send(serviceWith(prisma), { key: "יש כאן רווח ועברית", purpose: "x" }),
    ).rejects.toThrow(/מפתח אידמפוטנטיות פסול/u);
  });
});
