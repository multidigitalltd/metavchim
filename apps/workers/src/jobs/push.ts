import webpush from "web-push";
import {
  pushOutcome,
  pushPayload,
  shouldPush,
  chunkExpoPush,
  expoPushMessage,
  expoPushOutcome,
  type ExpoPushMessage,
  type ExpoPushTicket,
  redactNotification,
  type NotificationViewer,
  shouldRetireAfterFailure,
  type Capability,
} from "@metavchim/shared";
import { prisma } from "../runtime.js";
import {
  capabilitiesByUser,
  notificationAnchorSubjects,
  visibleContactIdSet,
} from "./whatsapp-notify.js";

/* ==================== התראות פוש בדפדפן ==================== */

/**
 * סורק ההתראות שטרם נדחפו.
 *
 * למה סורק ולא שליחה בכל מקום שיוצר התראה: שורות `notifications`
 * נכתבות מתריסר מקומות שונים בקובץ הזה וב-API, וכל מקום חדש היה
 * צריך לזכור גם לדחוף. סורק על `pushed_at IS NULL` מכסה את כולם —
 * גם את מי שייכתב בעתיד — והוא אידמפוטנטי מטבעו: סריקה שנפלה
 * באמצע פשוט תרים את מה שנשאר בפעם הבאה.
 *
 * הסימון `pushed_at` נכתב **גם** להתראה שאין לה נמענים ולזו שסוננה
 * ע"י `shouldPush`. אחרת כל סריקה הייתה שולפת אותן מחדש לנצח.
 */
const PUSH_BATCH = 100;
/** לא מנסים לדחוף התראה ישנה — פוש שמגיע יום אחרי האירוע הוא רעש. */
const PUSH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

let pushConfigured: boolean | null = null;

function configurePush(): boolean {
  if (pushConfigured !== null) return pushConfigured;
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"];
  pushConfigured = Boolean(publicKey && privateKey && subject);
  if (pushConfigured) {
    webpush.setVapidDetails(
      subject as string,
      publicKey as string,
      privateKey as string,
    );
  }
  return pushConfigured;
}

/**
 * ‏שליחה ל-Expo Push — אצווה אחת, כרטיס תשובה לכל הודעה באותו סדר.
 *
 * ‏כשל HTTP של הבקשה כולה (רשת, 5xx) מוחזר ככרטיסי `retry` לכולן:
 * ‏אין מידע על אף טוקן, ומחיקה על סמך תקלה של Expo הייתה משתיקה
 * ‏מכשירים תקינים. אין תצורה: השירות אינו דורש מפתח לשליחה.
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

async function sendExpoPushBatch(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const retryAll = (): ExpoPushTicket[] =>
    messages.map(() => ({ status: "error", message: "expo push request failed" }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return retryAll();
    const body = (await res.json()) as { data?: ExpoPushTicket[] };
    if (!Array.isArray(body.data) || body.data.length !== messages.length) return retryAll();
    return body.data;
  } catch {
    return retryAll();
  }
}

export async function processPushSweep(): Promise<void> {
  /*
   * ‏שני ערוצים באותה סריקה: הדפדפן (VAPID — כבוי בלי מפתחות) והנייד
   * ‏(Expo — בלי תצורה). הסריקה רצה כל עוד אחד מהם יכול לשלוח, ומסמנת
   * ‏`pushed_at` רק כשניגשה בפועל להתראות של המשרד.
   */
  const webPushConfigured = configurePush();
  const since = new Date(Date.now() - PUSH_MAX_AGE_MS);
  const tenants = await prisma.tenant.findMany({ select: { id: true } });

  for (const tenant of tenants) {
    // השליחה עצמה יוצאת החוצה לרשת ולכן אינה יושבת בתוך טרנזקציה:
    // עשרות בקשות HTTP בתוך טרנזקציה אחת היו מחזיקות חיבור DB פתוח
    // לשניות ארוכות. קוראים בטרנזקציה, שולחים מחוצה לה, מסמנים בשנייה.
    const pending = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.notification.findMany({
        where: {
          tenantId: tenant.id,
          pushedAt: null,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "asc" },
        take: PUSH_BATCH,
        select: {
          id: true,
          userId: true,
          type: true,
          title: true,
          body: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
      });
    });
    if (pending.length === 0) continue;

    const { subscriptions, devices } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return {
        subscriptions: webPushConfigured
          ? await tx.pushSubscription.findMany({ where: { tenantId: tenant.id } })
          : [],
        devices: await tx.devicePushToken.findMany({ where: { tenantId: tenant.id } }),
      };
    });
    // אין למי לשלוח בשום ערוץ — ההתראות נשארות לא-מסומנות, למקרה
    // שהמפתחות יוגדרו או שמכשיר יירשם בדקות הקרובות
    if (!webPushConfigured && devices.length === 0) continue;

    type Recipients = { web: typeof subscriptions; devices: typeof devices };
    const byUser = new Map<string, Recipients>();
    const recipientsOf = (userId: string): Recipients => {
      const existing = byUser.get(userId);
      if (existing) return existing;
      const fresh: Recipients = { web: [], devices: [] };
      byUser.set(userId, fresh);
      return fresh;
    };
    for (const sub of subscriptions) recipientsOf(sub.userId).web.push(sub);
    for (const device of devices) recipientsOf(device.userId).devices.push(device);

    const retire: string[] = [];
    const bumpFailure: string[] = [];
    const succeeded: string[] = [];
    /* ‏הודעות הנייד נאספות ונשלחות באצוות אחרי הלולאה — ראו למטה */
    const expoQueue: { deviceId: string; message: ExpoPushMessage }[] = [];

    /*
     * ‎**והדחיפה לדפדפן היא הערוץ השלישי** (ביקורת Codex, P1, על
     * ‏סבב הוואטסאפ — ואותו כשל בדיוק כאן).
     *
     * ‏הלולאה רצה על ההתראות, ושורה משרדית נדחפה ל**כל** המנויים
     * ‏במשרד עם הכותרת והגוף הגולמיים. עכשיו היא רצה על הנמענים,
     * ‏כי הצנזורה היא פר-אדם: אותה שורה נראית אחרת לסוכן שהלקוח
     * ‏שלו ולסוכן שהוסתר ממנו.
     *
     * ‏הניתוב לא השתנה — התראה אישית לנמען שלה, ומשרדית לכולם —
     * ‏רק סדר הלולאות והצנזורה שביניהן.
     */
    const tenantRow = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { blockedModules: true },
    });
    const pushUsers = await prisma.user.findMany({
      where: { tenantId: tenant.id, id: { in: [...byUser.keys()] } },
      select: { id: true, role: true },
    });
    const pushCaps = await capabilitiesByUser(
      tenant.id,
      pushUsers,
      tenantRow?.blockedModules ?? [],
      new Date(),
    );
    const pushSubjects = await notificationAnchorSubjects(tenant.id, pending);

    for (const [userId, recipients] of byUser) {
      const subs = recipients.web;
      const caps = pushCaps.get(userId) ?? new Set<Capability>();
      /*
       * ‏המונה על אייקון האפליקציה — כמה התראות שלא נקראו יש לנמען הזה
       * ‏(שלו ושל המשרד), כולל אלה שנדחפות עכשיו: הן כבר במסד. נספר
       * ‏פעם אחת לנמען ולא להודעה; iOS מציג את המספר האחרון שהגיע.
       */
      const badge =
        recipients.devices.length === 0
          ? undefined
          : await prisma.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
              return tx.notification.count({
                where: { tenantId: tenant.id, OR: [{ userId: null }, { userId }], readAt: null },
              });
            });
      const viewer: NotificationViewer = {
        allowed: await visibleContactIdSet(tenant.id, userId, caps),
        userId,
        capabilities: caps,
      };
      for (const raw of pending) {
        if (!shouldPush(raw)) continue;
        // התראה משרדית (userId ריק) הולכת לכל מי שנרשם במשרד
        if (raw.userId && raw.userId !== userId) continue;
        const notification = redactNotification(raw, viewer, pushSubjects);
        const message = pushPayload(notification);
        const payload = JSON.stringify(message);

        for (const device of recipients.devices) {
          expoQueue.push({
            deviceId: device.id,
            message: expoPushMessage(device.token, message, badge),
          });
        }

        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              payload,
            );
            succeeded.push(sub.id);
          } catch (error: unknown) {
            const status =
              typeof error === "object" && error !== null && "statusCode" in error
                ? Number((error as { statusCode: unknown }).statusCode)
                : 0;
            const outcome = pushOutcome(status);
            if (
              outcome === "retire" ||
              shouldRetireAfterFailure(sub.failureCount + 1)
            ) {
              retire.push(sub.id);
            } else if (outcome !== "delivered") {
              bumpFailure.push(sub.id);
            }
          }
        }
      }
    }

    /*
     * ‏הנייד — באצוות של 100, כפי ש-Expo מקבל. הטוקן מסווג לפי
     * ‏הכרטיס שלו (`expoPushOutcome`), עם אותה תקרת כישלונות רצופים
     * ‏כמו בדפדפן. אותו מכשיר יכול להופיע בכמה הודעות; מחיקה גוברת
     * ‏על הצלחה, כי `DeviceNotRegistered` אינו מצב שחולף.
     */
    const deviceSucceeded = new Set<string>();
    const deviceFailed = new Set<string>();
    const deviceRetire = new Set<string>();
    const failuresById = new Map(devices.map((d) => [d.id, d.failureCount]));
    for (const batch of chunkExpoPush(expoQueue)) {
      const tickets = await sendExpoPushBatch(batch.map((item) => item.message));
      batch.forEach((item, index) => {
        const ticket = tickets[index];
        const outcome = ticket ? expoPushOutcome(ticket) : "retry";
        if (outcome === "delivered") {
          deviceSucceeded.add(item.deviceId);
        } else if (
          outcome === "retire" ||
          shouldRetireAfterFailure((failuresById.get(item.deviceId) ?? 0) + 1)
        ) {
          deviceRetire.add(item.deviceId);
        } else {
          deviceFailed.add(item.deviceId);
        }
      });
    }
    for (const id of deviceRetire) {
      deviceSucceeded.delete(id);
      deviceFailed.delete(id);
    }
    for (const id of deviceSucceeded) deviceFailed.delete(id);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      // כולן מסומנות, גם המסוננות — אחרת הן יישלפו שוב בכל סריקה
      await tx.notification.updateMany({
        where: { tenantId: tenant.id, id: { in: pending.map((n) => n.id) } },
        data: { pushedAt: new Date() },
      });
      if (deviceSucceeded.size > 0) {
        await tx.devicePushToken.updateMany({
          where: { tenantId: tenant.id, id: { in: [...deviceSucceeded] } },
          data: { failureCount: 0, lastSuccessAt: new Date() },
        });
      }
      if (deviceFailed.size > 0) {
        await tx.devicePushToken.updateMany({
          where: { tenantId: tenant.id, id: { in: [...deviceFailed] } },
          data: { failureCount: { increment: 1 } },
        });
      }
      if (deviceRetire.size > 0) {
        await tx.devicePushToken.deleteMany({
          where: { tenantId: tenant.id, id: { in: [...deviceRetire] } },
        });
      }
      if (succeeded.length > 0) {
        await tx.pushSubscription.updateMany({
          where: { tenantId: tenant.id, id: { in: succeeded } },
          data: { failureCount: 0, lastSuccessAt: new Date() },
        });
      }
      if (bumpFailure.length > 0) {
        await tx.pushSubscription.updateMany({
          where: { tenantId: tenant.id, id: { in: bumpFailure } },
          data: { failureCount: { increment: 1 } },
        });
      }
      if (retire.length > 0) {
        await tx.pushSubscription.deleteMany({
          where: { tenantId: tenant.id, id: { in: retire } },
        });
      }
    });
  }
}
