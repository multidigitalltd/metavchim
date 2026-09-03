#!/usr/bin/env node
/**
 * ‎**התיעוד הציבורי הוא הבית היחיד של ההדרכות.**
 *
 * ההדרכות ישבו בשני מקומות: `/guides` מאחורי התחברות, ו-`/docs`
 * הפתוח. שני בתים לאותו תוכן נפרדים ביום שאחד מהם משתפר — וזה כבר
 * קרה במערכת הזו, גם עם תוויות המקורות וגם עם מונחי ההפניות.
 *
 * הפיצול נסגר, והשער הזה שומר שהוא יישאר סגור. הוא בודק ארבעה
 * דברים שאין עליהם קומפיילר:
 *
 *   1. ‎`/guides` ו-`/guides/<נושא>` הם הפניה בלבד, ולא מסך שהוחזר.
 *   2. הלשונית בסרגל מובילה ל-`/docs` ולא בחזרה ל-`/guides`.
 *   3. לכל נושא יש עמוד משלו — כלומר `/docs/[topic]` קיים ונבנה
 *      מראש מהרשימה, ולא נתיב שמקבל מזהה חופשי.
 *   4. עוגני האזורים באינדקס מוקדמים ב-`area-`. מפתחות האזורים
 *      ומזהי הנושאים חולקים מילים — „start”, „office”, „account” —
 *      ושני עוגנים באותו שם באותו עמוד הם עוגן אחד שבור.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const problems = [];
const need = (condition, message) => {
  if (!condition) problems.push(message);
};

/* ------------------------------------------------------------------
   1. „הדרכות” שבמערכת מפנה, ואינו מציג
   ------------------------------------------------------------------ */
const index = read("src/app/guides/page.tsx");
const topic = read("src/app/guides/[topic]/page.tsx");

for (const [name, source] of [
  ["/guides", index],
  ["/guides/[topic]", topic],
]) {
  need(
    source.includes("permanentRedirect("),
    `${name} אינו מפנה — התוכן חזר לשבת מאחורי התחברות`,
  );
  /*
   * ‎`GUIDES.map` או `guide.steps` בקובץ הפניה פירושם שמישהו התחיל
   * לצייר שם תוכן שוב. הבדיקה על הציור, לא על האורך.
   */
  need(!source.includes(".steps"), `${name} מצייר גוף מדריך — זה תפקידו של /docs`);
}
need(
  topic.includes("GUIDES.some((guide) => guide.id === topic)"),
  "/guides/[topic] מפנה בלי לבדוק מול הרשימה — מזהה לא קיים יגיע ל-404",
);

/* ------------------------------------------------------------------
   2. הלשונית בסרגל
   ------------------------------------------------------------------ */
const shell = read("src/app/app-shell.tsx");
need(
  shell.includes('navExternal("/docs", "הדרכות"'),
  'הלשונית „הדרכות” אינה מובילה ל-/docs',
);
need(
  !shell.includes('navLink("/guides"'),
  'הלשונית „הדרכות” הוחזרה ל-/guides — כלומר לבית השני',
);

/* ------------------------------------------------------------------
   3. עמוד לכל נושא, מהרשימה הסגורה
   ------------------------------------------------------------------ */
const docTopic = read("src/app/docs/[topic]/page.tsx");
need(
  docTopic.includes("export function generateStaticParams()"),
  "/docs/[topic] אינו נבנה מראש — התיעוד הציבורי חייב להגיע מלא בלי JavaScript",
);
need(
  docTopic.includes("GUIDES.map((guide) => ({ topic: guide.id }))"),
  "/docs/[topic] אינו נגזר מרשימת הנושאים",
);
need(docTopic.includes("robots: { index: true"), "עמוד הנושא אינו מוצהר לאינדוקס");
need(docTopic.includes("alternates: { canonical:"), "לעמוד הנושא אין הצהרה קנונית");

/* ------------------------------------------------------------------
   4. עוגני האזורים מוקדמים
   ------------------------------------------------------------------ */
const browser = read("src/app/docs/docs-browser.tsx");
need(browser.includes("id={`area-${area.key}`}"), "עוגן האזור אינו מוקדם ב-area-");
need(
  docTopic.includes("/docs#${area.key}") === false,
  "פירור הלחם מקשר לעוגן אזור בלי הקידומת — הוא ינחת על הנושא בעל אותו שם",
);
need(docTopic.includes("/docs#area-${area.key}"), "פירור הלחם אינו מקשר לאזור");

/* ------------------------------------------------------------------ */
if (problems.length > 0) {
  console.error("שער התיעוד נכשל:\n" + problems.map((p) => `  · ${p}`).join("\n"));
  process.exit(1);
}
console.log("שער התיעוד עבר: בית אחד לתוכן, עמוד לכל נושא.");
