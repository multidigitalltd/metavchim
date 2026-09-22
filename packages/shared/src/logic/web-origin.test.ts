import { describe, expect, it } from "vitest";
import { normalizeWebOrigin, webOriginFromEnv } from "./web-origin.js";

describe("normalizeWebOrigin", () => {
  it("‏לוכסן אחד נחתך", () => {
    expect(normalizeWebOrigin("https://app.example.com/")).toBe("https://app.example.com");
  });

  it("‏כמה לוכסנים נחתכים יחד", () => {
    expect(normalizeWebOrigin("https://app.example.com///")).toBe("https://app.example.com");
  });

  it("‏כתובת תקינה נשארת כפי שהיא", () => {
    expect(normalizeWebOrigin("https://app.example.com")).toBe("https://app.example.com");
  });

  /*
   * ‎**זו התקלה שהמשתמש דיווח עליה, בשורה אחת.**
   *
   * ‏כך נראה הקישור שהבוט שלח: הכתובת נכונה, הדומיין נכון, והנתיב
   * ‏מתחיל בלוכסן כפול — ואין מסך כזה.
   */
  it("‏קישור שנבנה מכתובת עם לוכסן אינו נושא לוכסן כפול", () => {
    const broken = `${"https://app.example.com/"}${"/properties/abc"}`;
    expect(broken).toBe("https://app.example.com//properties/abc");
    expect(`${normalizeWebOrigin("https://app.example.com/")}${"/properties/abc"}`).toBe(
      "https://app.example.com/properties/abc",
    );
  });
});

describe("webOriginFromEnv", () => {
  it("‏מנרמל כמו כולם", () => {
    expect(webOriginFromEnv("https://app.example.com/")).toBe("https://app.example.com");
  });

  it("‏רווחים מסביב אינם חלק מהכתובת", () => {
    expect(webOriginFromEnv("  https://app.example.com/  ")).toBe("https://app.example.com");
  });

  /*
   * ‏`?? ""` היה הקורא הקודם, והוא הפך משתנה חסר לקישור יחסי
   * ‏שבוואטסאפ אינו קישור. `null` מכריח את הקורא לומר משהו.
   */
  it("‏חסר הוא null ולא מחרוזת ריקה", () => {
    expect(webOriginFromEnv(undefined)).toBeNull();
    expect(webOriginFromEnv("")).toBeNull();
    expect(webOriginFromEnv("   ")).toBeNull();
  });
});
