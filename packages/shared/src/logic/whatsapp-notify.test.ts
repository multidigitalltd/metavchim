import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHATSAPP_NOTIFY_PREFS,
  formatNotifyMessage,
  inQuietHours,
  notifyCategory,
  parseWhatsAppNotifyPrefs,
  sessionWindowOpen,
  shouldNotifyByWhatsApp,
  templateParams,
  type NotifyItem,
} from "./whatsapp-notify.js";

const item = (over: Partial<NotifyItem> = {}): NotifyItem => ({
  type: "lead",
  title: "ליד חדש",
  body: null,
  entityType: null,
  entityId: null,
  ...over,
});

describe("notifyCategory", () => {
  it("ממפה סוגים מוכרים לקטגוריה שלהם", () => {
    expect(notifyCategory("call_missed")).toBe("calls");
    expect(notifyCategory("lead_sla")).toBe("leads");
    expect(notifyCategory("task_reminder")).toBe("tasks");
    expect(notifyCategory("daily_brief")).toBe("digests");
  });

  it("סוג שאינו במפה נופל להודעות מערכת ולא נעלם", () => {
    expect(notifyCategory("something_new")).toBe("system");
  });
});

describe("parseWhatsAppNotifyPrefs", () => {
  it("ברירת המחדל היא כבוי — הודעה יזומה היא בחירה", () => {
    expect(parseWhatsAppNotifyPrefs(undefined)).toEqual(DEFAULT_WHATSAPP_NOTIFY_PREFS);
    expect(parseWhatsAppNotifyPrefs({}).enabled).toBe(false);
  });

  it("קורא את ההעדפות מתוך preferences של המשתמש", () => {
    const prefs = parseWhatsAppNotifyPrefs({
      accessibility: { contrast: "high" },
      whatsappNotify: {
        enabled: true,
        categories: { digests: false, calls: true },
        quietFromHour: 23,
        quietToHour: 6,
      },
    });
    expect(prefs.enabled).toBe(true);
    expect(prefs.categories).toEqual({ digests: false, calls: true });
    expect(prefs.quietFromHour).toBe(23);
    expect(prefs.quietToHour).toBe(6);
  });

  it("מתעלם משדות פגומים במקום ליפול", () => {
    const prefs = parseWhatsAppNotifyPrefs({
      whatsappNotify: {
        enabled: "כן",
        categories: { calls: "לא", לא_קיים: true },
        quietFromHour: 99,
        quietToHour: -3,
      },
    });
    expect(prefs.enabled).toBe(false);
    expect(prefs.categories).toEqual({});
    expect(prefs.quietFromHour).toBe(22);
    expect(prefs.quietToHour).toBe(7);
  });
});

describe("shouldNotifyByWhatsApp", () => {
  const on = { ...DEFAULT_WHATSAPP_NOTIFY_PREFS, enabled: true };

  it("המתג הראשי חוסם הכול", () => {
    expect(shouldNotifyByWhatsApp("lead", DEFAULT_WHATSAPP_NOTIFY_PREFS)).toBe(false);
  });

  it("קטגוריה שלא נכתבה נחשבת דלוקה", () => {
    expect(shouldNotifyByWhatsApp("lead", on)).toBe(true);
  });

  it("קטגוריה שכובתה חוסמת רק את עצמה", () => {
    const prefs = { ...on, categories: { digests: false } };
    expect(shouldNotifyByWhatsApp("daily_brief", prefs)).toBe(false);
    expect(shouldNotifyByWhatsApp("call_missed", prefs)).toBe(true);
  });
});

describe("inQuietHours", () => {
  const prefs = { ...DEFAULT_WHATSAPP_NOTIFY_PREFS, quietFromHour: 22, quietToHour: 7 };

  it("טווח שעובר חצות תופס את שני צדדיו", () => {
    expect(inQuietHours(23, prefs)).toBe(true);
    expect(inQuietHours(2, prefs)).toBe(true);
    expect(inQuietHours(22, prefs)).toBe(true);
  });

  it("שעת הסיום עצמה כבר אינה שקטה", () => {
    expect(inQuietHours(7, prefs)).toBe(false);
    expect(inQuietHours(14, prefs)).toBe(false);
  });

  it("טווח באותו יום נבדק כרגיל", () => {
    const day = { ...prefs, quietFromHour: 1, quietToHour: 5 };
    expect(inQuietHours(3, day)).toBe(true);
    expect(inQuietHours(6, day)).toBe(false);
  });

  it("from === to פירושו שאין שעות שקט", () => {
    const none = { ...prefs, quietFromHour: 8, quietToHour: 8 };
    expect(inQuietHours(8, none)).toBe(false);
    expect(inQuietHours(3, none)).toBe(false);
  });
});

describe("formatNotifyMessage", () => {
  it("התראה אחת עם קישור לכרטיס", () => {
    const text = formatNotifyMessage(
      [item({ title: "משה לוי מתקשר", type: "incoming_call", entityType: "lead", entityId: "L1" })],
      "https://app.example.com",
    );
    expect(text).toContain("*עדכון מהמערכת*");
    expect(text).toContain("משה לוי מתקשר");
    expect(text).toContain("https://app.example.com/leads/L1");
  });

  it("מקבץ כמה התראות להודעה אחת עם מונה", () => {
    const text = formatNotifyMessage(
      [item({ title: "א" }), item({ title: "ב" }), item({ title: "ג" })],
      "https://x",
    );
    expect(text).toContain("*3 עדכונים מהמערכת*");
    expect(text).toContain("א");
    expect(text).toContain("ג");
  });

  it("חותך לרשימה סבירה ואומר כמה נשארו", () => {
    const many = Array.from({ length: 10 }, (_, i) => item({ title: `פריט ${i}` }));
    const text = formatNotifyMessage(many, "https://x");
    expect(text).toContain("ועוד 4 עדכונים");
    expect(text).not.toContain("פריט 7");
  });

  it("אינו מצרף קישור לדשבורד — הוא אינו מוסיף דבר", () => {
    const text = formatNotifyMessage([item({ entityType: null })], "https://x");
    expect(text).not.toContain("https://x/");
  });

  it("רשימה ריקה אינה מייצרת הודעה", () => {
    expect(formatNotifyMessage([], "https://x")).toBe("");
  });
});

describe("sessionWindowOpen", () => {
  const now = new Date("2026-08-23T12:00:00Z");

  it("בלי הודעה נכנסת החלון סגור", () => {
    expect(sessionWindowOpen(null, now)).toBe(false);
  });

  it("הודעה מלפני שעה — פתוח", () => {
    expect(sessionWindowOpen(new Date("2026-08-23T11:00:00Z"), now)).toBe(true);
  });

  it("הודעה מלפני יומיים — סגור", () => {
    expect(sessionWindowOpen(new Date("2026-08-21T12:00:00Z"), now)).toBe(false);
  });
});

describe("templateParams", () => {
  it("התראה אחת — כותרת וגוף שלה", () => {
    expect(templateParams([item({ title: "התמלול מוכן", body: "סיכום קצר" })])).toEqual([
      "התמלול מוכן",
      "סיכום קצר",
    ]);
  });

  it("כמה התראות — מונה ורשימת כותרות", () => {
    const [headline, detail] = templateParams([
      item({ title: "א" }),
      item({ title: "ב" }),
      item({ title: "ג" }),
      item({ title: "ד" }),
    ]);
    expect(headline).toBe("4 עדכונים חדשים");
    expect(detail).toBe("א · ב · ג");
  });

  it("משטח שורות חדשות — תבנית של Meta דוחה אותן", () => {
    const [, detail] = templateParams([item({ title: "כותרת", body: "שורה\nשנייה" })]);
    expect(detail).toBe("שורה שנייה");
  });
});
