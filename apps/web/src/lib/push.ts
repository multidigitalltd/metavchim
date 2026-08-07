"use client";

import { apiGet, apiPost } from "@/lib/api";

/**
 * הרשמה להתראות פוש בדפדפן.
 *
 * שלושה תנאים חייבים להתקיים ואף אחד מהם אינו מובן מאליו: הדפדפן
 * תומך (Safari רק מ-16.4 ורק כשהאתר הותקן למסך הבית), השרת הוגדר
 * עם מפתחות VAPID, והמשתמש אישר את ההרשאה. כל אחד מהם מדווח בנפרד
 * כדי שהמסך יגיד *למה* אי אפשר, ולא "לא זמין".
 */

export type PushSupport = "ready" | "unsupported" | "not-configured";

export interface PushState {
  support: PushSupport;
  permission: NotificationPermission;
  subscribed: boolean;
}

function browserSupportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * המפתח הציבורי מגיע כ-base64url וצריך להיגיש כ-ArrayBuffer.
 * הבאפר נבנה במפורש (ולא `Uint8Array` שנשען על ArrayBufferLike),
 * כי `applicationServerKey` דורש ArrayBuffer ולא זיכרון משותף.
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const normalized = padded.replace(/-/gu, "+").replace(/_/gu, "/");
  const raw = window.atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function readPushState(): Promise<PushState> {
  if (!browserSupportsPush()) {
    return { support: "unsupported", permission: "denied", subscribed: false };
  }
  const key = await apiGet<{ enabled: boolean; publicKey: string | null }>(
    "/notifications/push/key",
  ).catch(() => ({ enabled: false, publicKey: null }));
  if (!key.enabled) {
    return { support: "not-configured", permission: Notification.permission, subscribed: false };
  }
  // המנוי נקרא מהדפדפן ולא מהשרת: המקור האמין למצב *הדפדפן הזה*
  // הוא הדפדפן. שורה בשרת יכולה להיות של מכשיר אחר של אותו משתמש.
  const existing = await registration()
    .then((reg) => reg.pushManager.getSubscription())
    .catch(() => null);
  return {
    support: "ready",
    permission: Notification.permission,
    subscribed: existing !== null,
  };
}

/**
 * הפעלה. מחזירה הודעת שגיאה בעברית או null בהצלחה.
 *
 * חשוב: `Notification.requestPermission` חייב להיקרא מתוך אינטראקציה
 * של המשתמש (לחיצה), אחרת דפדפנים דוחים אותו בשקט.
 */
export async function enablePush(): Promise<string | null> {
  if (!browserSupportsPush()) return "הדפדפן הזה אינו תומך בהתראות";

  const key = await apiGet<{ enabled: boolean; publicKey: string | null }>(
    "/notifications/push/key",
  ).catch(() => ({ enabled: false, publicKey: null }));
  if (!key.enabled || !key.publicKey) return "התראות הפוש אינן מוגדרות בשרת";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied"
      ? "ההרשאה נחסמה בדפדפן — יש לאפשר התראות בהגדרות האתר"
      : "ההרשאה לא אושרה";
  }

  try {
    const reg = await registration();
    // מנוי קיים משמש כמו שהוא; יצירה חוזרת הייתה מנפיקה endpoint חדש
    // ומשאירה את הקודם תלוי באוויר
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        // חובה בכל הדפדפנים: לא מנפיקים מנוי שקט שאפשר לעקוב איתו
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(key.publicKey),
      }));

    const json = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      return "הדפדפן החזיר מנוי חסר — נסו שוב";
    }

    await apiPost("/notifications/push/subscribe", {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 300),
    });
    return null;
  } catch {
    return "ההרשמה להתראות נכשלה";
  }
}

/** כיבוי — גם בדפדפן וגם בשרת, אחרת השרת ימשיך לשלוח לכתובת מתה. */
export async function disablePush(): Promise<void> {
  if (!browserSupportsPush()) return;
  const reg = await registration().catch(() => null);
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await apiPost("/notifications/push/unsubscribe", { endpoint }).catch(() => undefined);
}
