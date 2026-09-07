import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleCalendarService, type CalendarLink } from "./google-calendar.service";
import type { PrismaService } from "../../core/prisma.service";
import type { PlatformSettingsService } from "../platform/platform-settings.service";
import type { CryptoService } from "../../core/crypto.service";

/**
 * ‎**מחיקת אירוע שנכשלה נאמרת** (ביקורת Codex, P2).
 *
 * ‏התשובה מ-Google לא נבדקה בענף הביטול כלל, ולכן 401, 403 או 5xx
 * ‏חזרו כ„בוצע”. הקורא אז מסמן את השורה כמסונכרנת ומאפס את המזהה —
 * ‏כלומר האירוע נשאר ביומן של המתווך, והמזהה היחיד שמצביע עליו
 * ‏נמחק. שגיאה חולפת הפכה לאירוע נצחי.
 *
 * ‎404 ו-410 הם ההפך: האירוע כבר איננו, וזו בדיוק המטרה.
 */

const LINK: CalendarLink = {
  id: "01LINKAAAAAAAAAAAAAAAAAAAA",
  tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
  userId: "01USERAAAAAAAAAAAAAAAAAAAA",
  googleEmail: "agent@example.com",
  calendarId: "primary",
  refreshTokenEncrypted: "x",
  syncToken: null,
  lastSyncAt: null,
  lastError: null,
};

const EVENT = {
  googleEventId: "gcal-1",
  summary: "משימה: לחזור לבעלים",
  startsAt: new Date("2026-09-07T09:00:00.000Z"),
  endsAt: new Date("2026-09-07T09:30:00.000Z"),
  cancelled: true,
};

function serviceWith(status: number): GoogleCalendarService {
  const service = new GoogleCalendarService(
    {} as unknown as PrismaService,
    {} as unknown as PlatformSettingsService,
    {} as unknown as CryptoService,
  );
  /* ‏האסימון אינו הנושא כאן — הענף שאחריו הוא */
  (service as unknown as { accessToken: () => Promise<string> }).accessToken = async () => "tok";
  vi.stubGlobal("fetch", async () => new Response(null, { status }));
  return service;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("‏ביטול אירוע ביומן Google", () => {
  it("‏מחיקה שהצליחה מחזירה null", async () => {
    await expect(serviceWith(204).upsertEvent(LINK, EVENT)).resolves.toBeNull();
  });

  it("‏אירוע שכבר איננו הוא הצלחה — 404 ו-410", async () => {
    for (const status of [404, 410]) {
      await expect(serviceWith(status).upsertEvent(LINK, EVENT), String(status)).resolves.toBeNull();
    }
  });

  it("‏כל כישלון אחר נזרק ואינו נבלע", async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      await expect(serviceWith(status).upsertEvent(LINK, EVENT), String(status)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
  });
});
