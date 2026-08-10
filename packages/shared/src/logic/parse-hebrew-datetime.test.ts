import { describe, expect, it } from "vitest";
import { parseAppointmentKind, parseHebrewDateTime } from "./parse-hebrew-datetime.js";

/*
 * הבדיקות קוראות את התוצאה **בשעון ירושלים** ולא בשעון התהליך.
 *
 * קודם הן קראו ‎`.getHours()`‎ ישירות, ולכן הן עברו רק במקרה: הן רצו
 * במכונה ששעונה מקומי, בעוד ה-API רץ ב-UTC. כלומר הן אישרו את הבאג
 * שבגללו כל פגישה שנקבעה בקול נשמרה שלוש שעות מאוחר מדי — "בשעה 5"
 * הוצג למתווך כ-08:00.
 *
 * ‎NOW‎ מוגדר כרגע מוחלט (UTC) ולא בבנאי המקומי, מאותה סיבה בדיוק.
 */
const IL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function il(date: Date | undefined): { day: number; month: number; hour: number; minute: number } {
  if (!date) throw new Error("לא זוהה תאריך");
  const parts = IL.formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
}

// יום ראשון, 1 בפברואר 2026, 09:00 בירושלים (חורף = UTC+2)
const NOW = new Date("2026-02-01T07:00:00.000Z");

describe("parseHebrewDateTime", () => {
  it("'מחר בעשר' — יום אחד קדימה בשעה 10:00", () => {
    const result = parseHebrewDateTime("קבע פגישה מחר בעשר", NOW);
    expect(il(result.date)).toMatchObject({ day: 2, hour: 10 });
    expect(result.timeExplicit).toBe(true);
  });

  it("'מחרתיים' — יומיים קדימה", () => {
    expect(il(parseHebrewDateTime("סיור מחרתיים", NOW).date).day).toBe(3);
  });

  it("שעה בפורמט מספרי נשמרת כלשונה", () => {
    expect(il(parseHebrewDateTime("מחר ב-16:30", NOW).date)).toMatchObject({
      hour: 16,
      minute: 30,
    });
  });

  it("'ב-4' מתפרש כאחר הצהריים", () => {
    expect(il(parseHebrewDateTime("מחר בשעה 4", NOW).date).hour).toBe(16);
  });

  it("'ב-9 בבוקר' נשאר בבוקר", () => {
    expect(il(parseHebrewDateTime("מחר בשעה 9 בבוקר", NOW).date).hour).toBe(9);
  });

  it("יום בשבוע — הקרוב שעוד לא עבר", () => {
    // NOW הוא יום ראשון; "יום שלישי" ⇒ עוד יומיים
    expect(il(parseHebrewDateTime("קבע פגישה ביום שלישי", NOW).date).day).toBe(3);
  });

  it("יום בשבוע שהוא היום — נדחה לשבוע הבא", () => {
    expect(il(parseHebrewDateTime("ביום ראשון", NOW).date).day).toBe(8);
  });

  it("'בעוד שעתיים' — יחסית לעכשיו", () => {
    const result = parseHebrewDateTime("קבע פגישה בעוד שעתיים", NOW);
    expect(il(result.date).hour).toBe(11);
    expect(result.timeExplicit).toBe(true);
  });

  it("בלי שעה — ברירת מחדל 10:00 ומסומן שלא נאמר במפורש", () => {
    const result = parseHebrewDateTime("פגישה מחר", NOW);
    expect(il(result.date).hour).toBe(10);
    expect(result.timeExplicit).toBe(false);
  });

  it("בלי תאריך — לא מנחש", () => {
    expect(parseHebrewDateTime("קבע פגישה עם משה", NOW).date).toBeUndefined();
  });
});

describe("אזור זמן — הרגע הנכון ולא שעון התהליך", () => {
  it("'מחר בשעה 10' הוא 10:00 בירושלים גם כשהשרת ב-UTC", () => {
    /*
     * זו הבדיקה שהייתה חסרה. ‎setHours‎ על שרת UTC ייצר 10:00 UTC,
     * שהוא 12:00 בישראל בקיץ — והמתווך ראה פגישה שלא קבע.
     */
    const result = parseHebrewDateTime("פגישה מחר בשעה 10 בבוקר", NOW);
    expect(result.date?.toISOString()).toBe("2026-02-02T08:00:00.000Z"); // חורף: UTC+2
  });

  it("בקיץ ההיסט הוא שלוש שעות, ואותו משפט נותן רגע אחר", () => {
    const summer = new Date("2026-08-09T05:00:00.000Z"); // 08:00 בישראל
    const result = parseHebrewDateTime("פגישה מחר בשעה 10 בבוקר", summer);
    expect(result.date?.toISOString()).toBe("2026-08-10T07:00:00.000Z"); // קיץ: UTC+3
  });

  it("'בשעה 5' ו'בשעה 5:00' נותנים אותה שעה", () => {
    /*
     * הענף של hh:mm חזר מיד ודילג על הכרעת בוקר/ערב: אותו משפט נתן
     * 17:00 בצורה אחת ו-05:00 בשנייה — פגישה בחמש לפנות בוקר.
     */
    const a = parseHebrewDateTime("פגישה מחר בשעה 5", NOW);
    const b = parseHebrewDateTime("פגישה מחר בשעה 5:00", NOW);
    expect(il(a.date).hour).toBe(17);
    expect(il(b.date).hour).toBe(17);
  });
});

describe("תאריך מפורש", () => {
  it("'11 באוגוסט' — לא היום ולא מחר", () => {
    expect(il(parseHebrewDateTime("פגישה ב-11 באוגוסט", NOW)?.date)).toMatchObject({
      day: 11,
      month: 8,
    });
  });

  it("'11 לשמיני' — החודש בצורה סודרת, כמו שמדברים", () => {
    expect(il(parseHebrewDateTime("קבע פגישה 11 לשמיני בשעה 5", NOW).date)).toMatchObject({
      day: 11,
      month: 8,
      hour: 17,
    });
  });

  it("תאריך מפורש גובר על 'היום'", () => {
    /*
     * התמלול האמיתי שהתגלה בשימוש הכיל את שניהם. "היום" ניצח,
     * והפגישה נקבעה ליום הלא נכון בלי שום סימן במסך.
     */
    const result = parseHebrewDateTime("תקבע פגישה עם ריקי היום 11 לשמיני בשעה 5:00", NOW);
    expect(il(result.date)).toMatchObject({ day: 11, month: 8, hour: 17 });
  });

  it("תאריך שכבר חלף שייך לשנה הבאה", () => {
    // NOW הוא פברואר 2026; "11 לינואר" הוא ינואר 2027
    const result = parseHebrewDateTime("פגישה 11 בינואר", NOW);
    expect(result.date?.getUTCFullYear()).toBe(2027);
  });

  it("שנה מפורשת מתקבלת כלשונה", () => {
    const result = parseHebrewDateTime("פגישה בתאריך 11.1.2026", NOW);
    expect(result.date?.getUTCFullYear()).toBe(2026);
    expect(il(result.date)).toMatchObject({ day: 11, month: 1 });
  });

  it("'3.5 חדרים' אינו תאריך", () => {
    /*
     * הצורה המספרית דורשת "בתאריך" או שנה מלאה בדיוק בשביל זה:
     * ניחוש של 3 במאי מתוך תיאור נכס גרוע מלא לזהות תאריך בכלל.
     */
    expect(parseHebrewDateTime("דירה 3.5 חדרים בתל אביב", NOW).date).toBeUndefined();
  });

  it("'יום שלישי' אינו נקרא כחודש שלישי", () => {
    // הצורה הסודרת דורשת מספר יום לפניה; בלעדיו זו סתם מילה
    expect(il(parseHebrewDateTime("קבע פגישה ביום שלישי", NOW).date).month).toBe(2);
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
