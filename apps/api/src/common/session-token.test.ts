import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, sessionTokenOf } from "./session-token";

/** 32 בתים ב-base64url — הצורה ש-`issueSession` מנפיק. */
const TOKEN = "A".repeat(43);

function request(input: { cookie?: string; authorization?: string }) {
  return {
    cookies: input.cookie === undefined ? {} : { [SESSION_COOKIE]: input.cookie },
    headers: input.authorization === undefined ? {} : { authorization: input.authorization },
  };
}

describe("sessionTokenOf", () => {
  it("קורא את העוגייה של הדפדפן", () => {
    expect(sessionTokenOf(request({ cookie: TOKEN }))).toBe(TOKEN);
  });

  it("קורא כותרת Bearer של האפליקציה לנייד", () => {
    expect(sessionTokenOf(request({ authorization: `Bearer ${TOKEN}` }))).toBe(TOKEN);
  });

  it("בלי אף אחד מהם — אין Session", () => {
    expect(sessionTokenOf(request({}))).toBeNull();
    expect(sessionTokenOf(request({ cookie: "" }))).toBeNull();
    expect(sessionTokenOf({ cookies: undefined, headers: {} })).toBeNull();
  });

  it("הכותרת קודמת לעוגייה כשיש שתיהן", () => {
    const other = "B".repeat(43);
    expect(sessionTokenOf(request({ cookie: TOKEN, authorization: `Bearer ${other}` }))).toBe(
      other,
    );
  });

  it("כותרת שאינה טוקן שלנו נופלת לעוגייה, ולא נשלחת למסד", () => {
    expect(sessionTokenOf(request({ authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
    expect(sessionTokenOf(request({ authorization: "Bearer short" }))).toBeNull();
    expect(sessionTokenOf(request({ authorization: `Bearer ${TOKEN}.` }))).toBeNull();
    expect(sessionTokenOf(request({ authorization: "Bearer x", cookie: TOKEN }))).toBe(TOKEN);
  });
});
