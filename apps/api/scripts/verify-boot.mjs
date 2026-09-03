/**
 * בדיקה שה-API בכלל מסוגל לעלות — על הפלט המהודר, לא על המקור.
 *
 * **נכתבה אחרי תקלת ייצור.** שירות היה רשום ב-`providers` של
 * `CoreModule` אבל לא ב-`exports`, ומודול `@Global()` חושף רק את מה
 * שהוא מייצא. Nest נכשל בבניית גרף התלויות, התהליך מת, וכל המערכת
 * ירדה — לא מסך אחד. המסגרת נטענה מהקונטיינר של ה-web, וכל קריאת
 * נתונים החזירה שגיאה.
 *
 * אף שער קיים לא יכול היה לתפוס את זה: TypeScript מאמת טיפוסים ולא
 * חיווט, ה-lint אינו יודע מה זה מודול, ובדיקות היחידה בונות מחלקות
 * ישירות עם תלויות מזויפות — כלומר עוקפות בדיוק את המנגנון שנשבר.
 *
 * **למה סקריפט ולא בדיקת vitest.** vitest ממיר TypeScript ב-esbuild,
 * ו-esbuild אינו פולט `design:paramtypes`. בלי המטא-דאטה הזו Nest
 * אינו רואה את פרמטרי הבנאי כלל, ולכן הוא "פותר" כל בקר בהצלחה —
 * בדיקה כזו נכתבה, עברה על הקוד השבור, והייתה גרועה מכלום: שער
 * שנראה כמו הגנה ואינו מגן. רק הפלט של `tsc` נושא את המטא-דאטה, ולכן
 * הבדיקה רצה על `dist` אחרי הבנייה.
 *
 * `compile()` ולא `init()` — הקומפילציה פותרת את הגרף ובונה את כל
 * המופעים, אבל אינה מריצה `onModuleInit`, ושם יושבים החיבורים
 * ל-Postgres, ל-Redis ולתורים. כך הבדיקה בודקת חיווט בלבד, רצה
 * בשניות, ואינה דורשת תשתית.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Test } from "@nestjs/testing";

/**
 * ‎**בנייה ישנה מהמקור = השער בודק קוד אחר.**
 *
 * ‏השער רץ על `dist` במכוון (רק שם יש `design:paramtypes`), וזה
 * בדיוק מה שהופך אותו לשקרן כשהבנייה מפגרת: שני שינויי חיווט
 * שבורים — ספק שאינו מיוצא מהמודול שלו, ואז מעגל מודולים — קיבלו
 * כאן „✓ ה-API מסוגל לעלות”, ורק הרצת השרת בפועל גילתה שהוא נופל
 * בעלייה.
 *
 * ‏אותה הגנה בדיוק כמו ב-`scripts/verify-notification-routes.mjs`,
 * מאותה סיבה. ב-CI הבנייה תמיד קודמת ולכן זה שקוף; מקומית זה
 * ההבדל בין ✓ מדומה להוראה מה לעשות.
 */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else if (/\.(?:ts|js)$/u.test(entry.name)) newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

const root = join(import.meta.dirname, "..");
if (newestMtime(join(root, "dist")) < newestMtime(join(root, "src"))) {
  console.error("✗ הבנייה של ה-API ישנה מהמקור — הריצו pnpm build לפני השער");
  process.exit(1);
}

const { AppModule } = await import("../dist/app.module.js");

try {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.close();
  console.log("✓ גרף התלויות נבנה — ה-API מסוגל לעלות");
} catch (error) {
  // רק השורה הראשונה: היא נושאת את שם הבקר ואת התלות החסרה, וכל
  // השאר הוא מחסנית של Nest שאינה מוסיפה דבר לאבחון
  const first = String(error instanceof Error ? error.message : error).split("\n")[0];
  console.error(`✗ ה-API אינו מסוגל לעלות: ${first}`);
  process.exit(1);
}
