import { describe, expect, it } from "vitest";
import {
  OWNER_ACTIVITY_TEXT_LINES,
  OWNER_ACTIVITY_TRUNCATED_NOTE,
  buildOwnerActivity,
  ownerActivityCsv,
  ownerActivityEmail,
  ownerActivityFileName,
  ownerActivityText,
  summarizeOwnerActivity,
  type OwnerActivityEntry,
} from "./property-activity";

/**
 * הדוח הזה יוצא מהמערכת אל מי שאינו משתמש בה, ולכן שתי שאלות
 * נבדקות כאן זו לצד זו: **האם הוא נכון** (בעל הנכס סופר לפיו כמה
 * ביקורים היו), ו**האם הוא לא אומר יותר מדי**.
 */

const NOW = new Date("2026-08-24T12:00:00.000Z");

describe("buildOwnerActivity", () => {
  it("פגישה שהתקיימה נושאת את התוצאה, ופגישה שבוטלה אינה", () => {
    const entries = buildOwnerActivity({
      appointments: [
        {
          kind: "viewing",
          startsAt: new Date("2026-08-20T09:00:00.000Z"),
          status: "completed",
          outcome: "negotiating",
        },
        {
          kind: "viewing",
          startsAt: new Date("2026-08-21T09:00:00.000Z"),
          status: "cancelled",
          // תוצאה שנשארה משיבוץ קודם אינה גוברת על הביטול
          outcome: "liked",
        },
      ],
      calls: [],
    });

    expect(entries.map((e) => e.result)).toEqual(["cancelled", "negotiating"]);
  });

  it("פגישה שהושלמה בלי תוצאה מתוארת כ„התקיים” ולא נעלמת", () => {
    const [entry] = buildOwnerActivity({
      appointments: [
        {
          kind: "meeting",
          startsAt: NOW,
          status: "completed",
          outcome: null,
        },
      ],
      calls: [],
    });
    expect(entry?.result).toBe("held");
  });

  it("סטטוס שאיננו מכירים מתואר כ„נקבע” — הטענה החלשה ביותר", () => {
    const [entry] = buildOwnerActivity({
      appointments: [
        { kind: "viewing", startsAt: NOW, status: "rescheduled_twice", outcome: null },
      ],
      calls: [],
    });
    expect(entry?.result).toBe("scheduled");
  });

  it("סוג פגישה שאיננו מכירים נופל ואינו מגיע לדוח", () => {
    /*
     * מוטב שיחסר פריט מאשר שבעל הנכס יראה שורה ריקה ויתהה מה היא.
     */
    const entries = buildOwnerActivity({
      appointments: [{ kind: "site_survey", startsAt: NOW, status: "completed", outcome: null }],
      calls: [],
    });
    expect(entries).toHaveLength(0);
  });

  it("שיחה נכנסת היא פנייה, יוצאת היא חזרה למתעניין", () => {
    const entries = buildOwnerActivity({
      appointments: [],
      calls: [
        {
          direction: "inbound",
          occurredAt: new Date("2026-08-22T10:00:00.000Z"),
          outcome: "answered",
          durationMinutes: 4,
        },
        {
          direction: "outbound",
          occurredAt: new Date("2026-08-23T10:00:00.000Z"),
          outcome: "answered",
          durationMinutes: 2,
        },
      ],
    });
    expect(entries.map((e) => e.kind)).toEqual(["callback", "inquiry"]);
  });

  it("‏missed ו-no_answer נאמרים באותה מילה — ההבדל ביניהם פנימי", () => {
    const entries = buildOwnerActivity({
      appointments: [],
      calls: [
        { direction: "inbound", occurredAt: NOW, outcome: "missed", durationMinutes: 0 },
        { direction: "inbound", occurredAt: NOW, outcome: "no_answer", durationMinutes: null },
      ],
    });
    expect(entries.map((e) => e.result)).toEqual(["unanswered", "unanswered"]);
  });

  it("משך מוצג רק לשיחה שנענתה", () => {
    const entries = buildOwnerActivity({
      appointments: [],
      calls: [
        { direction: "inbound", occurredAt: NOW, outcome: "missed", durationMinutes: 1 },
        { direction: "inbound", occurredAt: NOW, outcome: "answered", durationMinutes: 7 },
        { direction: "inbound", occurredAt: NOW, outcome: "answered", durationMinutes: 0 },
      ],
    });
    expect(entries.map((e) => e.durationMinutes)).toEqual([undefined, 7, undefined]);
  });

  it("הדוח ממוין מהחדש לישן, ושני המקורות משולבים בו", () => {
    const entries = buildOwnerActivity({
      appointments: [
        {
          kind: "viewing",
          startsAt: new Date("2026-08-10T09:00:00.000Z"),
          status: "completed",
          outcome: null,
        },
      ],
      calls: [
        {
          direction: "inbound",
          occurredAt: new Date("2026-08-15T09:00:00.000Z"),
          outcome: "answered",
          durationMinutes: 3,
        },
      ],
    });
    expect(entries.map((e) => e.kind)).toEqual(["inquiry", "viewing"]);
  });
});

describe("summarizeOwnerActivity", () => {
  it("„התקיים” נספר לפי התוצאה, ו„עתידי” נמדד מול הרגע שנמסר", () => {
    const entries = buildOwnerActivity({
      appointments: [
        {
          kind: "viewing",
          startsAt: new Date("2026-08-20T09:00:00.000Z"),
          status: "completed",
          outcome: "liked",
        },
        {
          kind: "viewing",
          startsAt: new Date("2026-08-30T09:00:00.000Z"),
          status: "scheduled",
          outcome: null,
        },
        {
          // נקבע ומועדו חלף בלי שדווח — אינו "עתידי" ואינו "התקיים"
          kind: "viewing",
          startsAt: new Date("2026-08-01T09:00:00.000Z"),
          status: "scheduled",
          outcome: null,
        },
      ],
      calls: [
        {
          direction: "inbound",
          occurredAt: new Date("2026-08-22T09:00:00.000Z"),
          outcome: "missed",
          durationMinutes: null,
        },
      ],
    });

    const summary = summarizeOwnerActivity(entries, NOW);
    expect(summary).toMatchObject({ total: 4, held: 1, upcoming: 1, inquiries: 1 });
    expect(summary.lastAt?.toISOString()).toBe("2026-08-30T09:00:00.000Z");
  });

  it("דוח ריק אינו מדווח על מועד אחרון", () => {
    expect(summarizeOwnerActivity([], NOW)).toEqual({
      total: 0,
      held: 0,
      upcoming: 0,
      inquiries: 0,
    });
  });
});

describe("ownerActivityCsv", () => {
  const entry: OwnerActivityEntry = {
    at: new Date("2026-08-20T06:30:00.000Z"),
    kind: "viewing",
    result: "liked",
    durationMinutes: 12,
  };

  it("התאריך והשעה בשעון ישראל, לא בשעון השרת", () => {
    // 06:30 UTC בקיץ = 09:30 בישראל, ועדיין ה-20 בחודש
    const csv = ownerActivityCsv([entry]);
    expect(csv).toContain("20.08.2026");
    expect(csv).toContain("09:30");
  });

  it("הקובץ נושא את העמודות שהוגדרו ותו לא", () => {
    const [header, row] = ownerActivityCsv([entry]).trim().split("\r\n");
    expect(header?.replace("﻿", "")).toBe("תאריך,שעה,פעולה,תוצאה,משך (דקות)");
    expect(row?.split(",")).toHaveLength(5);
  });

  it("קיטום נוסע עם הקובץ — האזהרה שבמסך אינה מגיעה לבעל הנכס", () => {
    /*
     * הקובץ הוא מה שנשלח. קובץ שנראה שלם ואינו שלם הוא בדיוק
     * השקר שהדוח נועד לא לספר.
     */
    expect(ownerActivityCsv([entry], { truncated: true })).toContain(
      OWNER_ACTIVITY_TRUNCATED_NOTE,
    );
    expect(ownerActivityCsv([entry])).not.toContain(OWNER_ACTIVITY_TRUNCATED_NOTE);
  });
});

describe("ownerActivityFileName", () => {
  it("הכתובת הופכת לשם קריא", () => {
    expect(ownerActivityFileName("רבי עקיבא 12, בני ברק")).toBe("פעילות - רבי עקיבא 12, בני ברק.csv");
  });

  it("מפריד נתיב אינו שורד — שם הורדה אינו מקום לנתיב", () => {
    const name = ownerActivityFileName("../../etc/passwd");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  it("כתובת ריקה נותנת שם ברירת מחדל ולא קובץ בלי שם", () => {
    expect(ownerActivityFileName("   ")).toBe("פעילות בנכס.csv");
  });
});

describe("ownerActivityText", () => {
  const base = { propertyLabel: "רבי עקיבא 12", officeName: "משרד הדגמה", periodLabel: "כל התקופה", now: NOW };

  it("ההודעה פותחת בשורת תקציר ואז בפירוט", () => {
    const entries = buildOwnerActivity({
      appointments: [
        {
          kind: "viewing",
          startsAt: new Date("2026-08-20T06:30:00.000Z"),
          status: "completed",
          outcome: "liked",
        },
      ],
      calls: [
        {
          direction: "inbound",
          occurredAt: new Date("2026-08-21T06:00:00.000Z"),
          outcome: "missed",
          durationMinutes: null,
        },
      ],
    });
    const text = ownerActivityText({ ...base, entries });

    expect(text).toContain("רבי עקיבא 12");
    expect(text).toContain("1 מפגשים התקיימו");
    expect(text).toContain("1 פניות של מתעניינים");
    expect(text).toContain("• 20.08.2026 09:30 — ביקור בנכס · הלקוח אהב");
  });

  it("תקופה ריקה אומרת זאת במקום לשלוח כותרת בלי גוף", () => {
    expect(ownerActivityText({ ...base, entries: [] })).toContain("לא נרשמה פעילות");
  });

  it("כשהמסד עצמו קיצץ — אין מספר, כי המספר שבידנו שגוי", () => {
    /*
     * ‎`entries` כבר חתוך ב-500 שורות. „ועוד 460 פעולות” שמחושב
     * ממנו הוא מספר מדויק שאינו נכון, ומשמיט את קיומן של השאר.
     */
    const entries: OwnerActivityEntry[] = Array.from({ length: 45 }, (_, i) => ({
      at: new Date(NOW.getTime() - i * 3_600_000),
      kind: "inquiry",
      result: "answered",
    }));
    const text = ownerActivityText({ ...base, entries, truncated: true });
    expect(text).toContain("ועוד פעולות נוספות");
    expect(text).not.toContain("ועוד 5 פעולות");
  });

  it("קיטום נאמר בפירוש — דוח מקוצץ בשקט הוא שקר", () => {
    const entries: OwnerActivityEntry[] = Array.from({ length: 45 }, (_, i) => ({
      at: new Date(NOW.getTime() - i * 3_600_000),
      kind: "inquiry",
      result: "answered",
    }));
    const text = ownerActivityText({ ...base, entries });

    expect(text.split("\n").filter((line) => line.startsWith("• "))).toHaveLength(
      OWNER_ACTIVITY_TEXT_LINES,
    );
    expect(text).toContain("ועוד 5 פעולות");
  });
});

/**
 * ‏המייל הוא מה שבעל הנכס באמת מקבל — ולכן הוא נבדק כמו הודעה
 * שיוצאת ללקוח ולא כמו פונקציית עזר: מה יש בו, ומה אין בו.
 */
describe("ownerActivityEmail", () => {
  const base = {
    propertyLabel: "רבי עקיבא 12",
    officeName: "משרד הדגמה",
    periodLabel: "‏30 הימים האחרונים",
    now: NOW,
  };
  const someEntries: OwnerActivityEntry[] = [
    { at: new Date("2026-08-20T06:30:00.000Z"), kind: "viewing", result: "held" },
    { at: new Date("2026-08-21T06:30:00.000Z"), kind: "inquiry", result: "answered" },
  ];

  it("הנושא נושא את הנכס, והפנייה את שם הבעלים", () => {
    const mail = ownerActivityEmail({ ...base, ownerName: "יוסי לוי", entries: someEntries });
    expect(mail.subject).toBe("דוח פעילות — רבי עקיבא 12");
    expect(mail.greeting).toBe("שלום יוסי לוי,");
  });

  it("בלי שם בעלים אין פנייה חצי-ריקה", () => {
    const mail = ownerActivityEmail({ ...base, entries: someEntries });
    expect(mail.greeting).toBeUndefined();
    const blank = ownerActivityEmail({ ...base, ownerName: "   ", entries: someEntries });
    expect(blank.greeting).toBeUndefined();
  });

  it("הפעילות בגוף ההודעה ולא רק בקובץ — בעל נכס פותח מייל בטלפון", () => {
    const mail = ownerActivityEmail({ ...base, entries: someEntries });
    expect(mail.paragraphs.some((p) => p.includes("ביקור"))).toBe(true);
    expect(mail.paragraphs[0]).toContain("‏30 הימים האחרונים");
  });

  it("תקופה בלי פעילות נאמרת, ולא נשלחת כמייל ריק", () => {
    const mail = ownerActivityEmail({ ...base, entries: [] });
    expect(mail.paragraphs).toContain("לא נרשמה פעילות בתקופה זו.");
  });

  it("קיטום נאמר — גם כשהוא במסד וגם כשהוא בגוף", () => {
    const many: OwnerActivityEntry[] = Array.from({ length: 45 }, (_, i) => ({
      at: new Date(NOW.getTime() - i * 3_600_000),
      kind: "inquiry",
      result: "answered",
    }));
    expect(ownerActivityEmail({ ...base, entries: many }).paragraphs).toContain(
      "ועוד 5 פעולות — הרשימה המלאה בקובץ המצורף.",
    );
    /* ‏הקיטום שבמסד אינו יודע כמה נשארו, ולכן אינו נוקב במספר */
    const cut = ownerActivityEmail({ ...base, entries: many, truncated: true });
    expect(cut.paragraphs).toContain("ועוד פעולות נוספות — הרשימה המלאה בקובץ המצורף.");
    expect(cut.paragraphs).not.toContain("ועוד 5 פעולות — הרשימה המלאה בקובץ המצורף.");
  });

  it("אין בו שם, טלפון או תוכן שיחה — וזה נאמר לנמען", () => {
    const mail = ownerActivityEmail({ ...base, ownerName: "יוסי לוי", entries: someEntries });
    const body = mail.paragraphs.join("\n");
    expect(body).not.toMatch(/05\d/u);
    expect(mail.footnote).toContain("אינו כולל שמות");
  });
});
