/**
 * ניגודיות טוקני הצבע — **נמדדת, לא מוערכת בעין.**
 *
 * ## למה שער ולא הנחיה
 *
 * זו הפעם השלישית שהמערכת מתקנת ניגודיות בעקבות דיווח משתמשים.
 * פעמיים הוכהה הטקסט, ובפעם הזו התברר שהתלונה על „טקסטים בהירים”
 * הצביעה בכלל על המסגרות: הטקסט כבר עמד ב-18.8:1 וב-10:1, בזמן
 * שגבול שדה הקלט עמד על **1.29:1** מול סף של 3:1.
 *
 * זה בדיוק סוג הכשל שאי אפשר לראות בעין — גבול חיוור נראה „עדין”
 * ולא „שבור”, והמצטבר על מסך מלא שדות הוא תחושת דהייה שאיש אינו
 * יודע להצביע על מקורה. מספר יודע.
 *
 * ## הספים
 *
 * מ-WCAG 2.2:
 * - 1.4.3 — טקסט רגיל: 4.5:1.
 * - 1.4.11 — **גבולות של פקדי ממשק**: 3:1. זה הסעיף שנשבר כאן,
 *   והוא חל על מסגרת של שדה קלט — היא מה שמגדיר איפה השדה מתחיל.
 *
 * ## מה **לא** נבדק
 *
 * מסגרות דקורטיביות (כרטיס, מפריד שורות) פטורות מהסף: הכרטיס
 * נבדל גם בצללית, והשורה גם ברווח. שער שהיה כופה עליהן 3:1 היה
 * הופך את המסך לרשת כבדה של קווים — כלומר מתקן קריאוּת בעזרת
 * פגיעה בקריאוּת. הן מופיעות בפלט כמידע, בלי להכשיל.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "src", "app", "globals.css"), "utf8");

/** ‎#rrggbb‎ ⟵ הבהירות היחסית לפי WCAG. */
function luminance(hex) {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * ערך טוקן כפי שהוא מוגדר בקובץ.
 *
 * ההגדרה הראשונה בלבד: הטוקנים הבהירים מוגדרים ב-`:root`, ומיפוי
 * הערכה הכהה מצביע עליהם דרך `var(--dk-*)` — כלומר הופעה שנייה של
 * אותו שם אינה ערך חדש אלא הפניה.
 */
function token(name) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "u").exec(css);
  return match?.[1] ?? null;
}

/** [שם הטוקן, שם הרקע שמולו הוא נמדד, סף, תיאור] */
const REQUIRED = [
  ["color-input-border", "color-field", 3, "גבול שדה קלט (בהיר)"],
  ["dk-input-border", "dk-field", 3, "גבול שדה קלט (כהה)"],
  ["color-text", "color-bg", 4.5, "טקסט ראשי (בהיר)"],
  ["dk-text", "dk-bg", 4.5, "טקסט ראשי (כהה)"],
  ["color-text-muted", "color-bg", 4.5, "טקסט משני (בהיר)"],
  ["dk-text-muted", "dk-bg", 4.5, "טקסט משני (כהה)"],
  ["color-text-soft", "color-bg", 4.5, "תוויות לשוניות (בהיר)"],
  ["color-danger", "color-bg", 4.5, "שגיאה (בהיר)"],
  ["color-primary", "color-bg", 4.5, "קישורים (בהיר)"],
];

/** נמדדים ומוצגים, אך אינם מכשילים — ראו „מה לא נבדק”. */
const INFORMATIVE = [
  ["color-border", "color-bg", "מסגרת כרטיס (בהיר)"],
  ["color-row-border", "color-bg", "מפריד שורות (בהיר)"],
  ["dk-border", "dk-surface", "מסגרת כרטיס (כהה)"],
];

const failures = [];
let checked = 0;

for (const [fg, bg, min, label] of REQUIRED) {
  const a = token(fg);
  const b = token(bg);
  if (!a || !b) {
    failures.push(`טוקן חסר: --${!a ? fg : bg}`);
    continue;
  }
  checked += 1;
  const ratio = contrast(a, b);
  if (ratio < min) {
    failures.push(
      `${label}: --${fg} (${a}) מול --${bg} (${b}) = ${ratio.toFixed(2)}:1, נדרש ${min}:1`,
    );
  }
}

if (failures.length > 0) {
  console.error("✗ ניגודיות מתחת לסף:\n");
  for (const line of failures) console.error(`  • ${line}`);
  console.error(
    "\nהמסגרות והצבעים מוגדרים ב-apps/web/src/app/globals.css. סף 3:1 לגבול פקד" +
      " הוא WCAG 1.4.11; 4.5:1 לטקסט הוא 1.4.3.",
  );
  process.exit(1);
}

const notes = INFORMATIVE.map(([fg, bg, label]) => {
  const a = token(fg);
  const b = token(bg);
  return a && b ? `${label} ${contrast(a, b).toFixed(2)}:1` : null;
}).filter(Boolean);

console.log(`✓ ${checked} זוגות צבע נמדדו — כולם מעל הסף`);
console.log(`  דקורטיבי (לידיעה בלבד): ${notes.join(" · ")}`);
