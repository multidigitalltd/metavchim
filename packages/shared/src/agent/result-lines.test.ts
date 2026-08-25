import { describe, expect, it } from "vitest";
import {
  AGENT_RESULT_LABEL_MAX,
  agentResultList,
  agentResultText,
  officeReportStats,
} from "./result-lines.js";

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

  /*
   * „התאמות לנכס” מחזירה קונים, ו„התאמות לקונה” מחזירה נכסים —
   * שתי צורות הפוכות של אותה שאלה. הבחנה ביניהן היא ההבדל בין
   * רשימה נכונה לרשימה שכל שורה בה מתויגת בשם של ישות אחרת.
   */
  it("שורה שממוקדת בקונה — הנכס הוא הכותרת, ולא „קונה של סוכן אחר”", () => {
    const text = agentResultText([{ ...matches[0], buyerName: null }])!;
    expect(text).toContain("דירת 4 חדרים");
    expect(text).not.toContain("קונה של סוכן אחר");
    // והכתובת אינה מופיעה פעמיים — פעם ככותרת ופעם בפרטים
    expect(text.match(/דירת 4 חדרים/gu)).toHaveLength(1);
  });

  it("קונה של סוכן אחר ברשימה שמרכזה נכס — הנפילה האנונימית נשמרת", () => {
    // `listForProperty` מחזירה שורות בלי `property` מקונן
    const text = agentResultText([
      { id: "m2", propertyId: "p1", buyerId: "b2", score: 71, explanation: "עיר", buyerName: null },
    ])!;
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

  /*
   * „אין משימות פתוחות” הוא כבר המסר של הפעולה, וההודעה בוואטסאפ
   * פותחת בו. תוספת שנייה הייתה אומרת את אותו דבר פעמיים ברצף —
   * וביומן גם בניסוח פחות מדויק, כי הפעולה יודעת על איזה יום
   * נשאלה (ביקורת Codex).
   */
  it("רשימה ריקה אינה מוסיפה דבר — המסר כבר נאמר", () => {
    expect(agentResultText({ tasks: [] })).toBeNull();
    expect(agentResultList({ tasks: [] })).not.toBeNull();
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

  /*
   * שני קיטומים מצטברים: שלנו (8 שורות מתוך מה שחזר) ושל השרת
   * (עמוד מתוך המאגר). „ועוד 42” לבדו על עמוד עם `hasMore` נשמע
   * כמו סך הכול (ביקורת Codex).
   */
  it("שני הקיטומים — שלנו ושל השרת — נאמרים יחד", () => {
    const buyers = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      name: `קונה ${i}`,
      cities: [],
    }));
    const text = agentResultText({ buyers, hasMore: true })!;
    expect(text).toContain("ועוד 42 קונים");
    expect(text).toContain("יש עוד מעבר להם");
  });

  it("שורה בלי פרטים אינה משאירה מקף יתום", () => {
    const text = agentResultText({ tasks: [{ id: "t", title: "משימה" }] })!;
    expect(text).toBe("• משימה");
  });
});

describe("הטלפון — מה שהמנסח הקודם הציג, ואסור היה לאבד", () => {
  it("קונה נושא את המספר שלו", () => {
    const text = agentResultText({
      buyers: [{ id: "b", name: "משה כהן", cities: ["רמת גן"], phone: "0501234567" }],
    })!;
    expect(text).toContain("0501234567");
  });

  it("שיחה נושאת מספר גם כשיש שם", () => {
    const text = agentResultText({
      calls: [
        {
          id: "c",
          direction: "inbound",
          contactName: "שרה לוי",
          phone: "0521111111",
          occurredAt: "2026-08-24T11:30:00Z",
          outcome: "answered",
        },
      ],
    })!;
    expect(text).toContain("שרה לוי");
    expect(text).toContain("0521111111");
  });

  it("המספר בשדה נפרד, ולא בתוך `detail` שנשמר לזיכרון", () => {
    const list = agentResultList({
      buyers: [{ id: "b", name: "משה כהן", cities: [], phone: "0501234567" }],
    })!;
    expect(list.rows[0]!.phone).toBe("0501234567");
    expect(list.rows[0]!.detail).not.toContain("050");
  });
});

describe("חיפוש כללי — כל המקטעים חוזרים תמיד, גם הריקים", () => {
  /** בדיוק הצורה ש-`SearchService.search` מחזירה. */
  const search = {
    contact: null,
    properties: [],
    buyers: [{ id: "b1", name: "משה כהן", cities: ["רמת גן"], phone: "0501234567" }],
    leads: [],
    appointments: [],
    tasks: [],
    calls: [],
    notes: [],
  };

  it("הקונה שנמצא מוצג — ולא „אין פגישות ביום הזה”", () => {
    const text = agentResultText(search)!;
    expect(text).toContain("משה כהן");
    expect(text).not.toContain("אין פגישות");
  });

  it("כל המקטעים שיש בהם תוצאות מאוחדים לרשימה אחת", () => {
    const list = agentResultList({
      ...search,
      appointments: [{ id: "a1", title: "סיור בהרצל", startsAt: "2026-08-24T13:00:00Z" }],
    })!;
    expect(list.rows.map((row) => row.label)).toEqual(["סיור בהרצל", "משה כהן"]);
  });

  it("הזהות בהתאמת-טלפון פותחת את הרשימה", () => {
    const list = agentResultList({
      ...search,
      contact: { id: "c1", name: "דנה לוי", phone: "0521111111" },
    })!;
    expect(list.rows[0]).toMatchObject({ label: "דנה לוי", phone: "0521111111" });
  });

  it("הערה שנמצאה אינה נבלעת — „לא נמצא כלום” הוא טענה על המאגר", () => {
    const text = agentResultText({
      ...search,
      buyers: [],
      notes: [{ id: "n1", content: "אמר שהוא גמיש בקומה", createdAt: "2026-08-24T11:30:00Z" }],
    })!;
    expect(text).toContain("אמר שהוא גמיש בקומה");
    expect(text).not.toContain("לא נמצא כלום");
  });

  it("חיפוש שלא מצא דבר אינו מוסיף שורה — הפעולה כבר ענתה", () => {
    expect(agentResultText({ ...search, buyers: [] })).toBeNull();
  });

  it("תוכן ההערה נשאר בפרטים — הוא אינו נשמר לזיכרון", () => {
    const list = agentResultList({
      ...search,
      buyers: [],
      notes: [{ id: "n1", content: "התקשר ל-0501234567", createdAt: "2026-08-24T11:30:00Z" }],
    })!;
    expect(list.rows[0]!.label).toBe("הערה");
    expect(list.rows[0]!.detail).toContain("0501234567");
  });
});

describe("מתקשר לא מוכר — המספר בתשובה, ולא בזיכרון", () => {
  const calls = {
    calls: [
      {
        id: "c",
        direction: "inbound",
        phone: "0521111111",
        occurredAt: "2026-08-24T11:30:00Z",
        outcome: "missed",
      },
    ],
  };

  it("הכותרת היא המספר — הוא מה שדרוש כדי לחזור", () => {
    expect(agentResultList(calls)!.rows[0]!.label).toBe("0521111111");
  });

  it("ומה שנשמר לזיכרון אינו המספר", () => {
    expect(agentResultList(calls)!.rows[0]!.memoryLabel).toBe("מספר לא מזוהה");
  });

  it("שיחה עם שם קצר אינה נושאת כותרת זיכרון נפרדת", () => {
    const list = agentResultList({
      calls: [{ ...calls.calls[0]!, contactName: "שרה לוי" }],
    })!;
    expect(list.rows[0]!.memoryLabel).toBeUndefined();
  });

  it("המספר נאמר פעם אחת ולא פעמיים", () => {
    expect(agentResultText(calls)!.match(/0521111111/gu)).toHaveLength(1);
  });
});

describe("אורך הכותרת — התקציב של הזיכרון", () => {
  const long = "א".repeat(120);

  it("כותרת ארוכה נחתכת, ונאמר שהיא נחתכה", () => {
    const list = agentResultList({ buyers: [{ id: "b", name: long, cities: [] }] })!;
    expect(list.rows[0]!.label).toHaveLength(AGENT_RESULT_LABEL_MAX);
    expect(list.rows[0]!.label.endsWith("…")).toBe(true);
  });

  it("שמונה שורות מלאות נכנסות בתקציב 600 התווים", () => {
    const buyers = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: long, cities: [] }));
    const labels = agentResultList({ buyers })!.rows.map((row) => row.label);
    expect(labels.join(", ")).toHaveLength(8 * AGENT_RESULT_LABEL_MAX + 7 * 2);
    expect(labels.join(", ").length).toBeLessThan(600);
  });

  it("כותרת קצרה אינה נוגעת", () => {
    const list = agentResultList({ buyers: [{ id: "b", name: "משה כהן", cities: [] }] })!;
    expect(list.rows[0]!.label).toBe("משה כהן");
    expect(list.rows[0]!.memoryLabel).toBeUndefined();
  });

  /*
   * הכותרת שנשמרת חוזרת בתור הבא כביטוי מזהה, והחיפוש מוצא רשומה
   * לפי גיבוב מדויק או לפי `name.includes(phrase)`. „…” שוברת את
   * שתי הדרכים, ולכן שורה שהמתווך בדיוק ראה הייתה חוזרת כ„לא נמצא
   * במאגר” (ביקורת Codex).
   */
  it("מה שנשמר הוא רישא נקייה — מפתח שהחיפוש עדיין מוצא", () => {
    const list = agentResultList({ buyers: [{ id: "b", name: long, cities: [] }] })!;
    const memory = list.rows[0]!.memoryLabel!;
    expect(memory).not.toContain("…");
    expect(memory).toHaveLength(AGENT_RESULT_LABEL_MAX);
    expect(long.includes(memory)).toBe(true);
  });

  it("ושתי הכותרות נחתכות באותה נקודה", () => {
    const row = agentResultList({ buyers: [{ id: "b", name: long, cities: [] }] })!.rows[0]!;
    expect(row.label.slice(0, AGENT_RESULT_LABEL_MAX - 1)).toBe(
      row.memoryLabel!.slice(0, AGENT_RESULT_LABEL_MAX - 1),
    );
  });
});

describe("תוצאת השיחה — כל הערכים שהסכימה מקבלת", () => {
  it.each([
    ["answered", "נענתה"],
    ["missed", "לא נענתה"],
    ["no_answer", "אין מענה"],
    ["voicemail", "תא קולי"],
  ])("%s ⟵ %s", (outcome, label) => {
    const text = agentResultText({
      calls: [{ id: "c", direction: "inbound", phone: "050", occurredAt: "2026-08-24T11:30:00Z", outcome }],
    })!;
    expect(text).toContain(label);
  });
});
