import { describe, expect, it } from "vitest";
import { formatCallbacks } from "./assistant-callbacks";

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contactId: "c1",
    name: "דני כהן",
    phone: "050-1234567",
    reason: "missed_call",
    reasonText: "התקשר ולא נענה",
    waitedText: "ממתין שעתיים",
    urgency: "now",
    since: new Date("2026-08-24T08:00:00Z"),
    href: "/leads",
    alsoCount: 0,
    ...over,
  };
}

describe("formatCallbacks", () => {
  it("מה שאינו רשימת חזרות נופל חזרה למנסח הבא", () => {
    expect(formatCallbacks(undefined)).toBeNull();
    expect(formatCallbacks(null)).toBeNull();
    expect(formatCallbacks({ tasks: [{ title: "לחזור לדני" }] })).toBeNull();
    expect(formatCallbacks({ callbacks: "לא מערך" })).toBeNull();
  });

  /*
   * זה מה שהתבקש מלכתחילה: מתווך ששאל בוואטסאפ „מספרים שצריך
   * לחזור אליהם” קיבל שמות בלי מספר. המספר חייב להופיע, ובשורה
   * משלו — כך וואטסאפ הופך אותו לקישור חיוג.
   */
  it("המספר יוצא בשורה נפרדת, יחד עם הסיבה וזמן ההמתנה", () => {
    const text = formatCallbacks({ callbacks: [row()] });
    expect(text).toContain("050-1234567");
    expect(text?.split("\n")).toContain("050-1234567");
    expect(text).toContain("דני כהן");
    expect(text).toContain("התקשר ולא נענה");
    expect(text).toContain("ממתין שעתיים");
  });

  it("שורה בלי מספר אומרת זאת במפורש ולא נעלמת", () => {
    const text = formatCallbacks({ callbacks: [row({ phone: null })] });
    expect(text).toContain("אין מספר בכרטיס");
  });

  /*
   * רשימה ריקה היא עדיין תשובה תקפה לשאלה. נפילה למנסח הכללי כאן
   * הייתה מחזירה מחרוזת ריקה — הודעה בלי שורת תוכן.
   */
  it("רשימה ריקה מקבלת ניסוח משלה ולא נופלת למנסח הכללי", () => {
    const text = formatCallbacks({ callbacks: [] });
    expect(text).not.toBeNull();
    expect(text).toContain("אין כרגע אף אחד שממתין");
  });

  /*
   * ההבדל מ-`summarizeData`, שחותך בחמש שורות בלי לומר זאת:
   * כאן התקרה גבוהה יותר וגם מוכרזת.
   */
  it("מעבר לתקרה — נשמרות עשר שורות ונאמר כמה נחתכו", () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      row({ contactId: `c${index}`, name: `לקוח ${index}`, phone: `05000000${index}` }),
    );
    const text = formatCallbacks({ callbacks: many });
    expect(text).toContain("14 ממתינים לחזרה");
    expect(text).toContain("לקוח 9");
    expect(text).not.toContain("לקוח 10");
    expect(text).toContain("ועוד 4");
  });

  it("שורה שאינה בצורת חזרה מוותרת על הניסוח כולו", () => {
    expect(formatCallbacks({ callbacks: [row(), { name: "בלי סיבה" }] })).toBeNull();
  });
});
