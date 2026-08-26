import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { CardcomService } from "../../core/cardcom.service";
import type { EmailService } from "../../core/email.service";
import type { Pbx015NumbersService } from "../../core/pbx015-numbers.service";
import type { PrismaService } from "../../core/prisma.service";
import { NumberRentalService } from "./number-rental.service";

/**
 * שערי ההשכרה: מי שמנסה לשכור מספר תפוס, מספר שאינו פנוי אצל 015,
 * או כשאין מחיר מוגדר — נעצר לפני שנפתח דף תשלום. וההפעלה: חודש
 * קדימה עם עוגן יום, כי חלק מחודש מחויב כחודש מלא.
 */

const NOW = new Date("2026-08-26T09:00:00.000Z");

/*
 * אותו נימוק כמו בבדיקות ההצעות: `loadEnv` מאמת את הסביבה כולה,
 * והבדיקות רצות בלי ‎.env. הערכים נכתבים תמיד ומוחזרים בסיום.
 */
const BASE_ENV: Record<string, string> = {
  WEB_ORIGIN: "https://app.example.test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PHONE_HASH_KEY: "x".repeat(32),
  PLATFORM_ADMIN_EMAILS: "admin@example.test",
};
const previousEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const [key, value] of Object.entries(BASE_ENV)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
});

const TENANT = "01TENANT000000000000000000";

interface Fakes {
  monthlyAgorot?: number | null;
  configured?: boolean;
  numberAvailable?: boolean;
  existingRental?: Record<string, unknown> | null;
  cardcomConfigured?: boolean;
}

/** השירות מעל תלויות מזויפות — בלי מסד, בלי סולק, בלי 015. */
function service(fakes: Fakes = {}): {
  svc: NumberRentalService;
  sentEmails: { to: string; subject: string }[];
  updates: Record<string, unknown>[];
} {
  const sentEmails: { to: string; subject: string }[] = [];
  const updates: Record<string, unknown>[] = [];
  const prisma = {
    rentedNumber: {
      findFirst: async (args: { where: Record<string, unknown> }) =>
        "status" in args.where && JSON.stringify(args.where).includes("pending")
          ? null
          : (fakes.existingRental ?? null),
      findUnique: async () => fakes.existingRental ?? null,
      create: async (args: { data: Record<string, unknown> }) => args.data,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return args.data;
      },
      delete: async () => ({}),
    },
    payment: { create: async (args: { data: unknown }) => args.data, update: async () => ({}) },
    tenant: { findUnique: async () => ({ name: "משרד הבדיקה" }) },
    user: { findFirst: async () => null, findUnique: async () => null },
  } as unknown as PrismaService;
  const pbx015 = {
    // `=== undefined` ולא `??`: `null` כאן הוא ערך הבדיקה, לא חוסר
    monthlyPriceAgorot: async () =>
      fakes.monthlyAgorot === undefined ? 5_000 : fakes.monthlyAgorot,
    isConfigured: async () => fakes.configured ?? true,
    isNumberAvailable: async () => fakes.numberAvailable ?? true,
    availableNumbers: async () => ["0722776123"],
    purchase: async () => ({ ok: true, code: "204", message: "OK" }),
    release: async () => ({ ok: true, code: "204", message: "OK" }),
    setDescription: async () => undefined,
  } as unknown as Pbx015NumbersService;
  const cardcom = {
    isConfigured: async () => fakes.cardcomConfigured ?? true,
    createPaymentPage: async () => ({ url: "https://pay.example.test", lowProfileId: "lp1" }),
  } as unknown as CardcomService;
  const email = {
    send: async (to: string, subject: string) => {
      sentEmails.push({ to, subject });
    },
  } as unknown as EmailService;
  return { svc: new NumberRentalService(prisma, pbx015, cardcom, email), sentEmails, updates };
}

describe("שערי פתיחת ההשכרה", () => {
  it("בלי מחיר מוגדר — אין דף תשלום", async () => {
    const { svc } = service({ monthlyAgorot: null });
    await expect(
      svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("מספר שכבר שכור אצלנו — לכל משרד שהוא — נדחה", async () => {
    const { svc } = service({
      existingRental: { id: "01R", status: "active" },
    });
    await expect(
      svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" }),
    ).rejects.toThrow(/כבר שכור/u);
  });

  it("מספר שאינו פנוי אצל 015 נדחה — הזמינות נבדקת מול הספק", async () => {
    const { svc } = service({ numberAvailable: false });
    await expect(
      svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" }),
    ).rejects.toThrow(/אינו פנוי/u);
  });

  it("קלט תקין פותח דף תשלום", async () => {
    const { svc } = service();
    const result = await svc.startCheckout({
      tenantId: TENANT,
      userId: "01U",
      number: "0722776123",
    });
    expect(result.url).toBe("https://pay.example.test");
  });
});

describe("הפעלה — חודש קדימה, עם עוגן", () => {
  it("התקופה הראשונה היא חודש מלא מרגע התשלום", async () => {
    const { svc } = service();
    let saved: Record<string, unknown> | null = null;
    const tx = {
      rentedNumber: {
        findUnique: async () => ({
          id: "01R",
          tenantId: TENANT,
          number: "0722776123",
          billingAnchorDay: null,
          currentPeriodEnd: null,
        }),
        update: async (args: { data: Record<string, unknown> }) => {
          saved = args.data;
          return args.data;
        },
      },
    };
    const activated = await svc.activateWithin(
      tx as never,
      "01R",
      new Date("2026-08-26T09:00:00.000Z"),
    );
    expect(activated?.periodEnd.toISOString()).toBe("2026-09-26T09:00:00.000Z");
    expect(saved).toMatchObject({ status: "active", billingAnchorDay: 26 });
  });

  it("השכרה מ-31 בחודש אינה מתקצרת לצמיתות — העוגן נשמר", async () => {
    const { svc } = service();
    const tx = {
      rentedNumber: {
        findUnique: async () => ({
          id: "01R",
          tenantId: TENANT,
          number: "0722776123",
          billingAnchorDay: 31,
          currentPeriodEnd: new Date("2026-02-28T09:00:00.000Z"),
        }),
        update: async () => ({}),
      },
    };
    const activated = await svc.activateWithin(
      tx as never,
      "01R",
      new Date("2026-02-28T10:00:00.000Z"),
    );
    // מפברואר המקוצר חוזרים ל-31 במרץ, לא נתקעים על 28. השעה היא
    // שעת התשלום — התקופה שחלפה נמדדת מהמאוחר מבין "עכשיו" לסופה.
    expect(activated?.periodEnd.toISOString()).toBe("2026-03-31T10:00:00.000Z");
  });
});

describe("ביטול", () => {
  it("ביטול השכרה פעילה מודיע למנהלי הפלטפורמה", async () => {
    const { svc, sentEmails } = service({
      existingRental: {
        id: "01R",
        tenantId: TENANT,
        number: "0722776123",
        status: "active",
        currentPeriodEnd: NOW,
      },
    });
    await svc.cancel(TENANT, "01R");
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0]!.to).toBe("admin@example.test");
  });
});
