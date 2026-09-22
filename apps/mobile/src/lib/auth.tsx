import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import type { Capability } from "@metavchim/shared";
import { ApiError, apiGet, apiPost, setUnauthorizedListener } from "./api";
import { clearCacheScope, clearLastCacheScope, setCacheScope } from "./cache";
import { loadApiOrigin } from "./config";
import { deviceSecured } from "./device-lock";
import { redeemOnce } from "./google-login";
import {
  readPushStatus,
  registerDevicePush,
  unregisterDevicePush,
  type PushStatus,
} from "./push";
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
  /**
   * ‏יש טוקן שמור, אבל השרת לא ענה — לא „לא מחובר”. המעטפת מציגה
   * ‏מסך „אין חיבור” עם ניסיון חוזר, ולא את מסך ההתחברות: מי שנכנס
   * ‏ברכבת בלי קליטה אינו צריך להקליד סיסמה מחדש (ביקורת Codex).
   */
  offline: boolean;
  login(email: string, password: string): Promise<LoginOutcome>;
  verifyOtp(otpToken: string, code: string): Promise<void>;
  /**
   * ‏המרת הקוד שחזר מ-Google (ראו `lib/google-login`) ל-Session.
   * ‏חד-פעמי לכל קוד — קריאה חוזרת מקבלת את אותה תוצאה.
   */
  loginWithGoogle(code: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  /**
   * ‏החלפת סיסמה. השרת מבטל את שאר החיבורים, וגם החיבור הזה נפסל
   * ‏(עידן הסיסמה שלו ישן מהסיסמה החדשה) — ולכן בסיום מתנתקים
   * ‏מקומית ומתחברים מחדש עם הסיסמה החדשה, כמו ב-web.
   */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** ‏מצב התראות הפוש של המכשיר הזה; `null` עד שנבדק. */
  pushStatus: PushStatus | null;
  /** ‏הפעלה מתוך לחיצה — כאן מותר לבקש את ההרשאה מהמשתמש. */
  enablePush(): Promise<PushStatus>;
  /**
   * ‏למה המשתמש במסך ההתחברות: `"expired"` — ה-Session פג או נותק
   * ‏ממכשיר אחר (מסך ההתחברות אומר זאת, במקום להיראות כאילו
   * ‏האפליקציה „שכחה”); `null` — התנתקות יזומה או הפעלה ראשונה.
   */
  signedOutReason: "expired" | null;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse {
  user: AuthUser;
  session?: { token: string; expiresAt: string };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [signedOutReason, setSignedOutReason] = useState<"expired" | null>(null);

  // מרחב המטמון הוא המשתמש: בלי זהות אין מטמון, ומשתמש אחר — מרחב אחר
  useEffect(() => {
    setCacheScope(user?.id ?? null);
  }, [user?.id]);

  const refresh = useCallback(async () => {
    // כתובת השרת שנשמרה במכשיר — לפני הבקשה הראשונה
    await loadApiOrigin();
    const token = await readSessionToken();
    if (token === null) {
      setOffline(false);
      setUser(null);
      return;
    }
    try {
      const { user: me } = await apiGet<{ user: AuthUser }>("/auth/me");
      setOffline(false);
      setUser(me);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // ‏Session שפג — גם המטמון של מי שהחזיק אותו יורד מהמכשיר
        await clearSessionToken();
        await clearLastCacheScope();
        setOffline(false);
        setSignedOutReason("expired");
        setUser(null);
        return;
      }
      /*
       * ‏תקלת רשת אינה „לא מחובר”: הטוקן עדיין תקף. כשהזהות כבר
       * ‏ידועה — המסכים מציגים את שגיאת הטעינה שלהם; כשעדיין לא —
       * ‏המעטפת מציגה „אין חיבור” וניסיון חוזר, ולא מסך התחברות.
       */
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * ‏רישום שקט אחרי התחברות: אם ההרשאה כבר ניתנה — הטוקן נרשם מחדש
   * ‏בשרת (הוא יכול להתחלף בין התקנות). לא שואלים כאן: השאלה באה
   * ‏מכפתור, כשהמשתמש מבין למה.
   */
  const ready = user !== null && user !== undefined && !user.mustChangePassword;
  useEffect(() => {
    if (!ready) {
      setPushStatus(null);
      return;
    }
    let cancelled = false;
    registerDevicePush({ prompt: false })
      .catch(() => readPushStatus())
      .then((status) => {
        if (!cancelled) setPushStatus(status);
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const enablePush = useCallback(async (): Promise<PushStatus> => {
    const status = await registerDevicePush({ prompt: true });
    setPushStatus(status);
    return status;
  }, []);

  useEffect(() => {
    setUnauthorizedListener(() => {
      // ‏ניתוק ממכשיר אחר או תפוגה באמצע עבודה — הטוקן והמטמון יורדים יחד
      void clearSessionToken()
        .then(() => clearLastCacheScope())
        .then(() => {
          setSignedOutReason("expired");
          setUser(null);
        });
    });
    return () => setUnauthorizedListener(null);
  }, []);

  /*
   * ‏הזהות שנשמרת היא של `/auth/me`, לא של תשובת ההתחברות: זו נושאת
   * ‏את המשתמש הבסיסי בלבד, בלי `capabilities` ו-`billingOnly`, ואיתה
   * ‏כל `can()` היה עונה „לא” עד ההפעלה הבאה (ביקורת Codex). אם
   * ‏המשיכה נכשלת ברשת — הטוקן כבר שמור, ומסך „אין חיבור” מנסה שוב.
   */
  const adopt = useCallback(
    async (response: LoginResponse) => {
      if (!response.session) {
        throw new ApiError(502, "השרת לא החזיר Session לאפליקציה — יש לעדכן את השרת");
      }
      await writeSessionToken(response.session.token);
      setSignedOutReason(null);
      await refresh();
    },
    [refresh],
  );

  /*
   * ‏`persistent` — בקשה ל-Session של 30 יום שמתגלגל בפעילות, במקום
   * ‏12 שעות: רק כשהמכשיר עצמו נעול (ראו `lib/device-lock`). ההחלטה
   * ‏נשלחת עם כל דרך התחברות, והשרת מכבד אותה רק מהאפליקציה.
   */
  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const result = await apiPost<LoginResponse | { otpRequired: true; otpToken: string }>(
        "/auth/login",
        { email, password, client: "mobile", persistent: await deviceSecured() },
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
        persistent: await deviceSecured(),
      });
      await adopt(result);
    },
    [adopt],
  );

  const loginWithGoogle = useCallback(
    (code: string) =>
      redeemOnce(code, async () => {
        const result = await apiPost<LoginResponse>("/auth/google/exchange", {
          code,
          persistent: await deviceSecured(),
        });
        await adopt(result);
      }),
    [adopt],
  );

  const logout = useCallback(async () => {
    // המכשיר יוצא מרשימת הפוש לפני שה-Session נסגר — אחרת ההסרה
    // כבר אינה מורשית, והמכשיר ממשיך לקבל התראות של חשבון שהתנתק
    await unregisterDevicePush();
    // הניתוק בשרת הוא הדבר החשוב: טוקן שנמחק רק מהמכשיר ממשיך לחיות
    // עד התפוגה. אם השרת לא נגיש — המכשיר נמחק בכל מקרה.
    await apiPost("/auth/logout", {}).catch(() => undefined);
    await clearSessionToken();
    // נתוני המשרד לא נשארים על מכשיר שהתנתק ממנו
    const leaving = user?.id;
    if (leaving) await clearCacheScope(leaving);
    setSignedOutReason(null);
    setUser(null);
  }, [user?.id]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await apiPost("/auth/change-password", { currentPassword, newPassword });
    await unregisterDevicePush();
    await clearSessionToken();
    const leaving = user?.id;
    if (leaving) await clearCacheScope(leaving);
    setUser(null);
  }, [user?.id]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      offline,
      login,
      verifyOtp,
      loginWithGoogle,
      logout,
      refresh,
      changePassword,
      pushStatus,
      enablePush,
      signedOutReason,
    }),
    [user, offline, login, verifyOtp, loginWithGoogle, logout, refresh, changePassword, pushStatus, enablePush, signedOutReason],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth מחוץ ל-AuthProvider");
  return ctx;
}
