/*
 * Service Worker — קיים אך ורק בשביל התראות הפוש.
 *
 * במכוון אין כאן שום מטמון (cache): המערכת מוגשת מאחורי Caddy/nginx,
 * ו-Service Worker שמטמין נכסים הוא בדיוק המנגנון שגורם למשתמש לראות
 * גרסה ישנה אחרי עדכון — תקלה שכבר עלתה כאן פעם. פוש בלבד, כלום מעבר.
 */

self.addEventListener("install", () => {
  // הגרסה החדשה נכנסת לתוקף מיד ולא ממתינה לסגירת כל הלשוניות
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // מטען שאינו JSON — עדיין מציגים משהו במקום לבלוע את ההתראה
    payload = { title: "מתווכים", body: event.data.text(), url: "/", tag: "generic" };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "מתווכים", {
      body: payload.body || "",
      // ה-tag מאחד התראות על אותה ישות במקום לערום אותן
      tag: payload.tag || "generic",
      icon: "/icon.svg",
      badge: "/icon.svg",
      dir: "rtl",
      lang: "he",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // לשונית פתוחה של המערכת — מנווטים בה במקום לפתוח עוד אחת.
      // בלי זה כל לחיצה על התראה מוסיפה חלון, ואחרי יום עבודה
      // למתווך יש עשרים לשוניות של אותה מערכת.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
