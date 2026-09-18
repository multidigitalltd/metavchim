import { useState } from "react";
import { Alert, Linking, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { ROLE_LABELS, type UserRole } from "@metavchim/shared";
import { useAuth } from "@/lib/auth";
import { apiOrigin } from "@/lib/config";
import type { PushStatus } from "@/lib/push";
import { Button, Card, Row, Screen, Text } from "@/components";
import { space } from "@/theme";

const PUSH_TEXT: Record<PushStatus, string> = {
  registered: "פועלות במכשיר הזה — ליד חדש, פגישה ומשימה מגיעים גם כשהאפליקציה סגורה.",
  undetermined: "עדיין לא הופעלו במכשיר הזה.",
  denied: "ההרשאה נחסמה. אפשר לפתוח אותה מחדש בהגדרות המכשיר.",
  unsupported: "אינן זמינות בסביבה הזו (סימולטור, Expo Go, או בנייה בלי מזהה פרויקט).",
};

/** ‏„עוד” — מי מחובר, התראות, והתנתקות. ההגדרות עצמן נשארות ב-web. */
export default function MoreScreen() {
  const { user, logout, pushStatus, enablePush } = useAuth();
  const router = useRouter();
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
    <Screen title="עוד">
      <Card>
        <Text variant="title">{user?.name ?? ""}</Text>
        <Text variant="muted">{user?.email ?? ""}</Text>
        <Text variant="muted">{[user?.tenantName, roleLabel].filter(Boolean).join(" · ")}</Text>
      </Card>

      <Card>
        <Text variant="title">התראות פוש</Text>
        <Text variant="muted">{pushStatus === null ? "בודק…" : PUSH_TEXT[pushStatus]}</Text>
        {pushStatus === "undetermined" ? (
          <Button title="הפעלת התראות" kind="secondary" busy={pushBusy} onPress={() => void turnOnPush()} />
        ) : null}
        {pushStatus === "denied" ? (
          <Button title="פתיחת הגדרות המכשיר" kind="ghost" onPress={() => void Linking.openSettings()} />
        ) : null}
      </Card>

      <Row
        title="התראות"
        subtitle="מה קרה מאז שהיית כאן"
        onPress={() => router.push("/notifications")}
      />
      <Row title="הגדרות, הרשאות ואינטגרציות" subtitle="נעשות מהמחשב — במערכת המלאה" />

      <Button title="התנתקות" kind="danger" onPress={confirmLogout} style={styles.logout} />

      <Text variant="small" style={styles.meta}>
        גרסה {Constants.expoConfig?.version ?? "?"} · שרת {apiOrigin() || "לא הוגדר"}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logout: { marginTop: space.lg },
  meta: { textAlign: "center", marginTop: space.md },
});
