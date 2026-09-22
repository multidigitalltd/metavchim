import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { notificationUrl } from "@metavchim/shared";
import { apiGet, apiList } from "./api";
import { loadApiOrigin } from "./config";
import type { NotificationRow } from "./dtos";
import { syncBadge } from "./push";
import { readSessionToken } from "./session-store";

/**
 * ‏התראות מבחוץ **בלי שירות פוש** — סריקה ברקע.
 *
 * ‏פוש אמיתי לאנדרואיד עובר דרך Firebase (FCM), וזה חשבון שרק בעל
 * ‏המשרד יכול לפתוח. עד שהוא קיים — וכגיבוי גם אחריו במכשיר שהפוש
 * ‏אינו זמין בו — האפליקציה שואלת את השרת בעצמה: משימת רקע של מערכת
 * ‏ההפעלה (WorkManager / BGTaskScheduler) שרצה כל רבע שעה לערך, מושכת
 * ‏את ההתראות האחרונות, מציגה **התראה מקומית** לכל התראה חדשה שלא
 * ‏נקראה, ומיישרת את המונה על האייקון. ההתראה נראית ומתנהגת בדיוק
 * ‏כמו פוש (כותרת, גוף, לחיצה שפותחת את הישות) — רק שהיא מגיעה
 * ‏באיחור של עד רבע שעה, כפי שמערכת ההפעלה מרשה לאפליקציה ברקע.
 *
 * ‏מה **לא** קורה כאן: אין כפילות עם פוש אמיתי — כשהמכשיר רשום לפוש
 * ‏(`pushStatus === "registered"`) המשימה אינה נרשמת. בהפעלה
 * ‏הראשונה לא נורית מקבץ של התראות ישנות: נרשם „עד לכאן”, ורק מה
 * ‏שיגיע אחרי זה מוצג. הפוקוס של המשימה הוא קצר: בקשה אחת, לכל היותר
 * ‏חמש התראות, ויציאה.
 *
 * ‏המשימה מוגדרת ברמת המודול (חובה ב-TaskManager: הקוד רץ גם כשאין
 * ‏React ואין מסך), ולכן המודול הזה מיובא מ-`_layout.tsx`.
 */

export const NOTIFY_TASK = "mv-notifications-poll";
/** ‏`createdAt` של ההתראה החדשה ביותר שכבר הוצגה (או שנרשמה כ„נראתה”). */
const THROUGH_KEY = "mv-notified-through";
/** ‏WorkManager אינו מריץ תכוף מזה; 15 הוא המינימום של אנדרואיד. */
const INTERVAL_MINUTES = 15;
const MAX_PER_RUN = 5;

interface Page {
  items: NotificationRow[];
  unreadCount: number;
}

async function pollOnce(): Promise<void> {
  const token = await readSessionToken();
  if (token === null) return;
  await loadApiOrigin();
  const page = await apiGet<Page>("/notifications?limit=20");
  const items = apiList(page.items, "items");
  const through = await AsyncStorage.getItem(THROUGH_KEY).catch(() => null);
  const newest = items[0]?.createdAt ?? null;
  if (through !== null) {
    const fresh = items
      .filter((n) => !n.readAt && n.createdAt > through)
      .slice(0, MAX_PER_RUN)
      .reverse();
    for (const n of fresh) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: n.title,
          body: n.body ?? "",
          data: {
            url: notificationUrl({
              type: n.type,
              title: n.title,
              body: n.body ?? null,
              entityType: n.entityType ?? null,
              entityId: n.entityId ?? null,
            }),
            tag: n.entityId ? `${n.type}:${n.entityId}` : n.type,
          },
          sound: "default",
        },
        trigger: null,
      });
    }
  }
  if (newest !== null) await AsyncStorage.setItem(THROUGH_KEY, newest).catch(() => undefined);
  syncBadge(page.unreadCount);
}

TaskManager.defineTask(NOTIFY_TASK, async () => {
  try {
    await pollOnce();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * ‏רישום — אחרי התחברות, כשאין פוש אמיתי. „עד לכאן” נרשם עכשיו, כדי
 * ‏שההרצה הראשונה לא תציג את מה שכבר נראה במסך ההתראות.
 */
export async function startNotificationPolling(): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(THROUGH_KEY);
    if (existing === null) {
      await AsyncStorage.setItem(THROUGH_KEY, new Date().toISOString());
    }
    await BackgroundTask.registerTaskAsync(NOTIFY_TASK, { minimumInterval: INTERVAL_MINUTES });
  } catch {
    // ‏סימולטור או מערכת שאינה מריצה משימות רקע — בלי גיבוי, בלי קריסה
  }
}

/** ‏הסרה — בהתנתקות, או כשהפוש האמיתי נרשם. */
export async function stopNotificationPolling(options: { forget: boolean }): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(NOTIFY_TASK)) {
      await BackgroundTask.unregisterTaskAsync(NOTIFY_TASK);
    }
  } catch {
    // ‏לא רשום — אין מה להסיר
  }
  if (options.forget) await AsyncStorage.removeItem(THROUGH_KEY).catch(() => undefined);
}
