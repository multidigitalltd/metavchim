import { describe, expect, it } from "vitest";
import { afterLoginTarget, safeLoginReturnPath, withLoginReturn } from "./login-return.js";

describe("safeLoginReturnPath", () => {
  it("מתיר דף הצעה בלינק", () => {
    expect(safeLoginReturnPath("/subscribe/abc123XY_-de")).toBe("/subscribe/abc123XY_-de");
  });

  it("דוחה כתובת חיצונית", () => {
    for (const next of [
      "https://evil.example/subscribe/abcdefgh",
      "//evil.example",
      "/\\evil.example",
      "http://evil.example",
    ]) {
      expect(safeLoginReturnPath(next)).toBeNull();
    }
  });

  it("דוחה נתיב פנימי שאינו ברשימה", () => {
    for (const next of ["/", "/settings", "/subscribe", "/subscribe/", "/properties/1"]) {
      expect(safeLoginReturnPath(next)).toBeNull();
    }
  });

  it("דוחה ניסיון לצאת מהנתיב או לתלות עליו פרמטרים", () => {
    for (const next of [
      "/subscribe/../../admin",
      "/subscribe/abcdefgh?x=1",
      "/subscribe/abcdefgh#f",
      "/subscribe/abcdefgh/more",
      "/subscribe/abcdefgh ",
    ]) {
      expect(safeLoginReturnPath(next)).toBeNull();
    }
  });

  it("דוחה טוקן קצר או ארוך מדי", () => {
    expect(safeLoginReturnPath("/subscribe/abc")).toBeNull();
    expect(safeLoginReturnPath(`/subscribe/${"a".repeat(65)}`)).toBeNull();
    expect(safeLoginReturnPath(`/subscribe/${"a".repeat(64)}`)).not.toBeNull();
  });

  it("דוחה חסר", () => {
    expect(safeLoginReturnPath(null)).toBeNull();
    expect(safeLoginReturnPath(undefined)).toBeNull();
    expect(safeLoginReturnPath("")).toBeNull();
  });
});

describe("afterLoginTarget", () => {
  it("מחזיר את הנתיב המותר", () => {
    expect(afterLoginTarget("/subscribe/abcdefgh")).toBe("/subscribe/abcdefgh");
  });

  it("נופל ללוח הבקרה בכל מקרה אחר", () => {
    expect(afterLoginTarget(null)).toBe("/");
    expect(afterLoginTarget("https://evil.example")).toBe("/");
  });
});

describe("withLoginReturn", () => {
  it("מוסיף את החזרה כשהיא מותרת", () => {
    expect(withLoginReturn("/change-password", "/subscribe/abcdefgh")).toBe(
      "/change-password?next=%2Fsubscribe%2Fabcdefgh",
    );
  });

  it("משאיר את הכתובת נקייה כשאין חזרה מותרת", () => {
    expect(withLoginReturn("/change-password", "/")).toBe("/change-password");
    expect(withLoginReturn("/change-password", null)).toBe("/change-password");
    expect(withLoginReturn("/change-password", "https://evil.example")).toBe("/change-password");
  });
});
