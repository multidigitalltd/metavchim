import { describe, expect, it } from "vitest";
import { parseAppointmentKind, parseHebrewDateTime } from "./parse-hebrew-datetime.js";

// יום ראשון, 1 בפברואר 2026, 09:00
const NOW = new Date(2026, 1, 1, 9, 0, 0, 0);

describe("parseHebrewDateTime", () => {
  it("'מחר בעשר' — יום אחד קדימה בשעה 10:00", () => {
    const result = parseHebrewDateTime("קבע פגישה מחר בעשר", NOW);
    expect(result.date?.getDate()).toBe(2);
    expect(result.date?.getHours()).toBe(10);
    expect(result.timeExplicit).toBe(true);
  });

  it("'מחרתיים' — יומיים קדימה", () => {
    expect(parseHebrewDateTime("סיור מחרתיים", NOW).date?.getDate()).toBe(3);
  });

  it("שעה בפורמט מספרי נשמרת כלשונה", () => {
    const result = parseHebrewDateTime("מחר ב-16:30", NOW);
    expect(result.date?.getHours()).toBe(16);
    expect(result.date?.getMinutes()).toBe(30);
  });

  it("'ב-4' מתפרש כאחר הצהריים", () => {
    expect(parseHebrewDateTime("מחר בשעה 4", NOW).date?.getHours()).toBe(16);
  });

  it("'ב-9 בבוקר' נשאר בבוקר", () => {
    expect(parseHebrewDateTime("מחר בשעה 9 בבוקר", NOW).date?.getHours()).toBe(9);
  });

  it("יום בשבוע — הקרוב שעוד לא עבר", () => {
    // NOW הוא יום ראשון; "יום שלישי" ⇒ עוד יומיים
    expect(parseHebrewDateTime("קבע פגישה ביום שלישי", NOW).date?.getDate()).toBe(3);
  });

  it("יום בשבוע שהוא היום — נדחה לשבוע הבא", () => {
    expect(parseHebrewDateTime("ביום ראשון", NOW).date?.getDate()).toBe(8);
  });

  it("'בעוד שעתיים' — יחסית לעכשיו", () => {
    const result = parseHebrewDateTime("קבע פגישה בעוד שעתיים", NOW);
    expect(result.date?.getHours()).toBe(11);
    expect(result.timeExplicit).toBe(true);
  });

  it("בלי שעה — ברירת מחדל 10:00 ומסומן שלא נאמר במפורש", () => {
    const result = parseHebrewDateTime("פגישה מחר", NOW);
    expect(result.date?.getHours()).toBe(10);
    expect(result.timeExplicit).toBe(false);
  });

  it("בלי תאריך — לא מנחש", () => {
    expect(parseHebrewDateTime("קבע פגישה עם משה", NOW).date).toBeUndefined();
  });
});

describe("parseAppointmentKind", () => {
  it("מזהה סיור בנכס", () => {
    expect(parseAppointmentKind("סיור בדירה מחר")).toBe("viewing");
  });

  it("מזהה שיחת טלפון", () => {
    expect(parseAppointmentKind("שיחה עם הלקוח")).toBe("call");
  });

  it("ברירת מחדל — פגישה", () => {
    expect(parseAppointmentKind("להיפגש עם משה")).toBe("meeting");
  });
});
