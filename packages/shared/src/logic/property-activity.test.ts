import { describe, expect, it } from "vitest";
import {
  OWNER_ACTIVITY_TEXT_LINES,
  buildOwnerActivity,
  ownerActivityCsv,
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
