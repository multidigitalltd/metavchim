import { useEffect } from "react";
import { I18nManager } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
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
 */
function Gate() {
  const { user } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inLogin = segments[0] === "login";

  useEffect(() => {
    if (user === undefined) return;
    void SplashScreen.hideAsync();
    if (user === null && !inLogin) router.replace("/login");
    else if (user !== null && inLogin) router.replace("/(tabs)/today");
  }, [user, inLogin, router]);

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
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ title: "התראות" }} />
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
