import { useState } from "react";
import { Alert, Linking, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { ROLE_LABELS, type UserRole } from "@metavchim/shared";
import { useAuth } from "@/lib/auth";
import type { PushStatus } from "@/lib/push";
import { Button, Card, Chips, Row, Screen, Text } from "@/components";
import { THEME_LABELS, useTheme, type ThemeChoice } from "@/lib/theme";
import { space } from "@/theme";

/** ‏הקומיט שממנו נבנה הקובץ — נצרב ב-workflow; ריק בבנייה מקומית. */
const BUILD_SHA = process.env.EXPO_PUBLIC_BUILD_SHA ?? "";

const THEME_OPTIONS: readonly { key: ThemeChoice; label: string }[] = (
  ["light", "dark", "auto"] as const
).map((key) => ({ key, label: THEME_LABELS[key] }));

const PUSH_TEXT: Record<PushStatus, string> = {
  registered:
    "פועלות במכשיר הזה — ליד חדש, פגישה ומשימה מגיעים גם כשהאפליקציה סגורה.",
  undetermined: "עדיין לא הופעלו במכשיר הזה.",
  denied: "ההרשאה נחסמה. אפשר לפתוח אותה מחדש בהגדרות המכשיר.",
  unsupported:
    "אינן זמינות בסביבה הזו (סימולטור, Expo Go, או בנייה בלי מזהה פרויקט).",
};

/**
 * ‏„האפליקציה” — מה ששייך למכשיר הזה: מי מחובר, התראות הפוש, הפרופיל
 * ‏(במערכת), התנתקות והגרסה. שאר ההגדרות הן של המשרד ויושבות
 * ‏ב„ניהול משרד” בתפריט.
 */
export default function AppSettingsScreen() {
  const { user, logout, pushStatus, enablePush } = useAuth();
  const router = useRouter();
  const { choice, setChoice } = useTheme();
  const [pushBusy, setPushBusy] = useState(false);

  async function turnOnPush() {
    setPushBusy(true);
    try {
      const status = await enablePush();
      if (status === "denied") {
        Alert.alert("ההרשאה נחסמה", "יש לאפשר התראות בהגדרות המכשיר.", [
          { text: "ביטול", style: "cancel" },
          { text: "להגדרות", onPress: () => void Linking.openSettings() },
        ]);
      }
    } catch {
      Alert.alert("ההתראות לא הופעלו", "נסו שוב כשיש חיבור לשרת.");
    } finally {
      setPushBusy(false);
    }
  }

  function confirmLogout() {
    Alert.alert("להתנתק?", "החיבור מהמכשיר הזה יימחק גם בשרת.", [
      { text: "ביטול", style: "cancel" },
      { text: "התנתקות", style: "destructive", onPress: () => void logout() },
    ]);
  }

  const role = user?.role as UserRole | undefined;
  const roleLabel = role === undefined ? null : (ROLE_LABELS[role] ?? role);

  return (
    <Screen title="האפליקציה">
      <Card>
        <Text variant="title">{user?.name ?? ""}</Text>
        <Text variant="muted">{user?.email ?? ""}</Text>
        <Text variant="muted">
          {[user?.tenantName, roleLabel].filter(Boolean).join(" · ")}
        </Text>
      </Card>

      <Row
        title="הפרופיל שלי"
        subtitle="שם, טלפון, סיסמה, ערכת נושא ונגישות"
        chevron
        onPress={() => router.push("/web/profile")}
      />
      <Row
        title="התראות"
        subtitle="מה קרה מאז שהיית כאן"
        chevron
        onPress={() => router.push("/notifications")}
      />
      <Row
        title="החיבורים הפתוחים שלי"
        subtitle="המכשירים שמחוברים לחשבון"
        chevron
        onPress={() => router.push("/web/profile")}
      />

      <Card>
        <Text variant="title">ערכת נושא</Text>
        <Text variant="muted">
          בהיר, כהה, או לפי מצב הלילה של המכשיר — גם במסכי המערכת שבתוך
          האפליקציה.
        </Text>
        <Chips options={THEME_OPTIONS} value={choice} onChange={setChoice} />
      </Card>

      <Card>
        <Text variant="title">התראות פוש</Text>
        <Text variant="muted">
          {pushStatus === null ? "בודק…" : PUSH_TEXT[pushStatus]}
        </Text>
        {pushStatus === "undetermined" ? (
          <Button
            title="הפעלת התראות"
            kind="secondary"
            busy={pushBusy}
            onPress={() => void turnOnPush()}
          />
        ) : null}
        {pushStatus === "denied" ? (
          <Button
            title="פתיחת הגדרות המכשיר"
            kind="ghost"
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
      </Card>

      <Button
        title="התנתקות"
        kind="danger"
        onPress={confirmLogout}
        style={styles.logout}
      />

      <Text variant="small" style={styles.meta}>
        מתווכים · גרסה {Constants.expoConfig?.version ?? "?"}
        {BUILD_SHA ? ` (${BUILD_SHA.slice(0, 7)})` : ""}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logout: { marginTop: space.lg },
  meta: { textAlign: "center", marginTop: space.md },
});
