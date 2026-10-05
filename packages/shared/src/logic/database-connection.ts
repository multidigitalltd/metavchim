/**
 * ‎**החיבור למסד — הגדרה אחת ל-API ול-Workers.**
 *
 * ‏מ-Prisma 7 השאילתות עוברות דרך `pg` (‏`@prisma/adapter-pg`) ולא דרך מנוע
 * ‏השאילתות, ומה שהמנוע קבע בעצמו נקבע כאן במפורש:
 *
 * - ‏**`TimeZone=UTC` בכל חיבור.** המתאם שולח תאריך כטקסט בלי אזור זמן
 *   ‏(`2026-03-27 00:30:00.123`), והמסד מפרש אותו באזור הזמן של החיבור.
 *   ‏המסד שלנו ב-UTC ממילא; הקביעה כאן מבטיחה שגם אם יוגדר אחרת, תאריך
 *   ‏בשאילתה לא יזוז בשקט בשעתיים.
 * - ‏**המתנה לחיבור — עשר שניות**, כמו `pool_timeout` של Prisma 6. ב-`pg`
 *   ‏ברירת המחדל היא לחכות לנצח: מאגר מלא היה תוקע בקשות במקום להיכשל.
 * - ‏**חיבור פנוי נשמר חמש דקות**, כמו ב-Prisma 6. ב-`pg` — עשר שניות,
 *   ‏כלומר חיבור חדש כמעט לכל בקשה בשעות שקטות.
 * - ‏**הסכימה מהכתובת** (`?schema=`) — המתאם אינו קורא אותה בעצמו.
 * - ‏**כתובת חסרה נכשלת כאן, בשם שלה** — ולא כ-„Invalid URL” בשאילתה הראשונה.
 *
 * ‏הפונקציה מחזירה נתונים בלבד: החבילה נטענת גם בדפדפן, והמתאם עצמו
 * ‏נבנה אצל הקורא — כמו `node:crypto` ב-`aes-gcm.ts`.
 */
export function databaseConnection(url: string | undefined): {
  pool: {
    connectionString: string;
    options: string;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
  };
  schema: string;
} {
  if (url === undefined || url === "") throw new Error("כתובת המסד חסרה (DATABASE_URL)");
  return {
    pool: {
      connectionString: url,
      options: "-c TimeZone=UTC",
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 300_000,
    },
    schema: decodeURIComponent(/[?&]schema=([^&#]+)/u.exec(url)?.[1] ?? "public"),
  };
}
