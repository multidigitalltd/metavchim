import { describe, expect, it, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { MOBILE_GOOGLE_RETURN_URL } from "@metavchim/shared";
import type { Request, Response } from "express";

vi.mock("../../config/env", () => ({
  loadEnv: () => ({ WEB_ORIGIN: "https://app.test", COOKIE_SECURE: true }),
}));

import { AuthController } from "./auth.controller";

/**
 * ‎**החזרה מ-Google לאפליקציה לנייד — קוד, לא עוגייה.**
 *
 * ‏אותו סבב OAuth משרת את הדפדפן ואת האפליקציה, ונבדל רק בסיום:
 * ‏לדפדפן עוגיית Session והפניה למסך, לאפליקציה הפניה לסכימה שלה עם
 * ‏קוד חד-פעמי. הבדיקות כאן נועלות את ההבדל הזה — שסיום לנייד אינו
 * ‏מנפיק Session ואינו כותב עוגייה, ושהמרת הקוד היא מה שמנפיק אותו.
 */

const USER = {
  id: "U",
  tenantId: "T",
  name: "n",
  email: "agent@office.test",
  role: "agent",
  mustChangePassword: false,
  passwordChangedAt: new Date(0),
};

function controllerWith(over: {
  identity?: { email: string; emailVerified: boolean };
  loginError?: Error;
}) {
  const issueSession = vi.fn(async () => ({
    token: "T".repeat(43),
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    user: USER,
  }));
  const handoff = {
    issueGoogle: vi.fn(async () => "C".repeat(43)),
    redeemGoogle: vi.fn(async () => USER.id),
    issueWebSession: vi.fn(async () => "W".repeat(43)),
    redeemWebSession: vi.fn(async () => "T".repeat(43)),
  };
  const auth = {
    issueSession,
    loginWithVerifiedEmail: vi.fn(async () => {
      if (over.loginError) throw over.loginError;
      return USER;
    }),
    getUserForSession: vi.fn(async () => USER),
    sessionExpiry: vi.fn(async () => new Date("2030-01-01T00:00:00Z")),
  };
  const google = {
    authorizationUrl: vi.fn(async () => "https://accounts.google.test/auth"),
    exchangeCode: vi.fn(async () => over.identity ?? { email: USER.email, emailVerified: true }),
  };
  const controller = new AuthController(
    auth as never,
    {} as never,
    {} as never,
    {} as never,
    google as never,
    handoff as never,
    { createFromVerifiedIdentity: vi.fn(async () => null) } as never,
  );
  return { controller, auth, handoff, google };
}

function response() {
  const res = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    redirect: vi.fn(),
  };
  return res as unknown as Response & typeof res;
}

function request(over: {
  query?: Record<string, string>;
  cookies?: Record<string, string>;
  bearer?: string;
}): Request {
  return {
    query: over.query ?? {},
    cookies: over.cookies ?? {},
    ip: "10.0.0.1",
    headers: {
      "user-agent": "metavchim-mobile",
      ...(over.bearer ? { authorization: `Bearer ${over.bearer}` } : {}),
    },
  } as unknown as Request;
}

describe("google/start", () => {
  it("client=mobile נרשם כמקטע רביעי בעוגייה; בלי — רק state ו-nonce", async () => {
    const { controller } = controllerWith({});
    const res = response();
    await controller.googleStart(request({ query: { client: "mobile" } }), res);
    const value = (res.cookie.mock.calls[0] as [string, string])[1];
    expect(value.split(".")).toHaveLength(4);
    expect(value.endsWith("..mobile")).toBe(true);

    const web = response();
    await controller.googleStart(request({}), web);
    expect((web.cookie.mock.calls[0] as [string, string])[1].split(".")).toHaveLength(2);
  });
});

describe("google/callback לנייד", () => {
  const cookies = { mv_oauth: "S.N..mobile" };

  it("מפנה לסכימה של האפליקציה עם קוד — בלי Session ובלי עוגייה", async () => {
    const { controller, auth, handoff } = controllerWith({});
    const res = response();
    await controller.googleCallback(request({ query: { code: "g", state: "S" }, cookies }), res);
    expect(handoff.issueGoogle).toHaveBeenCalledWith(USER.id);
    expect(res.redirect).toHaveBeenCalledWith(`${MOBILE_GOOGLE_RETURN_URL}?code=${"C".repeat(43)}`);
    expect(auth.issueSession).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("כישלון חוזר לאפליקציה עם אותה סיבה כמו ב-web", async () => {
    const unknown = controllerWith({
      loginError: new UnauthorizedException("החשבון לא קיים במערכת — פנו למנהל המשרד"),
    });
    const res = response();
    await unknown.controller.googleCallback(request({ query: { code: "g", state: "S" }, cookies }), res);
    expect(res.redirect).toHaveBeenCalledWith(`${MOBILE_GOOGLE_RETURN_URL}?error=unknown`);

    const unverified = controllerWith({ identity: { email: USER.email, emailVerified: false } });
    const res2 = response();
    await unverified.controller.googleCallback(request({ query: { code: "g", state: "S" }, cookies }), res2);
    expect(res2.redirect).toHaveBeenCalledWith(`${MOBILE_GOOGLE_RETURN_URL}?error=unverified`);

    const badState = controllerWith({});
    const res3 = response();
    await badState.controller.googleCallback(request({ query: { code: "g", state: "X" }, cookies }), res3);
    expect(res3.redirect).toHaveBeenCalledWith(`${MOBILE_GOOGLE_RETURN_URL}?error=failed`);
  });

  it("הדפדפן לא השתנה: עוגייה והפניה למסך", async () => {
    const { controller, auth } = controllerWith({});
    const res = response();
    await controller.googleCallback(
      request({ query: { code: "g", state: "S" }, cookies: { mv_oauth: "S.N" } }),
      res,
    );
    expect(auth.issueSession).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith("mv_session", "T".repeat(43), expect.anything());
    expect(res.redirect).toHaveBeenCalledWith("https://app.test/");
  });
});

describe("google/exchange", () => {
  it("ממיר את הקוד ל-Session בגוף — עם הכתובת מאומתת מחדש מול החשבון", async () => {
    const { controller, auth, handoff } = controllerWith({});
    const result = await controller.googleExchange(
      { code: "C".repeat(43), persistent: true },
      request({}),
    );
    expect(handoff.redeemGoogle).toHaveBeenCalledWith("C".repeat(43));
    expect(auth.getUserForSession).toHaveBeenCalledWith(USER.id);
    /* ‏Session של האפליקציה — וגם הבקשה ל-Session מתמשך (מכשיר נעול) עוברת הלאה */
    expect(auth.issueSession).toHaveBeenCalledWith(USER, {
      ip: "10.0.0.1",
      userAgent: "metavchim-mobile",
      client: "mobile",
      persistent: true,
    });
    expect(result).toEqual({
      user: USER,
      session: { token: "T".repeat(43), expiresAt: "2030-01-01T00:00:00.000Z" },
    });
  });

  it("קוד שפג או שכבר נוצל — 401, ובלי Session", async () => {
    const { controller, auth, handoff } = controllerWith({});
    handoff.redeemGoogle.mockRejectedValueOnce(new UnauthorizedException("פג"));
    await expect(controller.googleExchange({ code: "C".repeat(43) }, request({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(auth.issueSession).not.toHaveBeenCalled();
  });
});

describe("web-session — ה-Session של האפליקציה אל הדפדפן המוטמע", () => {
  it("הקוד נולד מהטוקן של הבקשה, ולא ממשהו אחר", async () => {
    const { controller, handoff } = controllerWith({});
    const result = await controller.webSession(request({ bearer: "T".repeat(43) }));
    expect(handoff.issueWebSession).toHaveBeenCalledWith("T".repeat(43));
    expect(result).toEqual({ code: "W".repeat(43), webOrigin: "https://app.test" });
  });

  it("הנחיתה שמה את אותו טוקן בעוגייה, מסמנת embedded, ומפנה לנתיב", async () => {
    const { controller, auth } = controllerWith({});
    const res = response();
    await controller.webSessionLanding("W".repeat(43), request({ query: { next: "/settings" } }), res);
    expect(auth.issueSession).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith("mv_session", "T".repeat(43), expect.anything());
    expect(res.cookie).toHaveBeenCalledWith("mv_embedded", "1", expect.objectContaining({ httpOnly: false }));
    expect(res.redirect).toHaveBeenCalledWith("https://app.test/settings");
  });

  it("נתיב חיצוני או כפול-לוכסן נופל ללוח הבקרה", async () => {
    for (const next of ["//evil.example", "https://evil.example/x", "settings", ""]) {
      const { controller } = controllerWith({});
      const res = response();
      await controller.webSessionLanding("W".repeat(43), request({ query: { next } }), res);
      expect(res.redirect).toHaveBeenCalledWith("https://app.test/");
    }
  });

  it("קוד שפג, קוד בצורה לא נכונה, או Session שכבר אינו קיים — למסך ההתחברות, בלי עוגייה", async () => {
    const expired = controllerWith({});
    expired.handoff.redeemWebSession.mockRejectedValueOnce(new UnauthorizedException("פג"));
    const res = response();
    await expired.controller.webSessionLanding("W".repeat(43), request({}), res);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("https://app.test/login");

    const malformed = controllerWith({});
    const res2 = response();
    await malformed.controller.webSessionLanding("short", request({}), res2);
    expect(malformed.handoff.redeemWebSession).not.toHaveBeenCalled();
    expect(res2.redirect).toHaveBeenCalledWith("https://app.test/login");

    const gone = controllerWith({});
    gone.auth.sessionExpiry.mockResolvedValueOnce(null);
    const res3 = response();
    await gone.controller.webSessionLanding("W".repeat(43), request({}), res3);
    expect(res3.cookie).not.toHaveBeenCalled();
    expect(res3.redirect).toHaveBeenCalledWith("https://app.test/login");
  });
});
