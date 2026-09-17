import { Alert, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { ROLE_LABELS, type UserRole } from "@metavchim/shared";
import { useAuth } from "@/lib/auth";
import { API_ORIGIN } from "@/lib/config";
import { Button, Card, Row, Screen, Text } from "@/components";
import { space } from "@/theme";

/** ‏„עוד” — מי מחובר, התראות, והתנתקות. ההגדרות עצמן נשארות ב-web. */
export default function MoreScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();

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

      <Row
        title="התראות"
        subtitle="מה קרה מאז שהיית כאן"
        onPress={() => router.push("/notifications")}
      />
      <Row title="הגדרות, הרשאות ואינטגרציות" subtitle="נעשות מהמחשב — במערכת המלאה" />

      <Button title="התנתקות" kind="danger" onPress={confirmLogout} style={styles.logout} />

      <Text variant="small" style={styles.meta}>
        גרסה {Constants.expoConfig?.version ?? "?"} · שרת {API_ORIGIN || "לא הוגדר"}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logout: { marginTop: space.lg },
  meta: { textAlign: "center", marginTop: space.md },
});
