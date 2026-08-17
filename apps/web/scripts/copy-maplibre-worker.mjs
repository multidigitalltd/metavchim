/**
 * העתקת ה-Worker של MapLibre ל-`public/`.
 *
 * ## למה זה נחוץ, ולמה בלי זה המפה לבנה
 *
 * מגרסה 6 של MapLibre ה-Worker אינו מוטמע בחבילה אלא נטען מקובץ
 * נפרד, והכתובת שלו נבנית בזמן ריצה:
 * `new URL(\`./${name}\`, base)` — שם הקובץ והבסיס שניהם משתנים.
 * webpack אינו יכול לנתח את זה סטטית, ולכן הוא **אינו פולט** את
 * הקובץ לפלט הבנייה. הדפדפן מבקש כתובת שאין בה קובץ, ה-Worker לא
 * עולה, ואין מי שיפענח אריחים.
 *
 * התוצאה הייתה מפה לבנה *עם* פקדי זום ועם קרדיט הספק — כלומר סגנון
 * המפה נטען (הוא נקרא בתהליך הראשי), ורק הציור לא קרה. תקלה שנראית
 * כמו "המפה לא עובדת" בלי שום שגיאה שהמשתמש יכול להבין.
 *
 * ## למה העתקה ולא ייבוא
 *
 * `new URL("./x.mjs", import.meta.url)` היה מאפשר ל-webpack לפלוט את
 * הקובץ, אבל נתיב לחבילה חיצונית אינו נפתר כך. העתקה ל-`public/`
 * היא מנגנון אחד פחות: הקובץ נמצא באותו מקור (`worker-src 'self'`),
 * ואינו תלוי בהתנהגות איש חבילות שיכולה להשתנות בגרסה הבאה.
 *
 * הקובץ נוצר בכל בנייה ובכל הרצת פיתוח, ולכן הוא תמיד תואם לגרסה
 * המותקנת ואינו נשמר ב-git — שני עותקים שנפרדים בשקט הם באג שקשה
 * לאבחן פעמיים.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/*
 * ה-Worker מייבא את `maplibre-gl-shared.mjs` בנתיב יחסי, ולכן שני
 * הקבצים חייבים לשכון זה ליד זה. העתקה של אחד מהם בלבד מחזירה בדיוק
 * את אותה מפה לבנה, ורק אחרי חיפוש ארוך יותר.
 */
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const target = join(import.meta.dirname, "..", "public", "maplibre");

await mkdir(target, { recursive: true });
for (const name of FILES) {
  await copyFile(join(dist, name), join(target, name));
}
console.log(`maplibre worker → public/maplibre (${FILES.length} files)`);
