import { describe, expect, it } from "vitest";
import {
  MAX_PUSH_FAILURES,
  notificationUrl,
  pushOutcome,
  pushPayload,
  shouldPush,
  shouldRetireAfterFailure,
  type PushableNotification,
} from "./web-push.js";

const note = (patch: Partial<PushableNotification> = {}): PushableNotification => ({
  type: "lead",
  title: "ליד חדש",
  body: "התקבלה פנייה חדשה",
  entityType: "lead",
  entityId: "01HQ0000000000000000000001",
  ...patch,
});

describe("shouldPush", () => {
  it("דוחף אירוע אמיתי", () => {
    expect(shouldPush(note({ type: "lead_requires_human" }))).toBe(true);
  });

  // סיכומים נשלחים בשעה קבועה לכולם — פוש עליהם הוא הרעש שגורם
  // למשתמש לכבות את ההרשאה, ואז גם הדחוף לא מגיע
  it("לא דוחף את דוח הבוקר", () => {
    expect(shouldPush(note({ type: "daily_brief" }))).toBe(false);
  });

  it("לא דוחף את הסיכום השבועי", () => {
    expect(shouldPush(note({ type: "weekly_summary" }))).toBe(false);
  });
});

describe("notificationUrl", () => {
  it("מקשר לכרטיס כשיש מזהה", () => {
    expect(notificationUrl(note({ entityType: "buyer", entityId: "abc" }))).toBe("/buyers/abc");
  });

  it("מקשר לרשימה כשאין מזהה", () => {
    expect(notificationUrl(note({ entityType: "offer", entityId: null }))).toBe("/offers");
  });

  it("נופל לדשבורד כשאין ישות", () => {
    expect(notificationUrl(note({ entityType: null, entityId: null }))).toBe("/");
  });

  // לחיצה על התראה שנוחתת על 404 גרועה מהתראה שלא נשלחה
  it("נופל לדשבורד גם על ישות שאינה מוכרת", () => {
    expect(notificationUrl(note({ entityType: "widget", entityId: "abc" }))).toBe("/");
  });
});

describe("pushPayload", () => {
  it("ממלא גוף ריק במקום undefined", () => {
    expect(pushPayload(note({ body: null })).body).toBe("");
  });

  it("שתי התראות על אותה ישות מקבלות אותו tag ומתמזגות", () => {
    const a = pushPayload(note({ type: "lead", entityId: "same" }));
    const b = pushPayload(note({ type: "lead", entityId: "same", title: "עדכון" }));
    expect(a.tag).toBe(b.tag);
  });

  it("אותו סוג על ישויות שונות נשאר נפרד", () => {
    const a = pushPayload(note({ entityId: "one" }));
    const b = pushPayload(note({ entityId: "two" }));
    expect(a.tag).not.toBe(b.tag);
  });

  it("התראה בלי ישות מקובצת לפי הסוג בלבד", () => {
    expect(pushPayload(note({ type: "matches_found", entityId: null })).tag).toBe("matches_found");
  });
});

describe("pushOutcome", () => {
  it("201 נחשב נמסר", () => {
    expect(pushOutcome(201)).toBe("delivered");
  });

  it("410 — הדפדפן ביטל את המנוי, מסירים אותו", () => {
    expect(pushOutcome(410)).toBe("retire");
  });

  it("404 — אותו דבר", () => {
    expect(pushOutcome(404)).toBe("retire");
  });

  // הבדיקה שבגללה ההבחנה קיימת: מפתח VAPID שהוחלף בטעות היה מוחק
  // את כל מנויי הפוש במערכת
  it("401 אינו מסיר מנוי — זו תקלת תצורה בשרת", () => {
    expect(pushOutcome(401)).toBe("retry");
    expect(pushOutcome(403)).toBe("retry");
  });

  it("עומס ותקלת שרת — ניסיון חוזר", () => {
    expect(pushOutcome(429)).toBe("retry");
    expect(pushOutcome(503)).toBe("retry");
  });

  it("בקשה פגומה אינה מוחקת מנוי — הבאג הוא שלנו", () => {
    expect(pushOutcome(400)).toBe("retry");
  });
});

describe("shouldRetireAfterFailure", () => {
  it("לא מוותר על כישלון בודד", () => {
    expect(shouldRetireAfterFailure(1)).toBe(false);
  });

  // בלי תקרה, מנוי תקוע מייצר ניסיון חוזר בכל סריקה לנצח
  it("מוותר בתקרה", () => {
    expect(shouldRetireAfterFailure(MAX_PUSH_FAILURES)).toBe(true);
    expect(shouldRetireAfterFailure(MAX_PUSH_FAILURES + 3)).toBe(true);
  });
});
