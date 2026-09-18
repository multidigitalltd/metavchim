import { useEffect, useRef } from "react";
import { I18nManager, StyleSheet } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
import { FONT_ASSETS } from "@/lib/fonts";
import { routeForPushUrl } from "@/lib/push";
import { ShellProvider } from "@/lib/shell";
import { Drawer, ErrorState } from "@/components";
import { colors } from "@/theme";

/*
 * ‏עברית היא השפה היחידה של המערכת, ולכן הפריסה ימין-לשמאל תמיד —
 * ‏גם במכשיר שהשפה שלו אנגלית. `forceRTL` נכנס לתוקף בהפעלה הבאה של
 * ‏האפליקציה; בבניית ייצור `extra.supportsRTL` ב-`app.json` קובע זאת
 * ‏כבר בהתקנה, וזו רק רשת ביטחון לפיתוח.
 */
I18nManager.allowRTL(true);
if (!I18nManager.isRTL) I18nManager.forceRTL(true);

void SplashScreen.preventAutoHideAsync();

/**
 * ‏שומר הכניסה: בלי Session — מסך ההתחברות; עם Session — האפליקציה.
 * ‏עד שידוע (הטוקן נקרא מהאחסון המאובטח, והגופן נטען) מסך הפתיחה
 * ‏נשאר, ולא מסך התחברות שמהבהב לרגע אצל מי שכבר מחובר.
 *
 * ‏סיסמה זמנית — חובה להחליף לפני כל פעולה אחרת, כמו ב-web: השרת
 * ‏מסמן `mustChangePassword` ואינו חוסם נתיבים עסקיים בעצמו, ולכן
 * ‏השומר כאן הוא מה שמונע עבודה עם סיסמה שמנהל המשרד הקליד.
 *
 * ‏משרד שתקופתו נגמרה (`billingOnly`) נשלח ישירות למסך המנוי — ה-web
 * ‏המוטמע, כמו ב-web: כל מסך אחר היה מחזיר 402.
 */
function Gate({ fontsReady }: { fontsReady: boolean }) {
  const { user, offline, refresh } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inAuth =
    segments[0] === "login" || segments[0] === "auth" || segments[0] === "forgot-password";
  const inChangePassword = segments[0] === "change-password";
  const path = (segments as readonly string[]).join("/");
  const inBilling = path.startsWith("web/settings/billing");

  useEffect(() => {
    if (!fontsReady) return;
    if (user === undefined) {
      if (offline) void SplashScreen.hideAsync();
      return;
    }
    void SplashScreen.hideAsync();
    if (user === null) {
      if (!inAuth) router.replace("/login");
    } else if (user.mustChangePassword) {
      if (!inChangePassword) router.replace("/change-password");
    } else if (user.billingOnly === true) {
      if (!inBilling) router.replace("/web/settings/billing");
    } else if (inAuth || inChangePassword) {
      // ‏מסך הבית — הדשבורד של המערכת, כמו ב-web
      router.replace("/web/home");
    }
  }, [fontsReady, user, offline, inAuth, inChangePassword, inBilling, router]);

  /*
   * ‏לחיצה על התראה — גם כשהאפליקציה הייתה סגורה (הפעלה קרה). הניווט
   * ‏ממתין לזהות: לפני שידוע שיש Session, המסך היה נפתח ומיד מוחלף
   * ‏במסך ההתחברות. כל תגובה מטופלת פעם אחת.
   */
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || !user || user.mustChangePassword) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    router.push(routeForPushUrl(response.notification.request.content.data?.["url"]));
  }, [response, user, router]);

  if (!fontsReady) return null;

  // ‏טוקן שמור והשרת לא ענה — לא מסך התחברות, אלא ניסיון חוזר
  if (user === undefined && offline) {
    return (
      <SafeAreaView style={styles.offline}>
        <ErrorState message="אין חיבור לשרת — בדקו את הרשת" onRetry={() => void refresh()} />
      </SafeAreaView>
    );
  }

  /*
   * ‏כל הכותרות הן של המסכים עצמם (`Screen` → `TopBar`, כמו `.mv-topbar`
   * ‏ב-web) — הכותרת הנייטיבית של הניווט כבויה בכל מקום.
   */
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      <Drawer />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontsError] = useFonts(FONT_ASSETS);
  // ‏גופן שלא נטען אינו עוצר את האפליקציה — גופן המערכת במקומו
  const fontsReady = fontsLoaded || fontsError !== null;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ShellProvider>
          <StatusBar style="dark" />
          <Gate fontsReady={fontsReady} />
        </ShellProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  offline: { flex: 1, backgroundColor: colors.bg, justifyContent: "center" },
});
