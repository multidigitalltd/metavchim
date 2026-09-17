import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import type { Capability } from "@metavchim/shared";
import { ApiError, apiGet, apiPost, setUnauthorizedListener } from "./api";
import { clearSessionToken, readSessionToken, writeSessionToken } from "./session-store";

/** ‏אותו DTO כמו `AuthUser` ב-web — התשובה של `GET /auth/me`. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
  tenantName?: string;
  isPlatformAdmin?: boolean;
  capabilities?: string[];
  trialEndsAt?: string | null;
  billingOnly?: boolean;
}

/**
 * ‏האם למשתמש יש את היכולת בפועל — מהרשימה שהשרת החזיר, ולא מהתפקיד.
 * ‏בלי משתמש ובלי רשימה התשובה שלילית (ראו `use-auth.ts` ב-web).
 */
export function can(user: AuthUser | null | undefined, capability: Capability): boolean {
  return user?.capabilities?.includes(capability) ?? false;
}

type LoginOutcome = { kind: "ok" } | { kind: "otp"; otpToken: string };

interface AuthState {
  /** ‏`undefined` — עדיין לא ידוע (הטוקן נקרא מהאחסון); `null` — לא מחובר. */
  user: AuthUser | null | undefined;
  login(email: string, password: string): Promise<LoginOutcome>;
  verifyOtp(otpToken: string, code: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse {
  user: AuthUser;
  session?: { token: string; expiresAt: string };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const token = await readSessionToken();
    if (token === null) {
      setUser(null);
      return;
    }
    try {
      const { user: me } = await apiGet<{ user: AuthUser }>("/auth/me");
      setUser(me);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await clearSessionToken();
        setUser(null);
        return;
      }
      /*
       * ‏תקלת רשת אינה „לא מחובר”: הטוקן עדיין תקף, והאפליקציה נפתחת
       * ‏ברכבת בלי קליטה. משאירים את מה שידוע ונותנים למסכים להציג את
       * ‏שגיאת הטעינה שלהם.
       */
      setUser((current) => current ?? null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedListener(() => {
      void clearSessionToken().then(() => setUser(null));
    });
    return () => setUnauthorizedListener(null);
  }, []);

  const adopt = useCallback(async (response: LoginResponse) => {
    if (!response.session) {
      throw new ApiError(502, "השרת לא החזיר Session לאפליקציה — יש לעדכן את השרת");
    }
    await writeSessionToken(response.session.token);
    setUser(response.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const result = await apiPost<LoginResponse | { otpRequired: true; otpToken: string }>(
        "/auth/login",
        { email, password, client: "mobile" },
      );
      if ("otpRequired" in result) return { kind: "otp", otpToken: result.otpToken };
      await adopt(result);
      return { kind: "ok" };
    },
    [adopt],
  );

  const verifyOtp = useCallback(
    async (otpToken: string, code: string) => {
      const result = await apiPost<LoginResponse>("/auth/login/verify", {
        otpToken,
        code,
        client: "mobile",
      });
      await adopt(result);
    },
    [adopt],
  );

  const logout = useCallback(async () => {
    // הניתוק בשרת הוא הדבר החשוב: טוקן שנמחק רק מהמכשיר ממשיך לחיות
    // עד התפוגה. אם השרת לא נגיש — המכשיר נמחק בכל מקרה.
    await apiPost("/auth/logout", {}).catch(() => undefined);
    await clearSessionToken();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, login, verifyOtp, logout, refresh }),
    [user, login, verifyOtp, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth מחוץ ל-AuthProvider");
  return ctx;
}
