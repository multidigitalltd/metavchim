import { describe, expect, it } from "vitest";
import {
  BOT_DEFAULTS,
  buildBotPrompt,
  isOptOut,
  parseBotSettings,
  withinHours,
} from "./bot-policy";

/**
 * ‎**כללי הבוט** (docs/12 §6).
 *
 * אלה פונקציות טהורות בכוונה, ולכן כאן הבדיקות אמיתיות ולא מבניות:
 * כל כלל נבדק על הקלט שמפיל אותו בפועל.
 */

describe("זיהוי בקשת הסרה", () => {
  it("תופס את הצורות הנפוצות", () => {
    for (const text of ["הסר", "הסירו", "תפסיקו", "STOP", "unsubscribe", "הסר אותי בבקשה"]) {
      expect(isOptOut(text), text).toBe(true);
    }
  });

  it("סובל סימני פיסוק ורווחים", () => {
    expect(isOptOut("  הסר!  ")).toBe(true);
    expect(isOptOut("stop.")).toBe(true);
  });

  /*
   * ‎**הכיוון המסוכן.** „די כבר חיפשתי חודשיים” אינה בקשת הסרה,
   * והתייחסות אליה ככזו הייתה מנתקת בשקט לקוח פעיל.
   */
  it("אינו תופס משפט ארוך שרק מתחיל במילה דומה", () => {
    expect(isOptOut("די כבר חיפשתי דירה חודשיים ולא מצאתי כלום, אשמח לעזרה")).toBe(false);
    expect(isOptOut("תפסיקו לשלוח לי נכסים בחולון אבל בתל אביב כן מעניין אותי מאוד")).toBe(false);
  });

  it("אינו תופס מילה שהיא רק חלק ממילה אחרת", () => {
    expect(isOptOut("הסרטון ששלחת לא נפתח")).toBe(false);
  });

  it("הודעה ריקה אינה הסרה", () => {
    expect(isOptOut("   ")).toBe(false);
  });
});

describe("שעות פעילות", () => {
  /*
   * ‎**הרגעים נבנים כ-UTC מפורש ולא כשעה מקומית.**
   *
   * השעות נמדדות בשעון ישראל, והמכונה שמריצה את הבדיקות היא UTC.
   * ‏`new Date(2026, 8, 2, 9)` היה נותן 12:00 שעון ישראל ולא 9:00,
   * כלומר הבדיקה הייתה בודקת שעה אחרת מזו שכתובה בה — ומשתנה עם
   * אזור הזמן של המריץ. בספטמבר ישראל היא UTC+3.
   */
  const israel = (hour: number, day = 2): Date =>
    new Date(Date.UTC(2026, 8, day, hour - 3, 0, 0));

  /* 2026-09-02 הוא יום רביעי (3) */
  const base = parseBotSettings({ enabled: true, hoursFrom: 8, hoursTo: 20, days: [0, 1, 2, 3, 4] });

  it("בתוך החלון", () => {
    expect(withinHours(base, israel(9))).toBe(true);
    expect(withinHours(base, israel(19))).toBe(true);
  });

  it("מחוץ לחלון", () => {
    expect(withinHours(base, israel(7))).toBe(false);
    expect(withinHours(base, israel(20))).toBe(false);
  });

  it("יום שאינו בפעילות סגור בכל שעה", () => {
    /* 2026-09-05 הוא שבת (6), שאינה ברשימה */
    expect(withinHours(base, israel(10, 5))).toBe(false);
  });

  /*
   * חלון שחוצה חצות דורש השוואה הפוכה. בלעדיה הוא תמיד סגור —
   * כלומר בוט שהוגדר ל-22:00–06:00 פשוט לא עונה לעולם.
   */
  it("חלון שחוצה חצות", () => {
    const night = parseBotSettings({
      enabled: true,
      hoursFrom: 22,
      hoursTo: 6,
      days: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(withinHours(night, israel(23))).toBe(true);
    expect(withinHours(night, israel(2))).toBe(true);
    expect(withinHours(night, israel(12))).toBe(false);
  });

  it("from זהה ל-to פירושו כל היום", () => {
    const always = parseBotSettings({ enabled: true, hoursFrom: 0, hoursTo: 0, days: [3] });
    expect(withinHours(always, israel(3))).toBe(true);
    expect(withinHours(always, israel(17))).toBe(true);
  });

  /*
   * ‎**הבדיקה שתופסת את באג שעון המכונה.** 06:00 UTC הם 09:00
   * בישראל — בתוך החלון. חישוב על שעון המכונה היה מחזיר 6 ופוסל.
   */
  it("השעה נמדדת בשעון ישראל ולא בשעון המכונה", () => {
    expect(withinHours(base, new Date("2026-09-02T06:00:00Z"))).toBe(true);
    expect(withinHours(base, new Date("2026-09-02T17:30:00Z"))).toBe(false);
  });
});

describe("קריאת ההגדרות", () => {
  it("ריק ⇒ ברירות מחדל, והבוט כבוי", () => {
    const s = parseBotSettings(null);
    expect(s.enabled).toBe(false);
    expect(s.questions).toEqual([...BOT_DEFAULTS.questions]);
  });

  /*
   * הגדרות שנשמרו לפני שנוסף שדה חייבות להמשיך לעבוד. נפילה כאן
   * הייתה משביתה בוטים קיימים בפריסה.
   */
  it("שדה חסר נופל לברירת מחדל ואינו מפיל", () => {
    const s = parseBotSettings({ enabled: true, officeName: "דנה נדל״ן" });
    expect(s.enabled).toBe(true);
    expect(s.officeName).toBe("דנה נדל״ן");
    expect(s.hoursFrom).toBe(8);
    expect(s.questions.length).toBeGreaterThan(0);
  });

  it("ערך מסוג שגוי אינו עובר", () => {
    const s = parseBotSettings({ enabled: "yes", hoursFrom: "8", questions: "אחת" });
    expect(s.enabled).toBe(false);
    expect(s.hoursFrom).toBe(8);
    expect(s.questions).toEqual([...BOT_DEFAULTS.questions]);
  });

  it("רשימת שאלות ריקה חוזרת לברירת המחדל ולא משאירה בוט בלי מה לשאול", () => {
    expect(parseBotSettings({ questions: [] }).questions.length).toBeGreaterThan(0);
  });
});

describe("הפרומפט", () => {
  const settings = parseBotSettings({
    enabled: true,
    officeName: "דנה נדל״ן",
    greeting: "היי! אני העוזר של {{office}}",
    questions: ["באיזה אזור?"],
  });

  /*
   * ‎**השלד הקבוע.** אלה אינם ניסוח אלא מדיניות: גילוי שזה בוט
   * (דרישת Meta), איסור התחייבות, ואסקלציה. הגדרה של סוכן נכנסת
   * כנתון ואינה יכולה להחליף אותם.
   */
  it("נושא את הכללים שאין לחרוג מהם", () => {
    const p = buildBotPrompt({ settings, customerName: "יוסי", history: [], message: "שלום" });
    expect(p).toContain("אתה בוט");
    expect(p).toContain("אין להתחזות לאדם");
    expect(p).toContain("אין להתחייב על מחיר");
    expect(p).toContain("escalate=true");
  });

  it("שם המשרד מוחלף בנוסח הפתיחה", () => {
    const p = buildBotPrompt({ settings, customerName: "יוסי", history: [], message: "שלום" });
    expect(p).toContain("היי! אני העוזר של דנה נדל״ן");
    expect(p).not.toContain("{{office}}");
  });

  it("שיחה ריקה מסומנת ככזו, כדי שהבוט לא יחזור על הפתיחה", () => {
    const empty = buildBotPrompt({ settings, customerName: "יוסי", history: [], message: "שלום" });
    expect(empty).toContain("זו ההודעה הראשונה בשיחה");
    const withHistory = buildBotPrompt({
      settings,
      customerName: "יוסי",
      history: [{ role: "bot", text: "היי" }, { role: "customer", text: "מחפש 4 חדרים" }],
      message: "ברמת גן",
    });
    expect(withHistory).not.toContain("זו ההודעה הראשונה בשיחה");
    expect(withHistory).toContain("מחפש 4 חדרים");
  });

  it("שאלות הסוכן נכנסות לפרומפט", () => {
    const p = buildBotPrompt({ settings, customerName: "יוסי", history: [], message: "שלום" });
    expect(p).toContain("באיזה אזור?");
  });
});
