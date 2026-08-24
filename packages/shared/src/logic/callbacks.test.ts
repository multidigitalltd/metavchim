import { describe, expect, it } from "vitest";
import {
  formatCallbacksForWhatsApp,
  pendingMissedCalls,
  rankCallbacks,
  type CallbackCallRow,
  type CallbackCandidate,
} from "./callbacks.js";

const NOW = new Date("2026-03-10T12:00:00Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function candidate(over: Partial<CallbackCandidate> = {}): CallbackCandidate {
  return {
    contactId: "c1",
    name: "דני כהן",
    phone: "+972501234567",
    reason: "missed_call",
    since: hoursAgo(1),
    href: "/calls",
    ...over,
  };
}

describe("rankCallbacks", () => {
  it("שיחה שלא נענתה קודמת לליד ממתין, וזה קודם למשימה", () => {
    /*
     * מי שהרים טלפון וקיבל דלת סגורה דוחק יותר ממשימה שנפתחה
     * מזמן — גם אם המשימה ותיקה בהרבה.
     */
    const rows = rankCallbacks(
      [
        candidate({ contactId: "c3", reason: "task", since: hoursAgo(80) }),
        candidate({ contactId: "c2", reason: "waiting_lead", since: hoursAgo(40) }),
        candidate({ contactId: "c1", reason: "missed_call", since: hoursAgo(1) }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.contactId)).toEqual(["c1", "c2", "c3"]);
  });

  it("בתוך אותה סיבה — מי שממתין יותר עולה למעלה", () => {
    const rows = rankCallbacks(
      [
        candidate({ contactId: "fresh", name: "א", since: hoursAgo(1) }),
        candidate({ contactId: "old", name: "ב", since: hoursAgo(30) }),
      ],
      NOW,
    );
    expect(rows[0]?.contactId).toBe("old");
    expect(rows[0]?.urgency).toBe("now");
    expect(rows[1]?.urgency).toBe("soon");
  });

  it("שתי סיבות לאותו אדם הן שיחה אחת, לא שתי שורות", () => {
    /*
     * הלב של הפיצ'ר: המתווך מרים טלפון לאדם, לא לרשומה. אותו לקוח
     * שגם התקשר וגם יש עליו משימה מופיע פעם אחת — עם הסיבה החזקה.
     */
    const rows = rankCallbacks(
      [
        candidate({ reason: "task", since: hoursAgo(50), detail: "לחזור בקשר לחוזה" }),
        candidate({ reason: "missed_call", since: hoursAgo(2) }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("missed_call");
    expect(rows[0]?.alsoCount).toBe(1);
  });

  it("ותק מכריע כשהסיבה זהה — גם במיזוג", () => {
    const rows = rankCallbacks(
      [
        candidate({ reason: "missed_call", since: hoursAgo(2), href: "/calls/new" }),
        candidate({ reason: "missed_call", since: hoursAgo(9), href: "/calls/old" }),
      ],
      NOW,
    );
    expect(rows[0]?.href).toBe("/calls/old");
    expect(rows[0]?.alsoCount).toBe(1);
  });

  it("איש קשר בלי מספר נשאר ברשימה", () => {
    // השמטה בשקט היא בדיוק מה שגורם ללקוח ליפול בין הכיסאות
    const rows = rankCallbacks([candidate({ phone: null })], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phone).toBeNull();
  });

  it("הניסוח בעברית תקנית, כולל צורת זוגי", () => {
    const rows = rankCallbacks([candidate({ since: hoursAgo(2) })], NOW);
    expect(rows[0]?.waitedText).toBe("ממתין שעתיים");
    expect(rows[0]?.reasonText).toBe("התקשר ולא נענה");
  });

  it("רשימה ריקה מחזירה רשימה ריקה", () => {
    expect(rankCallbacks([], NOW)).toEqual([]);
  });

  it("דחיפות: מעל יממה „עכשיו”, מעל ארבע שעות „היום”", () => {
    const rows = rankCallbacks(
      [
        candidate({ contactId: "a", since: hoursAgo(25) }),
        candidate({ contactId: "b", since: hoursAgo(5) }),
        candidate({ contactId: "c", since: hoursAgo(1) }),
      ],
      NOW,
    );
    const byId = new Map(rows.map((r) => [r.contactId, r.urgency]));
    expect(byId.get("a")).toBe("now");
    expect(byId.get("b")).toBe("today");
    expect(byId.get("c")).toBe("soon");
  });
});

describe("formatCallbacksForWhatsApp", () => {
  it("המספר עומד בשורה משלו — זה מה שהופך אותו לקישור חיוג", () => {
    const rows = rankCallbacks([candidate()], NOW);
    const lines = formatCallbacksForWhatsApp(rows).split("\n");
    expect(lines).toContain("+972501234567");
  });

  it("רשימה ריקה אומרת זאת במפורש", () => {
    expect(formatCallbacksForWhatsApp([])).toContain("אין כרגע");
  });

  it("מעל התקרה — נאמר כמה נחתכו, ולא נחתך בשקט", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      candidate({ contactId: `c${i}`, name: `לקוח ${i}`, since: hoursAgo(i + 1) }),
    );
    const text = formatCallbacksForWhatsApp(rankCallbacks(many, NOW), { limit: 10 });
    expect(text).toContain("ועוד 4");
    expect(text.split("\n").filter((l) => l.startsWith("10. "))).toHaveLength(1);
    expect(text).not.toContain("11. ");
  });

  it("איש קשר בלי מספר אומר זאת, ולא משאיר שורה ריקה", () => {
    const rows = rankCallbacks([candidate({ phone: null })], NOW);
    expect(formatCallbacksForWhatsApp(rows)).toContain("אין מספר בכרטיס");
  });

  it("סיבות נוספות מסומנות במספר ולא ברשימה", () => {
    const rows = rankCallbacks(
      [candidate({ reason: "missed_call" }), candidate({ reason: "task", since: hoursAgo(50) })],
      NOW,
    );
    expect(formatCallbacksForWhatsApp(rows)).toContain("(+1 בכרטיס)");
  });
});

function call(over: Partial<CallbackCallRow> = {}): CallbackCallRow {
  return {
    id: "call1",
    contactId: "c1",
    contactName: "דני כהן",
    phone: "+972501234567",
    direction: "inbound",
    outcome: "no_answer",
    occurredAt: hoursAgo(2),
    ...over,
  };
}

describe("pendingMissedCalls", () => {
  it("שיחה נכנסת שלא נענתה — ממתינה לחזרה", () => {
    const out = pendingMissedCalls([call()], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe("missed_call");
    expect(out[0]?.phone).toBe("+972501234567");
  });

  it("חייגנו בחזרה — הטיפול הסתיים, גם בלי שאיש סימן דבר", () => {
    /*
     * הכלל הוא „מה הדבר האחרון שקרה”, ולא „האם קיימת שיחה יוצאת”.
     * זה מה שהופך את הרשימה לנכונה בלי שהמתווך יתחזק אותה ידנית.
     */
    const out = pendingMissedCalls(
      [
        call({ id: "missed", occurredAt: hoursAgo(5) }),
        call({ id: "returned", direction: "outbound", outcome: "answered", occurredAt: hoursAgo(4) }),
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("התקשר שוב אחרי שדיברנו — ממתין מחדש", () => {
    // שיחה יוצאת ישנה אינה מבטלת פנייה חדשה
    const out = pendingMissedCalls(
      [
        call({ id: "old-outbound", direction: "outbound", outcome: "answered", occurredAt: hoursAgo(50) }),
        call({ id: "new-missed", occurredAt: hoursAgo(3) }),
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.href).toContain("new-missed");
  });

  it("שיחה שנענתה אינה נכנסת לרשימה", () => {
    expect(pendingMissedCalls([call({ outcome: "answered" })], NOW)).toEqual([]);
  });

  it("שלוש התוצאות שמשמעותן „לא קיבל מענה” נתפסות", () => {
    for (const outcome of ["missed", "no_answer", "voicemail"]) {
      expect(pendingMissedCalls([call({ outcome })], NOW)).toHaveLength(1);
    }
  });

  it("שיחה ישנה מהחלון היא היסטוריה, לא מטלה", () => {
    const out = pendingMissedCalls([call({ occurredAt: hoursAgo(24 * 20) })], NOW);
    expect(out).toEqual([]);
  });

  it("שיחה בלי איש קשר מזוהה מדולגת — אין למי לחזור", () => {
    expect(pendingMissedCalls([call({ contactId: undefined })], NOW)).toEqual([]);
  });

  it("כמה שיחות שלא נענו מאותו אדם הן שורה אחת — האחרונה", () => {
    const out = pendingMissedCalls(
      [
        call({ id: "first", occurredAt: hoursAgo(9) }),
        call({ id: "second", occurredAt: hoursAgo(3) }),
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.href).toContain("second");
  });
});
