import { describe, expect, it } from "vitest";
import {
  openSupportCount,
  orderSupportQueue,
  ticketTitle,
  type SupportQueueRow,
} from "./support-queue.js";

const row = (over: Partial<SupportQueueRow>): SupportQueueRow => ({
  source: "email",
  id: "01A",
  reference: 1,
  title: "נושא",
  who: "דנה",
  tenantName: null,
  status: "open",
  unread: false,
  lastActivityAt: "2026-08-01T10:00:00.000Z",
  ...over,
});

describe("סדר התור", () => {
  it("פתוחות לפני סגורות — גם כשהסגורה חדשה יותר", () => {
    /*
     * ‎**התקלה שהכלל הזה קיים בשבילה.** מיון לפי הערך של `status`
     * הוא לקסיקוגרפי, ושם `closed` < `in_progress` < `open` —
     * כלומר הסגורות עולות לראש. עם תקרה של 100 שורות זה אומר
     * שהתור הפתוח נעלם מהמסך.
     */
    const ordered = orderSupportQueue([
      row({ id: "סגורה-חדשה", status: "closed", lastActivityAt: "2026-08-05T00:00:00.000Z" }),
      row({ id: "פתוחה-ישנה", status: "open", lastActivityAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["פתוחה-ישנה", "סגורה-חדשה"]);
  });

  it("„בטיפול” נחשבת פתוחה — הפונה עדיין מחכה", () => {
    const ordered = orderSupportQueue([
      row({ id: "סגורה", status: "closed", lastActivityAt: "2026-08-09T00:00:00.000Z" }),
      row({ id: "בטיפול", status: "in_progress", lastActivityAt: "2026-08-02T00:00:00.000Z" }),
    ]);
    expect(ordered[0]?.id).toBe("בטיפול");
  });

  it("בתוך כל קבוצה — החדש בראש", () => {
    const ordered = orderSupportQueue([
      row({ id: "ישנה", lastActivityAt: "2026-08-01T00:00:00.000Z" }),
      row({ id: "חדשה", lastActivityAt: "2026-08-09T00:00:00.000Z" }),
      row({ id: "אמצע", lastActivityAt: "2026-08-05T00:00:00.000Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["חדשה", "אמצע", "ישנה"]);
  });

  it("שני המקורות משורגים לפי זמן, לא מקובצים לפי מקור", () => {
    // זה כל העניין: תור אחד, לא שתי רשימות זו אחר זו
    const ordered = orderSupportQueue([
      row({ id: "מייל-ישן", source: "email", lastActivityAt: "2026-08-01T00:00:00.000Z" }),
      row({ id: "כפתור-חדש", source: "app", lastActivityAt: "2026-08-09T00:00:00.000Z" }),
      row({ id: "מייל-חדש", source: "email", lastActivityAt: "2026-08-08T00:00:00.000Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["כפתור-חדש", "מייל-חדש", "מייל-ישן"]);
  });

  it("זמן זהה מוכרע במספר הפנייה — סדר יציב", () => {
    const same = "2026-08-05T00:00:00.000Z";
    const ordered = orderSupportQueue([
      row({ id: "א", reference: 5, lastActivityAt: same }),
      row({ id: "ב", reference: 9, lastActivityAt: same }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["ב", "א"]);
  });

  it("אינו משנה את המערך שהתקבל", () => {
    const rows = [row({ id: "א" }), row({ id: "ב", status: "closed" })];
    const before = rows.map((r) => r.id);
    orderSupportQueue(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("מונה הממתינות", () => {
  it("סופר פתוחות ובטיפול, לא סגורות", () => {
    expect(
      openSupportCount([
        row({ status: "open" }),
        row({ status: "in_progress" }),
        row({ status: "closed" }),
      ]),
    ).toBe(2);
  });
});

describe("כותרת פנייה מהכפתור", () => {
  it("השורה הראשונה בלבד", () => {
    expect(ticketTitle("לא מצליח להיכנס\nניסיתי שלוש פעמים")).toBe("לא מצליח להיכנס");
  });

  it("ארוכה נחתכת עם שלוש נקודות", () => {
    expect(ticketTitle("א".repeat(200))).toHaveLength(80);
    expect(ticketTitle("א".repeat(200)).endsWith("…")).toBe(true);
  });

  it("ריקה אינה שורה ריקה בתור", () => {
    expect(ticketTitle("   \n  ")).toBe("(פנייה ללא טקסט)");
  });
});
