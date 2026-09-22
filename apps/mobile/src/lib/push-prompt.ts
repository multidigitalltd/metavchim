import { Alert, Linking } from "react-native";
import type { PushStatus } from "./push";

/**
 * ‏בקשת ההרשאה להתראות מתוך לחיצה — אותה שיחה מכל מסך שמציע אותה
 * ‏(„היום”, „האפליקציה”): סירוב מוביל להגדרות המכשיר, כישלון רשת
 * ‏נאמר במילים, וכלום אינו נופל בשקט.
 */
export async function askForPush(enablePush: () => Promise<PushStatus>): Promise<void> {
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
  }
}
