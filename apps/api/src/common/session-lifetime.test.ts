import { describe, expect, it } from "vitest";
import {
  isPersistentSession,
  PERSISTENT_SESSION_TTL_MS,
  renewedExpiry,
  RENEW_INTERVAL_MS,
  SESSION_TTL_MS,
  sessionTtlMs,
} from "./session-lifetime";

const NOW = new Date("2026-09-19T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("Session מתמשך — למי", () => {
  it("רק האפליקציה, ורק כשביקשה", () => {
    expect(isPersistentSession("mobile", true)).toBe(true);
    expect(isPersistentSession("mobile", false)).toBe(false);
    // דפדפן שמבקש (גוף בקשה מזויף) מקבל את הרגיל
    expect(isPersistentSession("web", true)).toBe(false);
  });

  it("אורך החיים — 12 שעות לרגיל, 30 יום למתמשך", () => {
    expect(sessionTtlMs(false)).toBe(SESSION_TTL_MS);
    expect(sessionTtlMs(true)).toBe(PERSISTENT_SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(12 * HOUR);
    expect(PERSISTENT_SESSION_TTL_MS).toBe(30 * 24 * HOUR);
  });
});

describe("הארכה בפעילות", () => {
  it("Session רגיל לעולם לא מוארך", () => {
    expect(renewedExpiry({ persistent: false, expiresAt: new Date(NOW.getTime() + HOUR) }, NOW)).toBeNull();
  });

  it("מתמשך שהוארך לפני פחות מיום — אין כתיבה", () => {
    const issuedAnHourAgo = new Date(NOW.getTime() - HOUR + PERSISTENT_SESSION_TTL_MS);
    expect(renewedExpiry({ persistent: true, expiresAt: issuedAnHourAgo }, NOW)).toBeNull();
  });

  it("מתמשך שעבר עליו יום — התפוגה נדחפת ל-30 יום מעכשיו", () => {
    const issuedYesterday = new Date(NOW.getTime() - RENEW_INTERVAL_MS + PERSISTENT_SESSION_TTL_MS);
    expect(renewedExpiry({ persistent: true, expiresAt: issuedYesterday }, NOW)).toEqual(
      new Date(NOW.getTime() + PERSISTENT_SESSION_TTL_MS),
    );
  });

  it("מתמשך שכמעט פג (הפעילות הראשונה אחרי שבועות) — מוארך", () => {
    const almostExpired = new Date(NOW.getTime() + HOUR);
    expect(renewedExpiry({ persistent: true, expiresAt: almostExpired }, NOW)).toEqual(
      new Date(NOW.getTime() + PERSISTENT_SESSION_TTL_MS),
    );
  });
});
