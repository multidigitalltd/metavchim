import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiService } from "./gemini.service";
import type { PlatformSettingsService } from "./platform-settings.service";

/**
 * ‎**רמת החשיבה — בקשה, ונפילה מדורגת כשהמודל אינו מכיר אותה.**
 *
 * ‏הסוכן בוואטסאפ מבקש `medium`. מודל שדוחה את הרמה הזו חוזר קודם
 * ‏ל-`low` — ברירת המחדל שמחזיקה את העלות — ורק מודל שאינו מכיר את
 * ‏השדה כלל רץ בלי הגבלה. מעבר ישר ל„בלי הגבלה” היה מייקר את **כל**
 * ‏הקריאות של המודל מכאן והלאה, בגלל בקשה אחת.
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

const settings = {
  get: (key: string) =>
    Promise.resolve(key === "geminiApiKey" ? "test-key" : key === "geminiModel" ? "test-model" : null),
} as unknown as PlatformSettingsService;

const ok = (): Response =>
  ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"action":"search"}' }] } }] }),
  }) as Response;
const rejected = (): Response =>
  ({
    ok: false,
    status: 400,
    json: () => Promise.resolve({ error: { status: "INVALID_ARGUMENT", message: "thinking" } }),
  }) as Response;

/** ‏הרמה שנשלחה בכל קריאה — `null` = בלי `thinkingConfig` כלל. */
function sentLevels(fetchMock: ReturnType<typeof vi.fn>): (string | null)[] {
  return fetchMock.mock.calls.map(([, init]) => {
    const body = JSON.parse(String((init as RequestInit).body)) as {
      generationConfig: { thinkingConfig?: { thinkingLevel: string } };
    };
    return body.generationConfig.thinkingConfig?.thinkingLevel ?? null;
  });
}

describe("רמת החשיבה בקריאה למודל", () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("בלי בקשה — הרמה הנמוכה, כמו תמיד", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(ok()));
    vi.stubGlobal("fetch", fetchMock);
    await new GeminiService(settings).generateStructuredDetailed("p", { type: "object" });
    expect(sentLevels(fetchMock)).toEqual(["low"]);
  });

  it("בקשה ל-medium נשלחת כמו שהיא", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(ok()));
    vi.stubGlobal("fetch", fetchMock);
    await new GeminiService(settings).generateStructuredDetailed(
      "p",
      { type: "object" },
      { thinkingLevel: "medium" },
    );
    expect(sentLevels(fetchMock)).toEqual(["medium"]);
  });

  it("מודל שדוחה medium — חוזר ל-low, ולא לבלי הגבלה; ונזכר", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve(String(init.body).includes('"medium"') ? rejected() : ok()),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new GeminiService(settings);
    const first = await service.generateStructuredDetailed("p", { type: "object" }, { thinkingLevel: "medium" });
    expect(first.value).toEqual({ action: "search" });
    expect(sentLevels(fetchMock)).toEqual(["medium", "low"]);

    // ‏הקריאה הבאה אינה משלמת את ה-400 שוב
    await service.generateStructuredDetailed("p", { type: "object" }, { thinkingLevel: "medium" });
    expect(sentLevels(fetchMock)).toEqual(["medium", "low", "low"]);
  });
});
