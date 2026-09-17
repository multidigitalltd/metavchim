import { useEffect, useRef } from "react";
import { I18nManager, StyleSheet } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
import { routeForPushUrl } from "@/lib/push";
import { ErrorState } from "@/components";
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
 * ‏עד שידוע (הטוקן נקרא מהאחסון המאובטח) מסך הפתיחה נשאר, ולא מסך
 * ‏התחברות שמהבהב לרגע אצל מי שכבר מחובר.
 *
 * ‏סיסמה זמנית — חובה להחליף לפני כל פעולה אחרת, כמו ב-web: השרת
 * ‏מסמן `mustChangePassword` ואינו חוסם נתיבים עסקיים בעצמו, ולכן
 * ‏השומר כאן הוא מה שמונע עבודה עם סיסמה שמנהל המשרד הקליד
 * ‏(ביקורת Codex).
 */
function Gate() {
  const { user, offline, refresh } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inLogin = segments[0] === "login";
  const inChangePassword = segments[0] === "change-password";

  useEffect(() => {
    if (user === undefined) {
      if (offline) void SplashScreen.hideAsync();
      return;
    }
    void SplashScreen.hideAsync();
    if (user === null) {
      if (!inLogin) router.replace("/login");
    } else if (user.mustChangePassword) {
      if (!inChangePassword) router.replace("/change-password");
    } else if (inLogin || inChangePassword) {
      router.replace("/(tabs)/today");
    }
  }, [user, offline, inLogin, inChangePassword, router]);

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

  // ‏טוקן שמור והשרת לא ענה — לא מסך התחברות, אלא ניסיון חוזר
  if (user === undefined && offline) {
    return (
      <SafeAreaView style={styles.offline}>
        <ErrorState message="אין חיבור לשרת — בדקו את הרשת" onRetry={() => void refresh()} />
      </SafeAreaView>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        headerBackTitle: "חזרה",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen
        name="change-password"
        options={{ title: "החלפת סיסמה", headerBackVisible: false, gestureEnabled: false }}
      />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ title: "התראות" }} />
      <Stack.Screen name="leads/new" options={{ title: "ליד חדש" }} />
      <Stack.Screen name="tasks/new" options={{ title: "משימה חדשה" }} />
      <Stack.Screen name="leads/[id]" options={{ title: "ליד" }} />
      <Stack.Screen name="properties/[id]" options={{ title: "נכס" }} />
      <Stack.Screen name="buyers/[id]" options={{ title: "לקוח" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  offline: { flex: 1, justifyContent: "center", backgroundColor: colors.bg },
});
