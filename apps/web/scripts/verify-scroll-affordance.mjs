/**
 * סרגל שנגלל לרוחב — **חייב להראות שיש בו עוד.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * שני סרגלי הלשוניות במערכת נגללים לרוחב (הכרעה מכוונת: שבירה
 * לשלוש שורות במסך צר גרועה יותר) ומסתירים את פס הגלילה — הוא מכער
 * רצועת גלולות. הצירוף יצר בדיוק את מה שבעל המוצר דיווח עליו:
 * לשונית שנקטעת באמצע מילה על הקצה, בלי שום סימן שאפשר לגלול
 * אליה. תוכן שנראה **חתוך** ולא תוכן שאפשר להגיע אליו.
 *
 * שלוש תקלות היו שם, וכולן בלתי נראות לקומפיילר:
 *
 * 1. אין רמז שיש עוד — הקצה נחתך חד.
 * 2. כניסה עם `?tab=` בחרה לשונית שיושבת מחוץ למסך: במסך צר
 *    הלשונית האחרונה הייתה כחמש מאות פיקסלים משמאל לקצה הנראה.
 * 3. מונה שמגיע אחרי הטעינה מרחיב לשונית **בלי** לשנות את תיבת
 *    הגבול של הסרגל, ולכן משקיף שמאזין לו בלבד אינו נורה כלל.
 *
 * ## למה שער סטטי ולא בדיקה בדפדפן
 *
 * המדידה האמיתית נעשתה בדפדפן על כל רוחבי המסך, וזו הדרך היחידה
 * לדעת שהתיקון עובד. אבל בדיקה כזו דורשת שרת פיתוח חי, ולכן היא
 * אינה שער. מה שכן ניתן לאכוף כאן זה שהמנגנון **לא ייעלם** ולא
 * יישכפל: חלקיו תלויים זה בזה, וכל אחד לבדו חסר תועלת.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = read("../src/app/globals.css");
const hook = read("../src/lib/use-scroll-affordance.ts");

/** כל סרגל שנגלל לרוחב ומסתיר את פס הגלילה חייב את הטיפול הזה. */
const STRIPS = [".mv-entity-tabs", ".mv-tabs"];

/** מי שמרנדר סרגל כזה — חייב לקרוא להוק, לא להעתיק אותו. */
const CALLERS = [
  "../src/app/entity-tabs.tsx",
  "../src/app/settings/page.tsx",
  "../src/app/collaboration/commission-terms-tabs.tsx",
];

const problems = [];

/*
 * 1 · אף סרגל נגלל לא נשאר בלי מסכה.
 *
 * הרשימה נגזרת מה-CSS עצמו ולא נכתבת כאן בלבד: סרגל שלישי שיתווסף
 * עם `overflow-x: auto` ופס מוסתר ייתפס, במקום להיוולד עם התקלה.
 */
const scrollers = [...css.matchAll(/(\.[\w-]+)\s*\{[^}]*?overflow-x:\s*auto[^}]*?\}/gsu)]
  .filter((m) => /scrollbar-width:\s*none/u.test(m[0]))
  .map((m) => m[1]);
for (const selector of scrollers) {
  if (!STRIPS.includes(selector)) {
    problems.push(`${selector} נגלל לרוחב עם פס מוסתר ואינו ברשימת הסרגלים המטופלים`);
  }
}
for (const selector of STRIPS) {
  for (const state of ["start", "end", "both"]) {
    if (!css.includes(`${selector}[data-fade="${state}"]`)) {
      problems.push(`חסרה מסכת קצה למצב "${state}" ב-${selector}`);
    }
  }
}

/*
 * 2 · הכיוונים הפיזיים נכונים.
 *
 * ‎`to left` מתחיל בקצה הימני ומְמַסֶּה את **ימין** — הפוך
 * מהאינטואיציה, וזה נמדד בדפדפן ולא הונח: הגרסה הראשונה מיסכה
 * בדיוק את הצד שאינו נחתך, והקצה שנחתך נשאר חד. בעברית סוף הסרגל
 * משמאל, ולכן `end` חייב להיות `to right`.
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

/* 3 · רוחב המסכה אחיד, וההוק מכיר את אותו מספר */
const widths = [...css.matchAll(/\[data-fade[^}]*?#000 (\d+)px/gsu)].map((m) => Number(m[1]));
if (widths.length === 0) {
  problems.push("לא נמצא רוחב מסכה — הכלל השתנה והשער אינו מודד עוד דבר");
}
const maskWidth = widths[0];
if (widths.some((w) => w !== maskWidth)) {
  problems.push(`רוחב המסכה אינו אחיד בין המצבים: ${[...new Set(widths)].join(", ")}`);
}
const declared = hook.match(/SCROLL_FADE_PX = (\d+);/u);
if (declared === null) {
  problems.push("ההוק אינו מצהיר על SCROLL_FADE_PX");
} else if (Number(declared[1]) !== maskWidth) {
  problems.push(`ההוק מצהיר ${declared[1]}px בזמן שה-CSS ממסך ${maskWidth}px`);
}

/* 4 · הדהייה נמדדת בזמן ריצה — CSS אינו יודע אם נשאר מה לגלול */
for (const [what, marker] of [
  ["הדהייה אינה נקבעת", 'dataset["fade"]'],
  ["אין מדידה מחדש בשינוי רוחב", "ResizeObserver"],
  ["המשקיף אינו מאזין ללשוניות עצמן", "observer.observe(child)"],
  ["מדידת הגלילה חסרת Math.abs (ב-RTL scrollLeft שלילי)", "Math.abs(el.scrollLeft)"],
  ["הנבחר אינו נגלל לתצוגה", "scrollLeft -="],
]) {
  if (!hook.includes(marker)) problems.push(`${what} — חסר ${marker}`);
}

/*
 * 5 · הגלילה מכבדת את רוחב המסכה.
 *
 * השוואה מול קצה הסרגל בלבד מדלגת על לשונית שנמצאת בתוכו אך יושבת
 * בתוך הדהייה — כלומר לחיצה שבוחרת לשונית ומעמעמת אותה.
 */
if (!hook.includes("box.left + PAD") || !hook.includes("box.right - PAD")) {
  problems.push("הגלילה משווה מול קצה הסרגל ולא מול הקצה פחות המסכה");
}
if (!/const PAD = SCROLL_FADE_PX \+ \d+;/u.test(hook)) {
  problems.push("PAD אינו נגזר מרוחב המסכה — השניים יכולים להיפרד בשקט");
}

/* 6 · אף קורא אינו מחזיק עותק משלו */
for (const caller of CALLERS) {
  const src = read(caller);
  if (!src.includes("useScrollAffordance")) {
    problems.push(`${caller} מרנדר סרגל נגלל ואינו קורא ל-useScrollAffordance`);
  }
  if (src.includes('dataset["fade"]')) {
    problems.push(`${caller} מחשב דהייה בעצמו — ההיגיון שייך להוק אחד`);
  }
}

if (problems.length > 0) {
  console.error("✗ רמז הגלילה בסרגלי הלשוניות נשבר:\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(
  `✓ ${STRIPS.length} סרגלים נגללים · מסכה ${maskWidth}px בשלושה מצבים · ${CALLERS.length} קוראים על הוק אחד`,
);
