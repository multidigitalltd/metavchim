import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { useAuth } from "./auth";
import { deviceSecured } from "./device-lock";

/**
 * ‏נעילת האפליקציה — טביעת אצבע, פנים או קוד המכשיר בפתיחה.
 *
 * ‏ההתחברות המתמשכת (30 יום במכשיר נעול) סומכת על נעילת המכשיר. מי
 * ‏שמוסר את הטלפון פתוח לרגע — לילד, ללקוח שרוצה לראות תמונה — רוצה
 * ‏שכבה נוספת לפני לקוחות המשרד. זו אותה נעילה שהמכשיר כבר מכיר,
 * ‏ולכן אין כאן סיסמה שנייה לזכור: המערכת של המכשיר מאמתת, והאפליקציה
 * ‏רק שואלת.
 *
 * ‏מתי נועלים: בכל הפעלה קרה, ובחזרה לחזית אחרי יותר מדקה ברקע —
 * ‏פחות מזה הוא „עניתי לשיחה”, לא „הנחתי את הטלפון”. ההעדפה נשמרת
 * ‏במכשיר (`mv-app-lock`), ואפשר להפעיל אותה רק במכשיר שיש בו נעילה:
 * ‏בלי נעילה אין למי להאמין.
 */

export const APP_LOCK_KEY = "mv-app-lock";
/** ‏כמה זמן ברקע לפני שנועלים שוב. */
export const LOCK_AFTER_MS = 60_000;

interface AppLockState {
  /** ‏ההעדפה; `null` עד שנקראה מהאחסון. */
  enabled: boolean | null;
  /** ‏המסך נעול עכשיו — המעטפת מציגה את מסך הנעילה מעל הכול. */
  locked: boolean;
  /** ‏ניסיון אימות רץ (הדיאלוג של המערכת פתוח). */
  authenticating: boolean;
  /**
   * ‏הפעלה או כיבוי. ההפעלה דורשת מכשיר נעול ואימות אחד מוצלח —
   * ‏כדי שמי שמפעיל יודע שהוא יכול לפתוח. מחזירה האם ההעדפה השתנתה.
   */
  setEnabled(next: boolean): Promise<boolean>;
  /** ‏פתיחה — מציג את דיאלוג האימות של המכשיר. */
  unlock(): Promise<void>;
}

const AppLockContext = createContext<AppLockState | null>(null);

async function authenticate(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "פתיחת מתווכים",
      cancelLabel: "ביטול",
      // ‏קוד המכשיר הוא חלופה לגיטימית — טביעת אצבע רטובה אינה נעילה מהחשבון
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

export function AppLockProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(false);
  /*
   * ‏נעילה בהפעלה קרה בלבד: מי שהרגע הפעיל את המתג (ואימת לשם כך) או
   * ‏הרגע התחבר בסיסמה אינו צריך לאמת שוב באותו רגע. הדגל נדלק כשההעדפה
   * ‏נקראת מהאחסון כ„מופעל”, ונכבה אחרי הנעילה הראשונה.
   */
  const [lockOnStart, setLockOnStart] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const signedIn = user !== null && user !== undefined;

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(APP_LOCK_KEY)
      .then((stored) => {
        if (cancelled) return;
        setEnabledState(stored === "1");
        if (stored === "1") setLockOnStart(true);
      })
      .catch(() => {
        if (!cancelled) setEnabledState(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ‏הפעלה קרה עם נעילה מופעלת ומשתמש מחובר — נעול עד אימות
  useEffect(() => {
    if (lockOnStart && signedIn) {
      setLocked(true);
      setLockOnStart(false);
    }
    if (!signedIn) setLocked(false);
  }, [lockOnStart, signedIn]);

  useEffect(() => {
    if (enabled !== true) return;
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background") {
        backgroundAt.current = Date.now();
        return;
      }
      if (state === "active" && backgroundAt.current !== null) {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (away >= LOCK_AFTER_MS && signedIn) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled, signedIn]);

  const unlock = useCallback(async () => {
    if (authenticating) return;
    /*
     * ‏מכשיר שהנעילה הוסרה ממנו בינתיים — אין למי להאמין, והנעילה
     * ‏מתבטלת במקום לנעול את הבעלים בחוץ. הסרת נעילה מהמכשיר דורשת
     * ‏את הנעילה עצמה, ולכן זה אינו עוקף.
     */
    if (!(await deviceSecured())) {
      await AsyncStorage.removeItem(APP_LOCK_KEY).catch(() => undefined);
      setEnabledState(false);
      setLocked(false);
      return;
    }
    setAuthenticating(true);
    try {
      if (await authenticate()) setLocked(false);
    } finally {
      setAuthenticating(false);
    }
  }, [authenticating]);

  // ‏כשננעל — הדיאלוג נפתח מעצמו; „נסו שוב” במסך הנעילה למי שביטל
  const lockedRef = useRef(false);
  useEffect(() => {
    if (locked && !lockedRef.current) void unlock();
    lockedRef.current = locked;
  }, [locked, unlock]);

  const setEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    if (next) {
      if (!(await deviceSecured())) return false;
      if (!(await authenticate())) return false;
      await AsyncStorage.setItem(APP_LOCK_KEY, "1").catch(() => undefined);
      setEnabledState(true);
      return true;
    }
    await AsyncStorage.removeItem(APP_LOCK_KEY).catch(() => undefined);
    setEnabledState(false);
    setLocked(false);
    return true;
  }, []);

  const value = useMemo<AppLockState>(
    () => ({ enabled, locked, authenticating, setEnabled, unlock }),
    [enabled, locked, authenticating, setEnabled, unlock],
  );
  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockState {
  const ctx = useContext(AppLockContext);
  if (ctx === null) throw new Error("useAppLock מחוץ ל-AppLockProvider");
  return ctx;
}
