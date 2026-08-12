import { describe, expect, it } from "vitest";
import { CAPABILITIES, ROLE_CAPABILITIES, type Capability } from "../rbac.js";
import {
  BLOCKABLE_MODULE_KEYS,
  CAPABILITY_LABELS,
  CAPABILITY_MODULES,
  applyBlockedModules,
  blockedModulesRejectionReason,
  capabilitiesWithoutModule,
  clearEffect,
  moduleLabel,
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

describe("clearEffect", () => {
  it("ניקוי חסימה על יכולת שהתפקיד נותן הוא הענקה", () => {
    // agent מקבל offers.send מהתפקיד — הסרת החסימה מחזירה גישה
    expect(clearEffect("agent", "offers.send", "deny")).toBe("grant");
  });

  it("ניקוי חסימה על יכולת שהתפקיד לא נותן אינו מחזיר כלום", () => {
    expect(clearEffect("agent", "billing.manage", "deny")).toBe("deny");
  });

  it("ניקוי הענקה הוא צמצום ולכן מותר תמיד", () => {
    expect(clearEffect("agent", "analytics.view", "grant")).toBe("deny");
  });

  it("ניקוי בלי חריג קיים אינו מוסיף דבר", () => {
    expect(clearEffect("agent", "offers.send", null)).toBe("deny");
  });

  it("הכלל סוגר את נתיב ההסלמה שהתגלה בביקורת", () => {
    // מנהל שנחסמה ממנו data.export לא יוכל להחזיר אותה למנהל אחר
    const actorCaps = new Set<Capability>(
      (ROLE_CAPABILITIES["admin"] ?? []).filter((c) => c !== "data.export"),
    );
    const effect = clearEffect("admin", "data.export", "deny");
    expect(effect).toBe("grant");
    expect(
      overrideRejectionReason({
        actorUserId: "a",
        actorCapabilities: actorCaps,
        targetUserId: "b",
        targetRole: "admin",
        capability: "data.export",
        effect,
      }),
    ).toContain("שאין לכם");
  });
});

describe("חסימת מודול ברמת המשרד", () => {
  it("מודול חסום מוריד את כל היכולות שלו", () => {
    const capabilities = resolveCapabilities("owner", [], new Date());
    const after = applyBlockedModules(capabilities, ["collaboration"]);
    expect(after.has("collaboration.share")).toBe(false);
    expect(after.has("collaboration.offer")).toBe(false);
    // שאר המודולים לא נגעו
    expect(after.has("properties.view")).toBe(true);
  });

  it("בלי חסימות — אותן יכולות בדיוק", () => {
    const capabilities = resolveCapabilities("agent", [], new Date());
    expect([...applyBlockedModules(capabilities, [])].sort()).toEqual([...capabilities].sort());
  });

  it("החסימה גוברת על הענקה מפורשת של מנהל המשרד", () => {
    /*
     * זו כל הנקודה: חריג grant ברמת המשתמש אינו מבטל החלטת
     * פלטפורמה, אחרת מנהל המשרד היה מסיר את החסימה בלחיצה.
     */
    const capabilities = resolveCapabilities(
      "agent",
      [{ capability: "collaboration.offer", effect: "grant", expiresAt: null }],
      new Date(),
    );
    expect(capabilities.has("collaboration.offer")).toBe(true);
    expect(applyBlockedModules(capabilities, ["collaboration"]).has("collaboration.offer")).toBe(
      false,
    );
  });

  it("מפתח לא מוכר נדחה בשמירה, ואינו מחסיר דבר בהחלה", () => {
    expect(blockedModulesRejectionReason(["collaboration"])).toBeNull();
    expect(blockedModulesRejectionReason(["collaboration", "nope"])).not.toBeNull();
    const capabilities = resolveCapabilities("owner", [], new Date());
    expect(applyBlockedModules(capabilities, ["nope"]).size).toBe(capabilities.size);
  });

  it("כל מפתח חסימה הוא מודול אמיתי מהקטלוג", () => {
    expect([...BLOCKABLE_MODULE_KEYS].sort()).toEqual(
      CAPABILITY_MODULES.map((m) => m.key).sort(),
    );
    expect(moduleLabel("collaboration")).toBe("שיתוף פעולה בין משרדים");
    expect(moduleLabel("nope")).toBe("nope");
  });
});
