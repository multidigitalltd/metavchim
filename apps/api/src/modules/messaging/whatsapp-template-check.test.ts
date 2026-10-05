import { afterEach, describe, expect, it, vi } from "vitest";
import type { CryptoService } from "../../core/crypto.service";
import type { PlatformSettingsService } from "../../core/platform-settings.service";
import type { PrismaService } from "../../core/prisma.service";
import { WhatsAppSendService } from "./whatsapp-send.service";

/**
 * ‎**הכפתור „פתח במערכת” — מה שרשום ב-Meta מול מה שצריך.**
 *
 * ‏קישורי הבוט נחתו על „העמוד לא נמצא” כשבסיס הכתובת שנרשם ב-Meta היה
 * ‏הדומיין הראשי ולא כתובת המערכת (דיווח המשתמש). הבדיקה קוראת את
 * ‏התבנית מ-Meta ומשווה ל-`WEB_ORIGIN`.
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

const SETTINGS: Record<string, string> = {
  whatsappAccessToken: "system-user-token",
  whatsappPhoneNumberId: "555666777",
  whatsappAppId: "111222333",
  whatsappAppSecret: "app-secret-value",
  whatsappNotifyTemplate: "metavchim_notify",
  whatsappNotifyTemplateLang: "he",
};

const reply = (ok: boolean, body: unknown): Response =>
  ({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) }) as Response;

function service(settings: Record<string, string> = SETTINGS): WhatsAppSendService {
  const platformSettings = {
    get: vi.fn((key: string) => Promise.resolve(settings[key] ?? null)),
  } as unknown as PlatformSettingsService;
  return new WhatsAppSendService(platformSettings, {} as PrismaService, {} as CryptoService);
}

/** ‏Meta: חשבון עסקי אחד, המספר שלנו בתוכו, והתבנית עם הכפתור בכתובת `url` */
function meta(url: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL) => {
      const href = String(input);
      if (href.includes("/debug_token")) {
        return Promise.resolve(
          reply(true, { data: { granular_scopes: [{ scope: "whatsapp_business_messaging", target_ids: ["999888777"] }] } }),
        );
      }
      if (href.includes("999888777/phone_numbers")) return Promise.resolve(reply(true, { data: [{ id: "555666777" }] }));
      if (href.includes("999888777/message_templates")) {
        return Promise.resolve(
          reply(true, {
            data: [
              {
                name: "metavchim_notify",
                language: "he",
                components: [{ type: "BODY" }, { type: "BUTTONS", buttons: [{ type: "URL", url }] }],
              },
            ],
          }),
        );
      }
      return Promise.resolve(reply(false, {}));
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("בדיקת הכפתור מול Meta", () => {
  it("הכתובת הרשומה תואמת לכתובת המערכת — ✓", async () => {
    meta("https://app.example.test/{{1}}");
    expect(await service().checkNotifyTemplateButton()).toMatchObject({
      ok: true,
      expected: "https://app.example.test/{{1}}",
    });
  });

  it("הדומיין הראשי במקום כתובת המערכת — ✗, עם הכתובת הרשומה והנכונה", async () => {
    meta("https://example.test/{{1}}");
    const check = await service().checkNotifyTemplateButton();
    expect(check.ok).toBe(false);
    expect(check.registered).toBe("https://example.test/{{1}}");
    expect(check.expected).toBe("https://app.example.test/{{1}}");
  });

  it("אין תבנית מוגדרת — לא נבדק, ואין קריאה ל-Meta", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { whatsappNotifyTemplate: _omit, ...rest } = SETTINGS;
    expect((await service(rest).checkNotifyTemplateButton()).ok).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("לא ניתן לזהות את החשבון העסקי — לא נבדק, עם הסבר", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(reply(false, {}))));
    const check = await service().checkNotifyTemplateButton();
    expect(check.ok).toBeNull();
    expect(check.message).toContain("WhatsApp Manager");
  });
});
