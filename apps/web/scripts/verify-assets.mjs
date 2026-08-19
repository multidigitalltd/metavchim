/**
 * כל קובץ סטטי שהקוד מפנה אליו — קיים בפועל.
 *
 * למה שער ולא בדיקה ידנית: תמונה חסרה אינה מפילה בנייה ואינה מפילה
 * טיפוסים. היא מגיעה למשתמש כתמונה שבורה, ומתגלה רק כשמישהו פותח
 * את המסך — במקרה שלנו, מסך ההדרכות הפנה ל-`/guides/agreements.png`
 * שמעולם לא נוצר, וזה עבר `lint`, `typecheck`, `build` וכל 855
 * הבדיקות.
 *
 * הסריקה היא על מחרוזות בקוד ולא על רשימה ידנית: רשימה שצריך לזכור
 * לעדכן היא בדיוק מה שנשכח כאן.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicDir = join(root, "public");
const srcDir = join(root, "src");

/** כל קבצי המקור, רקורסיבית. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    /*
     * גם `.css`. בלעדיו השער החמיץ בדיוק את המקום שבו יושבים
     * הגופנים: `globals.css` מפנה לארבעה קבצי `woff`, והסרת אחד מהם
     * הותירה את הבדיקה מדווחת "הכול תקין" — בעוד שכל הטיפוגרפיה
     * של המערכת נשברת. שער שמדלג על סוג קובץ שלם גרוע משער שאינו
     * קיים, כי הוא מייצר ביטחון (ביקורת Codex).
     */
    else if (/\.(tsx?|mjs|css)$/u.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * הסיומות של נכסים שמוגשים מ-public. מוגבלות בכוונה — לא כל מחרוזת
 * שמתחילה בלוכסן, שאחרת כל נתיב ניווט היה נבדק כקובץ.
 */
/*
 * `mjs` נכנס בגלל ה-Worker של MapLibre.
 *
 * הוא נטען בזמן ריצה מ-`public/maplibre`, ולכן נתיב שגוי בו אינו
 * מפיל בנייה ואינו מפיל טיפוסים — הוא מגיע למשתמש כמפה לבנה עם
 * פקדים, בלי שום שגיאה שאפשר להבין. זה בדיוק סוג הכשל שהשער הזה
 * קיים בשבילו, והוא החמיץ אותו בפעם הראשונה.
 */
const EXT = "png|jpe?g|svg|webp|gif|ico|webmanifest|woff2?|mjs|js";

/** ‎"/guides/x.png"‎ — התחביר של TSX. */
const QUOTED = new RegExp(`["'\`](/[^"'\`\\s?#]+\\.(?:${EXT}))["'\`]`, "gu");

/**
 * ‎url(/fonts/x.woff)‎ — התחביר של CSS, עם מרכאות או בלעדיהן.
 *
 * `data:` מסונן: הקובץ מכיל SVG משובץ, ואין שם קובץ לבדוק.
 */
const CSS_URL = new RegExp(
  `url\\(\\s*["'\`]?(/[^)"'\`\\s]+\\.(?:${EXT}))`,
  "gu",
);

const missing = [];
const seen = new Set();

for (const file of sources(srcDir)) {
  const text = readFileSync(file, "utf8");
  for (const match of [...text.matchAll(QUOTED), ...text.matchAll(CSS_URL)]) {
    const asset = match[1];
    if (seen.has(asset)) continue;
    seen.add(asset);
    try {
      statSync(join(publicDir, asset));
    } catch {
      missing.push(`${asset}  ←  ${file.replace(`${root}/`, "")}`);
    }
  }
}

if (missing.length > 0) {
  console.error("✗ קבצים סטטיים שהקוד מפנה אליהם ואינם קיימים ב-public:\n");
  for (const m of missing) console.error(`  ${m}`);
  console.error("");
  process.exit(1);
}

/*
 * תוסף ה-RTL של המפה חייב להיות `.mjs` — וזה אינו עניין של סגנון.
 *
 * ה-Worker של MapLibre בוחר איך לטעון **לפי הסיומת**: `.mjs` עובר
 * ב-`await import(url)`, וכל שאר הסיומות ב-`globalThis.eval(source)`.
 * ה-CSP שלנו אינו מתיר `unsafe-eval` בייצור, ולכן הגרסה עם `.js`
 * נכשלה שם בשקט והמפה הציגה עברית הפוכה — בזמן שבפיתוח, שבו
 * `unsafe-eval` מותר בשביל Fast Refresh, הכול נראה תקין.
 *
 * בדיקה קיימת ולא הערה בקוד: קובץ שקיים ונטען בהצלחה עובר את השער
 * שמעליו בלי הערה, והכשל אינו מפיל טיפוסים ואינו מפיל בנייה.
 */
const badRtl = [...seen].filter(
  (asset) => asset.includes("mapbox-gl-rtl-text") && !asset.endsWith(".mjs"),
);
if (badRtl.length > 0) {
  console.error(
    "✗ תוסף ה-RTL של המפה חייב להיטען כ-`.mjs`; סיומת אחרת עוברת דרך eval שה-CSP חוסם:\n",
  );
  for (const m of badRtl) console.error(`  ${m}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ ${seen.size} קבצים סטטיים נבדקו — כולם קיימים`);
