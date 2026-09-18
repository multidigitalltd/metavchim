import { describe, expect, it } from "vitest";
import {
  chunkExpoPush,
  expoPushMessage,
  expoPushOutcome,
  isExpoPushToken,
} from "./expo-push.js";

describe("isExpoPushToken", () => {
  it("מקבל את שתי הצורות ש-Expo מנפיק", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc-DEF_123456]")).toBe(true);
  });

  it("דוחה כל דבר אחר — כתובת, מחרוזת ריקה, טוקן בלי סוגריים", () => {
    expect(isExpoPushToken("")).toBe(false);
    expect(isExpoPushToken("https://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[abc def]")).toBe(false);
    expect(isExpoPushToken(`ExponentPushToken[${"x".repeat(200)}]`)).toBe(false);
  });
});

describe("expoPushOutcome", () => {
  it("הצלחה — נמסר", () => {
    expect(expoPushOutcome({ status: "ok" })).toBe("delivered");
  });

  it("מכשיר שהסיר את האפליקציה — הטוקן מת ונמחק", () => {
    expect(expoPushOutcome({ status: "error", details: { error: "DeviceNotRegistered" } })).toBe(
      "retire",
    );
  });

  it("כל שגיאה אחרת — ניסיון חוזר, הטוקן נשאר", () => {
    expect(expoPushOutcome({ status: "error", details: { error: "MessageRateExceeded" } })).toBe(
      "retry",
    );
    expect(expoPushOutcome({ status: "error", message: "boom" })).toBe("retry");
  });
});

describe("expoPushMessage", () => {
  it("נושא את אותו מטען כמו הדפדפן — נתיב ומזהה קיבוץ — ואת ערוץ אנדרואיד", () => {
    const message = expoPushMessage("ExponentPushToken[abcdefghij]", {
      title: "ליד חדש",
      body: "דנה כהן",
      url: "/leads/01ABC",
      tag: "lead_new:01ABC",
    });
    expect(message).toEqual({
      to: "ExponentPushToken[abcdefghij]",
      title: "ליד חדש",
      body: "דנה כהן",
      data: { url: "/leads/01ABC", tag: "lead_new:01ABC" },
      sound: "default",
      channelId: "default",
      priority: "high",
    });
  });
});

describe("chunkExpoPush", () => {
  it("מחלק לאצוות של 100 כברירת מחדל, והשארית באחרונה", () => {
    const chunks = chunkExpoPush(Array.from({ length: 250 }, (_, i) => i));
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it("רשימה ריקה — אין אצוות", () => {
    expect(chunkExpoPush([])).toEqual([]);
  });
});
