import { describe, expect, it } from "vitest";
import { agentResultList, agentResultText, officeReportStats } from "./result-lines.js";

/**
 * הבדיקות מתחילות מהצורות שלא ענו כלל — שיחות, דוח והתאמות.
 *
 * זה מה שהיה שבור: הודעה עם מספר („5 שיחות אחרונות”) ובלי שורה
 * אחת מתחתיה. בדיקה שמאשרת רק „יש כותרת” הייתה עוברת גם על הבאג.
 */

describe("שיחות — הצורה שלא הוצגה בכלל", () => {
  const calls = {
    calls: [
      {
        id: "1",
        direction: "inbound",
        contactName: "שרה לוי",
        phone: "0501234567",
        occurredAt: "2026-08-24T11:30:00Z",
        outcome: "answered",
        summary: "מעוניינת בדירה ברמת גן",
      },
      {
        id: "2",
        direction: "outbound",
        phone: "0521111111",
        occurredAt: "2026-08-24T09:00:00Z",
        outcome: "missed",
      },
    ],
  };

  it("כל שיחה עם כיוון, תוצאה ומועד", () => {
    const text = agentResultText(calls)!;
    expect(text).toContain("שרה לוי");
    expect(text).toContain("נכנסת");
    expect(text).toContain("נענתה");
    expect(text).toContain("מעוניינת בדירה ברמת גן");
    expect(text).toContain("יוצאת");
    expect(text).toContain("לא נענתה");
  });

  it("מספר שאינו מוכר נשאר מספר ולא „לא מזוהה”", () => {
    // המספר הוא בדיוק מה שדרוש כדי לחזור אליו
    expect(agentResultText(calls)!).toContain("0521111111");
  });

  it("השעה בשעון ישראל", () => {
    // 11:30Z בקיץ = 14:30 בירושלים
    expect(agentResultText(calls)!).toContain("14:30");
  });
});

describe("דוח המשרד — אינו מערך, ולכן לא הוצג", () => {
  const report = {
    report: {
      deals: { closed: 3 },
      properties: { total: 40, active: 12 },
      buyers: { total: 30, hot: 5 },
      leads: { open: 7 },
      offers: { sent: 9 },
      appointments: { upcoming: 2 },
    },
  };

  it("המדדים מוצגים, ועסקאות שנסגרו ראשונות", () => {
    const stats = officeReportStats(report.report);
    expect(stats[0]).toEqual({ label: "עסקאות שנסגרו", value: 3 });
    expect(stats.map((s) => s.label)).toContain("קונים חמים");
  });

  it("מדד חסר אינו הופך לאפס — הוא פשוט אינו מוצג", () => {
    const stats = officeReportStats({ deals: { closed: 1 } });
    expect(stats).toEqual([{ label: "עסקאות שנסגרו", value: 1 }]);
  });

  it("הטקסט לוואטסאפ נושא את המספרים", () => {
    const text = agentResultText(report)!;
    expect(text).toContain("עסקאות שנסגרו — 3");
    expect(text).toContain("לידים פתוחים — 7");
  });
});

describe("התאמות — מערך חשוף, שאף מסך לא זיהה", () => {
  const matches = [
    {
      id: "m1",
      propertyId: "p1",
      buyerId: "b1",
      score: 92,
      explanation: "תקציב וחדרים",
      status: "new",
      property: { address: "הרב שך 12", title: "דירת 4 חדרים" },
      buyerName: "משה כהן",
    },
  ];

  it("השם, הנכס והציון", () => {
    const text = agentResultText(matches)!;
    expect(text).toContain("משה כהן");
    expect(text).toContain("דירת 4 חדרים");
    expect(text).toContain("92%");
  });

  it("קונה של סוכן אחר נשאר בלי שם ולא נעלם מהרשימה", () => {
    const text = agentResultText([{ ...matches[0], buyerName: null }])!;
    expect(text).toContain("קונה של סוכן אחר");
  });
});

describe("פגישות ומשימות — היו בלי שעה ובלי מועד", () => {
  it("פגישה בלי כותרת נופלת לסוג שלה, ונושאת שעה", () => {
    const text = agentResultText({
      appointments: [{ id: "a1", kind: "viewing", startsAt: "2026-08-24T13:00:00Z", status: "scheduled" }],
    })!;
    expect(text).toContain("סיור");
    expect(text).toContain("16:00");
  });

  it("משימה נושאת את הכרטיס ואת מועד היעד", () => {
    const text = agentResultText({
      tasks: [{ id: "t1", title: "לחזור ללקוח", dueAt: "2026-08-25T07:00:00Z", entityLabel: "שרה לוי" }],
    })!;
    expect(text).toContain("לחזור ללקוח");
    expect(text).toContain("שרה לוי");
    expect(text).toContain("25.08.2026");
  });
});

describe("עסקאות משותפות — תווית השלב מהמקור המשותף", () => {
  it("„לא יצא לפועל” ולא „בוטל”", () => {
    const text = agentResultText({
      deals: [
        {
          id: "d1",
          title: "הרצל 3",
          stage: "cancelled",
          counterpartOffice: "משרד ב׳",
          lastActivityAt: "2026-08-24T10:00:00Z",
        },
      ],
    })!;
    expect(text).toContain("לא יצא לפועל");
    expect(text).not.toContain("בוטל");
  });
});

describe("הגבולות", () => {
  it("צורה שאינה מוכרת מחזירה null — ולא מחרוזת ריקה", () => {
    // ההבדל מכריע: הקורא נופל למנסח הכללי במקום לשלוח שורה ריקה
    expect(agentResultText({ something: [1, 2] })).toBeNull();
    expect(agentResultList("טקסט")).toBeNull();
  });

  it("רשימה ריקה אומרת מה אין, ואינה null", () => {
    expect(agentResultText({ tasks: [] })).toBe("אין משימות פתוחות");
  });

  it("רשימה ארוכה נחתכת — ואומרת בכמה", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: `משימה ${i}` }));
    const text = agentResultText({ tasks })!;
    expect(text.split("\n")).toHaveLength(9); // 8 שורות + „ועוד”
    expect(text).toContain("ועוד 4 משימות פתוחות");
  });

  it("קיטום שהשרת עשה נאמר גם הוא", () => {
    const buyers = Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: `קונה ${i}`, cities: [] }));
    const text = agentResultText({ buyers, hasMore: true })!;
    expect(text).toContain("יש עוד");
  });

  it("שורה בלי פרטים אינה משאירה מקף יתום", () => {
    const text = agentResultText({ tasks: [{ id: "t", title: "משימה" }] })!;
    expect(text).toBe("• משימה");
  });
});
