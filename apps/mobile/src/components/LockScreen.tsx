import { Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppLock } from "@/lib/app-lock";
import { useAuth } from "@/lib/auth";
import { makeStyles } from "@/lib/theme";
import { chrome, space } from "@/theme";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { Text } from "./Text";

/**
 * ‏מסך הנעילה — מעל כל מסך, עד שהמכשיר מאמת. `Modal` ולא View מוחלט:
 * ‏המגירה היא Modal נייטיבי שיושב מעל כל View רגיל, ומגירה שנשארה
 * ‏פתוחה ברקע הייתה מציגה את שם המשרד והתפריט מעל הנעילה (ביקורת
 * ‏Codex). Modal שנפתח אחרון יושב למעלה — וכפתור „חזרה” באנדרואיד
 * ‏אינו סוגר אותו. הדיאלוג של המערכת נפתח
 * ‏מעצמו; הכפתור כאן למי שביטל אותו. „התנתקות” נשארת זמינה: מי שאינו
 * ‏מצליח לאמת (אצבע חבושה, מכשיר שהחליף ידיים) יכול לצאת ולהיכנס
 * ‏בסיסמה במקום להיתקע.
 */
export function LockScreen() {
  const styles = useStyles();
  const { unlock, authenticating } = useAppLock();
  const { logout } = useAuth();
  return (
    <Modal visible animationType="none" statusBarTranslucent onRequestClose={() => undefined}>
      <SafeAreaView style={styles.root} accessibilityViewIsModal>
        <View style={styles.body}>
          <Logo size={40} wordmark={34} />
          <Text style={styles.text}>האפליקציה נעולה</Text>
          <Text style={styles.muted}>אימות בטביעת אצבע, פנים או קוד המכשיר.</Text>
          <Button
            title="פתיחה"
            onPress={() => void unlock()}
            busy={authenticating}
            style={styles.button}
          />
          <Button title="התנתקות" kind="text" onPress={() => void logout()} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = makeStyles(() => ({
  root: { flex: 1, backgroundColor: chrome.sidebarBg },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    padding: space.xl,
  },
  text: { color: "#ffffff", fontSize: 20, marginTop: space.lg },
  muted: { color: chrome.sidebarFg, textAlign: "center" },
  button: { marginTop: space.md, minWidth: 200 },
}));
