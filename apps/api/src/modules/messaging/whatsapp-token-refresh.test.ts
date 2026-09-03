import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CryptoService } from "../../core/crypto.service";
import type { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PlatformSettingsService } from "../../core/platform-settings.service";
import type { PrismaService } from "../../core/prisma.service";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";

/**
 * ‎**תפוגת הטוקן העסקי — הכשל השקט של החיבור** (docs/12).
 *
 * תצורת Embedded Signup מנפיקה טוקן ל-60 יום, ו-Meta אינה מודיעה
 * כשהוא פג: אין `account_update`, אין שגיאה, השורה ממשיכה לומר
 * ‎`connected` והלידים פשוט מפסיקים להיכנס. לכן הבדיקות כאן הן
 * התנהגותיות ולא מבניות — מה שחשוב הוא **מה נשמר** ו**מתי מסמנים**,
 * ושני אלה ניתנים להרצה בלי Meta בצד השני.
 */

/*
 * ‎`appCredentials` נופלת ל-`loadEnv()` כשאין ערך ב-`platform_settings`,
 * ו-`loadEnv` מאמתת את כל הסביבה. המינימום החוקי מוגדר כאן כדי
 * שהבדיקה תבדוק את הסבב ולא את קונפיגורציית הסביבה.
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

const NOW = new Date("2026-09-03T12:00:00.000Z");
const days = (n: number): Date => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

interface Row {
  id: string;
  tenantId: string;
  userId: string;
  displayPhone: string;
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  disconnectReason: string | null;
}

/**
 * מה שהסבב עשה לשורה — הטענה של רוב הבדיקות כאן. `where` נשמר ולא
 * רק `data`: ההגנה מפני ניתוק במקביל **היא** תנאי ה-`where`, ובדיקה
 * שמסתכלת רק על `data` הייתה עוברת גם אחרי הסרתו.
 */
type Update = { where: Record<string, unknown>; data: Record<string, unknown> };

function harness(
  rows: Row[],
  /** ‏0 = מישהו הקדים אותנו (ניתוק, חיבור מחדש) בין הקריאה לכתיבה */
  affected = 1,
): {
  service: WhatsAppConnectionService;
  updates: Update[];
  where: () => Record<string, unknown>;
} {
  const updates: Update[] = [];
  let captured: Record<string, unknown> = {};
  const prisma = {
    whatsAppBusinessConnection: {
      findMany: vi.fn((args: { where: Record<string, unknown> }) => {
        captured = args.where;
        return Promise.resolve(rows);
      }),
      updateMany: vi.fn((args: Update) => {
        updates.push(args);
        return Promise.resolve({ count: affected });
      }),
    },
  } as unknown as PrismaService;

  /* הצפנה מדומה והפיכה — הבדיקה עוסקת בזרימה, לא ב-AES */
  const crypto = {
    encrypt: (plain: string) => `enc:${plain}`,
    decrypt: (stored: string) => {
      if (!stored.startsWith("enc:")) throw new Error("מפתח אחר");
      return stored.slice(4);
    },
  } as unknown as CryptoService;

  const platformSettings = {
    get: vi.fn((key: string) =>
      Promise.resolve(
        key === "whatsappAppId" ? "111" : key === "whatsappConnectAppSecret" ? "shh" : null,
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
    updates,
    where: () => captured,
  };
}

/** תשובת Graph מוצלחת להארכה. `expires_in` בשניות, כמו אצל Meta. */
const ok = (body: unknown): Response =>
  ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

const fail = (): Response =>
  ({ ok: false, status: 400, text: () => Promise.resolve("expired") }) as unknown as Response;

const row = (over: Partial<Row> = {}): Row => ({
  id: "c1",
  tenantId: "t1",
  userId: "u1",
  displayPhone: "972501234567",
  accessTokenEncrypted: "enc:old-token",
  accessTokenExpiresAt: days(5),
  disconnectReason: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  /* הסורק מדווח ב-error/warn, ואין ערך בזיהום פלט הבדיקות */
  vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("סבב רענון הטוקנים", () => {
  it("שואל רק על קווים חיים שהתפוגה שלהם בשבועיים הקרובים", async () => {
    const { service, where } = harness([]);
    vi.stubGlobal("fetch", vi.fn());
    await service.sweepExpiringTokens(NOW);

    const w = where() as {
      disconnectedAt: null;
      accessTokenEncrypted: { not: null };
      accessTokenExpiresAt: { not: null; lt: Date };
    };
    expect(w.disconnectedAt).toBeNull();
    expect(w.accessTokenEncrypted).toEqual({ not: null });
    /*
     * ‏שבועיים ולא יום: רענון שנכשל צריך מקום לניסיונות חוזרים.
     * הטענה על הגבול עצמו, כי הקטנתו בטעות היא בדיוק מה שהיה
     * מחזיר את הכשל השקט בלי להפיל אף בדיקה אחרת.
     */
    expect(w.accessTokenExpiresAt.lt.getTime()).toBe(days(14).getTime());
    /* ‏`not: null` — טוקן שאינו פג אינו נכנס לסבב מלכתחילה */
    expect(w.accessTokenExpiresAt.not).toBeNull();
  });

  it("טוקן שהוארך נשמר מוצפן עם התפוגה החדשה", async () => {
    const { service, updates } = harness([row()]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(ok({ access_token: "fresh", expires_in: 5_184_000 }))),
    );

    const result = await service.sweepExpiringTokens(NOW);

    expect(result.refreshed).toBe(1);
    expect(result.expired).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data.accessTokenEncrypted).toBe("enc:fresh");
    expect((updates[0]?.data.accessTokenExpiresAt as Date).getTime()).toBe(days(60).getTime());
  });

  it("הבקשה היא fb_exchange_token עם הטוקן המפוענח", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(ok({ access_token: "fresh", expires_in: 60 })));
    vi.stubGlobal("fetch", fetchSpy);
    const { service } = harness([row()]);
    await service.sweepExpiringTokens(NOW);

    const url = new URL(String((fetchSpy.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    /* ‏המפוענח, לא המוצפן — שליחת `enc:` הייתה נדחית על ידי Meta */
    expect(url.searchParams.get("fb_exchange_token")).toBe("old-token");
    expect(url.searchParams.get("client_secret")).toBe("shh");
  });

  it("תשובה בלי expires_in נשמרת כטוקן שאינו פג ולא כתאריך בעבר", async () => {
    const { service, updates } = harness([row()]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok({ access_token: "fresh" }))));

    await service.sweepExpiringTokens(NOW);

    /*
     * ‏אילו היה נשמר `new Date(0)` או `now`, הסבב הבא היה מסמן את
     * הקו כפג — כלומר ניתוק של קו תקין בגלל שדה שמטא השמיטה.
     */
    expect(updates[0]?.data.accessTokenExpiresAt).toBeNull();
  });

  it("כישלון רענון בזמן שהטוקן עוד חי אינו מסמן ואינו מתריע", async () => {
    const { service, updates } = harness([row({ accessTokenExpiresAt: days(5) })]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(fail())));

    const result = await service.sweepExpiringTokens(NOW);

    expect(result.expired).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("טוקן שכבר פג ואי אפשר לרענן מסומן ומדווח", async () => {
    const { service, updates } = harness([row({ accessTokenExpiresAt: days(-1) })]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(fail())));

    const result = await service.sweepExpiringTokens(NOW);

    expect(updates[0]?.data).toEqual({ status: "error", disconnectReason: "token_expired" });
    expect(result.expired).toEqual([
      { id: "c1", tenantId: "t1", userId: "u1", displayPhone: "972501234567" },
    ]);
  });

  it("קו שכבר סומן פג אינו מייצר התראה שנייה", async () => {
    /* ‏אחרת כל שש שעות הייתה נשלחת אותה התראה על אותה תקלה */
    const { service, updates } = harness([
      row({ accessTokenExpiresAt: days(-1), disconnectReason: "token_expired" }),
    ]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(fail())));

    const result = await service.sweepExpiringTokens(NOW);

    /*
     * ‏בלי התנאי הזה כל שש שעות הייתה נשלחת אותה התראה, והמתווך
     * היה מכבה התראות במקום לחבר מחדש.
     */
    expect(result.expired).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("רענון מוצלח אינו מכריז „מחובר” על קו שנשבר מסיבה אחרת", async () => {
    const { service, updates } = harness([
      row({ disconnectReason: "webhook_subscribe_failed" }),
    ]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok({ access_token: "fresh" }))));

    await service.sweepExpiringTokens(NOW);

    /*
     * ‏רענון טוקן אינו פותר כשל הרשמה ל-Webhooks. „מחובר” כאן היה
     * מסך ירוק על קו שלידים אינם מגיעים אליו (ביקורת Codex).
     */
    expect(updates[0]?.data.accessTokenEncrypted).toBe("enc:fresh");
    expect(updates[0]?.data.status).toBeUndefined();
    expect(updates[0]?.data.disconnectReason).toBeUndefined();
  });

  it("תפוגה אינה דורסת סיבת תקלה קיימת ואינה מתריעה עליה", async () => {
    const { service, updates } = harness([
      row({ accessTokenExpiresAt: days(-1), disconnectReason: "webhook_subscribe_failed" }),
    ]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(fail())));

    const result = await service.sweepExpiringTokens(NOW);

    /*
     * ‏הקו כבר אדום ומוסבר במסך, והתרופה זהה — חיבור מחדש. החלפת
     * הסיבה ב-`token_expired` הייתה מוחקת את התקלה האמיתית.
     */
    expect(updates).toEqual([]);
    expect(result.expired).toEqual([]);
  });

  it("כתיבת הטוקן המרוענן מותנית בשורה מחוברת עם אותו צופן", async () => {
    const { service, updates } = harness([row()]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok({ access_token: "fresh" }))));

    await service.sweepExpiringTokens(NOW);

    /*
     * ‏בין הקריאה לכתיבה עוברת קריאת רשת אל Meta, ובה המתווך יכול
     * לנתק. בלי שני התנאים האלה הכתיבה הייתה מחזירה טוקן חי לשורה
     * מנותקת — הפרה של מחיקת הסוד בניתוק (ביקורת Codex).
     */
    expect(updates[0]?.where).toEqual({
      id: "c1",
      disconnectedAt: null,
      accessTokenEncrypted: "enc:old-token",
    });
  });

  it("קו שנותק תוך כדי הרענון אינו נספר כמרוענן", async () => {
    const { service } = harness([row()], 0);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok({ access_token: "fresh" }))));

    const result = await service.sweepExpiringTokens(NOW);

    expect(result.refreshed).toBe(0);
  });

  it("קו שנותק תוך כדי הסבב אינו מסומן ואינו מתריע", async () => {
    const { service, updates } = harness([row({ accessTokenExpiresAt: days(-1) })], 0);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(fail())));

    const result = await service.sweepExpiringTokens(NOW);

    /* ‏הסימון נוסה, אבל השורה כבר לא ענתה לתנאי — ואז אין על מה להתריע */
    expect(updates[0]?.where).toEqual({ id: "c1", disconnectedAt: null, disconnectReason: null });
    expect(result.expired).toEqual([]);
  });

  it("טוקן שאי אפשר לפענח אינו מפיל את הסבב", async () => {
    const { service } = harness([
      row({ accessTokenEncrypted: "מפתח-אחר", accessTokenExpiresAt: days(-1) }),
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await service.sweepExpiringTokens(NOW);

    /* ‏אין מה לשלוח ל-Meta, אבל הקו כן מסומן: הוא מת בפועל */
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.expired).toHaveLength(1);
  });
});
