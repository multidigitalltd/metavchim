import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { apiGet } from "./api";
import { useAuth } from "./auth";
import type { NavSummary } from "./nav";
import { syncBadge } from "./push";

/**
 * ‏מצב המעטפת — המגירה, מוני הניווט והפעמון — משותף לכל המסכים.
 *
 * ‏הסיכום (`/nav/summary`) והלא-נקראות מתרעננים כל דקה, בכל פתיחה
 * ‏של המגירה, בכל חזרה של האפליקציה לחזית ובכל התראה שמגיעה בזמן
 * ‏שהיא פתוחה: פעולה במסך אחד (קליטת ליד) צריכה להשתקף בתג כשעוברים
 * ‏הלאה, בלי Polling צפוף. כישלון אינו מאפס תג שכבר הוצג.
 *
 * ‏הלא-נקראות הן גם המונה על אייקון האפליקציה (`syncBadge`): מה
 * ‏שהפעמון מראה בפנים, האייקון מראה בחוץ — ואפס כשמתנתקים.
 */
interface ShellState {
  drawerOpen: boolean;
  openDrawer(): void;
  closeDrawer(): void;
  summary: NavSummary | null;
  unread: number;
  refreshCounts(): void;
  hasFeature(code: string): boolean;
}

const ShellContext = createContext<ShellState | null>(null);

const REFRESH_MS = 60_000;

export function ShellProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [summary, setSummary] = useState<NavSummary | null>(null);
  const [unread, setUnread] = useState(0);
  const ready = user !== null && user !== undefined && !user.mustChangePassword && user.billingOnly !== true;

  const refreshCounts = useCallback(() => {
    if (!ready) return;
    apiGet<NavSummary>("/nav/summary")
      .then(setSummary)
      .catch(() => undefined);
    apiGet<{ unreadCount: number }>("/notifications?limit=1")
      .then((r) => {
        setUnread(r.unreadCount);
        syncBadge(r.unreadCount);
      })
      .catch(() => undefined);
  }, [ready]);

  useEffect(() => {
    if (!ready) {
      setSummary(null);
      setUnread(0);
      syncBadge(0);
      return;
    }
    refreshCounts();
    const timer = setInterval(refreshCounts, REFRESH_MS);
    // ‏חזרה לחזית — המונים מתרעננים מיד, לא בדקה הבאה
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshCounts();
    });
    // ‏התראה שהגיעה בזמן שהאפליקציה פתוחה — הפעמון והאייקון מתעדכנים מיד
    const received = Notifications.addNotificationReceivedListener(() => refreshCounts());
    return () => {
      clearInterval(timer);
      appState.remove();
      received.remove();
    };
  }, [ready, refreshCounts]);

  const openDrawer = useCallback(() => {
    refreshCounts();
    setDrawerOpen(true);
  }, [refreshCounts]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const value = useMemo<ShellState>(
    () => ({
      drawerOpen,
      openDrawer,
      closeDrawer,
      summary,
      unread,
      refreshCounts,
      // ‏כל עוד הסיכום לא נטען — כן: כפתור שנעלם ונחזר על רשת איטית גרוע מכפתור שייתכן וייחסם
      hasFeature: (code) => summary?.features === undefined || summary.features.includes(code),
    }),
    [drawerOpen, openDrawer, closeDrawer, summary, unread, refreshCounts],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (ctx === null) throw new Error("useShell מחוץ ל-ShellProvider");
  return ctx;
}
