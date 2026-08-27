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

describe("תזכורת לפני סיור — ההגדרה שפונה ללקוח", () => {
  /*
   * ‎**שני האמצעים כברירת מחדל.** תזכורת בערוץ אחד מפספסת בדיוק
   * את הלקוח שאינו חי בערוץ הזה, והמחיר הוא נסיעה לשווא.
   */
  it("ברירת המחדל היא וואטסאפ ומייל, עם שני נוסחים", () => {
    const settings = defaultAutomationSettings();
    const reminder = settings.viewing_reminder;
    expect(reminder.enabled).toBe(true);
    expect(reminder.value).toBe(5);
    expect(reminder.channel).toBe("both");
    expect(reminder.messages?.["occupant"]).toContain("{{שעה}}");
    expect(reminder.messages?.["buyer"]).toContain("{{שעה}}");
  });

  it("ערוץ ונוסח שנשמרו נקראים בחזרה", () => {
    const out = resolveAutomationSettings({
      viewing_reminder: {
        enabled: true,
        value: 3,
        channel: "whatsapp",
        messages: { buyer: "נתראה ב{{שעה}}" },
      },
    });
    expect(out.viewing_reminder.value).toBe(3);
    expect(out.viewing_reminder.channel).toBe("whatsapp");
    expect(out.viewing_reminder.messages?.["buyer"]).toBe("נתראה ב{{שעה}}");
    // מה שלא נגעו בו נשאר ברירת המחדל, ולא נמחק
    expect(out.viewing_reminder.messages?.["occupant"]).toContain("מגיעים");
  });

  /*
   * ‎**נוסח ריק אינו הודעה ריקה.** מי שמחק את התיבה התכוון
   * „תחזירו לי את המקורי”, והודעה ריקה ללקוח אי אפשר לתקן אחרי.
   */
  it("נוסח ריק או רווחים בלבד נופל לברירת המחדל", () => {
    const out = resolveAutomationSettings({
      viewing_reminder: { messages: { buyer: "   ", occupant: "" } },
    });
    expect(out.viewing_reminder.messages?.["buyer"]).toContain("נפגשים");
    expect(out.viewing_reminder.messages?.["occupant"]).toContain("מגיעים");
  });

  it("ערוץ שאינו מוכר אינו נכנס", () => {
    const out = resolveAutomationSettings({
      viewing_reminder: { channel: "מדיה חברתית" },
    });
    expect(out.viewing_reminder.channel).toBe("both");
  });

  /*
   * לשאר האוטומציות אין ערוץ ואין נוסח — הן פונות פנימה, למשרד.
   * שדות שהיו מופיעים אצל כולן היו מבטיחים במסך שליטה שאין לה
   * משמעות.
   */
  it("אוטומציה שאינה פונה ללקוח נשארת בלי ערוץ ובלי נוסח", () => {
    const settings = defaultAutomationSettings();
    expect(settings.lead_sla.channel).toBeUndefined();
    expect(settings.lead_sla.messages).toBeUndefined();
  });
});

describe("דחיית הגדרה — הערוץ והנוסח", () => {
  /*
   * ‎**בליעה שקטה הייתה גרועה מדחייה.** המשרד היה מנסח הודעה,
   * המסך היה אומר „נשמר”, ודבר לא היה משתנה.
   */
  it("ערוץ על אוטומציה שאינה פונה ללקוח נדחה", () => {
    expect(automationRejectionReason("lead_sla", { channel: "both" })).toContain(
      "אינה שולחת ללקוח",
    );
    expect(
      automationRejectionReason("lead_sla", { messages: { buyer: "היי" } }),
    ).toContain("אינה שולחת ללקוח");
  });

  it("ערוץ תקין על האוטומציה הנכונה עובר", () => {
    expect(
      automationRejectionReason("viewing_reminder", {
        channel: "whatsapp",
        messages: { buyer: "נתראה" },
      }),
    ).toBeNull();
  });

  it("נמען שאינו בקטלוג נדחה בשמו", () => {
    expect(
      automationRejectionReason("viewing_reminder", { messages: { שכן: "היי" } }),
    ).toContain("שכן");
  });

  it("נוסח ארוך מהתקרה נדחה", () => {
    expect(
      automationRejectionReason("viewing_reminder", {
        messages: { buyer: "א".repeat(601) },
      }),
    ).toContain("ארוך");
  });

  it("ערוץ שאינו מוכר נדחה", () => {
    expect(
      automationRejectionReason("viewing_reminder", { channel: "יונת דואר" }),
    ).toContain("ערוץ");
  });

  /*
   * הסף עדיין נבדק — התוספת לא אמורה לעקוף את מה שכבר עבד.
   */
  it("הסף ממשיך להיבדק כרגיל", () => {
    expect(
      automationRejectionReason("viewing_reminder", { value: 999 }),
    ).toContain("בין");
  });
});
