import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHATSAPP_NOTIFY_PREFS,
  formatNotifyMessage,
  inQuietHours,
  notifyCategory,
  notifyFollowUp,
  dominantNotifyCategory,
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

  /*
   * שישה סוגים שנוצרים בפועל נפלו ל-`system`, ולכן קיבלו אייקון
   * ומשפט סיום כלליים — וגרוע מכך, לא היו ניתנים לכיבוי בקטגוריה
   * שאליה הם שייכים. הבדיקה הזו היא מה שמונע נפילה חוזרת בשקט.
   */
  it("ההצעות, ההתאמות והרשת אינן הודעות מערכת", () => {
    /*
     * ‏„נכנס נכס שמתאים לביקוש שאתה עוקב אחריו” נפל ל-`system`
     * בדיוק כמו השישה שלפניו (ביקורת Codex): מי שכיבה „רשת” המשיך
     * לקבל אותו כהודעה שאי אפשר לכבות.
     */
    expect(notifyCategory("coop_demand_match")).toBe("network");
    expect(notifyCategory("offer_opened")).toBe("matches");
    expect(notifyCategory("offer_interested")).toBe("matches");
    expect(notifyCategory("matches_found")).toBe("matches");
    expect(notifyCategory("opportunity_opened")).toBe("matches");
    expect(notifyCategory("lead_requires_human")).toBe("leads");
    expect(notifyCategory("whatsapp_bot_escalation")).toBe("leads");
    expect(notifyCategory("coop_offer_received")).toBe("network");
    expect(notifyCategory("shared_lead_sold")).toBe("network");
    expect(notifyCategory("appointment_scheduled")).toBe("tasks");
  });

  it("מי שכיבה „התאמות” מפסיק לקבל גם את פתיחת ההצעה", () => {
    const prefs = parseWhatsAppNotifyPrefs({ categories: { matches: false } });
    expect(shouldNotifyByWhatsApp("offer_opened", prefs)).toBe(false);
    expect(shouldNotifyByWhatsApp("matches_found", prefs)).toBe(false);
  });
});

describe("dominantNotifyCategory", () => {
  it("הקטגוריה השכיחה היא זו שקובעת", () => {
    expect(
      dominantNotifyCategory([
        item({ type: "call_missed" }),
        item({ type: "call_missed" }),
        item({ type: "lead" }),
      ]),
    ).toBe("calls");
  });

  it("תקציר יומי מזוהה — הוא היחיד שנשאר עם „מה דחוף היום?”", () => {
    expect(dominantNotifyCategory([item({ type: "daily_brief" })])).toBe("digests");
  });
});

describe("parseWhatsAppNotifyPrefs", () => {
  it("ברירת המחדל היא הכול פעיל — מי ששילם על הסוכן רוצה שיעדכן", () => {
    expect(parseWhatsAppNotifyPrefs(undefined)).toEqual(DEFAULT_WHATSAPP_NOTIFY_PREFS);
    expect(parseWhatsAppNotifyPrefs({}).enabled).toBe(true);
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
        enabled: 7,
        categories: { calls: "לא", לא_קיים: true },
        quietFromHour: 99,
        quietToHour: -3,
      },
    });
    expect(prefs.enabled).toBe(true);
    expect(prefs.categories).toEqual({});
    expect(prefs.quietFromHour).toBe(22);
    expect(prefs.quietToHour).toBe(7);
  });

  it("שקט ארוך מ-18 שעות חוזר לברירת המחדל — אחרת התראות היו מתיישנות", () => {
    // 20:00–16:00 הוא עשרים שעות שקט, כלומר „כמעט אף פעם”
    const tooLong = parseWhatsAppNotifyPrefs({
      whatsappNotify: { quietFromHour: 20, quietToHour: 16 },
    });
    expect(tooLong.quietFromHour).toBe(22);
    expect(tooLong.quietToHour).toBe(7);
  });

  it("שקט של שש-עשרה שעות עדיין מותר — חלון הסורק מכסה אותו", () => {
    const long = parseWhatsAppNotifyPrefs({
      whatsappNotify: { quietFromHour: 20, quietToHour: 12 },
    });
    expect(long.quietFromHour).toBe(20);
    expect(long.quietToHour).toBe(12);
  });
});

describe("shouldNotifyByWhatsApp", () => {
  const on = { ...DEFAULT_WHATSAPP_NOTIFY_PREFS, enabled: true };

  it("המתג הראשי חוסם הכול כשכיבו אותו", () => {
    const off = { ...DEFAULT_WHATSAPP_NOTIFY_PREFS, enabled: false };
    expect(shouldNotifyByWhatsApp("lead", off)).toBe(false);
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
    expect(text).toContain("*עדכון חדש*");
    expect(text).toContain("משה לוי מתקשר");
    expect(text).toContain("https://app.example.com/leads/L1");
  });

  it("מקבץ כמה התראות להודעה אחת עם מונה", () => {
    const text = formatNotifyMessage(
      [item({ title: "א" }), item({ title: "ב" }), item({ title: "ג" })],
      "https://x",
    );
    expect(text).toContain("*3 עדכונים חדשים*");
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

  /*
   * ‏הבקשה עצמה: המתווך שהציע קיבל בוואטסאפ „נפתח חדר עסקה משותף”
   * ולא קיבל לאן. שורת הקישור נשמטת בדיוק כש-`notificationUrl`
   * מחזירה `"/"`, ולכן ישות חסרה בטבלה נראית כאן כהודעה תקינה
   * בלי כתובת — ולא ככשל.
   */
  it("„נפתח חדר עסקה” נושאת קישור ישיר לחדר", () => {
    const text = formatNotifyMessage(
      [
        item({
          title: "נפתח חדר עסקה משותף",
          type: "coop_deal",
          entityType: "coop_deal",
          entityId: "D7",
        }),
      ],
      "https://app.example.com",
    );
    expect(text).toContain("https://app.example.com/collaboration/deals/D7");
  });
});

describe("formatNotifyMessage — הפרטים שמאחורי הכותרת", () => {
  const offerDetail = {
    kind: "offer" as const,
    ownerUserId: "agent1",
    person: { name: "דנה לוי", phone: "050-1111111" },
    property: "4 חדרים · הרצל 12, רמת גן",
    price: "2,100,000 ₪",
    openCount: 3,
    why: null,
  };
  const notification = item({
    id: "n1",
    type: "offer_opened",
    title: "הקונה פתח את ההצעה ששלחת",
    entityType: "offer",
    entityId: "o1",
  });

  it("השם והטלפון נכנסים להודעה — בלי להיכנס למערכת", () => {
    const message = formatNotifyMessage([notification], "https://app.example.com", {
      viewer: { userId: "agent1", capabilities: ["buyers.view_own"] },
      byNotificationId: new Map([["n1", offerDetail]]),
    });
    expect(message).toContain("דנה לוי");
    expect(message).toContain("050-1111111");
    expect(message).toContain("4 חדרים · הרצל 12, רמת גן");
  });

  it("נמען שאינו רשאי לראות את הקונה מקבל את הכותרת בלבד", () => {
    const message = formatNotifyMessage([notification], "https://app.example.com", {
      viewer: { userId: "agent2", capabilities: ["buyers.view_own"] },
      byNotificationId: new Map([["n1", offerDetail]]),
    });
    expect(message).toContain("הקונה פתח את ההצעה ששלחת");
    expect(message).not.toContain("דנה לוי");
    expect(message).not.toContain("050-1111111");
  });

  it("בלי מפת פרטים ההודעה נשארת בדיוק כפי שהייתה", () => {
    const before = formatNotifyMessage([notification], "https://app.example.com");
    const after = formatNotifyMessage([notification], "https://app.example.com", {
      viewer: { userId: "agent1", capabilities: [] },
      byNotificationId: new Map(),
    });
    expect(after).toBe(before);
  });

  it("הפרטים באים לפני הקישור, לא במקומו", () => {
    const message = formatNotifyMessage([notification], "https://app.example.com", {
      viewer: { userId: "agent1", capabilities: ["buyers.view_all"] },
      byNotificationId: new Map([["n1", offerDetail]]),
    });
    expect(message.indexOf("דנה לוי")).toBeLessThan(message.indexOf("👈"));
    expect(message).toContain("👈 https://app.example.com/offers");
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

describe("notifyFollowUp", () => {
  /*
   * ‎**כל היכולות** — הבדיקות כאן על הגזירה, לא על ההרשאות; אלה
   * נבדקות בנפרד למטה.
   */
  const ALL = [
    "show_callbacks",
    "show_leads",
    "show_tasks",
    "show_matches",
    "show_network_inbox",
  ];

  it("שיחה שלא נענתה מזמינה את „למי לחזור”, לא את „מה דחוף היום”", () => {
    const step = notifyFollowUp([item({ type: "call_missed" })], ALL);
    expect(step).not.toBeNull();
    expect(step?.label).toContain("למי לחזור");
    expect(step?.text).not.toBe("");
  });

  it("פנייה מהרשת מזמינה את הפניות הממתינות", () => {
    const step = notifyFollowUp([item({ type: "coop_offer" })], ALL);
    expect(step?.label).toContain("מה מחכה ברשת");
  });

  /*
   * ‎**התקציר היומי הוא המקרה שבו הכפתור הישן היה נכון.** `null`
   * כאן אינו „לא מצאנו” אלא „הכללי מתאים”, והקורא נשען על זה.
   */
  it("תקציר יומי נשאר עם הכפתור הכללי", () => {
    expect(notifyFollowUp([item({ type: "daily_brief" })], ALL)).toBeNull();
  });

  /*
   * ‎**הקטגוריה השכיחה, ולא הפריט הראשון.** אגד של חמש התראות
   * לידים ושיחה אחת הוא אגד לידים, וזו גם הקטגוריה שממנה כבר נגזר
   * משפט הסיום של אותה הודעה.
   */
  it("אגד מעורב הולך אחרי הרוב", () => {
    const items = [
      item({ type: "call_missed" }),
      item({ type: "lead" }),
      item({ type: "lead_sla" }),
      item({ type: "lead_stale" }),
    ];
    expect(notifyFollowUp(items, ALL)?.label).toContain("הלידים שלי");
  });

  /*
   * ‎**כפתור לפעולה חסומה שולח את המתווך אל „אין לך הרשאה” על משהו
   * שהמערכת עצמה הציעה.** אותו כלל בדיוק כמו בהצעות הסוכן.
   */
  it("פעולה שאינה מותרת אינה נהפכת לכפתור", () => {
    expect(notifyFollowUp([item({ type: "call_missed" })], [])).toBeNull();
    expect(notifyFollowUp([item({ type: "call_missed" })], ["show_leads"])).toBeNull();
  });

  it("אגד ריק אינו מייצר כפתור", () => {
    expect(notifyFollowUp([], ALL)).toBeNull();
  });

  /*
   * ‎**`allowed` הוא מזהי פעולות, לא יכולות** — וזו הבחנה ששוברת
   * בשקט. רשימת יכולות (`leads.view_own`) לעולם אינה מכילה
   * ‎`show_callbacks`, ולכן קורא שמעביר אותה מכבה את הכפתור הנגזר
   * תמיד ומקבל את הכללי — בלי שגיאה, בלי לוג, ובלי בדיקה אדומה.
   * זו בדיוק הטעות שנעשתה בקורא הראשון, והבדיקה הזו מקבעת אותה.
   */
  it("רשימת יכולות אינה רשימת פעולות — והיא אינה פותחת כפתור", () => {
    const capabilities = ["leads.view_own", "leads.view_all", "collaboration.offer"];
    expect(notifyFollowUp([item({ type: "call_missed" })], capabilities)).toBeNull();
  });

  /*
   * ‎**המסלול המלא כפי שהקורא בונה אותו:** תפקיד ⟵ יכולות ⟵
   * הפעולות המותרות ⟵ כפתור. בעלים אמור לקבל כפתור על שיחה
   * שלא נענתה; אם הגזירה נשברת, זה נשבר כאן ולא אצל המתווך.
   */
  it("בעלים מקבל כפתור דרך הגזירה האמיתית מהתפקיד", async () => {
    const { AGENT_ACTIONS, mayUseAction } = await import("../agent/actions.js");
    const { ROLE_CAPABILITIES } = await import("../rbac.js");
    const capabilities = new Set(ROLE_CAPABILITIES["owner"] ?? []);
    const ids = AGENT_ACTIONS.filter((a) => mayUseAction(a, capabilities)).map((a) => a.id);
    expect(notifyFollowUp([item({ type: "call_missed" })], ids)?.label).toContain("למי לחזור");
  });

  /*
   * ‎**המשפט חייב להיות אחד שהמנוע מכיר.** הוא נשלח כאילו הוקלד,
   * ולכן הוא נלקח מהקטלוג ולא נכתב כאן — הבדיקה מקבעת את המקור.
   */
  it("המשפט מגיע מהדוגמאות של הפעולה בקטלוג", async () => {
    const { agentAction } = await import("../agent/actions.js");
    const step = notifyFollowUp([item({ type: "task_reminder" })], ALL);
    expect(step?.text).toBe(agentAction("show_tasks")?.examples[0]);
  });

  /*
   * ‎**כיתוב שנחתך הוא כיתוב שגוי, לא כיתוב קצר.** Meta חותכת ב-20
   * תווים ומוסיפה „…”, ו„פניות ממתינות מה…” אינו אומר דבר. הבדיקה
   * עוברת על *כל* הקטגוריות ולא על אחת, כדי שגם כיתוב שיתארך בעתיד
   * ייתפס כאן ולא אצל המתווך.
   */
  it("שום כיתוב אינו נחתך על ידי Meta", async () => {
    const { buttonTitle } = await import("./whatsapp-buttons.js");
    const types = ["call_missed", "lead", "task_reminder", "matches_refreshed", "coop_offer"];
    for (const type of types) {
      const step = notifyFollowUp([item({ type })], ALL);
      expect(step, type).not.toBeNull();
      expect(buttonTitle(step!.label), type).toBe(step!.label);
    }
  });
});
