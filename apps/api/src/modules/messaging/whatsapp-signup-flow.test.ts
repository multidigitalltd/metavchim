import { Logger } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CryptoService } from "../../core/crypto.service";
import type { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PlatformSettingsService } from "../../core/platform-settings.service";
import type { PrismaService } from "../../core/prisma.service";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";

/**
 * ‎**כשהפופאפ לא אומר איזה מספר חובר** (docs/12).
 *
 * הזרימה הרגילה מוסרת `waba_id` ו-`phone_number_id` באירוע `message`
 * מהפופאפ. הערוץ הזה **אינו מובטח**: מתווך שכבר חיבר בעבר מקבל
 * מ-Meta את מסך „להמשיך עם ההגדרות הקודמות?”, ומסלול ההמשך מדלג על
 * בחירת המספר ולכן אינו משדר דבר; דפדפן שחוסם `postMessage` בין
 * מקורות עושה את אותו דבר. עד כאן זה הסתיים ב„החיבור לא הושלם — לא
 * נבחר מספר”, שגיאה שאין ממנה מוצא: המתווך לוחץ שוב ומקבל בדיוק את
 * אותו מסך.
 *
 * הבדיקות כאן התנהגותיות: הן מריצות את `complete` מול Graph מדומה
 * ובודקות **מה נשמר** — ובעיקר מה **לא** נשמר כשיש יותר ממועמד אחד.
 */

for (const [key, value] of Object.entries({
  WEB_ORIGIN: "https://app.example.test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PHONE_HASH_KEY: "x".repeat(32),
})) {
  process.env[key] = value;
}

const WABA = "11122233344";
const LINE = "55566677788";

/** תשובת Graph מוצלחת. `text` קיים כי חלק מהנתיבים קוראים אותו בכשל. */
const ok = (body: unknown): Response =>
  ({ ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve("") }) as Response;

interface Graph {
  /** ה-WABA שהטוקן מורשה לנהל, כפי ש-`debug_token` מדווח */
  wabas?: string[];
  /** הקווים שתחת ה-WABA הראשון */
  lines?: string[];
}

/**
 * Graph מדומה שמנתב לפי כתובת ולא לפי סדר קריאה: הסדר הוא פרט
 * מימוש, והבדיקה אמורה לשרוד שינוי שלו.
 */
function graph(over: Graph = {}): { calls: string[] } {
  const wabas = over.wabas ?? [WABA];
  const lines = over.lines ?? [LINE];
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | string) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/oauth/access_token")) {
        return Promise.resolve(ok({ access_token: "biz-token", expires_in: 5_184_000 }));
      }
      if (url.includes("/debug_token")) {
        return Promise.resolve(
          ok({
            data: {
              granular_scopes: [
                { scope: "whatsapp_business_management", target_ids: wabas },
                /* רעש מכוון: היקפים אחרים נושאים target_ids משלהם */
                { scope: "pages_show_list", target_ids: ["999999999"] },
              ],
            },
          }),
        );
      }
      if (url.includes("/phone_numbers")) {
        return Promise.resolve(ok({ data: lines.map((id) => ({ id })) }));
      }
      if (url.includes("/subscribed_apps")) return Promise.resolve(ok({ success: true }));
      /* מה שנשאר הוא שליפת פרטי הקו */
      return Promise.resolve(
        ok({
          display_phone_number: "+972 50-123-4567",
          verified_name: "תיווך בדיקה",
          quality_rating: "GREEN",
        }),
      );
    }),
  );
  return { calls };
}

function build(): {
  service: WhatsAppConnectionService;
  created: () => Record<string, unknown> | null;
} {
  let created: Record<string, unknown> | null = null;
  const prisma = {
    whatsAppBusinessConnection: {
      findFirst: vi.fn(() => Promise.resolve(null)),
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        created = args.data;
        return Promise.resolve({
          id: "c1",
          userId: "u1",
          displayPhone: "972501234567",
          verifiedName: "תיווך בדיקה",
          status: "pending_history",
          historyShared: false,
          qualityRating: "GREEN",
          connectedAt: new Date(),
          disconnectedAt: null,
          disconnectReason: null,
        });
      }),
    },
  } as unknown as PrismaService;

  const crypto = { encrypt: (plain: string) => `enc:${plain}` } as unknown as CryptoService;

  const platformSettings = {
    get: vi.fn((key: string) =>
      Promise.resolve(
        key === "whatsappAppId"
          ? "111222333"
          : key === "whatsappConnectAppSecret"
            ? "secret-of-the-connect-app"
            : key === "whatsappSignupConfigId"
              ? "444555666"
              : null,
      ),
    ),
  } as unknown as PlatformSettingsService;

  return {
    service: new WhatsAppConnectionService(
      prisma,
      crypto,
      platformSettings,
      {} as PlanCatalogService,
    ),
    created: () => created,
  };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});

describe("חיבור שהגיע בלי מזהי הפופאפ", () => {
  it("שואל את Meta מי הקו, ומחבר אותו", async () => {
    graph();
    const { service, created } = build();

    const result = await service.complete("t1", "u1", { code: "the-signup-code" });

    expect(result.ok).toBe(true);
    expect(created()).toMatchObject({ wabaId: WABA, phoneNumberId: LINE });
  });

  it("מזהה את ה-WABA לפי ההיקף של וואטסאפ ולא לפי היקף אחר", async () => {
    const { calls } = graph();
    const { service } = build();

    await service.complete("t1", "u1", { code: "the-signup-code" });

    // ה-`target_ids` של `pages_show_list` אינו WABA, ואסור שיישאל עליו
    expect(calls.some((url) => url.includes(`/${WABA}/phone_numbers`))).toBe(true);
    expect(calls.some((url) => url.includes("999999999"))).toBe(false);
  });

  /*
   * ‎**המקרה שבגללו כל זה קיים: אסור לנחש.**
   *
   * שני מספרים תחת אותו חשבון הם בחירה שהמתווך עשה בפופאפ, וכאן היא
   * חסרה. ניחוש „הראשון” מנתב לקוחות אמיתיים לקו הלא-נכון, בשקט
   * ובלי שאיש ידע — ולכן מוטב לעצור ולבקש לבחור מפורשות.
   */
  it("מסרב לנחש כשיש יותר ממספר אחד — ואינו שומר דבר", async () => {
    graph({ lines: [LINE, "99988877766"] });
    const { service, created } = build();

    const result = await service.complete("t1", "u1", { code: "the-signup-code" });

    expect(result).toMatchObject({ ok: false });
    expect(created()).toBeNull();
    if (!result.ok) expect(result.reason).toContain("עריכת ההגדרות");
  });

  it("מסרב לנחש גם כשיש יותר מחשבון WhatsApp אחד", async () => {
    graph({ wabas: [WABA, "22233344455"] });
    const { service, created } = build();

    const result = await service.complete("t1", "u1", { code: "the-signup-code" });

    expect(result).toMatchObject({ ok: false });
    expect(created()).toBeNull();
  });

  /* מה שהפופאפ מסר מתאר בחירה שנעשתה עכשיו, ולכן אין מה לשאול */
  it("מזהים שהגיעו מהפופאפ גוברים, ו-Meta אינה נשאלת עליהם", async () => {
    const { calls } = graph({ wabas: ["77788899900"] });
    const { service, created } = build();

    const result = await service.complete("t1", "u1", {
      code: "the-signup-code",
      wabaId: WABA,
      phoneNumberId: LINE,
    });

    expect(result.ok).toBe(true);
    expect(created()).toMatchObject({ wabaId: WABA, phoneNumberId: LINE });
    expect(calls.some((url) => url.includes("/debug_token"))).toBe(false);
  });
});

describe("הקונפיגורציה שהמסך מקבל", () => {
  it("כוללת את סוג הזרימה, כי הפרונט אינו מקבע אותה", async () => {
    graph();
    const { service } = build();

    const config = await service.signupConfig();

    expect(config).toMatchObject({
      appId: "111222333",
      configId: "444555666",
      featureType: "whatsapp_business_app_onboarding",
    });
  });
});
