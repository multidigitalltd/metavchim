import { StreamableFile } from "@nestjs/common";
import type { Request, Response } from "express";
import type { StoredObject } from "../core/storage.service";

/**
 * ‏הגשת אובייקט מהאחסון **שעשוי להשתכתב במקום** — תמונת נכס אחרי
 * ‏טשטוש או שיפור.
 *
 * ## ‏למה לא `max-age`
 *
 * ‏עד היום תמונת נכס נשמרה במטמון הדפדפן לשעה: הקובץ מאחורי הכתובת
 * ‏מעולם לא השתנה. מרגע שטשטוש כותב בייטים חדשים תחת אותו מפתח,
 * ‏שעה של מטמון היא שעה שבה הקונה שכבר פתח את דף ההצעה ממשיך
 * ‏לראות את הפנים שטושטשו (ביקורת Codex). חותמת בכתובת פותרת רק
 * ‏את הכתובות שאנחנו מרכיבים; דף נחיתה, הצעה ומודעה ברשת נושאים
 * ‏כתובות יציבות.
 *
 * ‏לכן: `no-cache` (לשמור, אבל לשאול בכל פעם) עם `ETag` של האחסון,
 * ‏ו-304 כשלא השתנה. העלות: בקשה מותנית אחת לתמונה במקום אפס;
 * ‏הרווח: תמונה שטושטשה נעלמת מכל מקום ברגע הטעינה הבאה.
 *
 * ‎`Cross-Origin-Resource-Policy: same-site` — `helmet()` קובע
 * ‎`same-origin`, והדפדפן חוסם `<img>` מפורט אחר של אותו אתר עוד
 * ‏לפני ה-CSP; אותה הכרעה כמו בתמונות הרשת.
 */
export function objectResponse(
  req: Request,
  res: Response,
  obj: StoredObject,
  scope: "private" | "public",
): StreamableFile | undefined {
  res.setHeader("Cache-Control", `${scope}, no-cache`);
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  if (obj.etag !== undefined && obj.etag !== "") {
    res.setHeader("ETag", obj.etag);
    const header = req.headers["if-none-match"];
    const offered = (typeof header === "string" ? header : "")
      .split(",")
      .map((tag) => tag.trim().replace(/^W\//, ""));
    if (offered.includes(obj.etag)) {
      res.status(304);
      /* ‏הגוף כבר נפתח מול האחסון — סוגרים אותו במקום לזרום לשום מקום */
      (obj.body as { destroy?: () => void }).destroy?.();
      return undefined;
    }
  }
  return new StreamableFile(obj.body as never, {
    type: obj.contentType ?? "application/octet-stream",
    ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
  });
}
