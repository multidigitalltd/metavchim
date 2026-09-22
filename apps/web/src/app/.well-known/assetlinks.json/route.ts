/**
 * ‏Android App Links — „הקישורים של app.metavchim.co.il שייכים לאפליקציה”.
 *
 * ‏אנדרואיד פותח קישור `https://app.metavchim.co.il/leads/…` ישירות
 * ‏באפליקציה (בלי דיאלוג „לפתוח ב…”) רק אם הדומיין מאשר זאת כאן:
 * ‏שם החבילה וטביעת האצבע (SHA-256) של מפתח החתימה של ה-APK. הטביעה
 * ‏תלויה במפתח — של EAS בחנות, של ה-CI ב-APK הבדיקה — ולכן היא משתנה
 * ‏סביבה (`ANDROID_APP_LINKS_SHA256`, פסיקים בין כמה), לא קוד. בלי
 * ‏המשתנה התשובה היא רשימה ריקה: הקישורים ממשיכים להיפתח בדפדפן,
 * ‏כמו היום, ושום דבר לא נשבר.
 *
 * ‏Route ולא קובץ ב-`public/`: קובץ סטטי היה נצרב בבנייה, וטביעת
 * ‏האצבע ידועה רק בהתקנה.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PACKAGE = "co.il.metavchim.app";
const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/u;

export function GET(): NextResponse {
  const fingerprints = (process.env["ANDROID_APP_LINKS_SHA256"] ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => FINGERPRINT.test(value));
  const body =
    fingerprints.length === 0
      ? []
      : [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: PACKAGE,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ];
  return NextResponse.json(body, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
