import { describe, expect, it } from "vitest";
import {
  MOBILE_GOOGLE_RETURN_URL,
  mobileGoogleReturnUrl,
  parseMobileGoogleReturn,
} from "./mobile-auth.js";

const CODE = "A".repeat(43);

describe("mobileGoogleReturnUrl / parseMobileGoogleReturn", () => {
  it("קוד עובר הלוך ושוב", () => {
    const url = mobileGoogleReturnUrl({ kind: "code", code: CODE });
    expect(url).toBe(`${MOBILE_GOOGLE_RETURN_URL}?code=${CODE}`);
    expect(parseMobileGoogleReturn(url)).toEqual({ kind: "code", code: CODE });
  });

  it("שגיאה עוברת הלוך ושוב", () => {
    const url = mobileGoogleReturnUrl({ kind: "error", error: "unknown" });
    expect(parseMobileGoogleReturn(url)).toEqual({ kind: "error", error: "unknown" });
  });

  it("דוחה כתובת שאינה החזרה שלנו", () => {
    for (const url of [
      `https://evil.example/auth/google?code=${CODE}`,
      `metavchim://auth/other?code=${CODE}`,
      `metavchim://auth/google/?code=${CODE}`,
      "metavchim://auth/google",
      "metavchim://auth/google?",
    ]) {
      expect(parseMobileGoogleReturn(url)).toBeNull();
    }
  });

  it("דוחה קוד בצורה לא נכונה ושגיאה שאינה ברשימה", () => {
    expect(parseMobileGoogleReturn(`${MOBILE_GOOGLE_RETURN_URL}?code=short`)).toBeNull();
    expect(parseMobileGoogleReturn(`${MOBILE_GOOGLE_RETURN_URL}?code=${CODE}%20`)).toBeNull();
    expect(parseMobileGoogleReturn(`${MOBILE_GOOGLE_RETURN_URL}?error=weird`)).toBeNull();
  });

  it("קוד גובר על שגיאה כשיש שניהם — אבל רק קוד תקין", () => {
    expect(parseMobileGoogleReturn(`${MOBILE_GOOGLE_RETURN_URL}?code=${CODE}&error=failed`)).toEqual({
      kind: "code",
      code: CODE,
    });
    expect(parseMobileGoogleReturn(`${MOBILE_GOOGLE_RETURN_URL}?code=x&error=failed`)).toBeNull();
  });
});

describe("googleLoginErrorText", () => {
  it("סיבה מוכרת — הנוסח שלה; כל דבר אחר — הכישלון הכללי", async () => {
    const { googleLoginErrorText, GOOGLE_LOGIN_ERROR_TEXT } = await import("./mobile-auth.js");
    expect(googleLoginErrorText("unknown")).toBe(GOOGLE_LOGIN_ERROR_TEXT.unknown);
    expect(googleLoginErrorText("weird")).toBe(GOOGLE_LOGIN_ERROR_TEXT.failed);
    expect(googleLoginErrorText(null)).toBe(GOOGLE_LOGIN_ERROR_TEXT.failed);
  });
});
