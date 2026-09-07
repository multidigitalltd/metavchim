import { Logger } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CryptoService } from "../../core/crypto.service";
import type { PlatformSettingsService } from "../../core/platform-settings.service";
import type { PrismaService } from "../../core/prisma.service";
import { WhatsAppSendService } from "./whatsapp-send.service";

/**
 * ‎**„בדוק חיבור” אינו מוכיח ששליחה עובדת** — ולכן `probeSend`.
 *
 * ‎`probe` קורא את פרטי המספר מ-Meta. זו בדיקה חלשה יותר משהיא
 * נראית: טוקן שחסרה לו ההרשאה `whatsapp_business_messaging` עובר
 * אותה בהצלחה מלאה, וכך גם מספר שאינו ברשימת הבדיקה במצב
 * Development. שני המקרים מתגלים היום רק בהודעה הראשונה של מתווך
 * אמיתי, כלומר במקום הגרוע ביותר.
 *
 * ## מה נבדק כאן
 *
 * לא „נשלח או לא” — אלא **מה נאמר למי שלוחץ**. בדיקה שמחזירה
 * „נכשל” משאירה את המנהל לנחש בין טוקן פסול, מספר לא מורשה וכלל
 * של Meta; והכישלון הצפוי ביותר כאן — חלון 24 השעות — נראה בלי
 * הסבר בדיוק כמו חיבור שבור, בזמן שהוא התנהגות תקינה לחלוטין.
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

/** תשובת Graph. `ok:false` נושאת גוף שגיאה בצורה של Meta. */
const reply = (ok: boolean, body: unknown, status = 200): Response =>
  ({ ok, status, json: () => Promise.resolve(body) }) as Response;

function build(configured = true): { service: WhatsAppSendService } {
  const platformSettings = {
    get: vi.fn((key: string) =>
      Promise.resolve(
        !configured
          ? null
          : key === "whatsappAccessToken"
            ? "system-user-token"
            : key === "whatsappPhoneNumberId"
              ? "555666777"
              : null,
      ),
    ),
  } as unknown as PlatformSettingsService;

  return {
    service: new WhatsAppSendService(
      platformSettings,
      {} as PrismaService,
      {} as CryptoService,
    ),
  };
}

/** ה-fetch המדומה נקבע בכל בדיקה, כי כל אחת בוחנת תשובה אחרת. */
const graph = (response: Response, capture?: (payload: unknown) => void): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: URL | string, init?: { body?: string }) => {
      capture?.({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
      return Promise.resolve(response);
    }),
  );
};

beforeEach(() => {
  vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});

describe("הודעת בדיקה מהמסך", () => {
  it("שולחת אל המספר המנורמל, ואומרת לאן", async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    graph(reply(true, { messages: [{ id: "wamid.1" }] }), (p) => {
      captured = p as { url: string; body: Record<string, unknown> };
    });
    const { service } = build();

    const result = await service.probeSend("050-123-4567");

    expect(result.ok).toBe(true);
    // ‎`0501234567` מקומי ⇐ `972501234567`, כמו בכל מקום אחר בערוץ
    expect(captured!.body["to"]).toBe("972501234567");
    expect(result.message).toContain("972501234567");
  });

  /*
   * הנוסח קבוע בשירות ואינו מגיע מהמסך: המסך מוסר מספר בלבד, כדי
   * שזה יישאר בדיקת חיבור ולא כלי לשליחת טקסט חופשי לכל מספר.
   */
  it("הנוסח קבוע ואינו נשלט מהמסך", async () => {
    let captured: { body: Record<string, unknown> } | null = null;
    graph(reply(true, {}), (p) => {
      captured = p as { body: Record<string, unknown> };
    });
    const { service } = build();

    await service.probeSend("0501234567");

    expect((captured!.body["text"] as { body: string }).body).toContain("בדיקת חיבור");
  });

  /**
   * ‎**הכישלון הצפוי ביותר, וזה שהכי קל לפרש לא נכון.**
   *
   * ‏Meta מתירה טקסט חופשי רק בתוך 24 שעות מהודעה של הנמען. הנוסח
   * שלה („re-engagement message”) אינו אומר את זה, ומי שלוחץ מסיק
   * שהחיבור שבור — ומתחיל לחפש תקלה שאינה קיימת.
   */
  it("חלון 24 השעות מוסבר, ולא מוצג כתקלת חיבור", async () => {
    graph(
      reply(false, { error: { code: 131047, message: "Re-engagement message" } }, 400),
    );
    const { service } = build();

    const result = await service.probeSend("0501234567");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("24 השעות");
    // ומה לעשות, לא רק מה קרה
    expect(result.message).toContain("שלחו הודעה");
  });

  it("טוקן שנדחה מכוון לסוג הטוקן הנכון", async () => {
    graph(reply(false, { error: { code: 190, message: "Invalid OAuth token" } }, 401));
    const { service } = build();

    const result = await service.probeSend("0501234567");

    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("System User");
  });

  /* שגיאה אחרת נמסרת כלשונה — הניסוח של Meta הוא המידע */
  it("שגיאה אחרת נמסרת עם הנוסח של Meta", async () => {
    graph(reply(false, { error: { code: 131030, message: "Recipient not in allowed list" } }, 400));
    const { service } = build();

    const result = await service.probeSend("0501234567");

    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("Recipient not in allowed list");
  });

  it("בלי אישורים אומרת מה חסר ואינה פונה ל-Meta", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { service } = build(false);

    const result = await service.probeSend("0501234567");

    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("Phone Number ID");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("מספר ריק נעצר לפני הפנייה ל-Meta", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { service } = build();

    const result = await service.probeSend("---");

    expect(result).toMatchObject({ ok: false, message: "מספר לא תקין" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
