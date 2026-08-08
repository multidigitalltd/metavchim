import { describe, expect, it } from "vitest";
import { CAPABILITIES, ROLE_CAPABILITIES, type Capability } from "../rbac.js";
import {
  CAPABILITY_LABELS,
  CAPABILITY_MODULES,
  capabilitiesWithoutModule,
  describeOverride,
  isOverrideActive,
  overrideRejectionReason,
  resolveCapabilities,
  type CapabilityOverride,
} from "./capability-overrides.js";

const NOW = new Date("2026-08-08T12:00:00Z");
const TOMORROW = new Date("2026-08-09T12:00:00Z");
const YESTERDAY = new Date("2026-08-07T12:00:00Z");

describe("isOverrideActive", () => {
  it("חריג בלי תפוגה תמיד בתוקף", () => {
    expect(isOverrideActive({ capability: "offers.send", effect: "deny", expiresAt: null }, NOW)).toBe(
      true,
    );
  });

  it("חריג שתפוגתו בעתיד בתוקף", () => {
    expect(
      isOverrideActive({ capability: "offers.send", effect: "deny", expiresAt: TOMORROW }, NOW),
    ).toBe(true);
  });

  it("חריג שפג אינו בתוקף", () => {
    expect(
      isOverrideActive({ capability: "offers.send", effect: "deny", expiresAt: YESTERDAY }, NOW),
    ).toBe(false);
  });
});

describe("resolveCapabilities", () => {
  it("בלי חריגים מחזיר בדיוק את יכולות התפקיד", () => {
    expect([...resolveCapabilities("agent", [], NOW)].sort()).toEqual(
      [...ROLE_CAPABILITIES["agent"]!].sort(),
    );
  });

  it("חסימה מסירה יכולת שהתפקיד נותן", () => {
    const caps = resolveCapabilities(
      "agent",
      [{ capability: "offers.send", effect: "deny", expiresAt: null }],
      NOW,
    );
    expect(caps.has("offers.send")).toBe(false);
    expect(caps.has("properties.view")).toBe(true);
  });

  it("הענקה מוסיפה יכולת שהתפקיד לא נותן", () => {
    const caps = resolveCapabilities(
      "agent",
      [{ capability: "analytics.view", effect: "grant", expiresAt: null }],
      NOW,
    );
    expect(caps.has("analytics.view")).toBe(true);
  });

  it("חריג שפג לא משפיע — התפוגה נאכפת בקריאה", () => {
    const caps = resolveCapabilities(
      "agent",
      [{ capability: "offers.send", effect: "deny", expiresAt: YESTERDAY }],
      NOW,
    );
    expect(caps.has("offers.send")).toBe(true);
  });

  it("חסימה זמנית פעילה עד רגע התפוגה", () => {
    const override: CapabilityOverride = {
      capability: "properties.edit",
      effect: "deny",
      expiresAt: TOMORROW,
    };
    expect(resolveCapabilities("agent", [override], NOW).has("properties.edit")).toBe(false);
    expect(
      resolveCapabilities("agent", [override], new Date("2026-08-10T12:00:00Z")).has(
        "properties.edit",
      ),
    ).toBe(true);
  });

  it("חסימת יכולת שהתפקיד ממילא לא נותן אינה משנה דבר", () => {
    const caps = resolveCapabilities(
      "viewer",
      [{ capability: "billing.manage", effect: "deny", expiresAt: null }],
      NOW,
    );
    expect(caps.has("billing.manage")).toBe(false);
    expect([...caps].sort()).toEqual([...ROLE_CAPABILITIES["viewer"]!].sort());
  });

  it("חסימת מודול שלם מסירה את כל יכולותיו", () => {
    const properties = CAPABILITY_MODULES.find((m) => m.key === "properties")!;
    const caps = resolveCapabilities(
      "agent",
      properties.capabilities.map((capability) => ({
        capability,
        effect: "deny" as const,
        expiresAt: null,
      })),
      NOW,
    );
    for (const capability of properties.capabilities) expect(caps.has(capability)).toBe(false);
    expect(caps.has("calendar.manage")).toBe(true);
  });

  it("תפקיד לא מוכר מקבל אפס יכולות ולא קורס", () => {
    expect(resolveCapabilities("לא-קיים", [], NOW).size).toBe(0);
  });
});

describe("overrideRejectionReason", () => {
  const ownerCaps = new Set<Capability>(CAPABILITIES);
  const adminCaps = new Set<Capability>(ROLE_CAPABILITIES["admin"]!);

  function request(overrides: Partial<Parameters<typeof overrideRejectionReason>[0]> = {}) {
    return overrideRejectionReason({
      actorUserId: "manager",
      actorCapabilities: ownerCaps,
      targetUserId: "agent",
      targetRole: "agent",
      capability: "offers.send",
      effect: "deny",
      ...overrides,
    });
  }

  it("שינוי תקין מותר", () => {
    expect(request()).toBeNull();
  });

  it("אי אפשר לשנות הרשאות של עצמך", () => {
    expect(request({ targetUserId: "manager" })).toContain("של עצמך");
  });

  it("אי אפשר לגעת בבעל המשרד", () => {
    expect(request({ targetRole: "owner" })).toContain("בעל המשרד");
  });

  it("מנהל לא מעניק יכולת שאין לו — אין הסלמה דרך מישהו אחר", () => {
    expect(
      request({ actorCapabilities: adminCaps, capability: "billing.manage", effect: "grant" }),
    ).toContain("שאין לכם");
  });

  it("אבל כן יכול לחסום יכולת שאין לו", () => {
    // חסימה מצמצמת ולכן אינה נתיב הסלמה
    expect(
      request({ actorCapabilities: adminCaps, capability: "billing.manage", effect: "deny" }),
    ).toBeNull();
  });

  it("הכלל של עצמך גובר גם כשהיעד הוא בעל משרד", () => {
    expect(request({ targetUserId: "manager", targetRole: "owner" })).toContain("של עצמך");
  });
});

describe("describeOverride", () => {
  it("לצמיתות", () => {
    expect(describeOverride({ capability: "offers.send", effect: "deny", expiresAt: null }, NOW)).toBe(
      "נחסמה לצמיתות",
    );
  });

  it("הענקה מנוסחת אחרת מחסימה", () => {
    expect(
      describeOverride({ capability: "analytics.view", effect: "grant", expiresAt: null }, NOW),
    ).toBe("נוספה לצמיתות");
  });

  it("חסימה שפגה מסומנת ככזו", () => {
    expect(
      describeOverride({ capability: "offers.send", effect: "deny", expiresAt: YESTERDAY }, NOW),
    ).toContain("פג תוקף");
  });

  it("חסימה זמנית מציגה כמה נשאר", () => {
    expect(
      describeOverride(
        { capability: "offers.send", effect: "deny", expiresAt: new Date("2026-08-15T12:00:00Z") },
        NOW,
      ),
    ).toBe("נחסמה — ל-7 ימים נוספים");
  });

  it("פחות מיממה", () => {
    expect(
      describeOverride(
        { capability: "offers.send", effect: "deny", expiresAt: new Date("2026-08-08T20:00:00Z") },
        NOW,
      ),
    ).toBe("נחסמה — עד סוף היום");
  });
});

describe("שלמות הקיבוץ למודולים", () => {
  it("כל יכולת שייכת למודול — יכולת חדשה לא תיעלם מהמסך", () => {
    expect(capabilitiesWithoutModule()).toEqual([]);
  });

  it("אין יכולת שמופיעה בשני מודולים", () => {
    const all = CAPABILITY_MODULES.flatMap((m) => m.capabilities);
    expect(all.length).toBe(new Set(all).size);
  });

  it("לכל יכולת יש תווית בעברית", () => {
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_LABELS[capability]).toBeTruthy();
    }
  });
});
