import { describe, expect, it } from "vitest";
import {
  AUTOMATIONS,
  automationRejectionReason,
  automationSpec,
  automationThresholdMs,
  defaultAutomationSettings,
  resolveAutomationSettings,
} from "./automations.js";

describe("קטלוג האוטומציות", () => {
  it("כל מפתח מופיע פעם אחת", () => {
    const keys = AUTOMATIONS.map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("לאוטומציה עם יחידה יש ברירת מחדל ותחום, ולזו שבלי — אין", () => {
    for (const spec of AUTOMATIONS) {
      if (spec.unit === null) {
        expect(spec.defaultValue).toBeUndefined();
      } else {
        expect(spec.defaultValue).toBeDefined();
        expect(spec.min).toBeDefined();
        expect(spec.max).toBeDefined();
        expect(spec.defaultValue!).toBeGreaterThanOrEqual(spec.min!);
        expect(spec.defaultValue!).toBeLessThanOrEqual(spec.max!);
      }
    }
  });

  it("הספים שהיו קבועים בקוד הם ברירת המחדל", () => {
    // שינוי כאן משנה התנהגות לכל משרד שלא נגע בהגדרה
    expect(automationSpec("lead_sla")?.defaultValue).toBe(2);
    expect(automationSpec("stale_lead")?.defaultValue).toBe(7);
    expect(automationSpec("offer_followup")?.defaultValue).toBe(48);
    expect(automationSpec("viewing_followup")?.defaultValue).toBe(1);
  });
});

describe("resolveAutomationSettings", () => {
  it("ריק = הכל פועל בברירת המחדל", () => {
    expect(resolveAutomationSettings(null)).toEqual(
      defaultAutomationSettings(),
    );
    expect(resolveAutomationSettings({})).toEqual(defaultAutomationSettings());
    expect(resolveAutomationSettings("לא אובייקט")).toEqual(
      defaultAutomationSettings(),
    );
  });

  it("ערך שמור גובר, והשאר נשאר ברירת מחדל", () => {
    const out = resolveAutomationSettings({
      lead_sla: { enabled: false, value: 6 },
    });
    expect(out.lead_sla).toEqual({ enabled: false, value: 6 });
    expect(out.stale_lead.enabled).toBe(true);
    expect(out.stale_lead.value).toBe(7);
  });

  /*
   * ההתנהגות הקריטית: שדה פגום לא מכבה אוטומציה. אוטומציה שנכבית
   * בשקט היא תקלה שמתגלה רק כשליד לא נענה ואף אחד לא יודע למה.
   */
  it("שדה פגום או חסר אינו מכבה — נופל לברירת המחדל", () => {
    const out = resolveAutomationSettings({
      lead_sla: { enabled: "כן", value: "שש" },
      stale_lead: null,
      offer_followup: 42,
    });
    expect(out.lead_sla).toEqual({ enabled: true, value: 2 });
    expect(out.stale_lead.enabled).toBe(true);
    expect(out.offer_followup.value).toBe(48);
  });

  it("מפתח לא מוכר מגרסה אחרת מתעלמים ממנו", () => {
    const out = resolveAutomationSettings({
      something_else: { enabled: false },
    });
    expect(out).toEqual(defaultAutomationSettings());
  });

  it("ערך מחוץ לתחום נחתך לתחום ולא מפיל", () => {
    const out = resolveAutomationSettings({
      lead_sla: { value: 9999 },
      stale_lead: { value: 0 },
    });
    expect(out.lead_sla.value).toBe(automationSpec("lead_sla")!.max);
    expect(out.stale_lead.value).toBe(automationSpec("stale_lead")!.min);
  });

  it("אוטומציה שאסור לכבות נשארת פועלת גם אם נשמר אחרת", () => {
    const out = resolveAutomationSettings({ exclusivity: { enabled: false } });
    expect(out.exclusivity.enabled).toBe(true);
  });
});

describe("automationRejectionReason", () => {
  it("הגדרה תקפה עוברת", () => {
    expect(
      automationRejectionReason("lead_sla", { enabled: true, value: 4 }),
    ).toBeNull();
    expect(
      automationRejectionReason("daily_brief", { enabled: false }),
    ).toBeNull();
  });

  it("מפתח לא מוכר נדחה", () => {
    expect(automationRejectionReason("nope", { enabled: true })).toContain(
      "לא מוכרת",
    );
  });

  it("סף מחוץ לתחום נדחה עם התחום בהודעה", () => {
    const reason = automationRejectionReason("lead_sla", { value: 500 });
    expect(reason).toContain("1");
    expect(reason).toContain("72");
  });

  it("סף לאוטומציה שאין לה סף נדחה", () => {
    expect(automationRejectionReason("daily_brief", { value: 3 })).toContain(
      "אין לה סף",
    );
  });

  it("כיבוי אוטומציה חובה נדחה", () => {
    expect(
      automationRejectionReason("exclusivity", { enabled: false }),
    ).toContain("אי אפשר לכבות");
  });

  it("טיפוס שגוי ב'פועל' נדחה", () => {
    expect(automationRejectionReason("lead_sla", { enabled: "כן" })).toContain(
      "כן או לא",
    );
  });
});

describe("automationThresholdMs", () => {
  it("שעות וימים מומרים נכון", () => {
    const settings = defaultAutomationSettings();
    expect(automationThresholdMs("lead_sla", settings)).toBe(
      2 * 60 * 60 * 1000,
    );
    expect(automationThresholdMs("stale_lead", settings)).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it("אוטומציה בלי סף מחזירה null", () => {
    expect(
      automationThresholdMs("daily_brief", defaultAutomationSettings()),
    ).toBeNull();
  });

  it("ערך שהמשרד קבע גובר על ברירת המחדל", () => {
    const settings = resolveAutomationSettings({ stale_lead: { value: 3 } });
    expect(automationThresholdMs("stale_lead", settings)).toBe(
      3 * 24 * 60 * 60 * 1000,
    );
  });
});
