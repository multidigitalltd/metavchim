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

/*
 * תוסף הטקסט הדו-כיווני — הסיבה שהמפה הראתה עברית הפוכה.
 *
 * MapLibre מציירת תוויות משמאל לימין, ובלי התוסף הזה שמות רחובות
 * בעברית יוצאים בסדר אותיות הפוך: "בגין מנחם" נראה כמו כתב מראה.
 * זה אינו באג בעיצוב אלא היעדר סידור דו-כיווני, ולכן התיקון הוא
 * טעינת התוסף ולא CSS.
 *
 * גם הוא מוגש מ-`public` ולא מ-CDN: ה-CSP אינו מתיר מקור חיצוני,
 * והתוסף נטען בתוך ה-Worker — כלומר `script-src 'self'` הוא מה
 * שחל עליו.
 *
 * ## למה `.mjs` ולא `.js`
 *
 * ה-Worker של MapLibre 6 בוחר איך לטעון את התוסף **לפי הסיומת**:
 * קובץ `.mjs` נטען ב-`await import(url)`, וכל שאר הסיומות עוברות
 * דרך `globalThis.eval(source)` — שה-CSP חוסם.
 *
 * החבילה מפיצה UMD. כמודול ES שני הענפים הראשונים שלו (`exports`,
 * `define`) אינם קיימים, והוא נופל לענף הגלובלי שקורא
 * ל-`self.registerRTLTextPlugin` — בדיוק מה שה-Worker מציב.
 * לכן די בהעתקה תחת שם אחר; אין צורך לעטוף או לבנות מחדש.
 *
 * **הסיומת לבדה אינה מספיקה.** התוסף הוא WebAssembly, וההידור שלו
 * חסום בלי `wasm-unsafe-eval` ב-`script-src`. שני התנאים יחד הם
 * התיקון; אחד מהם לבדו משאיר את המפה בלי תוויות בעברית. ראו
 * `src/middleware.ts`.
 */
const RTL_SOURCE = "mapbox-gl-rtl-text.js";
const RTL_PLUGIN = "mapbox-gl-rtl-text.mjs";

const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
/*
 * החבילה חושפת ב-`exports` את המקור בלבד, ולכן אי אפשר לפתור את
 * `./dist/...` ישירות. הפתרון הוא לפתור את השורש ולעלות ממנו —
 * ולא לכתוב נתיב קשיח לתוך `node_modules`, שנשבר בכל שינוי פריסה.
 */
const rtlDist = join(
  dirname(require.resolve("@mapbox/mapbox-gl-rtl-text")),
  "..",
  "dist",
);
const target = join(import.meta.dirname, "..", "public", "maplibre");

await mkdir(target, { recursive: true });
for (const name of FILES) {
  await copyFile(join(dist, name), join(target, name));
}
await copyFile(join(rtlDist, RTL_SOURCE), join(target, RTL_PLUGIN));
console.log(
  `maplibre worker + RTL → public/maplibre (${FILES.length + 1} files)`,
);
