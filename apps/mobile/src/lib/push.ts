import { routeFor } from "./nav";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { isExpoPushToken } from "@metavchim/shared";
import { apiPost } from "./api";

/**
 * ‏התראות פוש לנייד — הרישום מול Expo ומול השרת.
 *
 * ‏שלושה תנאים חייבים להתקיים, וכל אחד מהם מדווח בנפרד כדי שהמסך
 * ‏יאמר *למה* אין התראות ולא „לא זמין”: מכשיר אמיתי (לא סימולטור,
 * ‏ולא Expo Go — שם פוש מרוחק אינו נתמך עוד), מזהה פרויקט EAS
 * ‏בתצורה, והרשאה מהמשתמש.
 */

export type PushStatus =
  /** ‏רשום בשרת, הטוקן שמור במכשיר */
  | "registered"
  /** ‏עדיין לא נשאל — מציעים כפתור, לא שואלים מעצמנו */
  | "undetermined"
  /** ‏המשתמש סירב — הפתיחה מחדש רק מהגדרות המכשיר */
  | "denied"
  /** ‏סימולטור, Expo Go, או בנייה בלי מזהה פרויקט */
  | "unsupported";

/** ‏הטוקן שנרשם — כדי להסיר אותו מהשרת בהתנתקות. אינו סוד, אבל אין סיבה שיהיה נגיש. */
const TOKEN_KEY = "mv_device_push_token";

/*
 * ‏איך מוצגת התראה כשהאפליקציה פתוחה. ברירת המחדל של המערכת היא
 * ‏להסתיר, וליד חדש שמגיע בזמן שהמתווך בכרטיס אחר הוא בדיוק מה
 * ‏שצריך להיראות.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? undefined;
}

/** ‏ערוץ ברירת המחדל באנדרואיד — בלעדיו ההתראה אינה מוצגת מ-Android 8. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "התראות",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
  });
}

async function storedToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

function supported(): boolean {
  return Device.isDevice && projectId() !== undefined;
}

/** ‏המצב הנוכחי, בלי לשאול את המשתמש דבר. */
export async function readPushStatus(): Promise<PushStatus> {
  if (!supported()) return "unsupported";
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "denied") return "denied";
  if (status !== "granted") return "undetermined";
  return (await storedToken()) === null ? "undetermined" : "registered";
}

/**
 * ‏רישום. `prompt: false` — רק אם ההרשאה כבר ניתנה (בפתיחת האפליקציה);
 * ‏`prompt: true` — מתוך לחיצה של המשתמש, ואז מותר לשאול.
 */
export async function registerDevicePush(options: { prompt: boolean }): Promise<PushStatus> {
  if (!supported()) return "unsupported";
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    if (!options.prompt) return status === "denied" ? "denied" : "undetermined";
    status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return status === "denied" ? "denied" : "undetermined";
  }
  await ensureAndroidChannel();
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
  } catch {
    return "unsupported";
  }
  if (!isExpoPushToken(token)) return "unsupported";
  await apiPost("/notifications/push/device", {
    token,
    platform: Platform.OS === "ios" ? "ios" : "android",
    deviceName: [Device.manufacturer, Device.modelName].filter(Boolean).join(" ").slice(0, 120),
  });
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // בלי האחסון ההסרה בהתנתקות תדלג — הטוקן ייפסל בשרת לפי כישלונות
  }
  return "registered";
}

/** ‏הסרה מהשרת ומהמכשיר — לפני התנתקות. כישלון רשת אינו חוסם את ההתנתקות. */
export async function unregisterDevicePush(): Promise<void> {
  const token = await storedToken();
  if (token === null) return;
  await apiPost("/notifications/push/device/remove", { token }).catch(() => undefined);
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // אין מה למחוק
  }
}

/**
 * ‏לאן מובילה לחיצה על התראה. ה-`url` הוא נתיב של ה-web
 * ‏(`notificationUrl` ב-shared); רק המסכים שקיימים כאן נפתחים לפי
 * ‏הנתיב, והשאר נוחתים ברשימת ההתראות — לעולם לא על מסך שאינו קיים.
 */
export function routeForPushUrl(url: unknown): string {
  if (typeof url !== "string" || !url.startsWith("/")) return "/notifications";
  // ‏מסך נייטיבי כשיש, ואחרת אותו מסך של ה-web מוטמע — אין „אין מסך כזה”
  return routeFor(url);
}
