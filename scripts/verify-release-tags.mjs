/**
 * ‎**`:latest` של כל השירותים מצביע תמיד על אותו קומיט.**
 *
 * ## הכשל שהשער הזה מונע — וכבר קרה
 *
 * המערכת רצה בשלושה קונטיינרים (api, web, workers) ועוד סוכן העדכון,
 * וכולם נמשכים כ-`:latest`. כל אחד נבנה ב-job נפרד, ועד כה כל job
 * הזיז את `:latest` בעצמו כשסיים.
 *
 * ‎`1811929` ו-`2c2fd8e` מוזגו בהפרש של **13 שניות**, ולכן שתי
 * הריצות כתבו לאותם תגים במקביל. מה שנשאר ב-Registry אחר כך:
 *
 * | api | web | workers | updater |
 * | --- | --- | --- | --- |
 * | `2c2fd8e` | ‎**`1811929`** | `2c2fd8e` | `2c2fd8e` |
 *
 * הריצה הישנה כתבה את `web:latest` אחרונה, וזה **לא חלון**: התג
 * נשאר שם עד השחרור הבא. הלקוח לחץ „עדכן גרסה” שוב ושוב, וכל משיכה
 * הביאה בנאמנות את אותה תמונה ישנה. נדרשה הרצה ידנית מחדש של
 * ה-workflow כדי לשחרר את זה.
 *
 * ‎**ואי אפשר להסיק את סדר הכתיבה מזמני סיום ה-jobs.** ניסיתי, קיבלתי
 * את התשובה ההפוכה, ואמרתי למשתמש שה-Registry תקין ושהתקלה אצלו
 * בשרת. רק הדיגסטים אומרים מי כתב אחרון.
 *
 * אותה צורה גם בכיוון השני: אם בניית יעד אחד **נכשלת**, השאר כבר
 * הזיזו את `:latest` והוא נשאר על הקומיט הקודם — שוב לצמיתות.
 *
 * ## מה נטען כאן
 *
 * 1. שום שלב בנייה אינו דוחף `:latest` — התג של הבנייה הוא הקומיט.
 * 2. יש job שמזיז את `:latest`, והוא תלוי (`needs`) בבנייה.
 * 3. ‎**היעדים בשני המקומות זהים.** זו הטענה שקשה לזכור ידנית: יעד
 *    שנוסף למטריצה ולא ללולאת ההזזה היה נבנה בכל שחרור ו-`:latest`
 *    שלו היה קפוא על הקומיט האחרון שקדם להוספה — בשקט מוחלט.
 * 4. ‎**שחרור אחד בכל רגע, והחדש מנצח.** `needs` מסדר בתוך ריצה
 *    אחת בלבד; ה-`concurrency` של ה-workflow כולל את ה-SHA, ולכן
 *    שני מיזוגים סמוכים היו כותבים לאותם תגים במקביל (ביקורת
 *    Codex). נדרשים גם תור (`concurrency` בלי ה-SHA) וגם דילוג על
 *    ריצה שאינה ראש `main` — תור לבדו רק דוחה את הדריסה.
 * 5. ‎**המצב שנשאר נבדק, ולא נלמד מקוד היציאה.** ארבע כתיבות אינן
 *    אטומיות; כשל באמצע הוא פיצול, והוא אינו מתקן את עצמו.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

const problems = [];

/** שורות הקובץ בלי הערות — הערה שמצטטת `:latest` אינה דחיפה. */
const code = workflow
  .split("\n")
  .filter((line) => !/^\s*#/u.test(line))
  .join("\n");

/*
 * ‎1 · אף שלב בנייה אינו דוחף `:latest`.
 *
 * הבדיקה על `tags:` של `build-push-action` ולא על המחרוזת בכל מקום:
 * ה-compose מושך `:latest` כדין, וזו בדיוק ההבחנה — מותר למשוך,
 * אסור לדחוף מתוך job של יעד יחיד.
 */
for (const match of code.matchAll(/tags:\s*(\|[\s\S]*?\n(?=\s*[a-z-]+:)|.*)/gu)) {
  if (/:latest/u.test(match[1])) {
    problems.push(
      "שלב בנייה דוחף `:latest` — התג של הבנייה הוא הקומיט בלבד, וההזזה שייכת ל-job המרכז",
    );
  }
}

/* ‎2 · יש job שמזיז, והוא תלוי בבנייה. */
const publish = code.match(/\n {2}publish:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n|$)/u);
if (publish === null) {
  problems.push("אין job בשם `publish` שמזיז את `:latest` אחרי שכל התמונות נבנו");
} else {
  if (!/needs:\s*docker\b/u.test(publish[1])) {
    problems.push(
      "‏`publish` אינו `needs: docker` — בלי זה הוא יכול להזיז `:latest` בזמן שיעד עדיין נבנה",
    );
  }
  if (!/imagetools create/u.test(publish[1])) {
    problems.push("‏`publish` אינו מזיז את התג בפועל (`imagetools create` חסר)");
  }
}

/* ‎4 · תור לשחרור, ודילוג על ריצה שאינה ראש `main`. */
if (publish !== null) {
  /*
   * ‏עד סוף השורה ולא `\S+`: `publish-${{ github.sha }}` מכיל רווחים,
   * ‏ולכן קבוצה שנקבעת לפי הקומיט הייתה נחתכת אחרי `publish-${{`
   * ‏וה-SHA לא היה נראה כלל. מוטציה כזו עברה את הניסוח הראשון.
   */
  const group = publish[1].match(/concurrency:\s*\n\s*group:\s*(.+)/u);
  if (group === null) {
    problems.push(
      "‏`publish` בלי `concurrency` — שני מיזוגים סמוכים ישחררו במקביל לאותם תגים",
    );
  } else if (/github\.sha/u.test(group[1])) {
    problems.push(
      "קבוצת ה-`concurrency` של `publish` כוללת את ה-SHA, כלומר קבוצה לכל קומיט — וזה אינו תור",
    );
  }
  if (/cancel-in-progress:\s*true/u.test(publish[1])) {
    problems.push(
      "‏`cancel-in-progress: true` בשחרור — ביטול בין הזזה להזזה הוא בדיוק הפיצול",
    );
  }
  if (!/commits\/main/u.test(publish[1])) {
    problems.push(
      "‏`publish` אינו בודק שהקומיט עדיין ראש `main` — ריצה ישנה שממתינה בתור תחזיר את `:latest` אחורה",
    );
  }
}

/*
 * ‎5 · המצב הסופי נבדק מול ה-Registry — ו**שני** הצדדים נקראים משם.
 *
 * ‏הניסוח הראשון חיפש `imagetools inspect` בלבד, ולכן מוטציה
 * ‏שהחליפה את קריאת ה-`:latest` בהשמה מהערך שכבר בידנו עברה ירוקה:
 * ‏המחרוזת עדיין הופיעה, בקריאה השנייה. שוב שער שמדד נוכחות של
 * ‏טקסט במקום את ההכרעה — ולכן נדרשות כאן שתי קריאות **נפרדות**,
 * ‏אחת לתג הקומיט ואחת ל-`:latest`, והשוואה שיוצאת בכישלון.
 */
if (publish !== null) {
  /*
   * ‏הטענה נבדקת בתוך גוף ה-`run` של שלב האימות, ולא על ה-job או
   * ‏על השלב כולו. שתי סיבות, ושתיהן מוטציות שעברו: ל-job יש
   * ‎`exit 1` גם בלולאת הניסיונות החוזרים, ולכל שלב יש
   * ‎`if: steps.tip.outputs.stale != 'true'`, וה-`!=` שבתוכו סיפק
   * ‏את הניסוח הקודם — כלומר השער אישר „יש השוואה” על שורת התנאי
   * ‏של השלב, בזמן שההשוואה האמיתית נמחקה. שוב מדידת נוכחות של תו
   * ‏במקום ההכרעה עצמה.
   */
  const bodies = [...publish[1].matchAll(/run: \|\n([\s\S]*?)(?=\n {6}- |$)/gu)].map(
    (m) => m[1],
  );
  const assign = /(\w+)="\$\(docker buildx imagetools inspect[^\n]*?:([^"\n]+)"\)"/gu;
  const check = bodies.find((body) => {
    const vars = new Map(
      [...body.matchAll(assign)].map((m) => [m[2].trim(), m[1]]),
    );
    const sha = [...vars.entries()].find(([tag]) => tag.includes("github.sha"))?.[1];
    const latest = [...vars.entries()].find(([tag]) => tag === "latest")?.[1];
    if (sha === undefined || latest === undefined) return false;
    /* ההשוואה עצמה, בין שני המשתנים שמולאו מהשתי קריאות */
    const pair = new RegExp(
      `\\[ *"\\$(?:${sha}|${latest})" *!= *"\\$(?:${sha}|${latest})" *\\]`,
      "u",
    );
    return pair.test(body) && /exit 1/u.test(body);
  });
  if (check === undefined) {
    problems.push(
      "אין שלב שקורא את שני הצדדים מה-Registry (תג הקומיט מול `:latest`), משווה ביניהם ומפיל את הבנייה — כשל באמצע הלולאה היה נשאר פיצול שקט",
    );
  }
}

/* ‎3 · אותם יעדים בשני המקומות. */
const matrix = code.match(/matrix:\s*\n\s*target:\s*\[([^\]]*)\]/u);
if (matrix === null) {
  problems.push("לא נמצאה מטריצת היעדים ב-job הבנייה");
}
const loop = publish?.[1].match(/for\s+target\s+in\s+([^;\n]+?)\s*;\s*do/u) ?? null;
if (loop === null) {
  problems.push("לא נמצאה לולאת היעדים ב-`publish`");
}
if (matrix !== null && loop !== null) {
  const built = matrix[1].split(",").map((t) => t.trim()).filter(Boolean);
  const moved = loop[1].split(/\s+/u).filter(Boolean);
  const missing = built.filter((t) => !moved.includes(t));
  const extra = moved.filter((t) => !built.includes(t));
  if (missing.length > 0) {
    problems.push(
      `נבנים אך התג הזז שלהם חסר: ${missing.join(", ")} — \`:latest\` שלהם יישאר על קומיט ישן`,
    );
  }
  if (extra.length > 0) {
    problems.push(
      `‏\`publish\` מזיז יעדים שאינם נבנים: ${extra.join(", ")} — ההזזה תיכשל על תג שאינו קיים`,
    );
  }
}

if (problems.length > 0) {
  console.error("\n✗ שחרור התמונות אינו אטומי בין השירותים:\n");
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error(
    "\nכל השירותים נמשכים כ-`:latest` ומתעדכנים יחד. `:latest` שמצביע על שני קומיטים\nשונים פירושו מערכת שרצה בשתי גרסאות — ראו `packages/shared/src/logic/service-versions.ts`.\n",
  );
  process.exit(1);
}

console.log("✓ `:latest` זז לכל היעדים יחד, ורק אחרי שכולם נבנו");
