import { describe, expect, it } from "vitest";
import { jerusalemWallIsoToUtc, jerusalemWallParts } from "./israel-time.js";
import { quickDueOptions } from "./quick-due.js";

/** שעת קיר ישראלית → רגע, לבניית „עכשיו” בבדיקות. */
function at(wall: string): Date {
  return jerusalemWallIsoToUtc(wall);
}

function byKey(now: Date, key: string): string | undefined {
  return quickDueOptions(now).find((o) => o.key === key)?.value;
}

describe("quickDueOptions", () => {
  it("„מחר בבוקר” הוא 09:00 ביום הישראלי הבא", () => {
    expect(byKey(at("2026-03-10T11:00"), "tomorrow")).toBe("2026-03-11T09:00");
  });

  it("„היום” הוא סוף יום העבודה ולא חצות", () => {
    expect(byKey(at("2026-03-10T08:00"), "today")).toBe("2026-03-10T18:00");
  });

  /*
   * ‎**מועד יעד שכבר עבר אינו מועד יעד.**
   *
   * „היום 18:00” בשבע בערב הוא משימה שנולדה בפיגור — לחיצה אחת
   * שמייצרת איחור. הצ'יפ נעלם, והשדה עצמו נשאר פתוח לכל שעה.
   */
  it("„היום” נעלם אחרי שהשעה חלפה", () => {
    expect(byKey(at("2026-03-10T17:59"), "today")).toBe("2026-03-10T18:00");
    expect(byKey(at("2026-03-10T18:30"), "today")).toBeUndefined();
  });

  it("כל האפשרויות שמוצעות הן בעתיד", () => {
    for (const wall of ["2026-03-10T00:05", "2026-03-10T13:00", "2026-03-10T23:50"]) {
      const now = at(wall);
      for (const option of quickDueOptions(now)) {
        expect(jerusalemWallIsoToUtc(option.value).getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });

  /*
   * ‎**מעבר שעון — הסיבה שהחישוב הזה אינו יושב ב-JSX.**
   *
   * שעון הקיץ בישראל נכנס בליל שישי האחרון של מרץ. „מחר בבוקר”
   * חייב להישאר 09:00 **בשעון הקיר**, גם כשהיממה שבדרך אינה בת 24
   * שעות. חשבון של „עוד 86,400 שניות” מדלג כאן ליום שאחרי — נמדד
   * למטה, ולא משוער.
   */
  it("„מחר בבוקר” נשאר 09:00 גם מעבר למעבר שעון הקיץ", () => {
    /*
     * ‎**מאוחר בערב, ובכוונה.** הניסוח הראשון של הבדיקה עמד על
     * 20:00, ושם סטייה של שעה אינה מזיזה את תווית התאריך — כלומר
     * חשבון „עוד 86,400 שניות” היה עובר אותה. אימות בשבירה גילה
     * זאת: הבדיקה עברה גם על המימוש השגוי.
     *
     * ב-23:30 הסטייה **כן** חוצה חצות: `now + 24h` נוחת על
     * ‎`2026-03-28T00:30` ישראלי, ולכן „מחר” היה קופץ יומיים.
     */
    const value = byKey(at("2026-03-26T23:30"), "tomorrow");
    expect(value).toBe("2026-03-27T09:00");
    /* ובאמת 09:00 ישראלי, ולא רק מחרוזת שנראית כך */
    expect(jerusalemWallParts(jerusalemWallIsoToUtc(value!)).time).toBe("09:00");
  });

  /*
   * „בשבוע הבא” הוא אמירה על הלוח ולא מרחק בימים: מי שאומר זאת
   * ביום חמישי מתכוון לראשון שאחריו, לא ליום חמישי הבא.
   */
  it("„בשבוע הבא” נופל על יום ראשון", () => {
    const value = byKey(at("2026-03-12T09:00"), "next_week"); // חמישי
    expect(value).toBe("2026-03-15T09:00");
    expect(jerusalemWallIsoToUtc(value!).getUTCDay()).toBe(0);
  });

  it("מוצעים ארבעה מועדים בבוקר, ושלושה אחרי סוף היום", () => {
    expect(quickDueOptions(at("2026-03-10T08:00"))).toHaveLength(4);
    expect(quickDueOptions(at("2026-03-10T19:00"))).toHaveLength(3);
  });
});
