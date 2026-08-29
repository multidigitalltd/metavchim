/**
 * סרגל שנגלל לרוחב — **חייב להראות שיש בו עוד.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * סרגל הלשוניות של כרטיס הישות נגלל לרוחב (זו הכרעה מכוונת: שבירה
 * לשלוש שורות במסך צר גרועה יותר), ופס הגלילה מוסתר בכוונה — הוא
 * מכער רצועת גלולות. הצירוף הזה יצר בדיוק את מה שבעל המוצר דיווח
 * עליו: לשונית שנקטעת באמצע מילה על קצה המסך, בלי שום סימן שאפשר
 * לגלול אליה. תוכן שנראה **חתוך** ולא תוכן שאפשר להגיע אליו.
 *
 * שתי תקלות היו שם, ושתיהן בלתי נראות לקומפיילר:
 *
 * 1. אין רמז שיש עוד — הקצה נחתך חד.
 * 2. כניסה עם `?tab=` בחרה לשונית שיושבת מחוץ למסך: במסך צר
 *    הלשונית האחרונה הייתה חמש מאות פיקסלים משמאל לקצה הנראה,
 *    כלומר המתווך ראה פאנל בלי לדעת מה נבחר.
 *
 * ## למה שער סטטי ולא בדיקה בדפדפן
 *
 * המדידה האמיתית נעשתה בדפדפן על כל רוחבי המסך, וזו הדרך היחידה
 * לדעת שהתיקון עובד. אבל בדיקה כזו דורשת שרת פיתוח חי, ולכן היא
 * אינה שער. מה שכן ניתן לאכוף כאן זה שהמנגנון **לא ייעלם**: שלושת
 * חלקיו קשורים זה בזה, וכל אחד מהם לבדו חסר תועלת.
 *
 * ‎**רוחב המסכה וריווח הגלילה חייבים להתאים.** גלילה שעוצרת בתוך
 * אזור המיסוך מציבה את הלשונית הפעילה מתחת לדהייה — בוחרת לשונית
 * ומעמעמת אותה באותה נשימה. זה היה המצב בגרסה הראשונה של התיקון,
 * והוא נתפס במדידה ולא בקריאה.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = read("../src/app/globals.css");
const tabs = read("../src/app/entity-tabs.tsx");

const problems = [];

/* 1 · המסכה קיימת לשלושת המצבים */
for (const state of ["start", "end", "both"]) {
  if (!css.includes(`.mv-entity-tabs[data-fade="${state}"]`)) {
    problems.push(`חסרה מסכת קצה למצב "${state}" ב-.mv-entity-tabs`);
  }
}

/*
 * 2 · הכיוונים הפיזיים נכונים.
 *
 * ‎`to left` מתחיל בקצה הימני ומְמַסֶּה את **ימין** — הפוך
 * מהאינטואיציה, וזה נמדד בדפדפן. בעברית סוף הסרגל משמאל, ולכן
 * ‎`end` חייב להיות `to right`. היפוך כאן מְמַסֶּה את הצד שאינו
 * נחתך, והקצה שנחתך נשאר חד — כלומר תיקון שנראה קיים ואינו עובד.
 */
const fadeRule = (state) => {
  const at = css.indexOf(`.mv-entity-tabs[data-fade="${state}"]`);
  return at === -1 ? "" : css.slice(at, css.indexOf("}", at));
};
if (!/to right/u.test(fadeRule("end"))) {
  problems.push('מצב "end" חייב למסך את שמאל — כלומר linear-gradient(to right, …)');
}
if (!/to left/u.test(fadeRule("start"))) {
  problems.push('מצב "start" חייב למסך את ימין — כלומר linear-gradient(to left, …)');
}

/* 3 · הרוחב זהה בשלושת המצבים, והוא מה שריווח הגלילה מכבד */
const widths = [...css.matchAll(/\.mv-entity-tabs\[data-fade[^}]*?#000 (\d+)px/gsu)].map((m) =>
  Number(m[1]),
);
if (widths.length === 0) {
  problems.push("לא נמצא רוחב מסכה — הכלל השתנה והשער אינו מודד עוד דבר");
}
const maskWidth = widths[0];
if (widths.some((w) => w !== maskWidth)) {
  problems.push(`רוחב המסכה אינו אחיד בין המצבים: ${widths.join(", ")}`);
}

/* 4 · הדהייה נמדדת בזמן ריצה — CSS אינו יודע אם יש עוד לגלול */
if (!tabs.includes('dataset["fade"]')) {
  problems.push("entity-tabs אינו קובע data-fade — המסכה לעולם לא תידלק");
}
if (!tabs.includes("ResizeObserver")) {
  problems.push("entity-tabs אינו מודד מחדש בשינוי רוחב — סיבוב מכשיר ישאיר דהייה שקרית");
}
if (!tabs.includes("Math.abs(el.scrollLeft)")) {
  problems.push("מדידת הגלילה חייבת Math.abs — ב-RTL scrollLeft שלילי");
}

/* 5 · הלשונית הפעילה נגללת לתצוגה, ומחוץ לאזור המיסוך */
if (!/aria-selected="true"/u.test(tabs) || !tabs.includes("scrollLeft -=")) {
  problems.push("entity-tabs אינו גולל את הלשונית הפעילה לתצוגה");
}
const pad = tabs.match(/const PAD = (\d+);/u);
if (pad === null) {
  problems.push("לא נמצא PAD — ריווח הגלילה אינו ניתן להשוואה מול רוחב המסכה");
} else if (Number(pad[1]) <= maskWidth) {
  problems.push(
    `PAD (${pad[1]}) אינו גדול מרוחב המסכה (${maskWidth}) — הלשונית הפעילה תשב מתחת לדהייה`,
  );
}

if (problems.length > 0) {
  console.error("✗ רמז הגלילה בסרגל הלשוניות נשבר:\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(
  `✓ סרגל הלשוניות: מסכת קצה בשלושה מצבים (${maskWidth}px), נמדדת בזמן ריצה, והלשונית הפעילה נגללת מעבר לה (${pad[1]}px)`,
);
